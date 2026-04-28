import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@libsql/client';
import type { DateMode } from './database.service.js';

const mainDbUrl = process.env.TURSO_DB_URL || 'file:./dev.db';
const reviewsDb = createClient({
  url: process.env.TURSO_REVIEWS_URL || mainDbUrl,
  authToken: process.env.TURSO_REVIEWS_TOKEN || process.env.TURSO_DB_TOKEN,
});

const initPromise = reviewsDb.execute(`
  CREATE TABLE IF NOT EXISTS agent_assignments (
    pick_date TEXT NOT NULL,
    date_mode TEXT NOT NULL,
    agent_email TEXT NOT NULL,
    auditor TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (pick_date, date_mode, agent_email)
  )
`).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS pushed_scores (
      pick_date TEXT NOT NULL,
      date_mode TEXT NOT NULL,
      agent_email TEXT NOT NULL,
      pushed_by TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      ticket_count INTEGER NOT NULL DEFAULT 0,
      avg_score REAL,
      PRIMARY KEY (pick_date, date_mode, agent_email)
    )
  `)
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS reevaluation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      agent_email TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','resolved','rejected')),
      requested_by TEXT,
      requested_at TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      resolved_note TEXT,
      original_score REAL,
      new_score REAL
    )
  `)
).then(() =>
  reviewsDb.execute(`CREATE INDEX IF NOT EXISTS idx_reevals_status ON reevaluation_requests(status)`).catch(() => {})
).then(() =>
  reviewsDb.execute(`CREATE INDEX IF NOT EXISTS idx_reevals_ticket ON reevaluation_requests(ticket_id)`).catch(() => {})
);

export interface AgentAssignment {
  pickDate: string;
  dateMode: DateMode;
  agentEmail: string;
  auditor: string;
  claimedAt: string;
}

export async function getAssignments(date: string, dateMode: DateMode): Promise<AgentAssignment[]> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `SELECT pick_date as pickDate, date_mode as dateMode, agent_email as agentEmail,
                 auditor, claimed_at as claimedAt
          FROM agent_assignments
          WHERE pick_date = ? AND date_mode = ?`,
    args: [date, dateMode],
  });
  return result.rows as unknown as AgentAssignment[];
}

export async function claimAgent(
  date: string,
  dateMode: DateMode,
  agentEmail: string,
  auditor: string
): Promise<{ ok: boolean; existing?: AgentAssignment }> {
  await initPromise;
  const existing = await reviewsDb.execute({
    sql: `SELECT pick_date as pickDate, date_mode as dateMode, agent_email as agentEmail,
                 auditor, claimed_at as claimedAt
          FROM agent_assignments
          WHERE pick_date = ? AND date_mode = ? AND agent_email = ?`,
    args: [date, dateMode, agentEmail],
  });
  const row = existing.rows[0] as unknown as AgentAssignment | undefined;
  if (row && row.auditor !== auditor) return { ok: false, existing: row };
  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO agent_assignments (pick_date, date_mode, agent_email, auditor, claimed_at)
          VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [date, dateMode, agentEmail, auditor],
  });
  return { ok: true };
}

export async function releaseAgent(
  date: string,
  dateMode: DateMode,
  agentEmail: string,
  auditor: string
): Promise<boolean> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `DELETE FROM agent_assignments
          WHERE pick_date = ? AND date_mode = ? AND agent_email = ? AND auditor = ?`,
    args: [date, dateMode, agentEmail, auditor],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export interface PushedScore {
  pickDate: string;
  dateMode: DateMode;
  agentEmail: string;
  pushedBy: string;
  pushedAt: string;
  ticketCount: number;
  avgScore: number | null;
}

export async function getPushedScores(date: string, dateMode: DateMode): Promise<PushedScore[]> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `SELECT pick_date as pickDate, date_mode as dateMode, agent_email as agentEmail,
                 pushed_by as pushedBy, pushed_at as pushedAt,
                 ticket_count as ticketCount, avg_score as avgScore
          FROM pushed_scores
          WHERE pick_date = ? AND date_mode = ?`,
    args: [date, dateMode],
  });
  return (result.rows as unknown as any[]).map((r) => ({
    ...r,
    ticketCount: Number(r.ticketCount || 0),
    avgScore: r.avgScore == null ? null : Number(r.avgScore),
  }));
}

