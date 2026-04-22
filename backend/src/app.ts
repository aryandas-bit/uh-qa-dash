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

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Sheets debug — tests credentials and writes a ping row
app.get('/api/debug/sheets', async (req, res) => {
  try {
    const { google } = await import('googleapis');
    const credJson = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!credJson) return res.json({ error: 'GOOGLE_CREDENTIALS_JSON not set' });
    let creds: any;
    try { creds = JSON.parse(credJson); } catch (e: any) { return res.json({ error: 'JSON.parse failed: ' + e.message }); }
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId! });
    const tabs = meta.data.sheets?.map((s: any) => s.properties.title);
    res.json({ ok: true, sheetId, tabs, clientEmail: creds.client_email });
  } catch (e: any) {
    res.json({ error: e.message });
  }
});

// Routes
app.use('/api/agents', agentsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/customers', customersRouter);
app.use('/api/daily-picks', dailyPicksRouter);
app.use('/api/metabase', metabaseRouter);

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
