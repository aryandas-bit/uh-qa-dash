import { Router } from 'express';
import { getDailyPicks, runDailyAudit, getAuditStatus } from '../services/dailypicks.service.js';

const router = Router();

// GET /api/daily-picks?date=YYYY-MM-DD — Get or generate picks for a date
router.get('/', async (req, res) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      return res.status(400).json({ error: 'date parameter is required' });
    }

    const { picks, generated } = await getDailyPicks(date);

    // Group by agent for summary
    const byAgent: Record<string, { total: number; analyzed: number; tickets: string[] }> = {};
    picks.forEach(p => {
      if (!byAgent[p.agentEmail]) {
        byAgent[p.agentEmail] = { total: 0, analyzed: 0, tickets: [] };
      }
      byAgent[p.agentEmail].total++;
      if (p.analyzed) byAgent[p.agentEmail].analyzed++;
      byAgent[p.agentEmail].tickets.push(p.ticketId);
    });

    res.json({
      date,
      totalPicks: picks.length,
      agentCount: Object.keys(byAgent).length,
      generated,
      picks,
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
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }

    const status = await runDailyAudit(date);
    res.json(status);
  } catch (error) {
    console.error('Error running daily audit:', error);
    res.status(500).json({ error: 'Failed to start audit' });
  }
});

// GET /api/daily-picks/status?date=YYYY-MM-DD — Get audit progress
router.get('/status', async (req, res) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      return res.status(400).json({ error: 'date parameter is required' });
    }

    const status = await getAuditStatus(date);
    res.json(status);
  } catch (error) {
    console.error('Error getting audit status:', error);
    res.status(500).json({ error: 'Failed to get audit status' });
  }
});

export { router as dailyPicksRouter };
