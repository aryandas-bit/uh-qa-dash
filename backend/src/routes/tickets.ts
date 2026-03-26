import { Router } from 'express';
import { getTicketById, getFlaggedTickets, getDailySummary, getTopIssues, getBestAgents, getFrustratedCustomers, getDailyInsights, DateMode } from '../services/database.service.js';
import NodeCache from 'node-cache';

const router = Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

// GET /api/tickets/summary - Get daily summary stats
router.get('/summary', async (req, res) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const summary = await getDailySummary(date);
    res.json({ date, summary });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// GET /api/tickets/insights - Get comprehensive daily insights
router.get('/insights', async (req, res) => {
  try {
    const date = req.query.date as string;
    const dateMode = (req.query.dateMode as DateMode) || 'activity';

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const cacheKey = `insights_${date}_${dateMode}`;
    let result = cache.get(cacheKey);

    if (!result) {
      const summary = await getDailyInsights(date, dateMode);
      const topIssues = await getTopIssues(date, 10, dateMode);
      const bestAgents = await getBestAgents(date, 5, dateMode);
      const frustratedCustomers = await getFrustratedCustomers(date, 5, dateMode);

      result = {
        date,
        dateMode,
        summary,
        topIssues,
        bestAgents,
        frustratedCustomers
      };
      cache.set(cacheKey, result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching insights:', error);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

// GET /api/tickets/flagged - Get flagged tickets for a date
router.get('/flagged', async (req, res) => {
  try {
    const date = req.query.date as string;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const tickets = await getFlaggedTickets(date, limit);
    res.json({ date, tickets, count: tickets.length });
  } catch (error) {
    console.error('Error fetching flagged tickets:', error);
    res.status(500).json({ error: 'Failed to fetch flagged tickets' });
  }
});

// GET /api/tickets/:id - Get single ticket
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await getTicketById(id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Parse MESSAGES_JSON if it exists
    let messages = [];
    if (ticket.MESSAGES_JSON) {
      try {
        messages = JSON.parse(ticket.MESSAGES_JSON);
      } catch (e) {
        console.warn('Failed to parse MESSAGES_JSON for ticket', id);
      }
    }

    res.json({
      ticket: {
        ...ticket,
        messages
      }
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

export { router as ticketsRouter };
