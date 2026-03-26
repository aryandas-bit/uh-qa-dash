import { Router } from 'express';
import { getCustomerHistory } from '../services/database.service.js';

const router = Router();

// GET /api/customers/:email/history - Get customer ticket history
router.get('/:email/history', async (req, res) => {
  try {
    const { email } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const tickets = await getCustomerHistory(email, limit);

    // Group by agent to see which agents handled this customer
    const agentSummary = tickets.reduce((acc: Record<string, number>, ticket) => {
      if (ticket.AGENT_EMAIL) {
        acc[ticket.AGENT_EMAIL] = (acc[ticket.AGENT_EMAIL] || 0) + 1;
      }
      return acc;
    }, {});

    // Calculate average CSAT for this customer
    const csatTickets = tickets.filter(t => t.TICKET_CSAT > 0);
    const avgCsat = csatTickets.length > 0
      ? csatTickets.reduce((sum, t) => sum + t.TICKET_CSAT, 0) / csatTickets.length
      : null;

    res.json({
      customerEmail: email,
      totalTickets: tickets.length,
      avgCsat: avgCsat ? Math.round(avgCsat * 100) / 100 : null,
      agentSummary,
      tickets
    });
  } catch (error) {
    console.error('Error fetching customer history:', error);
    res.status(500).json({ error: 'Failed to fetch customer history' });
  }
});

export { router as customersRouter };