export async function recordScorePush(
  date: string,
  dateMode: DateMode,
  agentEmail: string,
  pushedBy: string,
  ticketCount: number,
  avgScore: number | null
): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO pushed_scores
          (pick_date, date_mode, agent_email, pushed_by, pushed_at, ticket_count, avg_score)
          VALUES (?, ?, ?, ?, datetime('now'), ?, ?)`,
    args: [date, dateMode, agentEmail, pushedBy, ticketCount, avgScore],
  });
}

export interface ReevalRequest {
  id: number;
  ticketId: string;
  agentEmail: string | null;
  reason: string | null;
  status: 'open' | 'in_review' | 'resolved' | 'rejected';
  requestedBy: string | null;
  requestedAt: string;
  claimedBy: string | null;
  claimedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  originalScore: number | null;
  newScore: number | null;
}

export async function listReevaluations(opts: { status?: string; limit?: number } = {}): Promise<ReevalRequest[]> {
  await initPromise;
  const where: string[] = [];
  const args: any[] = [];
  if (opts.status) {
    where.push('status = ?');
    args.push(opts.status);
  }
  args.push(opts.limit ?? 200);
  const result = await reviewsDb.execute({
    sql: `SELECT id, ticket_id as ticketId, agent_email as agentEmail, reason, status,
                 requested_by as requestedBy, requested_at as requestedAt,
                 claimed_by as claimedBy, claimed_at as claimedAt,
                 resolved_by as resolvedBy, resolved_at as resolvedAt, resolved_note as resolvedNote,
                 original_score as originalScore, new_score as newScore
          FROM reevaluation_requests
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY
            CASE status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
            requested_at DESC
          LIMIT ?`,
    args,
  });
  return (result.rows as unknown as any[]).map((r) => ({
    ...r,
    originalScore: r.originalScore == null ? null : Number(r.originalScore),
    newScore: r.newScore == null ? null : Number(r.newScore),
  })) as ReevalRequest[];
}

export async function createReevaluation(input: {
  ticketId: string;
  agentEmail?: string;
  reason?: string;
  requestedBy?: string;
  originalScore?: number | null;
}): Promise<number> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `INSERT INTO reevaluation_requests
          (ticket_id, agent_email, reason, status, requested_by, requested_at, original_score)
          VALUES (?, ?, ?, 'open', ?, datetime('now'), ?)`,
    args: [
      input.ticketId,
      input.agentEmail || null,
      input.reason || null,
      input.requestedBy || null,
      input.originalScore ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

export async function claimReevaluation(id: number, auditor: string): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `UPDATE reevaluation_requests
          SET status = 'in_review', claimed_by = ?, claimed_at = datetime('now')
          WHERE id = ? AND status = 'open'`,
    args: [auditor, id],
  });
}

export async function resolveReevaluation(
  id: number,
  resolvedBy: string,
  status: 'resolved' | 'rejected',
  note?: string,
  newScore?: number | null
): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `UPDATE reevaluation_requests
          SET status = ?, resolved_by = ?, resolved_at = datetime('now'),
              resolved_note = ?, new_score = ?
          WHERE id = ?`,
    args: [status, resolvedBy, note || null, newScore ?? null, id],
  });
}

export async function countOpenReevaluations(): Promise<number> {
  await initPromise;
  const result = await reviewsDb.execute(
    `SELECT COUNT(*) as cnt FROM reevaluation_requests WHERE status IN ('open','in_review')`
  );
  return Number((result.rows[0] as any).cnt || 0);
}

// Distinct auditor names from reviews + assignments (acts as a directory until real auth)
export async function listAuditors(): Promise<string[]> {
  await initPromise;
  const a = await reviewsDb.execute(
    `SELECT DISTINCT auditor FROM agent_assignments WHERE auditor IS NOT NULL AND auditor != ''`
  );
  const b = await reviewsDb.execute(
    `SELECT DISTINCT reviewer_name as auditor FROM qa_reviews WHERE reviewer_name IS NOT NULL AND reviewer_name != ''`
  );
  const set = new Set<string>();
  (a.rows as any[]).forEach((r) => set.add(String(r.auditor)));
  (b.rows as any[]).forEach((r) => set.add(String(r.auditor)));
  return [...set].sort();
}

export interface TeamProgressEntry {
  auditor: string;
  agentsClaimed: number;
  agentsPushed: number;
  ticketsReviewed: number;
}

export async function getTeamProgress(date: string, dateMode: DateMode): Promise<TeamProgressEntry[]> {
  await initPromise;
  // Reviews completed today (by reviewed_at date matching the date param)
  // Note: reviewed_at is when the auditor reviewed, not the ticket's day; we count team activity that day.
  const reviews = await reviewsDb.execute({
    sql: `SELECT reviewer_name as auditor, COUNT(*) as cnt
          FROM qa_reviews
          WHERE reviewer_name IS NOT NULL AND reviewer_name != ''
            AND DATE(reviewed_at) = ?
          GROUP BY reviewer_name`,
    args: [date],
  });
  const reviewMap = new Map<string, number>();
  (reviews.rows as any[]).forEach((r) => reviewMap.set(String(r.auditor), Number(r.cnt || 0)));

  const claims = await reviewsDb.execute({
    sql: `SELECT auditor, COUNT(*) as cnt
          FROM agent_assignments
          WHERE pick_date = ? AND date_mode = ?
          GROUP BY auditor`,
    args: [date, dateMode],
  });
  const claimMap = new Map<string, number>();
  (claims.rows as any[]).forEach((r) => claimMap.set(String(r.auditor), Number(r.cnt || 0)));

  const pushes = await reviewsDb.execute({
    sql: `SELECT pushed_by as auditor, COUNT(*) as cnt
          FROM pushed_scores
          WHERE pick_date = ? AND date_mode = ?
          GROUP BY pushed_by`,
    args: [date, dateMode],
  });
  const pushMap = new Map<string, number>();
  (pushes.rows as any[]).forEach((r) => pushMap.set(String(r.auditor), Number(r.cnt || 0)));

  const auditors = new Set<string>([
    ...reviewMap.keys(),
    ...claimMap.keys(),
    ...pushMap.keys(),
  ]);
  return [...auditors].map((auditor) => ({
    auditor,
    agentsClaimed: claimMap.get(auditor) || 0,
    agentsPushed: pushMap.get(auditor) || 0,
    ticketsReviewed: reviewMap.get(auditor) || 0,
  })).sort((a, b) => (b.ticketsReviewed + b.agentsPushed) - (a.ticketsReviewed + a.agentsPushed));
}

export async function getMyStats(
  date: string,
  dateMode: DateMode,
  auditor: string
): Promise<{ ticketsReviewed: number; agentsClaimed: number; agentsPushed: number; openReevals: number }> {
  await initPromise;
  const [reviews, claims, pushes, reevals] = await Promise.all([
    reviewsDb.execute({
      sql: `SELECT COUNT(*) as cnt FROM qa_reviews
            WHERE reviewer_name = ? AND DATE(reviewed_at) = ?`,
      args: [auditor, date],
    }),
    reviewsDb.execute({
      sql: `SELECT COUNT(*) as cnt FROM agent_assignments
            WHERE auditor = ? AND pick_date = ? AND date_mode = ?`,
      args: [auditor, date, dateMode],
    }),
    reviewsDb.execute({
      sql: `SELECT COUNT(*) as cnt FROM pushed_scores
            WHERE pushed_by = ? AND pick_date = ? AND date_mode = ?`,
      args: [auditor, date, dateMode],
    }),
    reviewsDb.execute({
      sql: `SELECT COUNT(*) as cnt FROM reevaluation_requests
            WHERE status IN ('open','in_review')
              AND (claimed_by = ? OR claimed_by IS NULL)`,
      args: [auditor],
    }),
  ]);
  return {
    ticketsReviewed: Number((reviews.rows[0] as any).cnt || 0),
    agentsClaimed: Number((claims.rows[0] as any).cnt || 0),
    agentsPushed: Number((pushes.rows[0] as any).cnt || 0),
    openReevals: Number((reevals.rows[0] as any).cnt || 0),
  };
}
