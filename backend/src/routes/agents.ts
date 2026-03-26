import { Router } from 'express';
import {
  getAgentsDailySummary,
  getAgentTickets,
  getAgentPerformance,
  getDefaulters,
  getAvailableDates,
  DateMode
} from '../services/database.service.js';
import NodeCache from 'node-cache';

const router = Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache for historical data

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
