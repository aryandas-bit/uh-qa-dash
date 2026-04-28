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
import { metabaseRouter } from './routes/metabase.js';
import { dumpRouter } from './routes/dump.js';
import { auditorsRouter, reevaluationsRouter } from './routes/auditors.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// Routes
app.use('/api/agents', agentsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/customers', customersRouter);
app.use('/api/daily-picks', dailyPicksRouter);
app.use('/api/metabase', metabaseRouter);
app.use('/api/dump', dumpRouter);
app.use('/api/auditors', auditorsRouter);
app.use('/api/reevaluations', reevaluationsRouter);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`QA Dashboard API running on http://localhost:${PORT}`);
  });
}

export default app;
