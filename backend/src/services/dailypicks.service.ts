import {
  getDailyPickCandidates,
  getDailyPicksFromDb,
  saveDailyPicks,
  clearDailyPicksForAgent,
  markPickAnalyzed,
  syncDailyPickAnalysisFlags,
  getTicketById,
  getCustomerHistory,
  saveTicketAnalysis,
  getStoredTicketAnalysis,
  getStoredTicketAnalysisIds,
  getRelevantAuditMemories,
  saveAuditMemory,
  getQuickScoresBulk,
  saveQuickScoresBulk,
  getTicketMessagesBulk,
  type DailyPick,
  type DateMode,
  type TicketRow,
  type AuditMemoryRecord,
  type TicketQuickScore,
  type DailyPickCandidate,
} from './database.service.js';
import { analyzeTicket, type CustomerTicketHistory } from './gemini.service.js';
import { analyzeHybrid } from './analysis-hybrid.service.js';
import { analyzeQuick, type QuickAnalysis } from './groq.service.js';

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

function calculateRiskScore(analysis: QuickAnalysis): number {
  let score = 0;
  // Risk = (sentiment=angry: 3pts) + (priority=urgent: 2pts) + (hasError: 1pt)
  if (analysis.sentiment === 'angry') score += 3;
  else if (analysis.sentiment === 'negative') score += 1; // Slight boost for negative too

  if (analysis.priority === 'urgent') score += 2;
  if (analysis.hasError) score += 1;

  return score;
}

const MAX_CANDIDATES_TO_SCORE_PER_AGENT = 40;
const GROQ_CONCURRENCY = 5;

