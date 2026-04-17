import { analyzeQuick, type QuickAnalysis } from './groq.service.js';
import { analyzeTicket, type QAAnalysis, type CustomerTicketHistory } from './gemini.service.js';
import type { AuditMemoryRecord } from './database.service.js';

export interface HybridAnalysis {
  groqQuick?: QuickAnalysis | { error: string };
  geminiDeep?: QAAnalysis | { error: string };
  merged: QAAnalysis;
  analysisPath: 'groq+gemini' | 'groq-only' | 'gemini-only' | 'error';
  totalTime: number;
}

/**
 * Run Groq quick analysis + Gemini deep analysis in parallel.
 * - Groq fast path returns sentiment + priority + error flag + category instantly
 * - Gemini deep path runs in parallel for full QA analysis
 * - Results merge into final analysis_json
 * - If either model fails, fall back gracefully
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

  // Run both models in parallel
  const [groqResult, geminiResult] = await Promise.allSettled([
    analyzeQuick(ticketId, firstCustomerMessage, lastAgentMessage, totalTurns),
    analyzeTicket(ticketId, messagesJson, category, tags, customerHistory, auditMemories),
  ]);

  const groqSuccess = groqResult.status === 'fulfilled';
  const geminiSuccess = geminiResult.status === 'fulfilled';

  console.log(
    `[Hybrid] ticket=${ticketId} groq=${groqSuccess ? 'ok' : 'fail'} gemini=${geminiSuccess ? 'ok' : 'fail'}`
  );

  // Determine analysis path
  let analysisPath: HybridAnalysis['analysisPath'] = 'error';
  let merged: QAAnalysis;

  if (geminiSuccess) {
    // Gemini always wins (it's the truth)
    merged = geminiResult.value;
    if (groqSuccess) {
      analysisPath = 'groq+gemini';
    } else {
      analysisPath = 'gemini-only';
    }
  } else if (groqSuccess) {
    // Fallback: convert Groq quick to full analysis
    merged = convertQuickToFull(groqResult.value, ticketId);
    analysisPath = 'groq-only';
  } else {
    // Both failed - return minimal safe response
    merged = createEmptyAnalysis(ticketId);
    analysisPath = 'error';
  }

  return {
    groqQuick: groqSuccess
      ? groqResult.value
      : { ...getDefaultQuickAnalysis(), error: String(groqResult.reason) },
    geminiDeep: geminiSuccess
      ? geminiResult.value
      : { error: String(geminiResult.reason) },
    merged,
    analysisPath,
    totalTime: Date.now() - startTime,
  };
}

/**
 * Convert Groq quick analysis to a minimal full QA analysis
 * Used as fallback when Gemini fails
 */
function convertQuickToFull(quick: QuickAnalysis, ticketId: string): QAAnalysis {
  const baseScore = quick.hasError ? 50 : 85;
  const adjustedScore = quick.priority === 'urgent' ? Math.max(0, baseScore - 15) : baseScore;

  return {
    qaScore: adjustedScore,
    deductions: quick.hasError
      ? [{ category: 'process', points: -50, reason: 'Technical error reported' }]
      : [],
    sopCompliance: {
      score: 0,
      missedSteps: [],
      correctlyFollowed: [],
      matchedSOP: null,
    },
    sentiment: {
      customer: quick.sentiment,
      progression: 'unknown',
      agentTone: 'unknown',
    },
    customerContext: {
      isRepeatIssue: false,
      repeatIssueDetails: null,
      totalPreviousTickets: 0,
      previousAgents: [],
      customerExperience: 'neutral',
      recommendation: null,
    },
    resolution: {
      wasAbandoned: false,
      wasAutoResolved: false,
      customerIssueResolved: quick.sentiment === 'positive',
      abandonmentDetails: null,
    },
    suggestions: quick.hasError ? ['Investigate reported error'] : [],
    summary: `Quick triage: ${quick.sentiment} customer, ${quick.priority} priority, category=${quick.issueCategory}`,
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

function getDefaultQuickAnalysis(): QuickAnalysis {
  return {
    sentiment: 'neutral',
    priority: 'standard',
    hasError: false,
    issueCategory: 'other',
    analyzeTime: 0,
  };
}
