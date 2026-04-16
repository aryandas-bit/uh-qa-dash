import { Router } from 'express';
import { analyzeTicket, batchAnalyze, CustomerTicketHistory } from '../services/gemini.service.js';
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

const router = Router();
const analysisCache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache for analyses

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

    // 1. Check in-memory cache (fastest)
    if (!forceRefresh) {
      const cached = analysisCache.get(id);
      if (cached) {
        const review = await getQAReview(id);
        return res.json({ ticketId: id, analysis: cached, cached: true, review: review || null });
      }

      // 2. Check DB (persisted across restarts)
      const stored = await getStoredTicketAnalysis(id);
      if (stored) {
        analysisCache.set(id, stored); // warm up memory cache
        const review = await getQAReview(id);
        return res.json({ ticketId: id, analysis: stored, cached: true, review: review || null });
      }
    }

    // 3. Get ticket data for fresh analysis
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

    // Run analysis with customer history context
    const analysis = await analyzeTicket(
      id,
      messagesRaw,
      ticket.GROUP_NAME,
      ticket.TAGS,
      customerHistory,
      auditMemories
    );

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

    // Persist full analysis to DB and warm memory cache
    await saveTicketAnalysis(id, analysis, 'manual');
    analysisCache.set(id, analysis);
    // Also persist score for quick bulk lookup
    saveQAScore(id, analysis.qaScore, analysis.summary, analysis.deductions).catch(e =>
      console.error('[Analysis] Failed to persist QA score:', e)
    );

    const review = await getQAReview(id);

    res.json({
      ticketId: id,
      analysis,
      cached: false,
      review: review || null,
      customerHistory: customerHistory.slice(0, 10),
      ticket: {
        subject: ticket.SUBJECT,
        agentEmail: ticket.AGENT_EMAIL,
        customerEmail: ticket.VISITOR_EMAIL,
        csat: ticket.TICKET_CSAT,
        date: ticket.DAY
      }
    });
  } catch (error) {
    console.error('Error analyzing ticket:', error);
    res.status(500).json({ error: 'Failed to analyze ticket' });
  }
});

// POST /api/analysis/ticket/:id/review - Approve or flag a QA analysis
router.post('/ticket/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, reviewerName } = req.body;

    if (!['approved', 'flagged'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "approved" or "flagged"' });
    }

    await saveQAReview(id, status as 'approved' | 'flagged', note, reviewerName);
    const review = await getQAReview(id);

    // Sync to Google Sheets (non-blocking)
    const ticket = await getTicketById(id);
    upsertReviewToSheet(id, status, note, reviewerName, {
      subject: ticket?.SUBJECT,
      agentEmail: ticket?.AGENT_EMAIL,
      csat: ticket?.TICKET_CSAT,
      day: ticket?.DAY,
    });

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
    deleteReviewFromSheet(id); // non-blocking
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
    if (!ticketIdsParam) return res.json({ scores: {} });

    const ticketIds = ticketIdsParam.split(',').map((id: string) => id.trim()).filter(Boolean);

    // Primary: read from the persistent DB table
    const dbScores = await getQAScoresBulk(ticketIds);

    // Supplement with in-memory cache for tickets not yet in DB
    ticketIds.forEach(id => {
      if (!dbScores[id]) {
        const cached = analysisCache.get<any>(id);
        if (cached?.qaScore !== undefined) {
          dbScores[id] = {
            qaScore: cached.qaScore,
            summary: cached.summary || null,
            deductions: cached.deductions || [],
          };
        }
      }
    });

    return res.json({ scores: dbScores });
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

export { router as analysisRouter };
