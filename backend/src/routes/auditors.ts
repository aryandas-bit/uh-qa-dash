import { Router } from 'express';
import {
  getAssignments,
  claimAgent,
  releaseAgent,
  getPushedScores,
  recordScorePush,
  getTeamProgress,
  getMyStats,
  listAuditors,
  countOpenReevaluations,
  listReevaluations,
  createReevaluation,
  claimReevaluation,
  resolveReevaluation,
} from '../services/auditors.service.js';
import {
  getDailyPicksFromDb,
  getQAScoresBulk,
  type DateMode,
} from '../services/database.service.js';

export const auditorsRouter = Router();
export const reevaluationsRouter = Router();

function requireDate(req: any, res: any): { date: string; dateMode: DateMode } | null {
  const date = (req.query.date || req.body?.date) as string | undefined;
  const dateMode = ((req.query.dateMode || req.body?.dateMode || 'activity') as string) as DateMode;
  if (!date) {
    res.status(400).json({ error: 'date is required' });
    return null;
  }
  return { date, dateMode };
}

// Directory of known auditor names (until real auth)
auditorsRouter.get('/list', async (_req, res) => {
  try {
    const names = await listAuditors();
    res.json({ auditors: names });
  } catch (err) {
    console.error('Error listing auditors:', err);
    res.status(500).json({ error: 'Failed to list auditors' });
  }
});

auditorsRouter.get('/assignments', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  try {
    const rows = await getAssignments(ctx.date, ctx.dateMode);
    res.json({ assignments: rows });
  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

auditorsRouter.post('/claim', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  const agentEmail = req.body?.agentEmail as string | undefined;
  const auditor = req.body?.auditor as string | undefined;
  if (!agentEmail || !auditor) {
    return res.status(400).json({ error: 'agentEmail and auditor are required' });
  }
  try {
    const result = await claimAgent(ctx.date, ctx.dateMode, agentEmail, auditor);
    if (!result.ok) {
      return res.status(409).json({ error: 'already_claimed', existing: result.existing });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error claiming agent:', err);
    res.status(500).json({ error: 'Failed to claim agent' });
  }
});

auditorsRouter.post('/release', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  const agentEmail = req.body?.agentEmail as string | undefined;
  const auditor = req.body?.auditor as string | undefined;
  if (!agentEmail || !auditor) {
    return res.status(400).json({ error: 'agentEmail and auditor are required' });
  }
  try {
    const ok = await releaseAgent(ctx.date, ctx.dateMode, agentEmail, auditor);
    res.json({ ok });
  } catch (err) {
    console.error('Error releasing agent:', err);
    res.status(500).json({ error: 'Failed to release agent' });
  }
});

auditorsRouter.get('/pushed-scores', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  try {
    const rows = await getPushedScores(ctx.date, ctx.dateMode);
    res.json({ pushed: rows });
  } catch (err) {
    console.error('Error fetching pushed scores:', err);
    res.status(500).json({ error: 'Failed to fetch pushed scores' });
  }
});

// Marks a day's audited tickets as "delivered" to the agent.
// Real delivery (Slack DM / Sheet row / CX-tool webhook) plugs in here as deliverScores().
auditorsRouter.post('/push-scores', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  const agentEmail = req.body?.agentEmail as string | undefined;
  const auditor = req.body?.auditor as string | undefined;
  if (!agentEmail || !auditor) {
    return res.status(400).json({ error: 'agentEmail and auditor are required' });
  }
  try {
    const picks = await getDailyPicksFromDb(ctx.date, ctx.dateMode, agentEmail);
    const ticketIds = picks.map((p) => p.ticketId);
    const scores = await getQAScoresBulk(ticketIds);
    const scoreVals = Object.values(scores).map((s) => s.qaScore);
    const avg = scoreVals.length
      ? Math.round((scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) * 10) / 10
      : null;

    // Stub for actual delivery channel — wire to Slack/Sheets/CX webhook on the merge.
    await deliverScores({
      date: ctx.date,
      dateMode: ctx.dateMode,
      agentEmail,
      auditor,
      ticketCount: ticketIds.length,
      avgScore: avg,
    });

    await recordScorePush(ctx.date, ctx.dateMode, agentEmail, auditor, ticketIds.length, avg);
    res.json({ ok: true, ticketCount: ticketIds.length, avgScore: avg });
  } catch (err) {
    console.error('Error pushing scores:', err);
    res.status(500).json({ error: 'Failed to push scores' });
  }
});

auditorsRouter.get('/team-progress', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  try {
    const rows = await getTeamProgress(ctx.date, ctx.dateMode);
    res.json({ progress: rows });
  } catch (err) {
    console.error('Error fetching team progress:', err);
    res.status(500).json({ error: 'Failed to fetch team progress' });
  }
});

auditorsRouter.get('/my-stats', async (req, res) => {
  const ctx = requireDate(req, res);
  if (!ctx) return;
  const auditor = req.query.auditor as string | undefined;
  if (!auditor) return res.status(400).json({ error: 'auditor is required' });
  try {
    const stats = await getMyStats(ctx.date, ctx.dateMode, auditor);
    const openReevals = await countOpenReevaluations();
    res.json({ ...stats, openReevalsAll: openReevals });
  } catch (err) {
    console.error('Error fetching my stats:', err);
    res.status(500).json({ error: 'Failed to fetch my stats' });
  }
});

// --- Re-evaluations ---

reevaluationsRouter.get('/', async (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = Math.min(500, Number(req.query.limit) || 200);
  try {
    const rows = await listReevaluations({ status, limit });
    res.json({ requests: rows });
  } catch (err) {
    console.error('Error listing reevaluations:', err);
    res.status(500).json({ error: 'Failed to list re-evaluations' });
  }
});

reevaluationsRouter.post('/', async (req, res) => {
  const { ticketId, agentEmail, reason, requestedBy, originalScore } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  try {
    const id = await createReevaluation({
      ticketId: String(ticketId),
      agentEmail,
      reason,
      requestedBy,
      originalScore,
    });
    res.json({ id });
  } catch (err) {
    console.error('Error creating reevaluation:', err);
    res.status(500).json({ error: 'Failed to create re-evaluation' });
  }
});

reevaluationsRouter.post('/:id/claim', async (req, res) => {
  const id = Number(req.params.id);
  const auditor = req.body?.auditor as string | undefined;
  if (!auditor) return res.status(400).json({ error: 'auditor is required' });
  try {
    await claimReevaluation(id, auditor);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error claiming reevaluation:', err);
    res.status(500).json({ error: 'Failed to claim re-evaluation' });
  }
});

reevaluationsRouter.post('/:id/resolve', async (req, res) => {
  const id = Number(req.params.id);
  const { auditor, status, note, newScore } = req.body || {};
  if (!auditor || !status) return res.status(400).json({ error: 'auditor and status are required' });
  if (status !== 'resolved' && status !== 'rejected') {
    return res.status(400).json({ error: 'status must be resolved or rejected' });
  }
  try {
    await resolveReevaluation(id, auditor, status, note, newScore);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error resolving reevaluation:', err);
    res.status(500).json({ error: 'Failed to resolve re-evaluation' });
  }
});

// Stub for the score-delivery channel. The CX-tool merge will replace this
// with the real transport (Slack DM, Sheet row, CX webhook, etc).
async function deliverScores(_payload: {
  date: string;
  dateMode: DateMode;
  agentEmail: string;
  auditor: string;
  ticketCount: number;
  avgScore: number | null;
}): Promise<void> {
  // no-op for now — recordScorePush still gets called so the UI tracks state.
  return;
}
