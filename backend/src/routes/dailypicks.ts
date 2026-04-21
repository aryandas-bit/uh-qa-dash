import { Router } from 'express';
import { getDailyPickTicketSummaries, clearDailyPicks, type DateMode } from '../services/database.service.js';
import { createAgentRandomSample, getDailyPicks, runDailyAudit, getAuditStatus } from '../services/dailypicks.service.js';

const router = Router();

// GET /api/daily-picks?date=YYYY-MM-DD — Get or generate picks for a date
router.get('/', async (req, res) => {
  try {
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';
    const agentEmail = req.query.agentEmail as string | undefined;
    const autoGenerate = req.query.autoGenerate !== 'false';
    if (!date) {
      return res.status(400).json({ error: 'date parameter is required' });
    }

    const { picks, generated } = await getDailyPicks(date, undefined, dateMode, { agentEmail, autoGenerate });
    const summaries = await getDailyPickTicketSummaries(picks.map((pick) => pick.ticketId));

    // Group by agent for summary
    const byAgent: Record<string, { total: number; analyzed: number; errors: number; tickets: string[] }> = {};
    picks.forEach(p => {
      if (!byAgent[p.agentEmail]) {
        byAgent[p.agentEmail] = { total: 0, analyzed: 0, errors: 0, tickets: [] };
      }
      byAgent[p.agentEmail].total++;
      if (p.analyzed) byAgent[p.agentEmail].analyzed++;
      if (p.analysisStatus === 'error') byAgent[p.agentEmail].errors++;
      byAgent[p.agentEmail].tickets.push(p.ticketId);
    });

    res.json({
      date,
      dateMode,
      agentEmail: agentEmail || null,
      totalPicks: picks.length,
      agentCount: Object.keys(byAgent).length,
      generated,
      picks: picks.map((pick) => ({
        ...pick,
        ticket: summaries[pick.ticketId] || null,
      })),
      byAgent,
    });
  } catch (error) {
    console.error('Error getting daily picks:', error);
    res.status(500).json({ error: 'Failed to get daily picks' });
  }
});

// POST /api/daily-picks/run-audit — Trigger batch analysis on unanalyzed picks
router.post('/run-audit', async (req, res) => {
  try {
    const { date, dateMode = 'activity', agentEmail, count = 10, randomizeSample = false } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }

    if (agentEmail && randomizeSample) {
      await createAgentRandomSample(String(date), String(agentEmail), dateMode as DateMode, Math.max(1, Number(count) || 10));
    }

    // forceReanalysis=true when randomizeSample=true: skip stored-analysis cache for fresh picks
    const status = await runDailyAudit(date, dateMode as DateMode, agentEmail ? String(agentEmail) : undefined, Boolean(randomizeSample));
    res.json({ ...status, dateMode, agentEmail: agentEmail || null });
  } catch (error) {
    console.error('Error running daily audit:', error);
    res.status(500).json({ error: 'Failed to start audit' });
  }
});

// GET /api/daily-picks/status?date=YYYY-MM-DD — Get audit progress
router.get('/status', async (req, res) => {
  try {
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';
    const agentEmail = req.query.agentEmail as string | undefined;
    if (!date) {
      return res.status(400).json({ error: 'date parameter is required' });
    }

    const status = await getAuditStatus(date, dateMode, agentEmail);
    res.json({ ...status, dateMode, agentEmail: agentEmail || null });
  } catch (error) {
    console.error('Error getting audit status:', error);
    res.status(500).json({ error: 'Failed to get audit status' });
  }
});

// DELETE /api/daily-picks/reset — Clear picks for a date so they regenerate with current settings
router.delete('/reset', async (req, res) => {
  try {
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';
    if (!date) {
      return res.status(400).json({ error: 'date parameter is required' });
    }

    await clearDailyPicks(date, dateMode);
    res.json({ cleared: true, date, dateMode });
  } catch (error) {
    console.error('Error clearing daily picks:', error);
    res.status(500).json({ error: 'Failed to clear daily picks' });
  }
});

export { router as dailyPicksRouter };
