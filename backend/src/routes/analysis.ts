import { Router } from 'express';
import { analyzeTicket, batchAnalyze, CustomerTicketHistory } from '../services/gemini.service.js';
import { analyzeHybrid } from '../services/analysis-hybrid.service.js';
import { getTicketById, getFlaggedTickets, getAgentTickets, getTicketsByIds, getCustomerHistory, getRelevantAuditMemories, saveAuditMemory, AuditMemoryRecord, TicketRow, saveQAReview, getQAReview, deleteQAReview, getQAReviewsBulk, getAllQAReviews, getAllQAReviewsWithTickets, saveTicketAnalysis, getStoredTicketAnalysis, saveQAScore, getQAScoresBulk } from '../services/database.service.js';
import { upsertReviewToSheet, deleteReviewFromSheet } from '../services/sheets.service.js';
import { getAllSOPs, getSOPCategories } from '../services/sop.service.js';
import NodeCache from 'node-cache';

const BATCH_ANALYSIS_CONCURRENCY = Math.max(1, Number(process.env.GEMINI_BATCH_MAX_CONCURRENT || '1'));

// Helper to format customer history for analysis - only PREVIOUS tickets (before current)
function formatCustomerHistoryForAnalysis(
  tickets: TicketRow[],
  currentTicketId: string,
  currentTicketTime?: string
): CustomerTicketHistory[] {
  const currentIdStr = String(currentTicketId);
  const currentIdNum = Number(currentTicketId);

  return tickets
    .filter(t => {
      // Exclude current ticket
      if (String(t.TICKET_ID) === currentIdStr) return false;

      // Only include tickets that are OLDER than current ticket
      // Compare by INITIALIZED_TIME if available
      if (currentTicketTime && t.INITIALIZED_TIME) {
        return new Date(t.INITIALIZED_TIME) < new Date(currentTicketTime);
      }
      // Fallback: compare by ticket ID (lower ID = older ticket)
      return Number(t.TICKET_ID) < currentIdNum;
    })
    .map(t => ({
      ticketId: String(t.TICKET_ID),
      subject: t.SUBJECT || 'No subject',
      date: t.DAY || '',
      agentEmail: t.AGENT_EMAIL || '',
      status: t.TICKET_STATUS || 'Unknown',
      priority: t.PRIORITY || 'Normal',
      csat: t.TICKET_CSAT && t.TICKET_CSAT > 0 ? t.TICKET_CSAT : undefined
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

function normalizeSignaturePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

interface ParsedMessage {
  sender: 'CUSTOMER' | 'AGENT' | 'BOT' | 'INTERNAL_NOTE' | 'UNKNOWN';
  content: string;
}

function parseMessages(messagesJson: string): ParsedMessage[] {
  let rawMessages: any[] = [];
  try {
    rawMessages = JSON.parse(messagesJson || '[]');
  } catch {
    return [];
  }

  return rawMessages.map((msg: any) => {
    let sender: ParsedMessage['sender'] = 'UNKNOWN';
    if (msg.s === 'U') sender = 'CUSTOMER';
    else if (msg.s === 'A') sender = 'AGENT';
    else if (msg.s === 'B') sender = 'BOT';
    else if (msg.s === 'N') sender = 'INTERNAL_NOTE';

    let content = '';
    if (typeof msg.m === 'string') {
      try {
        const parsed = JSON.parse(msg.m);
        if (Array.isArray(parsed)) {
          content = parsed[0]?.message || parsed[0]?.text || '';
        } else if (parsed.message) {
          content = parsed.message;
        } else if (parsed.text) {
          content = parsed.text;
        } else {
          content = msg.m;
        }
      } catch {
        content = msg.m;
      }
    } else if (msg.message) {
      content = msg.message;
    } else if (msg.content) {
      content = msg.content;
    }

    return { sender, content: String(content).substring(0, 500) };
  }).filter(m => m.content.length > 0);
}

async function getTicketAnalysisContext(ticketId: string) {
  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    return {
      ticket: null,
      issueSignature: '',
      auditMemories: [] as AuditMemoryRecord[],
      customerHistory: [] as CustomerTicketHistory[],
    };
  }

  const issueSignature = buildIssueSignature(ticket);
  const auditMemories = ticket.VISITOR_EMAIL
    ? await getRelevantAuditMemories(ticket.VISITOR_EMAIL, issueSignature, 3)
    : [];
  const customerHistory = ticket.VISITOR_EMAIL
    ? formatCustomerHistoryForAnalysis(
        await getCustomerHistory(ticket.VISITOR_EMAIL, 20),
        ticketId,
        ticket.INITIALIZED_TIME
      )
    : [];

  return { ticket, issueSignature, auditMemories, customerHistory };
}

const router = Router();
const analysisCache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache for analyses

// Deduplicate concurrent analysis requests for the same ticket
const inFlightAnalyses = new Map<string, Promise<any>>();

// GET /api/analysis/sops - Get all available SOPs
router.get('/sops', (req, res) => {
  try {
    const sops = getAllSOPs();
    const categories = getSOPCategories();
    res.json({ sops, categories, count: sops.length });
  } catch (error) {
    console.error('Error fetching SOPs:', error);
    res.status(500).json({ error: 'Failed to fetch SOPs' });
  }
});

// GET /api/analysis/ticket/:id - Get or create analysis for a ticket
router.get('/ticket/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const forceRefresh = req.query.refresh === 'true';
    const cacheOnly = req.query.cacheOnly === 'true';

    // 1. Check in-memory cache (fastest)
    if (!forceRefresh) {
      const cached = analysisCache.get(id);
      if (cached) {
        const { auditMemories, customerHistory } = await getTicketAnalysisContext(id);
        const review = await getQAReview(id);
        return res.json({ ticketId: id, analysis: cached, cached: true, review: review || null, auditMemories, customerHistory: customerHistory.slice(0, 10) });
      }

      // 2. Check DB (persisted across restarts)
      const stored = await getStoredTicketAnalysis(id);
      if (stored) {
        analysisCache.set(id, stored); // warm up memory cache
        const { auditMemories, customerHistory } = await getTicketAnalysisContext(id);
        const review = await getQAReview(id);
        return res.json({ ticketId: id, analysis: stored, cached: true, review: review || null, auditMemories, customerHistory: customerHistory.slice(0, 10) });
      }
    }

    // cacheOnly mode: return null analysis instead of triggering Gemini
    if (cacheOnly) {
      const { auditMemories, customerHistory } = await getTicketAnalysisContext(id);
      const review = await getQAReview(id);
      return res.json({ ticketId: id, analysis: null, cached: false, review: review || null, auditMemories, customerHistory: customerHistory.slice(0, 10) });
    }

    // 3. Deduplicate: if another request is already analyzing this ticket, wait for it
    if (inFlightAnalyses.has(id)) {
      try {
        const existing = await inFlightAnalyses.get(id);
        const { auditMemories, customerHistory } = await getTicketAnalysisContext(id);
        const review = await getQAReview(id);
        return res.json({ ticketId: id, analysis: existing, cached: true, review: review || null, auditMemories, customerHistory: customerHistory.slice(0, 10) });
      } catch {
        // Previous request failed — fall through and try again
      }
    }

    // 4. Get ticket data for fresh analysis
    const ticket = await getTicketById(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Guard: skip tickets with no messages — Gemini can't analyze empty transcripts
    const messagesRaw = ticket.MESSAGES_JSON;
    if (!messagesRaw || messagesRaw === 'null' || messagesRaw.trim() === '[]' || messagesRaw.trim() === '') {
      return res.status(422).json({ error: 'Ticket has no messages to analyze' });
    }

    // Get customer history for context (only tickets BEFORE current one)
    let customerHistory: CustomerTicketHistory[] = [];
    const issueSignature = buildIssueSignature(ticket);
    let auditMemories: AuditMemoryRecord[] = [];
    if (ticket.VISITOR_EMAIL) {
      const historyTickets = await getCustomerHistory(ticket.VISITOR_EMAIL, 20);
      customerHistory = formatCustomerHistoryForAnalysis(historyTickets, id, ticket.INITIALIZED_TIME);
      auditMemories = await getRelevantAuditMemories(ticket.VISITOR_EMAIL, issueSignature, 3);
      console.log(`[Analysis] Customer ${ticket.VISITOR_EMAIL} has ${customerHistory.length} previous tickets`);
    }

    // Extract first customer message and last agent message for quick analysis
    const messages = parseMessages(messagesRaw);
    const firstCustomerMsg = messages.find(m => m.sender === 'CUSTOMER')?.content || '';
    const lastAgentMsg = messages.filter(m => m.sender === 'AGENT').at(-1)?.content || '';
    const totalTurns = messages.length;

    // Run HYBRID analysis: Groq quick + Gemini deep in parallel (with dedup)
    const analysisPromise = analyzeHybrid(
      id,
      messagesRaw,
      firstCustomerMsg,
      lastAgentMsg,
      totalTurns,
      ticket.GROUP_NAME,
      ticket.TAGS,
      customerHistory,
      auditMemories
    );
    inFlightAnalyses.set(id, analysisPromise.then(r => r.merged));

    let hybridResult;
    try {
      hybridResult = await analysisPromise;
    } finally {
      inFlightAnalyses.delete(id);
    }

    // Use merged analysis (Gemini deep if available, else Groq quick fallback)
    const analysis = hybridResult.merged;

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

    // Persist extended analysis (includes triage digest + fallback flag) to DB
    const extendedAnalysis = {
      ...analysis,
      triage: hybridResult.triage || null,
      isFallback: hybridResult.isFallback,
      analysisPath: hybridResult.analysisPath,
    };
    await saveTicketAnalysis(id, extendedAnalysis, 'manual');
    analysisCache.set(id, extendedAnalysis);
    // Only persist QA score if Gemini was the source (not a fallback)
    if (!hybridResult.isFallback) {
      saveQAScore(id, analysis.qaScore, analysis.summary, analysis.deductions).catch(e =>
        console.error('[Analysis] Failed to persist QA score:', e)
      );
    }

    const review = await getQAReview(id);

    res.json({
      ticketId: id,
      analysis,
      cached: false,
      review: review || null,
      auditMemories,
      customerHistory: customerHistory.slice(0, 10),
      ticket: {
        subject: ticket.SUBJECT,
        agentEmail: ticket.AGENT_EMAIL,
        customerEmail: ticket.VISITOR_EMAIL,
        csat: ticket.TICKET_CSAT,
        date: ticket.DAY
      },
      analysisInfo: {
        path: hybridResult.analysisPath,
        isFallback: hybridResult.isFallback,
        triage: hybridResult.triage || null,
        triageMs: hybridResult.triageMs,
        judgeMs: hybridResult.judgeMs,
        totalTime: hybridResult.totalTime,
      }
    });
  } catch (error: any) {
    console.error('Error analyzing ticket:', error);
    res.status(500).json({ error: 'Failed to analyze ticket', detail: error?.message || String(error) });
  }
});

// POST /api/analysis/ticket/:id/review - Approve or flag a QA analysis
router.post('/ticket/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, reviewerName } = req.body;

    if (!status || !['approved', 'flagged'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "approved" or "flagged"' });
    }

    await saveQAReview(id, status as 'approved' | 'flagged', note, reviewerName);
    const review = await getQAReview(id);

    // Sync to Google Sheets (non-blocking)
    const ticket = await getTicketById(id);
    const scores = await getQAScoresBulk([id]);
    const scoreInfo = scores[id];

    upsertReviewToSheet(id, status, note, reviewerName, {
      subject: ticket?.SUBJECT,
      agentEmail: ticket?.AGENT_EMAIL,
      csat: ticket?.TICKET_CSAT,
      day: ticket?.DAY,
      qaScore: scoreInfo?.qaScore,
      summary: scoreInfo?.summary || undefined,
      deductions: scoreInfo?.deductions?.map(d => `${d.category}: ${d.reason}`).join(' | '),
    }).catch(err => console.error('[Sheets] Failed to sync review:', err.message));

    res.json({ ticketId: id, review });
  } catch (error) {
    console.error('Error saving review:', error);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// DELETE /api/analysis/ticket/:id/review - Remove review (reset to pending)
router.delete('/ticket/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteQAReview(id);
    deleteReviewFromSheet(id).catch(err => console.error('[Sheets] Failed to delete review:', err.message));
    res.json({ ticketId: id, review: null });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// POST /api/analysis/batch - Batch analyze tickets
router.post('/batch', async (req, res) => {
  try {
    const { date, agentEmail, limit = 20, prioritizeFlagged = true, dateMode = 'activity', ticketIds: specificIds, forceRefresh = false } = req.body;

    // Get tickets to analyze
    let tickets;
    if (specificIds && specificIds.length > 0) {
      // Direct ID list — used by chunked frontend calls
      tickets = await getTicketsByIds(specificIds as string[]);
    } else {
      if (!date) return res.status(400).json({ error: 'Date is required' });
      if (agentEmail) {
        tickets = await getAgentTickets(agentEmail, date, limit, 0, dateMode);
      } else {
        tickets = await getFlaggedTickets(date, limit);
      }
    }

    if (tickets.length === 0) {
      return res.json({ message: 'No tickets to analyze', results: [], newlyAnalyzed: 0 });
    }

    const ticketsTyped = tickets as TicketRow[];
    const allTicketIds = ticketsTyped.map(t => String(t.TICKET_ID));

    // Check DB for already-persisted scores so we skip re-analysis after restarts
    // forceRefresh bypasses both memory and DB cache (e.g. after SOP updates)
    const dbScores = forceRefresh ? {} : await getQAScoresBulk(allTicketIds);

    const cachedResults: any[] = [];
    const needsAnalysis: TicketRow[] = [];

    for (const t of ticketsTyped) {
      const id = String(t.TICKET_ID);
      const memCached = forceRefresh ? null : analysisCache.get<any>(id);
      if (memCached) {
        cachedResults.push({ ticketId: id, analysis: memCached, cached: true });
      } else if (dbScores[id]) {
        // Already in DB — re-populate memory cache with a minimal stub carrying the score
        cachedResults.push({
          ticketId: id,
          analysis: { qaScore: dbScores[id].qaScore, summary: dbScores[id].summary },
          cached: true,
        });
      } else {
        needsAnalysis.push(t);
      }
    }

    // Analyze tickets with no existing score
    if (needsAnalysis.length > 0) {
      const toAnalyze = await Promise.all(needsAnalysis.map(async (ticket) => {
        let customerHistory: CustomerTicketHistory[] = [];
        let auditMemories: AuditMemoryRecord[] = [];
        const issueSignature = buildIssueSignature(ticket);

        if (ticket.VISITOR_EMAIL) {
          const historyTickets = await getCustomerHistory(ticket.VISITOR_EMAIL, 12);
          customerHistory = formatCustomerHistoryForAnalysis(
            historyTickets,
            String(ticket.TICKET_ID),
            ticket.INITIALIZED_TIME
          );
          auditMemories = await getRelevantAuditMemories(ticket.VISITOR_EMAIL, issueSignature, 2);
        }

        return {
          ticket,
          issueSignature,
          ticketId: ticket.TICKET_ID,
          messagesJson: ticket.MESSAGES_JSON,
          category: ticket.GROUP_NAME,
          tags: ticket.TAGS,
          customerHistory,
          auditMemories
        };
      }));

      console.log(`[Batch] Analyzing ${toAnalyze.length} new tickets (${cachedResults.length} already scored)`);
      const results = await batchAnalyze(toAnalyze, BATCH_ANALYSIS_CONCURRENCY);
      const ticketLookup = new Map(toAnalyze.map((entry) => [String(entry.ticketId), entry]));

      for (const [ticketId, analysis] of results.entries()) {
        if (!(analysis instanceof Error)) {
          analysisCache.set(ticketId, analysis);
          cachedResults.push({ ticketId, analysis, cached: false });

          await saveQAScore(ticketId, analysis.qaScore, analysis.summary, analysis.deductions).catch(e =>
            console.error('[Batch] Failed to persist QA score for', ticketId, e)
          );

          const source = ticketLookup.get(String(ticketId));
          if (source?.ticket?.VISITOR_EMAIL) {
            await saveAuditMemory({
              customerEmail: source.ticket.VISITOR_EMAIL,
              issueSignature: source.issueSignature,
              category: source.ticket.GROUP_NAME,
              subject: source.ticket.SUBJECT,
              tags: source.ticket.TAGS,
              ticketId: String(source.ticket.TICKET_ID),
              ticketDate: source.ticket.DAY,
              agentEmail: source.ticket.AGENT_EMAIL,
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
        } else {
          cachedResults.push({ ticketId, error: analysis.message, cached: false });
        }
      }
    }

    // Summary stats
    const successful = cachedResults.filter(r => !r.error);
    const avgScore = successful.length > 0
      ? successful.reduce((sum, r) => sum + (r.analysis.qaScore ?? 0), 0) / successful.length
      : 0;

    res.json({
      date,
      agentEmail: agentEmail || 'all',
      totalAnalyzed: cachedResults.length,
      newlyAnalyzed: needsAnalysis?.length ?? 0,
      successCount: successful.length,
      avgQAScore: Math.round(avgScore * 10) / 10,
      results: cachedResults,
    });
  } catch (error) {
    console.error('Error in batch analysis:', error);
    res.status(500).json({ error: 'Failed to complete batch analysis' });
  }
});

// GET /api/analysis/agent/:email/summary - Get analysis summary for an agent
router.get('/agent/:email/summary', async (req, res) => {
  try {
    const { email } = req.params;
    const date = req.query.date as string;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const tickets = await getAgentTickets(email, date, 100, 0);

    // Get cached analyses
    const analyses: any[] = [];
    tickets.forEach(t => {
      const cached = analysisCache.get(t.TICKET_ID);
      if (cached) {
        analyses.push({
          ticketId: t.TICKET_ID,
          analysis: cached,
          csat: t.TICKET_CSAT,
          subject: t.SUBJECT
        });
      }
    });

    // Calculate category breakdown
    const categoryBreakdown: Record<string, { count: number; totalPoints: number }> = {
      opening: { count: 0, totalPoints: 0 },
      quality: { count: 0, totalPoints: 0 },
      grammar: { count: 0, totalPoints: 0 },
      closing: { count: 0, totalPoints: 0 },
      fatal: { count: 0, totalPoints: 0 }
    };

    analyses.forEach(a => {
      a.analysis.deductions?.forEach((d: any) => {
        const cat = d.category.toLowerCase();
        if (categoryBreakdown[cat]) {
          categoryBreakdown[cat].count++;
          categoryBreakdown[cat].totalPoints += Math.abs(d.points);
        }
      });
    });

    const avgScore = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + a.analysis.qaScore, 0) / analyses.length
      : null;

    res.json({
      agentEmail: email,
      date,
      totalTickets: tickets.length,
      analyzedCount: analyses.length,
      avgQAScore: avgScore ? Math.round(avgScore * 10) / 10 : null,
      categoryBreakdown,
      analyses: analyses.slice(0, 20) // Return top 20
    });
  } catch (error) {
    console.error('Error fetching agent analysis summary:', error);
    res.status(500).json({ error: 'Failed to fetch analysis summary' });
  }
});

// GET /api/analysis/cached-scores - Get persisted QA scores for multiple tickets
// Reads from the qa_scores DB table (durable) and falls back to in-memory cache
// for tickets analyzed in the current session but not yet flushed.
router.get('/cached-scores', async (req, res) => {
  try {
    const ticketIdsParam = req.query.ticketIds as string;
    if (!ticketIdsParam) return res.json({ scores: {}, fallbackIds: [] });

    const ticketIds = ticketIdsParam.split(',').map((id: string) => id.trim()).filter(Boolean);

    // Primary: read from the persistent DB table
    const dbScores = await getQAScoresBulk(ticketIds);

    const fallbackIds: string[] = [];

    // Supplement with in-memory cache for tickets not yet in DB
    for (const id of ticketIds) {
      if (!dbScores[id]) {
        const cached = analysisCache.get<any>(id);
        if (cached?.qaScore !== undefined) {
          dbScores[id] = {
            qaScore: cached.qaScore,
            summary: cached.summary || null,
            deductions: cached.deductions || [],
          };
        } else if (cached?.isFallback) {
          // Analyzed but Gemini failed — triage-only provisional score
          fallbackIds.push(id);
        } else {
          // Check DB for cross-session fallback state
          const stored = await getStoredTicketAnalysis(id);
          if (stored && (stored as any).isFallback) {
            fallbackIds.push(id);
          }
        }
      }
    }

    return res.json({ scores: dbScores, fallbackIds });
  } catch (error) {
    console.error('Error fetching cached scores:', error);
    return res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

// GET /api/analysis/reviews - Get reviews for specific ticket IDs (bulk lookup) or all with ticket info
router.get('/reviews', async (req, res) => {
  try {
    const ticketIdsParam = req.query.ticketIds as string | undefined;
    if (ticketIdsParam) {
      const ticketIds = ticketIdsParam.split(',').map(id => id.trim()).filter(Boolean);
      const reviews = await getQAReviewsBulk(ticketIds);
      return res.json({ reviews });
    }
    // No filter = return all reviews enriched with ticket data + summary stats
    const reviews = await getAllQAReviewsWithTickets();
    const approved = reviews.filter(r => r.status === 'approved');
    const flagged = reviews.filter(r => r.status === 'flagged');

    // Per-agent breakdown
    const byAgent: Record<string, { approved: number; flagged: number }> = {};
    reviews.forEach(r => {
      const agent = r.agentEmail || 'Unknown';
      if (!byAgent[agent]) byAgent[agent] = { approved: 0, flagged: 0 };
      byAgent[agent][r.status]++;
    });

    res.json({
      reviews,
      summary: {
        total: reviews.length,
        approved: approved.length,
        flagged: flagged.length,
        approvalRate: reviews.length > 0 ? Math.round((approved.length / reviews.length) * 100) : 0,
      },
      byAgent,
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// GET /api/analysis/agent/:email/insights - Groq-powered miss trends from stored Gemini analyses
router.get('/agent/:email/insights', async (req, res) => {
  try {
    const { email } = req.params;
    const date = req.query.date as string;
    const dateMode = ((req.query.dateMode as string) || 'activity') as 'activity' | 'initialized';
    const decodedEmail = decodeURIComponent(email);

    if (!date) return res.status(400).json({ error: 'Date parameter is required' });

    const tickets = await getAgentTickets(decodedEmail, date, 500, 0, dateMode);
    if (tickets.length === 0) return res.json({ insight: null, stats: null });

    const ticketIds = tickets.map(t => String(t.TICKET_ID));
    const scores = await getQAScoresBulk(ticketIds);
    const analyzedEntries = Object.values(scores) as Array<{ qaScore: number; summary: string | null; deductions: Array<{ category: string; points: number; reason: string }> }>;

    if (analyzedEntries.length === 0) {
      return res.json({ insight: null, stats: { totalTickets: tickets.length, analyzedCount: 0, avgScore: null, topDeductionCategories: [], lowScoreCount: 0 } });
    }

    const avgScore = analyzedEntries.reduce((sum, s) => sum + (s.qaScore || 0), 0) / analyzedEntries.length;
    const lowScoreCount = analyzedEntries.filter(s => s.qaScore < 60).length;

    const catCounts: Record<string, number> = {};
    analyzedEntries.forEach(s => {
      (s.deductions || []).forEach(d => {
        const cat = (d.category || 'other').toLowerCase();
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      });
    });

    const topDeductionCategories = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category, count]) => ({ category, count }));

    const stats = {
      totalTickets: tickets.length,
      analyzedCount: analyzedEntries.length,
      avgScore: Math.round(avgScore * 10) / 10,
      topDeductionCategories,
      lowScoreCount,
    };

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.json({ insight: null, stats });

    const agentName = decodedEmail.split('@')[0];
    const prompt = `You are a QA analyst. Summarize this agent's performance on ${date} in exactly 2 short sentences. Be specific and direct.
Agent: ${agentName}
Tickets handled: ${tickets.length} | Analyzed: ${analyzedEntries.length}
Avg QA Score: ${stats.avgScore}/100 | Low-score tickets (<60): ${lowScoreCount}
Top issues: ${topDeductionCategories.map(c => `${c.category}(${c.count}x)`).join(', ') || 'none'}

Return only the 2 sentences, no labels.`;

    const models = ['llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
    let insight: string | null = null;
    for (const model of models) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 120 }),
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const d = await r.json() as any;
          insight = d.choices?.[0]?.message?.content?.trim() || null;
          break;
        }
      } catch { continue; }
    }

    res.json({ insight, stats });
  } catch (error) {
    console.error('[AgentInsights] Error:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

export { router as analysisRouter };
