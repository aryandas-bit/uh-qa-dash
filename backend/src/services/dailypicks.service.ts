import {
  getDailyPickCandidates,
  getDailyPicksFromDb,
  saveDailyPicks,
  markPickAnalyzed,
  syncDailyPickAnalysisFlags,
  getTicketById,
  getCustomerHistory,
  saveTicketAnalysis,
  getStoredTicketAnalysis,
  getStoredTicketAnalysisIds,
  getRelevantAuditMemories,
  saveAuditMemory,
  type DailyPick,
  type DateMode,
  type TicketRow,
  type AuditMemoryRecord,
} from './database.service.js';
import { analyzeTicket, type CustomerTicketHistory } from './gemini.service.js';
import { analyzeHybrid } from './analysis-hybrid.service.js';

const DEFAULT_PICKS_PER_AGENT = 10;

// Parse messages for Groq quick analysis
function parseMessagesForHybrid(messagesJson: string): { firstCustomer: string; lastAgent: string; totalTurns: number } {
  let rawMessages: any[] = [];
  try {
    rawMessages = JSON.parse(messagesJson || '[]');
  } catch {
    return { firstCustomer: '', lastAgent: '', totalTurns: 0 };
  }

  let firstCustomer = '';
  let lastAgent = '';
  let totalTurns = rawMessages.length;

  for (const msg of rawMessages) {
    let sender = '';
    if (msg.s === 'U') sender = 'CUSTOMER';
    else if (msg.s === 'A') sender = 'AGENT';

    if (sender === 'CUSTOMER' && !firstCustomer) {
      firstCustomer = extractMessageContent(msg).substring(0, 300);
    }
    if (sender === 'AGENT') {
      lastAgent = extractMessageContent(msg).substring(0, 200);
    }
  }

  return { firstCustomer, lastAgent, totalTurns };
}

function extractMessageContent(msg: any): string {
  if (typeof msg?.m === 'string') {
    try {
      const parsed = JSON.parse(msg.m);
      if (Array.isArray(parsed)) return String(parsed[0]?.message || parsed[0]?.text || '');
      if (parsed.message) return String(parsed.message);
      if (parsed.text) return String(parsed.text);
      return msg.m;
    } catch {
      return msg.m;
    }
  }
  if (msg?.message) return String(msg.message);
  if (msg?.content) return String(msg.content);
  return '';
}

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
  await syncExistingAnalyses(date, dateMode);
  const existing = await getDailyPicksFromDb(date, dateMode);
  if (existing.length > 0) {
    return { picks: existing, generated: false };
  }

  const candidates = await getDailyPickCandidates(date, dateMode);
  if (candidates.length === 0) {
    return { picks: [], generated: true };
  }

  const rng = mulberry32(dateToSeed(date));
  const allPicks: Array<{ pickDate: string; dateMode: DateMode; agentEmail: string; ticketId: string; pickOrder: number; analyzed?: boolean; analysisStatus?: string | null }> = [];
  const byAgent = new Map<string, string[]>();

  candidates.forEach((candidate) => {
    const existingCandidates = byAgent.get(candidate.agentEmail) || [];
    existingCandidates.push(candidate.ticketId);
    byAgent.set(candidate.agentEmail, existingCandidates);
  });

  const storedAnalysisByTicket = await getStoredTicketAnalysisIds(candidates.map((candidate) => candidate.ticketId));

  byAgent.forEach((ticketIds, agentEmail) => {
    const shuffled = seededShuffle(ticketIds, rng);
    const picked = shuffled.slice(0, Math.min(picksPerAgent, shuffled.length));

    picked.forEach((ticketId, idx) => {
      const hasStoredAnalysis = storedAnalysisByTicket.has(ticketId);
      allPicks.push({
        pickDate: date,
        dateMode,
        agentEmail,
        ticketId,
        pickOrder: idx + 1,
        analyzed: hasStoredAnalysis,
        analysisStatus: hasStoredAnalysis ? 'success' : null,
      });
    });
  });

  if (allPicks.length > 0) {
    await saveDailyPicks(allPicks);
  }

  const picks = await getDailyPicksFromDb(date, dateMode);
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

export async function getAuditStatus(date: string, dateMode: DateMode = 'activity'): Promise<AuditProgress> {
  await syncExistingAnalyses(date, dateMode);
  const picks = await getDailyPicksFromDb(date, dateMode);
  const analyzed = picks.filter(p => p.analyzed).length;
  const errors = picks.filter(p => p.analysisStatus === 'error').length;

  return {
    date,
    total: picks.length,
    analyzed,
    pending: picks.length - analyzed,
    errors,
    inProgress: activeAudits.has(getAuditKey(date, dateMode)),
  };
}

