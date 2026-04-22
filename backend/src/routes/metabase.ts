import { Router } from 'express';
import { syncDateFromMetabase, getSyncLog, isDateSynced } from '../services/database.service.js';
import { isMetabaseEnabled } from '../services/metabase.service.js';

export const metabaseRouter = Router();

metabaseRouter.get('/status', (_req, res) => {
  res.json({
    enabled: isMetabaseEnabled,
    baseUrl: process.env.METABASE_BASE_URL || null,
    cardId: process.env.METABASE_CARD_ID || '19330',
  });
});

metabaseRouter.get('/sync-log', async (_req, res) => {
  try {
    const log = await getSyncLog();
    res.json(log);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metabase/sync  body: { date: "2026-04-20" }
// POST /api/metabase/sync  body: { dates: ["2026-04-20", "2026-04-19"] }
metabaseRouter.post('/sync', async (req, res) => {
  if (!isMetabaseEnabled) {
    return res.status(400).json({ error: 'Metabase not configured' });
  }

  const { date, dates, force } = req.body as { date?: string; dates?: string[]; force?: boolean };
  const targets: string[] = dates ?? (date ? [date] : []);
  if (targets.length === 0) return res.status(400).json({ error: 'date or dates required' });

  const results: Record<string, number | string> = {};
  for (const d of targets) {
    if (!force && await isDateSynced(d)) {
      results[d] = 'already synced';
      continue;
    }
    try {
      results[d] = await syncDateFromMetabase(d);
    } catch (err: any) {
      results[d] = `error: ${err.message}`;
    }
  }

  res.json({ results });
});
