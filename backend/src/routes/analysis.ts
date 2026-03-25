import { Router } from 'express';
import { analyzeTicket, batchAnalyze, CustomerTicketHistory } from '../services/gemini.service.js';
import { getTicketById, getFlaggedTickets, getAgentTickets, getCustomerHistory, TicketRow, saveQAReview, getQAReview, deleteQAReview, getQAReviewsBulk, getAllQAReviews, getAllQAReviewsWithTickets } from '../services/database.service.js';
import { upsertReviewToSheet, deleteReviewFromSheet } from '../services/sheets.service.js';
import { getAllSOPs, getSOPCategories } from '../services/sop.service.js';
import NodeCache from 'node-cache';

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
      csat: typeof t.TICKET_CSAT === 'number' ? t.TICKET_CSAT : undefined
    }));
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

    // Check cache first
    if (!forceRefresh) {
      const cached = analysisCache.get(id);
      if (cached) {
        const review = getQAReview(id);
        return res.json({ ticketId: id, analysis: cached, cached: true, review: review || null });
      }
    }

    // Get ticket data
    const ticket = getTicketById(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get customer history for context (only tickets BEFORE current one)
    let customerHistory: CustomerTicketHistory[] = [];
    if (ticket.VISITOR_EMAIL) {
      const historyTickets = getCustomerHistory(ticket.VISITOR_EMAIL, 20);
      customerHistory = formatCustomerHistoryForAnalysis(historyTickets, id, ticket.INITIALIZED_TIME);
      console.log(`[Analysis] Customer ${ticket.VISITOR_EMAIL} has ${customerHistory.length} previous tickets`);
    }

    // Run analysis with customer history context
    const analysis = await analyzeTicket(
      id,
      ticket.MESSAGES_JSON,
      ticket.GROUP_NAME,
      ticket.TAGS,
      customerHistory
    );

    // Cache the result
    analysisCache.set(id, analysis);

    const review = getQAReview(id);

    res.json({
      ticketId: id,
      analysis,
      cached: false,
      review: review || null,
      customerHistory: customerHistory.slice(0, 10), // Return recent history to frontend
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

    saveQAReview(id, status as 'approved' | 'flagged', note, reviewerName);
    const review = getQAReview(id);

    // Sync to Google Sheets (non-blocking)
    const ticket = getTicketById(id);
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
    deleteQAReview(id);
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
    const { date, agentEmail, limit = 20, prioritizeFlagged = true } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    // Get tickets to analyze
    let tickets;
    if (agentEmail) {
      tickets = getAgentTickets(agentEmail, date, limit, 0);
    } else if (prioritizeFlagged) {
      tickets = getFlaggedTickets(date, limit);
    } else {
      // This would need a getAllTickets function - for now use flagged
      tickets = getFlaggedTickets(date, limit);
    }

    if (tickets.length === 0) {
      return res.json({ message: 'No tickets to analyze', results: [] });
    }

    // Check which ones are already cached
    const ticketsTyped = tickets as TicketRow[];
    const uncached = ticketsTyped.filter(t => !analysisCache.has(t.TICKET_ID));
    const cachedResults: any[] = [];

    ticketsTyped.forEach(t => {
      const cached = analysisCache.get(t.TICKET_ID);
      if (cached) {
        cachedResults.push({
          ticketId: t.TICKET_ID,
          analysis: cached,
          cached: true
        });
      }
    });

    // Analyze uncached tickets
    if (uncached.length > 0) {
      const toAnalyze = uncached.map(t => ({
        ticketId: t.TICKET_ID,
        messagesJson: t.MESSAGES_JSON,
        category: t.GROUP_NAME,
        tags: t.TAGS
      }));

      const results = await batchAnalyze(toAnalyze, 3);

      results.forEach((analysis, ticketId) => {
        if (!(analysis instanceof Error)) {
          analysisCache.set(ticketId, analysis);
          cachedResults.push({
            ticketId,
            analysis,
            cached: false
          });
        } else {
          cachedResults.push({
            ticketId,
            error: analysis.message,
            cached: false
          });
        }
      });
    }

    // Calculate summary stats
    const successful = cachedResults.filter(r => !r.error);
    const avgScore = successful.length > 0
      ? successful.reduce((sum, r) => sum + r.analysis.qaScore, 0) / successful.length
      : 0;

    res.json({
      date,
      agentEmail: agentEmail || 'all',
      totalAnalyzed: cachedResults.length,
      successCount: successful.length,
      avgQAScore: Math.round(avgScore * 10) / 10,
      results: cachedResults
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

    const tickets = getAgentTickets(email, date, 100, 0);

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

// GET /api/analysis/reviews - Get reviews for specific ticket IDs (bulk lookup) or all with ticket info
router.get('/reviews', (req, res) => {
  try {
    const ticketIdsParam = req.query.ticketIds as string | undefined;
    if (ticketIdsParam) {
      const ticketIds = ticketIdsParam.split(',').map(id => id.trim()).filter(Boolean);
      const reviews = getQAReviewsBulk(ticketIds);
      return res.json({ reviews });
    }
    // No filter = return all reviews enriched with ticket data + summary stats
    const reviews = getAllQAReviewsWithTickets();
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