export async function runDailyAudit(date: string, dateMode: DateMode = 'activity'): Promise<AuditProgress> {
  const auditKey = getAuditKey(date, dateMode);
  if (activeAudits.has(auditKey)) {
    return getAuditStatus(date, dateMode);
  }

  // Ensure picks exist
  const { picks } = await getDailyPicks(date, DEFAULT_PICKS_PER_AGENT, dateMode);
  const unanalyzed = picks.filter(p => !p.analyzed);

  if (unanalyzed.length === 0) {
    return getAuditStatus(date, dateMode);
  }

  activeAudits.add(auditKey);

  // Safety timeout: auto-remove audit key after 30 minutes in case batch hangs
  const timeout = setTimeout(() => {
    if (activeAudits.has(auditKey)) {
      console.warn(`[DailyAudit] Timeout — force-removing stale audit key: ${auditKey}`);
      activeAudits.delete(auditKey);
    }
  }, 30 * 60 * 1000);

  // Run analysis in background — don't await
  processAuditBatch(date, dateMode, unanalyzed).finally(() => {
    clearTimeout(timeout);
    activeAudits.delete(auditKey);
  });

  return getAuditStatus(date, dateMode);
}

const AUDIT_CONCURRENCY = Math.max(1, Number(process.env.DAILY_AUDIT_CONCURRENCY || '2'));
const AUDIT_CHUNK_DELAY_MS = Math.max(250, Number(process.env.DAILY_AUDIT_CHUNK_DELAY_MS || '500'));

