import { Router } from 'express';
import {
  getAgentsDailySummary,
  getAgentTickets,
  getAgentPerformance,
  getDefaulters,
  getAvailableDates,
  getAgentQATrend,
  getDailyPickTicketSummaries,
  getQAReviewsBulk,
  getQAScoresBulk,
  DateMode
} from '../services/database.service.js';
import { createAgentRandomSample, getDailyPicks, runDailyAudit } from '../services/dailypicks.service.js';
import NodeCache from 'node-cache';

const router = Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache for historical data

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isResolvedStatus(value: unknown): boolean {
  return normalizeStatus(value) === 'resolved';
}

function formatCategoryLabel(category: string): string {
  return category
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildOverallAssessment(avgScore: number, flaggedCount: number): string {
  if (avgScore >= 90 && flaggedCount === 0) return 'Excellent';
  if (avgScore >= 80 && flaggedCount <= 2) return 'Good';
  if (avgScore >= 65) return 'Needs Coaching';
  return 'Critical Attention';
}

// GET /api/agents/dates - Get available dates
router.get('/dates', async (req, res) => {
  try {
    const cacheKey = 'available_dates';
    let dates = cache.get<string[]>(cacheKey);

    if (!dates) {
      dates = await getAvailableDates();
      cache.set(cacheKey, dates);
    }

    res.json({ dates });
  } catch (error) {
    console.error('Error fetching dates:', error);
    res.status(500).json({ error: 'Failed to fetch available dates' });
  }
});

// GET /api/agents/daily - Get agent summary for a date
// Query params: date (required), dateMode ('activity' | 'initialized', default: 'activity')
router.get('/daily', async (req, res) => {
  try {
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const cacheKey = `agents_daily_${date}_${dateMode}`;
    let summary = cache.get(cacheKey);

    if (!summary) {
      summary = await getAgentsDailySummary(date, dateMode);
      cache.set(cacheKey, summary);
    }

    res.json({ date, dateMode, agents: summary });
  } catch (error) {
    console.error('Error fetching agent summary:', error);
    res.status(500).json({ error: 'Failed to fetch agent summary' });
  }
});

// GET /api/agents/:email/tickets - Get agent's tickets for a date
// Query params: date (required), dateMode ('activity' | 'initialized', default: 'activity'), limit, offset
router.get('/:email/tickets', async (req, res) => {
  try {
    const { email } = req.params;
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const cacheKey = `agent_tickets_${email}_${date}_${dateMode}_${limit}_${offset}`;
    let result = cache.get<{ agentEmail: string; date: string; dateMode: string; tickets: any[]; count: number }>(cacheKey);

    if (!result) {
      const tickets = await getAgentTickets(email, date, limit, offset, dateMode);
      result = { agentEmail: email, date, dateMode, tickets, count: tickets.length };
      cache.set(cacheKey, result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching agent tickets:', error);
    res.status(500).json({ error: 'Failed to fetch agent tickets' });
  }
});

// GET /api/agents/:email/performance - Get agent performance over time
router.get('/:email/performance', async (req, res) => {
  try {
    const { email } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate parameters are required' });
    }

    const performance = await getAgentPerformance(email, startDate, endDate);
    res.json({ agentEmail: email, startDate, endDate, performance });
  } catch (error) {
    console.error('Error fetching agent performance:', error);
    res.status(500).json({ error: 'Failed to fetch agent performance' });
  }
});

// GET /api/agents/:email/qa-trend - Get agent QA score trend
router.get('/:email/qa-trend', async (req, res) => {
  try {
    const { email } = req.params;
    const limit = parseInt(req.query.limit as string) || 14;
    const trend = await getAgentQATrend(email, limit);
    res.json({ agentEmail: email, limit, trend });
  } catch (error) {
    console.error('Error fetching agent QA trend:', error);
    res.status(500).json({ error: 'Failed to fetch agent QA trend' });
  }
});

// POST /api/agents/:email/audit-now - Create a random 10-ticket sample for an agent/day
router.post('/:email/audit-now', async (req, res) => {
  try {
    const { email } = req.params;
    const { date, dateMode = 'activity', count = 10 } = req.body;
    const decodedEmail = decodeURIComponent(email);

    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }

    const picks = await createAgentRandomSample(date, decodedEmail, dateMode, Math.max(1, Number(count) || 10));
    const status = await runDailyAudit(date, dateMode);

    res.json({
      agentEmail: decodedEmail,
      date,
      dateMode,
      count: picks.length,
      ticketIds: picks.map((pick) => pick.ticketId),
      picks,
      auditStatus: status,
    });
  } catch (error) {
    console.error('Error creating audit-now sample:', error);
    res.status(500).json({ error: 'Failed to create random audit sample' });
  }
});

// GET /api/agents/:email/report-card - Generate a reviewed sample-based report card for a date
router.get('/:email/report-card', async (req, res) => {
  try {
    const { email } = req.params;
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';
    const decodedEmail = decodeURIComponent(email);

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const cacheKey = `agent_report_card_${decodedEmail}_${date}_${dateMode}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [ticketResult, pickResult] = await Promise.all([
      getAgentTickets(decodedEmail, date, 500, 0, dateMode),
      getDailyPicks(date, 10, dateMode),
    ]);

    const samplePicks = pickResult.picks
      .filter((pick) => pick.agentEmail === decodedEmail)
      .sort((left, right) => left.pickOrder - right.pickOrder);

    if (samplePicks.length === 0) {
      return res.status(404).json({ error: 'No sampled tickets found for this agent and date' });
    }

    const sampleTicketIds = samplePicks.map((pick) => pick.ticketId);
    const [sampleSummaries, reviews, scores] = await Promise.all([
      getDailyPickTicketSummaries(sampleTicketIds),
      getQAReviewsBulk(sampleTicketIds),
      getQAScoresBulk(sampleTicketIds),
    ]);

    const missingReviews = sampleTicketIds.filter((ticketId) => !reviews[ticketId]);
    const missingScores = sampleTicketIds.filter((ticketId) => !scores[ticketId]);

    if (missingReviews.length > 0 || missingScores.length > 0) {
      return res.status(409).json({
        error: 'All sampled tickets must be audited and reviewed before creating a report card',
        missingReviews,
        missingScores,
        reviewedCount: sampleTicketIds.length - missingReviews.length,
        auditedCount: sampleTicketIds.length - missingScores.length,
        requiredCount: sampleTicketIds.length,
      });
    }

    const scoreEntries = sampleTicketIds.map((ticketId) => ({ ticketId, ...scores[ticketId] }));
    const avgScore = scoreEntries.reduce((sum, entry) => sum + entry.qaScore, 0) / scoreEntries.length;
    const approvedCount = sampleTicketIds.filter((ticketId) => reviews[ticketId]?.status === 'approved').length;
    const flaggedCount = sampleTicketIds.filter((ticketId) => reviews[ticketId]?.status === 'flagged').length;
    const verifiedCount = sampleTicketIds.length;

    const deductionCounts: Record<string, number> = {};
    scoreEntries.forEach((entry) => {
      (entry.deductions || []).forEach((deduction) => {
        const key = String(deduction.category || 'other').toLowerCase();
        deductionCounts[key] = (deductionCounts[key] || 0) + 1;
      });
    });

    const topDeductionCategories = Object.entries(deductionCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([category, count]) => ({ category, label: formatCategoryLabel(category), count }));

    const resolvedTickets = ticketResult.filter((ticket) => isResolvedStatus(ticket.TICKET_STATUS));
    const lowCsatCount = ticketResult.filter((ticket) => {
      const numericCsat = Number(ticket.TICKET_CSAT);
      return Number.isFinite(numericCsat) && numericCsat > 0 && numericCsat < 3;
    }).length;
    const validResponseTimes = ticketResult
      .map((ticket) => Number(ticket.FIRST_RESPONSE_DURATION_SECONDS))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 86400);
    const avgResponseTime = validResponseTimes.length > 0
      ? Math.round(validResponseTimes.reduce((sum, value) => sum + value, 0) / validResponseTimes.length)
      : null;

    const issueCounts = ticketResult.reduce<Record<string, number>>((acc, ticket) => {
      const subject = ticket.SUBJECT || 'Unknown';
      acc[subject] = (acc[subject] || 0) + 1;
      return acc;
    }, {});
    const topIssues = Object.entries(issueCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([subject, count]) => ({ subject, count }));

    const strengths: string[] = [];
    if (avgScore >= 85) strengths.push(`Reviewed sample averaged ${Math.round(avgScore)}/100, showing strong day-level QA quality.`);
    if (approvedCount >= Math.ceil(sampleTicketIds.length * 0.8)) strengths.push(`${approvedCount} of ${sampleTicketIds.length} sampled audits were manually approved.`);
    if (lowCsatCount === 0) strengths.push('No low-CSAT tickets were recorded for this agent on this day.');
    if (avgResponseTime !== null && avgResponseTime <= 60) strengths.push(`Average first response time stayed fast at roughly ${avgResponseTime}s.`);
    if (strengths.length === 0) strengths.push('The day included several workable interactions, but the audited sample needs closer coaching follow-through.');

    const flaggedTickets = sampleTicketIds
      .filter((ticketId) => reviews[ticketId]?.status === 'flagged')
      .map((ticketId) => ({
        ticketId,
        subject: sampleSummaries[ticketId]?.subject || 'No subject',
        qaScore: scores[ticketId]?.qaScore ?? null,
        reviewNote: reviews[ticketId]?.note || null,
        deductionSummary: (scores[ticketId]?.deductions || []).slice(0, 2).map((deduction) => deduction.reason).join(' | ') || null,
      }));

    const coachingPriorities = [
      ...topDeductionCategories.slice(0, 3).map((item) => `${item.label} misses appeared in ${item.count} reviewed audits.`),
      ...flaggedTickets
        .map((ticket) => ticket.reviewNote || ticket.deductionSummary)
        .filter(Boolean)
        .slice(0, 2)
        .map((note) => `Reviewer follow-up: ${note}`),
    ].slice(0, 4);

    if (coachingPriorities.length === 0) {
      coachingPriorities.push('No major repeat misses were found in the reviewed sample.');
    }

    const reportCard = {
      agentEmail: decodedEmail,
      date,
      dateMode,
      overallAssessment: buildOverallAssessment(avgScore, flaggedCount),
      summary: `${decodedEmail.split('@')[0].replace(/[._]/g, ' ')} handled ${ticketResult.length} tickets on ${date}. ` +
        `The verified 10-ticket sample averaged ${Math.round(avgScore)}/100, with ${approvedCount} approved and ${flaggedCount} flagged audits.`,
      sample: {
        requiredCount: sampleTicketIds.length,
        auditedCount: sampleTicketIds.length,
        reviewedCount: verifiedCount,
        approvedCount,
        flaggedCount,
        avgQaScore: Math.round(avgScore * 10) / 10,
      },
      dailyPerformance: {
        totalTickets: ticketResult.length,
        resolvedCount: resolvedTickets.length,
        avgResponseTime,
        lowCsatCount,
      },
      strengths,
      coachingPriorities,
      topDeductionCategories,
      topIssues,
      flaggedTickets,
      reviewedSample: samplePicks.map((pick) => ({
        ticketId: pick.ticketId,
        pickOrder: pick.pickOrder,
        pickReason: pick.pickReason,
        subject: sampleSummaries[pick.ticketId]?.subject || null,
        qaScore: scores[pick.ticketId]?.qaScore ?? null,
        reviewStatus: reviews[pick.ticketId]?.status || null,
        reviewNote: reviews[pick.ticketId]?.note || null,
      })),
    };

    cache.set(cacheKey, reportCard, 60 * 10);
    res.json(reportCard);
  } catch (error) {
    console.error('Error generating agent report card:', error);
    res.status(500).json({ error: 'Failed to generate report card' });
  }
});

// GET /api/agents/defaulters - Get agents with frequent issues
router.get('/defaulters', async (req, res) => {
  try {
    const minIssues = parseInt(req.query.minIssues as string) || 5;
    const days = parseInt(req.query.days as string) || 30;

    const cacheKey = `defaulters_${minIssues}_${days}`;
    let defaulters = cache.get(cacheKey);

    if (!defaulters) {
      defaulters = await getDefaulters(minIssues, days);
      cache.set(cacheKey, defaulters);
    }

    res.json({ minIssues, days, defaulters });
  } catch (error) {
    console.error('Error fetching defaulters:', error);
    res.status(500).json({ error: 'Failed to fetch defaulters' });
  }
});

export { router as agentsRouter };
