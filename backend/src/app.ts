// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { agentsRouter } from './routes/agents.js';
import { ticketsRouter } from './routes/tickets.js';
import { analysisRouter } from './routes/analysis.js';
import { customersRouter } from './routes/customers.js';
import { dailyPicksRouter } from './routes/dailypicks.js';
import { authRouter } from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';

if (!process.env.JWT_SECRET) {
  console.error('[Startup] FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Public routes — no auth required
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/auth', authRouter);

// All routes below this line require a valid session JWT
app.use('/api/agents', requireAuth, agentsRouter);
app.use('/api/tickets', requireAuth, ticketsRouter);
app.use('/api/analysis', requireAuth, analysisRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/daily-picks', requireAuth, dailyPicksRouter);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`QA Dashboard API running on http://localhost:${PORT}`);
  });
}

export default app;