function pickRandomSubset<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[swapIndex]] = [pool[swapIndex], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
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

  const rawCandidates = await getDailyPickCandidates(date, dateMode);
  if (rawCandidates.length === 0) {
    return { picks: [], generated: true };
  }

  // Pre-sort candidates to limit Groq calls if we have huge volumes
  // Heuristic: lower CSAT first, then Urgent priority
  const candidatesByAgent = new Map<string, DailyPickCandidate[]>();
  rawCandidates.forEach((c) => {
    const list = candidatesByAgent.get(c.agentEmail) || [];
    list.push(c);
    candidatesByAgent.set(c.agentEmail, list);
  });

  const candidatesToScore: DailyPickCandidate[] = [];
  candidatesByAgent.forEach((list) => {
    // Sort each agent's tickets by heuristic: low CSAT, then priority
    const sorted = [...list].sort((a, b) => {
      const aCsat = a.csat ?? 5;
      const bCsat = b.csat ?? 5;
      if (aCsat !== bCsat) return aCsat - bCsat; // Lower CSAT is riskier
      if (a.priority === 'Urgent' && b.priority !== 'Urgent') return -1;
      if (a.priority !== 'Urgent' && b.priority === 'Urgent') return 1;
      return 0;
    });
    // Take top N for Groq analysis
    candidatesToScore.push(...sorted.slice(0, MAX_CANDIDATES_TO_SCORE_PER_AGENT));
  });

  const candidateIds = candidatesToScore.map(c => c.ticketId);
  const existingScores = await getQuickScoresBulk(candidateIds);
  const unscoredIds = candidateIds.filter(id => !existingScores[id]);

  // Perform Groq analysis for unscored candidates
  if (unscoredIds.length > 0) {
    console.log(`[DailyPicks] Scoring ${unscoredIds.length} unscored candidates with Groq...`);
    const messages = await getTicketMessagesBulk(unscoredIds);
    const newScores: TicketQuickScore[] = [];

    // Process in concurrent chunks
    for (let i = 0; i < unscoredIds.length; i += GROQ_CONCURRENCY) {
      const chunk = unscoredIds.slice(i, i + GROQ_CONCURRENCY);
      await Promise.all(chunk.map(async (ticketId) => {
        const messagesRaw = messages[ticketId] || '[]';
        const { firstCustomer, lastAgent, totalTurns } = parseMessagesForHybrid(messagesRaw);
        try {
          const quick = await analyzeQuick(ticketId, firstCustomer, lastAgent, totalTurns);
          const riskScore = calculateRiskScore(quick);
          newScores.push({
            ticketId,
            sentiment: quick.sentiment,
            priority: quick.priority,
            hasError: quick.hasError,
            issueCategory: quick.issueCategory,
            riskScore
          });
        } catch (err) {
          console.warn(`[DailyPicks] Failed to score ticket ${ticketId}:`, err);
        }
      }));
    }

    if (newScores.length > 0) {
      await saveQuickScoresBulk(newScores);
      newScores.forEach(s => {
        existingScores[s.ticketId] = s;
      });
    }
  }

  const allPicks: Array<{ pickDate: string; dateMode: DateMode; agentEmail: string; ticketId: string; pickOrder: number; risk_score?: number; pick_reason?: string; analyzed?: boolean; analysisStatus?: string | null }> = [];
  const storedAnalysisByTicket = await getStoredTicketAnalysisIds(rawCandidates.map((c) => c.ticketId));

  candidatesByAgent.forEach((agentCandidates, agentEmail) => {
    const rng = mulberry32(dateToSeed(date + agentEmail));
    
    // Initial shuffle of all candidates for variety
    const shuffledPool = seededShuffle(agentCandidates, rng);

    // Score and rank all in the pool
    const ranked = shuffledPool.map(c => ({
      candidate: c,
      score: existingScores[c.ticketId]?.riskScore ?? 0,
      rand: rng()
    })).sort((a, b) => {
      // Sort by score descending, then by their pre-assigned random value
      if (b.score !== a.score) return b.score - a.score;
      return b.rand - a.rand;
    });

    const totalToPick = Math.min(picksPerAgent, ranked.length);
    const riskLimit = Math.max(1, Math.floor(totalToPick * 0.7)); // 70% slots for risk (min 1 if pickable)
    
    const pickedTickets = new Set<string>();
    const finalPicks: Array<{ candidate: any; score: number; reason: string }> = [];

    // 1. Fill Risk Slots (Only if they have a non-zero risk score)
    const riskCandidates = ranked.filter(r => r.score > 0);
    for (let i = 0; i < Math.min(riskLimit, riskCandidates.length); i++) {
      const p = riskCandidates[i];
      finalPicks.push({ candidate: p.candidate, score: p.score, reason: 'High Risk' });
      pickedTickets.add(p.candidate.ticketId);
    }

    // 2. Fill the rest with Random Audit (Diverse sampling)
    // We shuffle the remaining unpicked tickets to get true diversity
    const remainingCandidates = ranked.filter(r => !pickedTickets.has(r.candidate.ticketId));
    const randomSlotsNeeded = totalToPick - finalPicks.length;
    
    for (let i = 0; i < Math.min(randomSlotsNeeded, remainingCandidates.length); i++) {
        const p = remainingCandidates[i];
        finalPicks.push({ candidate: p.candidate, score: p.score, reason: 'Random Audit' });
        pickedTickets.add(p.candidate.ticketId);
    }

    // Map to the final storage format
    finalPicks.forEach((p, idx) => {
      const hasStoredAnalysis = storedAnalysisByTicket.has(p.candidate.ticketId);
      allPicks.push({
        pickDate: date,
        dateMode,
        agentEmail,
        ticketId: p.candidate.ticketId,
        pickOrder: idx + 1,
        risk_score: p.score,
        pick_reason: p.reason,
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

export async function createAgentRandomSample(
  date: string,
  agentEmail: string,
  dateMode: DateMode = 'activity',
  picksCount = DEFAULT_PICKS_PER_AGENT
): Promise<DailyPick[]> {
  await syncExistingAnalyses(date, dateMode);

  const normalizedAgentEmail = decodeURIComponent(agentEmail);
  await clearDailyPicksForAgent(date, dateMode, normalizedAgentEmail);

  const allCandidates = await getDailyPickCandidates(date, dateMode);
  const agentCandidates = allCandidates.filter((candidate) => candidate.agentEmail === normalizedAgentEmail);
  if (agentCandidates.length === 0) {
    return [];
  }

  const resolvedCandidates = agentCandidates.filter((candidate) => candidate.ticketStatus?.toLowerCase() === 'resolved');
  const candidatePool = resolvedCandidates.length >= picksCount ? resolvedCandidates : agentCandidates;
  const selected = pickRandomSubset(candidatePool, picksCount);
  const storedAnalysisByTicket = await getStoredTicketAnalysisIds(selected.map((candidate) => candidate.ticketId));

  await saveDailyPicks(selected.map((candidate, index) => ({
    pickDate: date,
    dateMode,
    agentEmail: normalizedAgentEmail,
    ticketId: candidate.ticketId,
    pickOrder: index + 1,
    pick_reason: 'Random Audit',
    risk_score: null,
    analyzed: storedAnalysisByTicket.has(candidate.ticketId),
    analysisStatus: storedAnalysisByTicket.has(candidate.ticketId) ? 'success' : null,
  })));

  return (await getDailyPicksFromDb(date, dateMode))
    .filter((pick) => pick.agentEmail === normalizedAgentEmail)
    .sort((left, right) => left.pickOrder - right.pickOrder);
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
  processAuditBatch(date, dateMode, unanalyzed)
    .catch(err => console.error(`[DailyAudit] Batch failed for ${auditKey}:`, err))
    .finally(() => {
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