async function processAuditBatch(date: string, dateMode: DateMode, picks: DailyPick[]): Promise<void> {
  // Promise-based cache: all concurrent calls for the same email await the same fetch
  const historyCache = new Map<string, Promise<any[]>>();
  const memoryCache = new Map<string, Promise<AuditMemoryRecord[]>>();

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
        csat: normalizeCsatValue(t.TICKET_CSAT),
      }));
  }

  function buildIssueSignature(ticket: Pick<TicketRow, 'GROUP_NAME' | 'SUBJECT' | 'TAGS'>): string {
    const category = normalizeSignaturePart(ticket.GROUP_NAME || 'unknown');
    const subject = normalizeSignaturePart(ticket.SUBJECT || 'unknown subject')
      .split(' ')
      .filter(Boolean)
      .slice(0, 6)
      .join(' ');
    const tagPart = extractTagTokens(ticket.TAGS).slice(0, 4).join(' ');
    return [category, subject, tagPart].filter(Boolean).join(' | ');
  }

  async function analyzeOne(pick: DailyPick): Promise<void> {
    try {
      const stored = await getStoredTicketAnalysis(pick.ticketId);
      if (stored) {
        await markPickAnalyzed(date, dateMode, pick.ticketId, 'success');
        return;
      }

      const ticket = await getTicketById(pick.ticketId);
      if (!ticket) {
        await markPickAnalyzed(date, dateMode, pick.ticketId, 'error');
        return;
      }

      // Skip tickets with no messages — Gemini returns 400 on empty transcripts
      const messagesRaw = ticket.MESSAGES_JSON;
      if (!messagesRaw || messagesRaw === 'null' || messagesRaw.trim() === '[]' || messagesRaw.trim() === '') {
        console.warn(`[DailyAudit] Skipping ticket ${pick.ticketId} — empty MESSAGES_JSON`);
        await markPickAnalyzed(date, dateMode, pick.ticketId, 'error');
        return;
      }

      let customerHistory: CustomerTicketHistory[] = [];
      let auditMemories: AuditMemoryRecord[] = [];
      const issueSignature = buildIssueSignature(ticket);
      if (ticket.VISITOR_EMAIL) {
        // Cache with error recovery — a failed fetch returns [] instead of poisoning the cache
        if (!historyCache.has(ticket.VISITOR_EMAIL)) {
          historyCache.set(ticket.VISITOR_EMAIL,
            getCustomerHistory(ticket.VISITOR_EMAIL, 12).catch(err => {
              console.warn(`[DailyAudit] History fetch failed for ${ticket.VISITOR_EMAIL}:`, err.message);
              return [];
            })
          );
        }
        const rawHistory = await historyCache.get(ticket.VISITOR_EMAIL)!;
        customerHistory = formatHistory(rawHistory, pick.ticketId, ticket.INITIALIZED_TIME);

        const memoryKey = `${ticket.VISITOR_EMAIL.toLowerCase()}::${issueSignature}`;
        if (!memoryCache.has(memoryKey)) {
          memoryCache.set(memoryKey,
            getRelevantAuditMemories(ticket.VISITOR_EMAIL, issueSignature, 2).catch(err => {
              console.warn(`[DailyAudit] Memory fetch failed for ${memoryKey}:`, err.message);
              return [];
            })
          );
        }
        auditMemories = await memoryCache.get(memoryKey)!;
      }

      // Extract message snippets for Groq quick analysis
      const { firstCustomer, lastAgent, totalTurns } = parseMessagesForHybrid(messagesRaw);

      // Run HYBRID analysis: Groq quick + Gemini deep in parallel
      const hybridResult = await analyzeHybrid(
        pick.ticketId,
        messagesRaw,
        firstCustomer,
        lastAgent,
        totalTurns,
        ticket.GROUP_NAME,
        ticket.TAGS,
        customerHistory,
        auditMemories
      );

      const analysis = hybridResult.merged;

      // Log which path was used for debugging
      console.log(`[DailyAudit] ticket=${pick.ticketId} path=${hybridResult.analysisPath} time=${hybridResult.totalTime}ms`);

      // Persist to DB so TicketPage can retrieve without re-analyzing
      await saveTicketAnalysis(pick.ticketId, analysis, 'daily_audit');
      if (ticket.VISITOR_EMAIL) {
        await saveAuditMemory({
          customerEmail: ticket.VISITOR_EMAIL,
          issueSignature,
          category: ticket.GROUP_NAME,
          subject: ticket.SUBJECT,
          tags: ticket.TAGS,
          ticketId: String(ticket.TICKET_ID),
          ticketDate: ticket.DAY,
          agentEmail: ticket.AGENT_EMAIL,
          repeatIssue: Boolean(analysis.customerContext?.isRepeatIssue),
          customerExperience: analysis.customerContext?.customerExperience || null,
          customerContext: analysis.customerContext?.repeatIssueDetails || analysis.customerContext?.recommendation || null,
          resolutionState: buildResolutionState(analysis),
          resolutionNotes: buildResolutionNotes(analysis),
          deductionSummary: buildDeductionSummary(analysis),
          missedSteps: analysis.sopCompliance?.missedSteps?.join(' | ') || null,
          suggestions: analysis.suggestions?.slice(0, 3).join(' | ') || null,
          qaScore: analysis.qaScore ?? null,
        });
      }
      await markPickAnalyzed(date, dateMode, pick.ticketId, 'success');
    } catch (error) {
      console.error(`[DailyAudit] Failed ticket ${pick.ticketId}:`, (error as Error).message);
      await markPickAnalyzed(date, dateMode, pick.ticketId, 'error');
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

async function syncExistingAnalyses(date: string, dateMode: DateMode): Promise<void> {
  await syncDailyPickAnalysisFlags(date, dateMode);
}

function getAuditKey(date: string, dateMode: DateMode): string {
  return `${date}:${dateMode}`;
}

function normalizeSignaturePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTagTokens(tags?: string): string[] {
  if (!tags) return [];

  try {
    const parsed = JSON.parse(tags);
    if (Array.isArray(parsed)) {
      return parsed
        .map((tag) => normalizeSignaturePart(String(tag)))
        .filter(Boolean);
    }
  } catch {
    return normalizeSignaturePart(tags).split(' ').filter(Boolean);
  }

  return [];
}

function buildDeductionSummary(analysis: any): string | null {
  if (!Array.isArray(analysis?.deductions) || analysis.deductions.length === 0) {
    return null;
  }

  return analysis.deductions
    .slice(0, 4)
    .map((deduction: any) => `${deduction.category}: ${deduction.reason}`)
    .join(' | ');
}

function buildResolutionState(analysis: any): string {
  if (analysis?.resolution?.wasAbandoned) return 'abandoned';
  if (analysis?.resolution?.customerIssueResolved) return 'resolved';
  if (analysis?.resolution?.wasAutoResolved) return 'auto_resolved';
  return 'unresolved';
}

function buildResolutionNotes(analysis: any): string | null {
  return analysis?.resolution?.abandonmentDetails || analysis?.summary || null;
}

function normalizeCsatValue(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric;
}
