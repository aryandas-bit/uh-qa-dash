import { analyzeQuick, type QuickAnalysis, type TriageDigest, convertDigestToProvisionalAnalysis } from './groq.service.js';
import { analyzeTicket, type QAAnalysis, type CustomerTicketHistory } from './gemini.service.js';
import type { AuditMemoryRecord } from './database.service.js';

export interface HybridAnalysis {
  triage?: TriageDigest;
  groqQuick?: QuickAnalysis | { error: string };
  geminiDeep?: QAAnalysis | { error: string };
  merged: QAAnalysis;
  analysisPath: 'triage+judge' | 'judge-only' | 'triage-only' | 'error';
  isFallback: boolean;
  triageMs?: number;
  judgeMs?: number;
  totalTime: number;
}

/**
 * Run Groq triage → Gemini judge sequentially.
 * - Groq triage (fast): extracts structured facts, sentiment, priority
 * - Gemini judge (deep): full QA analysis with triage digest as context
 * - If Gemini succeeds: use Gemini result (with triage attached)
 * - If Gemini fails but Groq succeeds: convert triage to provisional analysis (labeled as fallback)
 * - If both fail: return minimal safe response (labeled as fallback)
 */
export async function analyzeHybrid(
  ticketId: string,
  messagesJson: string,
  firstCustomerMessage: string,
  lastAgentMessage: string,
  totalTurns: number,
  category?: string,
  tags?: string,
  customerHistory?: CustomerTicketHistory[],
  auditMemories?: AuditMemoryRecord[]
): Promise<HybridAnalysis> {
  const startTime = Date.now();
  let triageMs = 0;
  let judgeMs = 0;
  let triage: TriageDigest | undefined;

  // Stage 1: Groq triage (best-effort, absorb errors)
  try {
    const triageStart = Date.now();
    triage = await analyzeQuick(ticketId, firstCustomerMessage, lastAgentMessage, totalTurns);
    triageMs = Date.now() - triageStart;
  } catch (error) {
    console.warn(`[Hybrid] Triage failed for ticket=${ticketId}:`, (error as Error).message);
  }

  // Stage 2: Gemini judge (now with triage context if available)
  const geminiStart = Date.now();
  const geminiResult = await Promise.allSettled([
    analyzeTicket(ticketId, messagesJson, category, tags, customerHistory, auditMemories, triage),
  ]);
  judgeMs = Date.now() - geminiStart;

  const geminiSuccess = geminiResult[0].status === 'fulfilled';

  console.log(
    `[Hybrid] ticket=${ticketId} triage=${triage ? 'ok' : 'fail'} judge=${geminiSuccess ? 'ok' : 'fail'} totalMs=${Date.now() - startTime}`
  );

  // Merge results
  let analysisPath: HybridAnalysis['analysisPath'] = 'error';
  let merged: QAAnalysis;
  let isFallback = false;

  const geminiSettled = geminiResult[0];

  if (geminiSuccess && geminiSettled.status === 'fulfilled') {
    // Gemini succeeds: use it verbatim
    merged = geminiSettled.value;
    analysisPath = triage ? 'triage+judge' : 'judge-only';
  } else if (triage) {
    // Gemini fails but triage exists: convert triage to provisional analysis
    merged = convertDigestToProvisionalAnalysis(triage);
    analysisPath = 'triage-only';
    isFallback = true;
  } else {
    // Both failed: return safe default
    merged = createEmptyAnalysis(ticketId);
    analysisPath = 'error';
    isFallback = true;
  }

  return {
    triage,
    geminiDeep: geminiSettled.status === 'fulfilled'
      ? geminiSettled.value
      : { error: String((geminiSettled as PromiseRejectedResult).reason) },
    merged,
    analysisPath,
    isFallback,
    triageMs,
    judgeMs,
    totalTime: Date.now() - startTime,
  };
}


/**
 * Create a minimal safe analysis when both models fail
 */
function createEmptyAnalysis(ticketId: string): QAAnalysis {
  return {
    qaScore: 50,
    deductions: [{ category: 'process', points: -50, reason: 'Analysis service unavailable' }],
    sopCompliance: {
      score: 0,
      missedSteps: [],
      correctlyFollowed: [],
      matchedSOP: null,
    },
    sentiment: {
      customer: 'unknown',
      progression: 'unknown',
      agentTone: 'unknown',
    },
    customerContext: {
      isRepeatIssue: false,
      repeatIssueDetails: null,
      totalPreviousTickets: 0,
      previousAgents: [],
      customerExperience: 'neutral',
      recommendation: 'Manual review required',
    },
    resolution: {
      wasAbandoned: false,
      wasAutoResolved: false,
      customerIssueResolved: false,
      abandonmentDetails: null,
    },
    suggestions: ['Analysis service unavailable - manual review required'],
    summary: 'Analysis temporarily unavailable. Please retry later.',
  };
}

