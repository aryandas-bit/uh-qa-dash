import {
  getActiveAgentEmails,
  getAgentTicketIds,
  getDailyPicksFromDb,
  saveDailyPicks,
  markPickAnalyzed,
  getTicketById,
  getCustomerHistory,
  saveTicketAnalysis,
  type DailyPick,
  type DateMode,
} from './database.service.js';
import { analyzeTicket, batchAnalyze, type CustomerTicketHistory } from './gemini.service.js';

const DEFAULT_PICKS_PER_AGENT = 20;

// Mulberry32 — fast, deterministic 32-bit PRNG
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateToSeed(dateStr: string): number {
  return parseInt(dateStr.replace(/-/g, ''), 10);
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function getDailyPicks(
  date: string,
  picksPerAgent = DEFAULT_PICKS_PER_AGENT,
  dateMode: DateMode = 'activity'
): Promise<{ picks: DailyPick[]; generated: boolean }> {
  // Check cache first
  const existing = await getDailyPicksFromDb(date);
  if (existing.length > 0) {
    return { picks: existing, generated: false };
  }

  // Generate new picks — use lightweight agent email query
  const agentEmails = await getActiveAgentEmails(date, dateMode);
  if (agentEmails.length === 0) {
    return { picks: [], generated: true };
  }

  const rng = mulberry32(dateToSeed(date));
  const allPicks: Array<{ pickDate: string; agentEmail: string; ticketId: string; pickOrder: number }> = [];

  for (const agentEmail of agentEmails) {
    const ticketIds = await getAgentTicketIds(agentEmail, date, dateMode);
    if (ticketIds.length === 0) continue;

    const shuffled = seededShuffle(ticketIds, rng);
    const picked = shuffled.slice(0, Math.min(picksPerAgent, shuffled.length));

    picked.forEach((ticketId, idx) => {
      allPicks.push({
        pickDate: date,
        agentEmail,
        ticketId,
        pickOrder: idx + 1,
      });
    });
  }

  if (allPicks.length > 0) {
    await saveDailyPicks(allPicks);
  }

  const picks = await getDailyPicksFromDb(date);
  return { picks, generated: true };
}

export interface AuditProgress {
  date: string;
  total: number;
  analyzed: number;
  pending: number;
  errors: number;
  inProgress: boolean;
}

// Track active audits to prevent duplicate runs
const activeAudits = new Set<string>();

export async function getAuditStatus(date: string): Promise<AuditProgress> {
  const picks = await getDailyPicksFromDb(date);
  const analyzed = picks.filter(p => p.analyzed).length;
  const errors = picks.filter(p => p.analysisStatus === 'error').length;

  return {
    date,
    total: picks.length,
    analyzed,
    pending: picks.length - analyzed,
    errors,
    inProgress: activeAudits.has(date),
  };
}

export async function runDailyAudit(date: string): Promise<AuditProgress> {
  if (activeAudits.has(date)) {
    return getAuditStatus(date);
  }

  // Ensure picks exist
  const { picks } = await getDailyPicks(date);
  const unanalyzed = picks.filter(p => !p.analyzed);

  if (unanalyzed.length === 0) {
    return getAuditStatus(date);
  }

  activeAudits.add(date);

  // Run analysis in background — don't await
  processAuditBatch(date, unanalyzed).finally(() => {
    activeAudits.delete(date);
  });

  return getAuditStatus(date);
}

const AUDIT_CONCURRENCY = 5;
const AUDIT_CHUNK_DELAY_MS = 1000; // 1s between chunks of 5

async function processAuditBatch(date: string, picks: DailyPick[]): Promise<void> {
  // Promise-based cache: all concurrent calls for the same email await the same fetch
  const historyCache = new Map<string, Promise<any[]>>();

  function formatHistory(tickets: any[], currentTicketId: string, currentTime?: string): CustomerTicketHistory[] {
    return tickets
      .filter(t => String(t.TICKET_ID) !== String(currentTicketId))
      .filter(t => {
        if (currentTime && t.INITIALIZED_TIME) {
          return new Date(t.INITIALIZED_TIME) < new Date(currentTime);
        }
        return Number(t.TICKET_ID) < Number(currentTicketId);
      })
      .map(t => ({
        ticketId: String(t.TICKET_ID),
        subject: t.SUBJECT || 'No subject',
        date: t.DAY || '',
        agentEmail: t.AGENT_EMAIL || '',
        status: t.TICKET_STATUS || 'Unknown',
        priority: t.PRIORITY || 'Normal',
        csat: t.TICKET_CSAT > 0 ? t.TICKET_CSAT : undefined,
      }));
  }

  async function analyzeOne(pick: DailyPick): Promise<void> {
    try {
      const ticket = await getTicketById(pick.ticketId);
      if (!ticket) {
        await markPickAnalyzed(date, pick.ticketId, 'error');
        return;
      }

      // Skip tickets with no messages — Gemini returns 400 on empty transcripts
      const messagesRaw = ticket.MESSAGES_JSON;
      if (!messagesRaw || messagesRaw === 'null' || messagesRaw.trim() === '[]' || messagesRaw.trim() === '') {
        console.warn(`[DailyAudit] Skipping ticket ${pick.ticketId} — empty MESSAGES_JSON`);
        await markPickAnalyzed(date, pick.ticketId, 'error');
        return;
      }

      let customerHistory: CustomerTicketHistory[] = [];
      if (ticket.VISITOR_EMAIL) {
        // Store a Promise — concurrent calls for same email share the same fetch
        if (!historyCache.has(ticket.VISITOR_EMAIL)) {
          historyCache.set(ticket.VISITOR_EMAIL, getCustomerHistory(ticket.VISITOR_EMAIL, 12));
        }
        const rawHistory = await historyCache.get(ticket.VISITOR_EMAIL)!;
        customerHistory = formatHistory(rawHistory, pick.ticketId, ticket.INITIALIZED_TIME);
      }

      const analysis = await analyzeTicket(
        pick.ticketId,
        messagesRaw,
        ticket.GROUP_NAME,
        ticket.TAGS,
        customerHistory
      );

      // Persist to DB so TicketPage can retrieve without re-analyzing
      await saveTicketAnalysis(pick.ticketId, analysis, 'daily_audit');
      await markPickAnalyzed(date, pick.ticketId, 'success');
    } catch (error) {
      console.error(`[DailyAudit] Failed ticket ${pick.ticketId}:`, (error as Error).message);
      await markPickAnalyzed(date, pick.ticketId, 'error');
    }
  }

  // Process in concurrent chunks
  for (let i = 0; i < picks.length; i += AUDIT_CONCURRENCY) {
    const chunk = picks.slice(i, i + AUDIT_CONCURRENCY);
    await Promise.all(chunk.map(analyzeOne));
    if (i + AUDIT_CONCURRENCY < picks.length) {
      await new Promise(r => setTimeout(r, AUDIT_CHUNK_DELAY_MS));
    }
  }
}
