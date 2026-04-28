import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@libsql/client';
import { fetchTicketsFromMetabase, isMetabaseEnabled } from './metabase.service.js';

// Main database — always Turso (or local dev.db); Metabase syncs INTO this DB
const mainDbUrl = process.env.TURSO_DB_URL || 'file:./dev.db';

const mainDb = createClient({
  url: mainDbUrl,
  authToken: process.env.TURSO_DB_TOKEN,
});

// Reviews database (writable)
const reviewsDb = createClient({
  url: process.env.TURSO_REVIEWS_URL || mainDbUrl,
  authToken: process.env.TURSO_REVIEWS_TOKEN || process.env.TURSO_DB_TOKEN,
});

// Add indexes on raw_tickets for common query patterns (runs on every cold start, idempotent)
mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_day ON raw_tickets(DAY)`).catch(() => {});
mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_agent ON raw_tickets(AGENT_EMAIL)`).catch(() => {});
mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_init ON raw_tickets(INITIALIZED_TIME)`).catch(() => {});
mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_agent_day ON raw_tickets(AGENT_EMAIL, DAY)`).catch(() => {});

// Create raw_tickets if it doesn't exist — safe on both local SQLite and Turso
const initMainPromise = mainDb.execute(`
    CREATE TABLE IF NOT EXISTS raw_tickets (
      TICKET_ID TEXT,
      VISITOR_NAME TEXT,
      VISITOR_EMAIL TEXT,
      SUBJECT TEXT,
      TAGS TEXT,
      TICKET_STATUS TEXT,
      PRIORITY TEXT,
      AGENT_EMAIL TEXT,
      RESOLVED_BY TEXT,
      FIRST_RESPONSE_DURATION_SECONDS INTEGER,
      AVG_RESPONSE_TIME_SECONDS INTEGER,
      SPENT_TIME_SECONDS INTEGER,
      TICKET_CSAT INTEGER,
      AGENT_RATING INTEGER,
      MESSAGES_JSON TEXT,
      MESSAGE_COUNT INTEGER,
      USER_MESSAGE_COUNT INTEGER,
      AGENT_MESSAGE_COUNT INTEGER,
      DAY TEXT,
      GROUP_NAME TEXT,
      INITIALIZED_TIME TEXT,
      RESOLVED_TIME TEXT
    )
  `).catch(() => { /* table already exists */ });

// Initialize reviews table once, share this promise across all callers
const initPromise = reviewsDb.execute(`
  CREATE TABLE IF NOT EXISTS qa_reviews (
    ticket_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('approved', 'flagged')),
    note TEXT,
    reviewer_name TEXT,
    reviewed_at TEXT NOT NULL
  )
`).then(() =>
  reviewsDb.execute(`ALTER TABLE qa_reviews ADD COLUMN reviewer_name TEXT`).catch(() => {})
).then(() =>
  reviewsDb.execute(`ALTER TABLE qa_reviews ADD COLUMN score_override INTEGER`).catch(() => {})
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS audit_memories (
      memory_key TEXT PRIMARY KEY,
      customer_email TEXT NOT NULL,
      issue_signature TEXT NOT NULL,
      category TEXT,
      subject TEXT,
      tags TEXT,
      last_ticket_id TEXT NOT NULL,
      last_ticket_date TEXT,
      last_agent_email TEXT,
      total_seen INTEGER NOT NULL DEFAULT 1,
      repeat_issue INTEGER NOT NULL DEFAULT 0,
      customer_experience TEXT,
      customer_context TEXT,
      resolution_state TEXT,
      resolution_notes TEXT,
      deduction_summary TEXT,
      missed_steps TEXT,
      suggestions TEXT,
      qa_score INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS daily_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pick_date TEXT NOT NULL,
      date_mode TEXT NOT NULL DEFAULT 'activity',
      agent_email TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      pick_order INTEGER NOT NULL,
      analyzed INTEGER NOT NULL DEFAULT 0,
      analysis_status TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(pick_date, date_mode, agent_email, ticket_id)
    )
  `)
).then(() =>
  reviewsDb.execute(`ALTER TABLE daily_picks ADD COLUMN date_mode TEXT NOT NULL DEFAULT 'activity'`).catch(() => {
    /* column already exists */
  })
).then(() =>
  reviewsDb.execute(`ALTER TABLE daily_picks ADD COLUMN pick_reason TEXT`).catch(() => {
    /* column already exists */
  })
).then(() =>
  reviewsDb.execute(`ALTER TABLE daily_picks ADD COLUMN risk_score REAL`).catch(() => {
    /* column already exists */
  })
).then(() =>
  reviewsDb.execute(`CREATE INDEX IF NOT EXISTS idx_daily_picks_date_mode ON daily_picks(pick_date, date_mode)`).catch(() => {})
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS ticket_analyses (
      ticket_id TEXT PRIMARY KEY,
      analysis_json TEXT NOT NULL,
      analyzed_at TEXT NOT NULL,
      source TEXT
    )
  `)
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS qa_scores (
      ticket_id TEXT PRIMARY KEY,
      qa_score REAL NOT NULL,
      summary TEXT,
      analyzed_at TEXT NOT NULL
    )
  `)
).then(() =>
  reviewsDb.execute(`ALTER TABLE qa_scores ADD COLUMN deductions_json TEXT`).catch(() => {})
).then(() =>
  reviewsDb.execute(`ALTER TABLE qa_scores ADD COLUMN score_override REAL`).catch(() => {})
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS ticket_quick_scores (
      ticket_id TEXT PRIMARY KEY,
      sentiment TEXT,
      priority TEXT,
      has_error INTEGER,
      issue_category TEXT,
      risk_score REAL,
      analyzed_at TEXT NOT NULL
    )
  `)
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS daily_agent_qa_scores (
      agent_email TEXT,
      date TEXT,
      avg_score REAL,
      scored_count INTEGER,
      PRIMARY KEY (agent_email, date)
    )
  `)
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS metabase_sync_log (
      date TEXT PRIMARY KEY,
      synced_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0
    )
  `)
).then(() =>
  reviewsDb.execute(`
    CREATE TABLE IF NOT EXISTS score_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      original_score REAL NOT NULL,
      adjusted_score REAL NOT NULL,
      adjustment_delta REAL NOT NULL,
      adjusted_by TEXT NOT NULL,
      adjusted_at TEXT NOT NULL,
      adjustment_reason TEXT
    )
  `)
).then(() =>
  reviewsDb.execute(`CREATE INDEX IF NOT EXISTS idx_score_adjustments_ticket ON score_adjustments(ticket_id)`).catch(() => {})
);

export interface DailyPick {
  pickDate: string;
  dateMode: DateMode;
  agentEmail: string;
  ticketId: string;
  pickOrder: number;
  riskScore: number | null;
  pickReason: string | null;
  analyzed: boolean;
  analysisStatus: string | null;
}

export async function getDailyPicksFromDb(
  date: string,
  dateMode: DateMode = 'activity',
  agentEmail?: string
): Promise<DailyPick[]> {
  await initPromise;
  const hasAgentFilter = Boolean(agentEmail);
  const result = await reviewsDb.execute({
    sql: `SELECT pick_date as pickDate, date_mode as dateMode, agent_email as agentEmail, ticket_id as ticketId,
                 pick_order as pickOrder, risk_score as riskScore, pick_reason as pickReason, analyzed, analysis_status as analysisStatus
          FROM daily_picks
          WHERE pick_date = ?
            AND date_mode = ?
            ${hasAgentFilter ? 'AND agent_email = ?' : ''}
          ORDER BY agent_email, pick_order`,
    args: hasAgentFilter ? [date, dateMode, agentEmail as string] : [date, dateMode],
  });
  return (result.rows as unknown as any[]).map(r => ({
    ...r,
    analyzed: Boolean(r.analyzed) && r.analysisStatus === 'success',
    riskScore: r.riskScore != null ? Number(r.riskScore) : null,
    pickReason: r.pickReason || null,
  }));
}

export async function saveDailyPicks(picks: Array<{ pickDate: string; dateMode: DateMode; agentEmail: string; ticketId: string; pickOrder: number; risk_score?: number; pick_reason?: string; analyzed?: boolean; analysisStatus?: string | null }>): Promise<void> {
  await initPromise;
  if (picks.length === 0) return;
  const now = new Date().toISOString();
  // Batch insert in a single transaction instead of N individual round-trips
  const statements = picks.map(pick => ({
    sql: `INSERT OR IGNORE INTO daily_picks (pick_date, date_mode, agent_email, ticket_id, pick_order, risk_score, pick_reason, analyzed, analysis_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      pick.pickDate,
      pick.dateMode,
      pick.agentEmail,
      pick.ticketId,
      pick.pickOrder,
      pick.risk_score ?? null,
      pick.pick_reason ?? null,
      pick.analyzed ? 1 : 0,
      pick.analysisStatus || null,
      now
    ],
  }));
  await reviewsDb.batch(statements, 'write');
}

export async function clearDailyPicks(date: string, dateMode: DateMode = 'activity'): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `DELETE FROM daily_picks WHERE pick_date = ? AND date_mode = ?`,
    args: [date, dateMode],
  });
}

export async function clearDailyPicksForAgent(date: string, dateMode: DateMode = 'activity', agentEmail: string): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `DELETE FROM daily_picks WHERE pick_date = ? AND date_mode = ? AND agent_email = ?`,
    args: [date, dateMode, agentEmail],
  });
}

export async function markPickAnalyzed(date: string, dateMode: DateMode, ticketId: string, status: string): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `UPDATE daily_picks
          SET analyzed = ?, analysis_status = ?
          WHERE pick_date = ? AND date_mode = ? AND ticket_id = ?`,
    args: [status === 'success' ? 1 : 0, status, date, dateMode, ticketId],
  });
}

export async function syncDailyPickAnalysisFlags(date: string, dateMode: DateMode = 'activity'): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `UPDATE daily_picks
          SET analyzed = 1,
              analysis_status = 'success'
          WHERE pick_date = ?
            AND date_mode = ?
            AND ticket_id IN (
              SELECT ticket_id
              FROM ticket_analyses
              WHERE COALESCE(json_extract(analysis_json, '$.isFallback'), 0) = 0
            )`,
    args: [date, dateMode],
  });
}

export async function saveTicketAnalysis(
  ticketId: string,
  analysis: object,
  source: 'daily_audit' | 'manual' = 'manual'
): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO ticket_analyses (ticket_id, analysis_json, analyzed_at, source)
          VALUES (?, ?, datetime('now'), ?)`,
    args: [ticketId, JSON.stringify(analysis), source],
  });
}

export async function getStoredTicketAnalysis(ticketId: string): Promise<object | null> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `SELECT analysis_json FROM ticket_analyses WHERE ticket_id = ?`,
    args: [ticketId],
  });
  const row = result.rows[0] as unknown as { analysis_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.analysis_json);
  } catch {
    return null;
  }
}

export async function getStoredTicketAnalysisIds(ticketIds: string[]): Promise<Set<string>> {
  await initPromise;
  if (ticketIds.length === 0) return new Set();

  const placeholders = ticketIds.map(() => '?').join(',');
  const result = await reviewsDb.execute({
    sql: `SELECT ticket_id as ticketId
          FROM ticket_analyses
          WHERE ticket_id IN (${placeholders})
            AND COALESCE(json_extract(analysis_json, '$.isFallback'), 0) = 0`,
    args: ticketIds,
  });

  return new Set((result.rows as unknown as any[]).map((row) => String(row.ticketId)));
}

export async function getActiveAgentEmails(date: string, dateMode: DateMode = 'activity'): Promise<string[]> {
  await ensureDateSynced(date);
  await initMainPromise;
  const dateCondition = dateMode === 'initialized' ? 'DATE(INITIALIZED_TIME) = ?' : 'DAY = ?';
  const result = await mainDb.execute({
    sql: `SELECT DISTINCT AGENT_EMAIL FROM raw_tickets WHERE ${dateCondition} AND AGENT_EMAIL IS NOT NULL AND AGENT_EMAIL != '' LIMIT 200`,
    args: [date],
  });
  return (result.rows as unknown as any[]).map(r => String(r.AGENT_EMAIL));
}

export async function getAgentTicketIds(agentEmail: string, date: string, dateMode: DateMode = 'activity'): Promise<string[]> {
  await ensureDateSynced(date);
  await initMainPromise;
  const dateCondition = dateMode === 'initialized' ? 'DATE(INITIALIZED_TIME) = ?' : 'DAY = ?';
  const result = await mainDb.execute({
    sql: `SELECT DISTINCT TICKET_ID FROM raw_tickets WHERE AGENT_EMAIL = ? AND ${dateCondition}`,
    args: [agentEmail, date],
  });
  return (result.rows as unknown as any[]).map(r => String(r.TICKET_ID));
}

export interface DailyPickCandidate {
  ticketId: string;
  agentEmail: string;
  initializedTime: string | null;
  csat: number | null;
  priority: string | null;
  firstResponseSeconds: number | null;
  messageCount: number | null;
  userMessageCount: number | null;
  agentMessageCount: number | null;
  ticketStatus: string | null;
}

export async function getDailyPickCandidates(
  date: string,
  dateMode: DateMode = 'activity',
  agentEmail?: string
): Promise<DailyPickCandidate[]> {
  await ensureDateSynced(date);
  await initMainPromise;
  const dateCondition = dateMode === 'initialized' ? 'DATE(INITIALIZED_TIME) = ?' : 'DAY = ?';
  const hasAgentFilter = Boolean(agentEmail);
  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            TICKET_ID as ticketId,
            MAX(INITIALIZED_TIME) as initializedTime,
            MAX(TICKET_CSAT) as csat,
            MAX(PRIORITY) as priority,
            MAX(FIRST_RESPONSE_DURATION_SECONDS) as firstResponseSeconds,
            MAX(MESSAGE_COUNT) as messageCount,
            MAX(USER_MESSAGE_COUNT) as userMessageCount,
            MAX(AGENT_MESSAGE_COUNT) as agentMessageCount,
            MAX(TICKET_STATUS) as ticketStatus
          FROM raw_tickets
          WHERE ${dateCondition}
            AND AGENT_EMAIL IS NOT NULL
            AND AGENT_EMAIL != ''
            ${hasAgentFilter ? 'AND AGENT_EMAIL = ?' : ''}
            AND TICKET_ID IS NOT NULL
          GROUP BY AGENT_EMAIL, TICKET_ID
          ORDER BY AGENT_EMAIL ASC`,
    args: hasAgentFilter ? [date, agentEmail as string] : [date],
  });
  return (result.rows as unknown as any[]).map((row) => ({
    ticketId: String(row.ticketId),
    agentEmail: String(row.agentEmail),
    initializedTime: row.initializedTime ? String(row.initializedTime) : null,
    csat: row.csat != null && row.csat !== '' ? Number(row.csat) : null,
    priority: row.priority ? String(row.priority) : null,
    firstResponseSeconds: row.firstResponseSeconds != null ? Number(row.firstResponseSeconds) : null,
    messageCount: row.messageCount != null ? Number(row.messageCount) : null,
    userMessageCount: row.userMessageCount != null ? Number(row.userMessageCount) : null,
    agentMessageCount: row.agentMessageCount != null ? Number(row.agentMessageCount) : null,
    ticketStatus: row.ticketStatus ? String(row.ticketStatus) : null,
  }));
}

export interface DailyPickTicketSummary {
  ticketId: string;
  subject: string | null;
  customerEmail: string | null;
  status: string | null;
  priority: string | null;
  groupName: string | null;
  day: string | null;
  responseTimeSeconds: number | null;
  hasStoredAnalysis: boolean;
}

export async function getDailyPickTicketSummaries(ticketIds: string[]): Promise<Record<string, DailyPickTicketSummary>> {
  await initPromise;
  await initMainPromise;
  if (ticketIds.length === 0) return {};

  const placeholders = ticketIds.map(() => '?').join(',');
  const [ticketsResult, analysesResult] = await Promise.all([
    mainDb.execute({
      sql: `SELECT
              TICKET_ID as ticketId,
              MAX(SUBJECT) as subject,
              MAX(VISITOR_EMAIL) as customerEmail,
              MAX(TICKET_STATUS) as status,
              MAX(PRIORITY) as priority,
              MAX(GROUP_NAME) as groupName,
              MAX(DAY) as day,
              MAX(FIRST_RESPONSE_DURATION_SECONDS) as responseTimeSeconds
            FROM raw_tickets
            WHERE TICKET_ID IN (${placeholders})
            GROUP BY TICKET_ID`,
      args: ticketIds,
    }),
    reviewsDb.execute({
      sql: `SELECT ticket_id as ticketId
            FROM ticket_analyses
            WHERE ticket_id IN (${placeholders})
              AND COALESCE(json_extract(analysis_json, '$.isFallback'), 0) = 0`,
      args: ticketIds,
    }),
  ]);

  const analyzedIds = new Set((analysesResult.rows as unknown as any[]).map((row) => String(row.ticketId)));
  const out: Record<string, DailyPickTicketSummary> = {};

  (ticketsResult.rows as unknown as any[]).forEach((row) => {
    const ticketId = String(row.ticketId);
    out[ticketId] = {
      ticketId,
      subject: row.subject || null,
      customerEmail: row.customerEmail || null,
      status: row.status || null,
      priority: row.priority || null,
      groupName: row.groupName || null,
      day: row.day || null,
      responseTimeSeconds: row.responseTimeSeconds === null || row.responseTimeSeconds === undefined
        ? null
        : Number(row.responseTimeSeconds),
      hasStoredAnalysis: analyzedIds.has(ticketId),
    };
  });

  return out;
}

export interface QAReview {
  status: 'approved' | 'flagged';
  note: string | null;
  reviewerName: string | null;
  reviewedAt: string;
  scoreOverride: number | null;
}

export interface ScoreAdjustment {
  id: number;
  ticketId: string;
  originalScore: number;
  adjustedScore: number;
  adjustmentDelta: number;
  adjustedBy: string;
  adjustedAt: string;
  adjustmentReason: string | null;
}

export interface AuditMemoryRecord {
  memoryKey: string;
  customerEmail: string;
  issueSignature: string;
  category: string | null;
  subject: string | null;
  tags: string | null;
  lastTicketId: string;
  lastTicketDate: string | null;
  lastAgentEmail: string | null;
  totalSeen: number;
  repeatIssue: boolean;
  customerExperience: string | null;
  customerContext: string | null;
  resolutionState: string | null;
  resolutionNotes: string | null;
  deductionSummary: string | null;
  missedSteps: string | null;
  suggestions: string | null;
  qaScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAuditMemoryInput {
  customerEmail: string;
  issueSignature: string;
  category?: string;
  subject?: string;
  tags?: string;
  ticketId: string;
  ticketDate?: string;
  agentEmail?: string;
  repeatIssue?: boolean;
  customerExperience?: string | null;
  customerContext?: string | null;
  resolutionState?: string | null;
  resolutionNotes?: string | null;
  deductionSummary?: string | null;
  missedSteps?: string | null;
  suggestions?: string | null;
  qaScore?: number | null;
}

export async function saveQAReview(ticketId: string, status: 'approved' | 'flagged', note?: string, reviewerName?: string): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO qa_reviews (ticket_id, status, note, reviewer_name, reviewed_at)
          VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [ticketId, status, note || null, reviewerName || null],
  });
}

export async function getQAReview(ticketId: string): Promise<QAReview | undefined> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `SELECT status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt,
                 score_override as scoreOverride
          FROM qa_reviews WHERE ticket_id = ?`,
    args: [ticketId],
  });
  return result.rows[0] as unknown as QAReview | undefined;
}

export async function saveScoreOverride(
  ticketId: string,
  adjustedScore: number,
  adjustedBy: string,
  adjustmentReason?: string,
): Promise<{ originalScore: number | null }> {
  await initPromise;

  const scoreResult = await reviewsDb.execute({
    sql: 'SELECT qa_score FROM qa_scores WHERE ticket_id = ?',
    args: [ticketId],
  });
  const originalScore = scoreResult.rows[0] ? Number((scoreResult.rows[0] as any).qa_score) : null;

  // Store override on qa_scores — always has a row for analyzed tickets, no dependency on a QC review existing
  await reviewsDb.execute({
    sql: `UPDATE qa_scores SET score_override = ? WHERE ticket_id = ?`,
    args: [adjustedScore, ticketId],
  });

  if (originalScore !== null) {
    await reviewsDb.execute({
      sql: `INSERT INTO score_adjustments (ticket_id, original_score, adjusted_score, adjustment_delta, adjusted_by, adjusted_at, adjustment_reason)
            VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
      args: [ticketId, originalScore, adjustedScore, adjustedScore - originalScore, adjustedBy, adjustmentReason || null],
    });
  }

  return { originalScore };
}

export async function getScoreAdjustmentHistory(ticketId: string): Promise<ScoreAdjustment[]> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `SELECT id, ticket_id as ticketId, original_score as originalScore, adjusted_score as adjustedScore,
                 adjustment_delta as adjustmentDelta, adjusted_by as adjustedBy, adjusted_at as adjustedAt,
                 adjustment_reason as adjustmentReason
          FROM score_adjustments
          WHERE ticket_id = ?
          ORDER BY adjusted_at DESC`,
    args: [ticketId],
  });
  return result.rows as unknown as ScoreAdjustment[];
}

export async function deleteQAReview(ticketId: string): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `DELETE FROM qa_reviews WHERE ticket_id = ?`,
    args: [ticketId],
  });
}

export async function getQAReviewsBulk(ticketIds: string[]): Promise<Record<string, QAReview>> {
  if (ticketIds.length === 0) return {};
  await initPromise;
  const placeholders = ticketIds.map(() => '?').join(',');
  const result = await reviewsDb.execute({
    sql: `SELECT ticket_id, status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt,
                 score_override as scoreOverride
          FROM qa_reviews
          WHERE ticket_id IN (${placeholders})`,
    args: ticketIds,
  });
  const rows = result.rows as unknown as Array<QAReview & { ticket_id: string }>;
  const out: Record<string, QAReview> = {};
  rows.forEach(row => {
    out[row.ticket_id] = {
      status: row.status,
      note: row.note,
      reviewerName: row.reviewerName,
      reviewedAt: row.reviewedAt,
      scoreOverride: row.scoreOverride ?? null,
    };
  });
  return out;
}

export async function getAllQAReviews(): Promise<Array<QAReview & { ticketId: string }>> {
  await initPromise;
  const result = await reviewsDb.execute(`
    SELECT ticket_id as ticketId, status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt
    FROM qa_reviews
    ORDER BY reviewed_at DESC
  `);
  return result.rows as unknown as Array<QAReview & { ticketId: string }>;
}

export async function saveAuditMemory(input: SaveAuditMemoryInput): Promise<void> {
  await initPromise;

  const memoryKey = `${input.customerEmail.toLowerCase()}::${input.issueSignature}`;
  const existingResult = await reviewsDb.execute({
    sql: `SELECT total_seen as totalSeen, last_ticket_id as lastTicketId, created_at as createdAt
          FROM audit_memories
          WHERE memory_key = ?`,
    args: [memoryKey],
  });

  const existing = existingResult.rows[0] as unknown as {
    totalSeen?: number;
    lastTicketId?: string;
    createdAt?: string;
  } | undefined;

  const totalSeen = existing?.lastTicketId === input.ticketId
    ? Number(existing?.totalSeen || 1)
    : Number(existing?.totalSeen || 0) + 1;
  const createdAt = existing?.createdAt || new Date().toISOString();
  const updatedAt = new Date().toISOString();

  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO audit_memories (
            memory_key,
            customer_email,
            issue_signature,
            category,
            subject,
            tags,
            last_ticket_id,
            last_ticket_date,
            last_agent_email,
            total_seen,
            repeat_issue,
            customer_experience,
            customer_context,
            resolution_state,
            resolution_notes,
            deduction_summary,
            missed_steps,
            suggestions,
            qa_score,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      memoryKey,
      input.customerEmail.toLowerCase(),
      input.issueSignature,
      input.category || null,
      input.subject || null,
      input.tags || null,
      input.ticketId,
      input.ticketDate || null,
      input.agentEmail || null,
      totalSeen,
      input.repeatIssue ? 1 : 0,
      input.customerExperience || null,
      input.customerContext || null,
      input.resolutionState || null,
      input.resolutionNotes || null,
      input.deductionSummary || null,
      input.missedSteps || null,
      input.suggestions || null,
      input.qaScore ?? null,
      createdAt,
      updatedAt,
    ],
  });
}

export async function getRelevantAuditMemories(
  customerEmail: string,
  issueSignature?: string,
  limit = 3
): Promise<AuditMemoryRecord[]> {
  await initPromise;

  const normalizedEmail = customerEmail.toLowerCase();
  const exactSignature = issueSignature || '';
  const prefixSignature = exactSignature.includes('|')
    ? `${exactSignature.split('|')[0]}%`
    : '';

  const result = await reviewsDb.execute({
    sql: `SELECT
            memory_key as memoryKey,
            customer_email as customerEmail,
            issue_signature as issueSignature,
            category,
            subject,
            tags,
            last_ticket_id as lastTicketId,
            last_ticket_date as lastTicketDate,
            last_agent_email as lastAgentEmail,
            total_seen as totalSeen,
            repeat_issue as repeatIssue,
            customer_experience as customerExperience,
            customer_context as customerContext,
            resolution_state as resolutionState,
            resolution_notes as resolutionNotes,
            deduction_summary as deductionSummary,
            missed_steps as missedSteps,
            suggestions,
            qa_score as qaScore,
            created_at as createdAt,
            updated_at as updatedAt
          FROM audit_memories
          WHERE customer_email = ?
          ORDER BY
            CASE
              WHEN issue_signature = ? THEN 0
              WHEN ? != '' AND issue_signature LIKE ? THEN 1
              ELSE 2
            END,
            updated_at DESC
          LIMIT ?`,
    args: [normalizedEmail, exactSignature, prefixSignature, prefixSignature, limit],
  });

  return (result.rows as unknown as AuditMemoryRecord[]).map((row) => ({
    ...row,
    totalSeen: Number(row.totalSeen || 0),
    repeatIssue: Boolean(row.repeatIssue),
    qaScore: row.qaScore === null || row.qaScore === undefined ? null : Number(row.qaScore),
  }));
}

export interface ReviewWithTicket extends QAReview {
  ticketId: string;
  reviewerName: string | null;
  subject: string | null;
  agentEmail: string | null;
  visitorEmail: string | null;
  csat: number | null;
  day: string | null;
  ticketStatus: string | null;
}

export async function getAllQAReviewsWithTickets(): Promise<ReviewWithTicket[]> {
  await initMainPromise;
  const reviews = await getAllQAReviews();
  if (reviews.length === 0) return [];

  const ticketIds = reviews.map(r => r.ticketId);
  const placeholders = ticketIds.map(() => '?').join(',');
  const result = await mainDb.execute({
    sql: `SELECT
            TICKET_ID,
            MAX(SUBJECT) as SUBJECT,
            MAX(AGENT_EMAIL) as AGENT_EMAIL,
            MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
            MAX(TICKET_CSAT) as TICKET_CSAT,
            MAX(DAY) as DAY,
            MAX(TICKET_STATUS) as TICKET_STATUS
          FROM raw_tickets
          WHERE TICKET_ID IN (${placeholders})
          GROUP BY TICKET_ID`,
    args: ticketIds,
  });
  const ticketRows = result.rows as unknown as any[];
  const ticketMap: Record<string, any> = {};
  ticketRows.forEach(t => { ticketMap[String(t.TICKET_ID)] = t; });

  return reviews.map(r => {
    const t = ticketMap[r.ticketId];
    return {
      ...r,
      subject: t?.SUBJECT || null,
      agentEmail: t?.AGENT_EMAIL || null,
      visitorEmail: t?.VISITOR_EMAIL || null,
      csat: t?.TICKET_CSAT || null,
      day: t?.DAY || null,
      ticketStatus: t?.TICKET_STATUS || null,
    };
  });
}

export interface TicketRow {
  TICKET_ID: string;
  VISITOR_NAME: string;
  VISITOR_EMAIL: string;
  SUBJECT: string;
  TAGS: string;
  TICKET_STATUS: string;
  PRIORITY: string;
  AGENT_EMAIL: string;
  RESOLVED_BY: string;
  FIRST_RESPONSE_DURATION_SECONDS: number;
  AVG_RESPONSE_TIME_SECONDS: number;
  SPENT_TIME_SECONDS: number;
  TICKET_CSAT: number;
  AGENT_RATING: number;
  MESSAGES_JSON: string;
  MESSAGE_COUNT: number;
  USER_MESSAGE_COUNT: number;
  AGENT_MESSAGE_COUNT: number;
  DAY: string;
  GROUP_NAME: string;
  INITIALIZED_TIME: string;
  RESOLVED_TIME: string;
}

// Normalize TEXT columns from SQLite to proper JS numbers
function toNum(val: any): number {
  if (val === null || val === undefined || val === '' || val === 'NA') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function normalizeTicketRow(row: any): TicketRow {
  return {
    ...row,
    FIRST_RESPONSE_DURATION_SECONDS: toNum(row.FIRST_RESPONSE_DURATION_SECONDS),
    AVG_RESPONSE_TIME_SECONDS: toNum(row.AVG_RESPONSE_TIME_SECONDS),
    SPENT_TIME_SECONDS: toNum(row.SPENT_TIME_SECONDS),
    TICKET_CSAT: toNum(row.TICKET_CSAT),
    AGENT_RATING: toNum(row.AGENT_RATING),
    MESSAGE_COUNT: toNum(row.MESSAGE_COUNT),
    USER_MESSAGE_COUNT: toNum(row.USER_MESSAGE_COUNT),
    AGENT_MESSAGE_COUNT: toNum(row.AGENT_MESSAGE_COUNT),
  };
}

export interface AgentSummary {
  agentEmail: string;
  totalTickets: number;
  avgCsat: number;
  avgResponseTime: number;
  resolvedCount: number;
  lowCsatCount: number;
}

// Date mode type for filtering
export type DateMode = 'activity' | 'initialized';

// Get unique dates available in database
export async function getAvailableDates(): Promise<string[]> {
  await initMainPromise;
  const result = await mainDb.execute(`
    SELECT DISTINCT DAY
    FROM raw_tickets
    WHERE DAY IS NOT NULL AND AGENT_EMAIL IS NOT NULL AND AGENT_EMAIL != ''
    ORDER BY DAY DESC
    LIMIT 90
  `);
  return (result.rows as unknown as Array<{ DAY: string }>).map(row => row.DAY);
}

// Get agent summary for a specific date (using DISTINCT to avoid duplicates)
// dateMode: 'activity' = filter by DAY field, 'initialized' = filter by INITIALIZED_TIME date
export async function getAgentsDailySummary(date: string, dateMode: DateMode = 'activity'): Promise<AgentSummary[]> {
  await ensureDateSynced(date);
  await initMainPromise;
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) > 0 AND CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) < 86400
                           THEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE ${dateCondition} AND AGENT_EMAIL IS NOT NULL AND AGENT_EMAIL != ''
          GROUP BY AGENT_EMAIL
          ORDER BY totalTickets DESC`,
    args: [date],
  });
  return result.rows as unknown as AgentSummary[];
}

// Export normalizeTicketRow for use in routes
export { normalizeTicketRow };

// Get tickets for a specific agent on a specific date (deduplicated by TICKET_ID)
// dateMode: 'activity' = filter by DAY field (when ticket had activity/resolved)
// dateMode: 'initialized' = filter by INITIALIZED_TIME date (when ticket was created)
export async function getAgentTickets(agentEmail: string, date: string, limit = 100, offset = 0, dateMode: DateMode = 'activity', skipSync = false): Promise<TicketRow[]> {
  if (!skipSync) await ensureDateSynced(date);
  await initMainPromise;
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            TICKET_ID,
            MAX(VISITOR_NAME) as VISITOR_NAME,
            MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
            MAX(SUBJECT) as SUBJECT,
            MAX(TAGS) as TAGS,
            MAX(TICKET_STATUS) as TICKET_STATUS,
            MAX(PRIORITY) as PRIORITY,
            MAX(AGENT_EMAIL) as AGENT_EMAIL,
            MAX(RESOLVED_BY) as RESOLVED_BY,
            MAX(FIRST_RESPONSE_DURATION_SECONDS) as FIRST_RESPONSE_DURATION_SECONDS,
            MAX(AVG_RESPONSE_TIME_SECONDS) as AVG_RESPONSE_TIME_SECONDS,
            MAX(SPENT_TIME_SECONDS) as SPENT_TIME_SECONDS,
            MAX(TICKET_CSAT) as TICKET_CSAT,
            MAX(AGENT_RATING) as AGENT_RATING,
            MAX(MESSAGES_JSON) as MESSAGES_JSON,
            MAX(MESSAGE_COUNT) as MESSAGE_COUNT,
            MAX(USER_MESSAGE_COUNT) as USER_MESSAGE_COUNT,
            MAX(AGENT_MESSAGE_COUNT) as AGENT_MESSAGE_COUNT,
            MAX(DAY) as DAY,
            MAX(GROUP_NAME) as GROUP_NAME,
            MAX(INITIALIZED_TIME) as INITIALIZED_TIME,
            MAX(RESOLVED_TIME) as RESOLVED_TIME
          FROM raw_tickets
          WHERE AGENT_EMAIL = ? AND ${dateCondition}
          GROUP BY TICKET_ID
          ORDER BY MAX(INITIALIZED_TIME) DESC
          LIMIT ? OFFSET ?`,
    args: [agentEmail, date, limit, offset],
  });
  return (result.rows as unknown as any[]).map(normalizeTicketRow);
}

// Get agent performance over a date range
export async function getAgentPerformance(agentEmail: string, startDate: string, endDate: string) {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT
            DAY as date,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) > 0 AND CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) < 86400
                           THEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE AGENT_EMAIL = ? AND DAY BETWEEN ? AND ?
          GROUP BY DAY
          ORDER BY DAY ASC`,
    args: [agentEmail, startDate, endDate],
  });
  return result.rows;
}

// Get single ticket by ID (returns first match if duplicates exist)
export async function getTicketById(ticketId: string): Promise<TicketRow | undefined> {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT
            TICKET_ID,
            MAX(VISITOR_NAME) as VISITOR_NAME,
            MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
            MAX(SUBJECT) as SUBJECT,
            MAX(TAGS) as TAGS,
            MAX(TICKET_STATUS) as TICKET_STATUS,
            MAX(PRIORITY) as PRIORITY,
            MAX(AGENT_EMAIL) as AGENT_EMAIL,
            MAX(RESOLVED_BY) as RESOLVED_BY,
            MAX(FIRST_RESPONSE_DURATION_SECONDS) as FIRST_RESPONSE_DURATION_SECONDS,
            MAX(AVG_RESPONSE_TIME_SECONDS) as AVG_RESPONSE_TIME_SECONDS,
            MAX(SPENT_TIME_SECONDS) as SPENT_TIME_SECONDS,
            MAX(TICKET_CSAT) as TICKET_CSAT,
            MAX(AGENT_RATING) as AGENT_RATING,
            MAX(MESSAGES_JSON) as MESSAGES_JSON,
            MAX(MESSAGE_COUNT) as MESSAGE_COUNT,
            MAX(USER_MESSAGE_COUNT) as USER_MESSAGE_COUNT,
            MAX(AGENT_MESSAGE_COUNT) as AGENT_MESSAGE_COUNT,
            MAX(DAY) as DAY,
            MAX(GROUP_NAME) as GROUP_NAME,
            MAX(INITIALIZED_TIME) as INITIALIZED_TIME,
            MAX(RESOLVED_TIME) as RESOLVED_TIME
          FROM raw_tickets
          WHERE TICKET_ID = ?
          GROUP BY TICKET_ID`,
    args: [ticketId],
  });
  const row = result.rows[0] as unknown as any | undefined;
  return row ? normalizeTicketRow(row) : undefined;
}

// Get customer ticket history (deduplicated)
export async function getCustomerHistory(email: string, limit = 50): Promise<TicketRow[]> {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT
            TICKET_ID,
            MAX(VISITOR_NAME) as VISITOR_NAME,
            MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
            MAX(SUBJECT) as SUBJECT,
            MAX(TAGS) as TAGS,
            MAX(TICKET_STATUS) as TICKET_STATUS,
            MAX(PRIORITY) as PRIORITY,
            MAX(AGENT_EMAIL) as AGENT_EMAIL,
            MAX(RESOLVED_BY) as RESOLVED_BY,
            MAX(FIRST_RESPONSE_DURATION_SECONDS) as FIRST_RESPONSE_DURATION_SECONDS,
            MAX(TICKET_CSAT) as TICKET_CSAT,
            MAX(AGENT_RATING) as AGENT_RATING,
            MAX(MESSAGES_JSON) as MESSAGES_JSON,
            MAX(MESSAGE_COUNT) as MESSAGE_COUNT,
            MAX(DAY) as DAY,
            MAX(GROUP_NAME) as GROUP_NAME,
            MAX(INITIALIZED_TIME) as INITIALIZED_TIME,
            MAX(RESOLVED_TIME) as RESOLVED_TIME
          FROM raw_tickets
          WHERE VISITOR_EMAIL = ?
          GROUP BY TICKET_ID
          ORDER BY MAX(INITIALIZED_TIME) DESC
          LIMIT ?`,
    args: [email, limit],
  });
  return (result.rows as unknown as any[]).map(normalizeTicketRow);
}

// Get agents with frequent low CSAT (defaulters)
export async function getDefaulters(minIssues = 5, days = 30) {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) as lowCsatCount,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            ROUND(100.0 * COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) /
                  NULLIF(COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN TICKET_ID END), 0), 1) as lowCsatPercent
          FROM raw_tickets
          WHERE AGENT_EMAIL IS NOT NULL
            AND AGENT_EMAIL != ''
            AND DAY >= date('now', '-' || ? || ' days')
          GROUP BY AGENT_EMAIL
          HAVING lowCsatCount >= ?
          ORDER BY lowCsatCount DESC`,
    args: [days, minIssues],
  });
  return result.rows;
}

// Get flagged tickets (low CSAT or slow response) - deduplicated
export async function getFlaggedTickets(date: string, limit = 50) {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT
            TICKET_ID,
            MAX(VISITOR_NAME) as VISITOR_NAME,
            MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
            MAX(SUBJECT) as SUBJECT,
            MAX(TAGS) as TAGS,
            MAX(TICKET_STATUS) as TICKET_STATUS,
            MAX(PRIORITY) as PRIORITY,
            MAX(AGENT_EMAIL) as AGENT_EMAIL,
            MAX(RESOLVED_BY) as RESOLVED_BY,
            MAX(FIRST_RESPONSE_DURATION_SECONDS) as FIRST_RESPONSE_DURATION_SECONDS,
            MAX(TICKET_CSAT) as TICKET_CSAT,
            MAX(AGENT_RATING) as AGENT_RATING,
            MAX(DAY) as DAY,
            MAX(GROUP_NAME) as GROUP_NAME,
            MAX(INITIALIZED_TIME) as INITIALIZED_TIME
          FROM raw_tickets
          WHERE DAY = ?
            AND (
              (CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3)
              OR CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) > 3600
            )
          GROUP BY TICKET_ID
          ORDER BY MAX(TICKET_CSAT) ASC, MAX(FIRST_RESPONSE_DURATION_SECONDS) DESC
          LIMIT ?`,
    args: [date, limit],
  });
  return result.rows;
}

// Get daily summary stats (using DISTINCT for accurate counts)
export async function getDailySummary(date: string) {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            COUNT(DISTINCT AGENT_EMAIL) as activeAgents,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) > 0 AND CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) < 86400
                           THEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE DAY = ?`,
    args: [date],
  });
  return result.rows[0];
}

// Get top issues by category/tag for a date
export async function getTopIssues(date: string, limit = 10, dateMode: DateMode = 'activity') {
  await initMainPromise;
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            COALESCE(GROUP_NAME, 'Uncategorized') as category,
            COUNT(DISTINCT TICKET_ID) as count
          FROM raw_tickets
          WHERE ${dateCondition}
          GROUP BY GROUP_NAME
          ORDER BY count DESC
          LIMIT ?`,
    args: [date, limit],
  });
  return result.rows;
}

// Get best performing agents by CSAT for a date
export async function getBestAgents(date: string, limit = 5, dateMode: DateMode = 'activity') {
  await initMainPromise;
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) >= 4 THEN TICKET_ID END) as highCsatCount,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE ${dateCondition}
            AND AGENT_EMAIL IS NOT NULL
            AND AGENT_EMAIL != ''
          GROUP BY AGENT_EMAIL
          HAVING COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN TICKET_ID END) >= 3
          ORDER BY avgCsat DESC, highCsatCount DESC
          LIMIT ?`,
    args: [date, limit],
  });
  return result.rows;
}

// Get most frustrated customers (low CSAT) for a date
export async function getFrustratedCustomers(date: string, limit = 5, dateMode: DateMode = 'activity') {
  await initMainPromise;
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            VISITOR_EMAIL as customerEmail,
            MAX(VISITOR_NAME) as customerName,
            COUNT(DISTINCT TICKET_ID) as ticketCount,
            MIN(CAST(TICKET_CSAT AS REAL)) as lowestCsat,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            GROUP_CONCAT(SUBJECT, ' | ') as subjects
          FROM raw_tickets
          WHERE ${dateCondition}
            AND VISITOR_EMAIL IS NOT NULL
            AND VISITOR_EMAIL != ''
            AND CAST(TICKET_CSAT AS REAL) > 0
            AND CAST(TICKET_CSAT AS REAL) < 3
          GROUP BY VISITOR_EMAIL
          ORDER BY lowestCsat ASC, ticketCount DESC
          LIMIT ?`,
    args: [date, limit],
  });
  return result.rows;
}

// Get comprehensive daily insights
export async function getDailyInsights(date: string, dateMode: DateMode = 'activity') {
  await initMainPromise;
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            COUNT(DISTINCT AGENT_EMAIL) as activeAgents,
            COUNT(DISTINCT VISITOR_EMAIL) as uniqueCustomers,
            ROUND(AVG(CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 THEN CAST(TICKET_CSAT AS REAL) ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) > 0 AND CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) < 86400
                           THEN CAST(FIRST_RESPONSE_DURATION_SECONDS AS REAL) ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) > 0 AND CAST(TICKET_CSAT AS REAL) < 3 THEN TICKET_ID END) as lowCsatCount,
            COUNT(DISTINCT CASE WHEN CAST(TICKET_CSAT AS REAL) >= 4 THEN TICKET_ID END) as highCsatCount
          FROM raw_tickets
          WHERE ${dateCondition}`,
    args: [date],
  });
  return result.rows[0];
}

// Fetch a specific set of tickets by ID in one query
export async function getTicketsByIds(ticketIds: string[]): Promise<TicketRow[]> {
  if (ticketIds.length === 0) return [];
  const placeholders = ticketIds.map(() => '?').join(',');
  const result = await mainDb.execute({
    sql: `SELECT
            TICKET_ID,
            MAX(VISITOR_NAME) as VISITOR_NAME,
            MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
            MAX(SUBJECT) as SUBJECT,
            MAX(TAGS) as TAGS,
            MAX(TICKET_STATUS) as TICKET_STATUS,
            MAX(PRIORITY) as PRIORITY,
            MAX(AGENT_EMAIL) as AGENT_EMAIL,
            MAX(RESOLVED_BY) as RESOLVED_BY,
            MAX(FIRST_RESPONSE_DURATION_SECONDS) as FIRST_RESPONSE_DURATION_SECONDS,
            MAX(AVG_RESPONSE_TIME_SECONDS) as AVG_RESPONSE_TIME_SECONDS,
            MAX(SPENT_TIME_SECONDS) as SPENT_TIME_SECONDS,
            MAX(TICKET_CSAT) as TICKET_CSAT,
            MAX(AGENT_RATING) as AGENT_RATING,
            MAX(MESSAGES_JSON) as MESSAGES_JSON,
            MAX(MESSAGE_COUNT) as MESSAGE_COUNT,
            MAX(USER_MESSAGE_COUNT) as USER_MESSAGE_COUNT,
            MAX(AGENT_MESSAGE_COUNT) as AGENT_MESSAGE_COUNT,
            MAX(DAY) as DAY,
            MAX(GROUP_NAME) as GROUP_NAME,
            MAX(INITIALIZED_TIME) as INITIALIZED_TIME,
            MAX(RESOLVED_TIME) as RESOLVED_TIME
          FROM raw_tickets
          WHERE TICKET_ID IN (${placeholders})
          GROUP BY TICKET_ID`,
    args: ticketIds,
  });
  return result.rows as unknown as TicketRow[];
}

export interface QADeduction {
  category: string;
  points: number;
  reason: string;
}

// Persist a QA score for a ticket (called whenever AI analysis runs)
export async function saveQAScore(
  ticketId: string,
  qaScore: number,
  summary?: string,
  deductions?: QADeduction[]
): Promise<void> {
  await initPromise;
  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO qa_scores (ticket_id, qa_score, summary, deductions_json, analyzed_at)
          VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [ticketId, qaScore, summary || null, deductions ? JSON.stringify(deductions) : null],
  });

  // Trigger aggregation for agent daily stats (fire and forget)
  getTicketMetadata(ticketId).then(meta => {
    if (meta?.agentEmail && meta?.date) {
      recalculateAgentDailyScore(meta.agentEmail, meta.date).catch(err => 
        console.error(`[DB] Failed to recalculate score for ${meta.agentEmail} on ${meta.date}:`, err)
      );
    }
  }).catch(err => console.error(`[DB] Failed to fetch metadata for ticket ${ticketId}:`, err));
}

export async function getTicketMetadata(ticketId: string): Promise<{ agentEmail: string; date: string } | null> {
  await initMainPromise;
  const result = await mainDb.execute({
    sql: `SELECT AGENT_EMAIL as agentEmail, DAY as date FROM raw_tickets WHERE TICKET_ID = ? LIMIT 1`,
    args: [ticketId],
  });
  const row = result.rows[0] as unknown as any;
  if (!row) return null;
  return {
    agentEmail: String(row.agentEmail),
    date: String(row.date)
  };
}

export async function recalculateAgentDailyScore(agentEmail: string, date: string): Promise<void> {
  await initPromise;
  await initMainPromise;

  const ticketIds = await getAgentTicketIds(agentEmail, date, 'activity');
  if (ticketIds.length === 0) return;

  const scores = await getQAScoresBulk(ticketIds);
  const scoreValues = Object.values(scores).map(s => s.qaScore);

  if (scoreValues.length === 0) {
    await reviewsDb.execute({
      sql: `DELETE FROM daily_agent_qa_scores WHERE agent_email = ? AND date = ?`,
      args: [agentEmail, date],
    });
    return;
  }

  const avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;

  await reviewsDb.execute({
    sql: `INSERT OR REPLACE INTO daily_agent_qa_scores (agent_email, date, avg_score, scored_count)
          VALUES (?, ?, ?, ?)`,
    args: [agentEmail, date, avgScore, scoreValues.length],
  });
}

export async function getAgentQATrend(agentEmail: string, limitDays = 14): Promise<Array<{ date: string; avgScore: number }>> {
  await initPromise;
  const result = await reviewsDb.execute({
    sql: `SELECT date, avg_score as avgScore 
          FROM daily_agent_qa_scores 
          WHERE agent_email = ? 
          ORDER BY date DESC 
          LIMIT ?`,
    args: [agentEmail, limitDays],
  });
  
  return (result.rows as unknown as any[])
    .map(r => ({
      date: String(r.date),
      avgScore: Number(r.avgScore)
    }))
    .reverse(); // Chronological order
}

export async function getAgentsQATrends(
  agentEmails: string[],
  limitDays = 14
): Promise<Record<string, Array<{ date: string; avgScore: number }>>> {
  await initPromise;
  if (agentEmails.length === 0) return {};

  const uniqueEmails = [...new Set(agentEmails.filter(Boolean))];
  if (uniqueEmails.length === 0) return {};

  const placeholders = uniqueEmails.map(() => '?').join(',');
  const result = await reviewsDb.execute({
    sql: `SELECT agent_email as agentEmail, date, avg_score as avgScore
          FROM daily_agent_qa_scores
          WHERE agent_email IN (${placeholders})
          ORDER BY agent_email ASC, date DESC`,
    args: uniqueEmails,
  });

  const trends: Record<string, Array<{ date: string; avgScore: number }>> = {};
  uniqueEmails.forEach((email) => {
    trends[email] = [];
  });

  (result.rows as unknown as Array<{ agentEmail: string; date: string; avgScore: number }>).forEach((row) => {
    const email = String(row.agentEmail);
    if (!trends[email]) {
      trends[email] = [];
    }
    if (trends[email].length < limitDays) {
      trends[email].push({
        date: String(row.date),
        avgScore: Number(row.avgScore),
      });
    }
  });

  Object.keys(trends).forEach((email) => {
    trends[email] = trends[email].slice().reverse();
  });

  return trends;
}

// Bulk-fetch persisted QA scores for a list of ticket IDs
export async function getQAScoresBulk(
  ticketIds: string[]
): Promise<Record<string, { qaScore: number; originalScore: number; hasOverride: boolean; summary: string | null; deductions: QADeduction[] }>> {
  if (ticketIds.length === 0) return {};
  await initPromise;
  const placeholders = ticketIds.map(() => '?').join(',');
  // score_override lives on qa_scores itself — no join needed
  const result = await reviewsDb.execute({
    sql: `SELECT ticket_id,
                 qa_score as originalScore,
                 COALESCE(score_override, qa_score) as qaScore,
                 CASE WHEN score_override IS NOT NULL THEN 1 ELSE 0 END as hasOverride,
                 summary,
                 deductions_json
          FROM qa_scores
          WHERE ticket_id IN (${placeholders})`,
    args: ticketIds,
  });
  const rows = result.rows as unknown as Array<{
    ticket_id: string;
    originalScore: number;
    qaScore: number;
    hasOverride: number;
    summary: string | null;
    deductions_json: string | null;
  }>;
  const out: Record<string, { qaScore: number; originalScore: number; hasOverride: boolean; summary: string | null; deductions: QADeduction[] }> = {};
  rows.forEach(row => {
    out[row.ticket_id] = {
      qaScore: Number(row.qaScore),
      originalScore: Number(row.originalScore),
      hasOverride: Boolean(row.hasOverride),
      summary: row.summary,
      deductions: row.deductions_json ? JSON.parse(row.deductions_json) : [],
    };
  });
  return out;
}

export interface TicketQuickScore {
  ticketId: string;
  sentiment: string;
  priority: string;
  hasError: boolean;
  issueCategory: string;
  riskScore: number;
}

export async function getQuickScoresBulk(ticketIds: string[]): Promise<Record<string, TicketQuickScore>> {
  if (ticketIds.length === 0) return {};
  await initPromise;
  const placeholders = ticketIds.map(() => '?').join(',');
  const result = await reviewsDb.execute({
    sql: `SELECT ticket_id as ticketId, sentiment, priority, has_error as hasError, issue_category as issueCategory, risk_score as riskScore
          FROM ticket_quick_scores
          WHERE ticket_id IN (${placeholders})`,
    args: ticketIds,
  });
  const rows = result.rows as unknown as any[];
  const out: Record<string, TicketQuickScore> = {};
  rows.forEach((row) => {
    out[row.ticketId] = {
      ...row,
      hasError: Boolean(row.hasError),
    };
  });
  return out;
}

export async function saveQuickScoresBulk(scores: TicketQuickScore[]): Promise<void> {
  if (scores.length === 0) return;
  await initPromise;
  const now = new Date().toISOString();
  const statements = scores.map((s) => ({
    sql: `INSERT OR REPLACE INTO ticket_quick_scores (ticket_id, sentiment, priority, has_error, issue_category, risk_score, analyzed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [s.ticketId, s.sentiment, s.priority, s.hasError ? 1 : 0, s.issueCategory, s.riskScore, now],
  }));
  await reviewsDb.batch(statements, 'write');
}

export async function getTicketMessagesBulk(ticketIds: string[]): Promise<Record<string, string>> {
  if (ticketIds.length === 0) return {};
  await initMainPromise;
  const placeholders = ticketIds.map(() => '?').join(',');
  const result = await mainDb.execute({
    sql: `SELECT TICKET_ID, MAX(MESSAGES_JSON) as messages FROM raw_tickets WHERE TICKET_ID IN (${placeholders}) GROUP BY TICKET_ID`,
    args: ticketIds,
  });
  const out: Record<string, string> = {};
  result.rows.forEach((row) => {
    out[String(row.TICKET_ID)] = String(row.messages || '[]');
  });
  return out;
}

// ── Metabase sync ────────────────────────────────────────────────────────────

export async function isDateSynced(date: string): Promise<boolean> {
  if (!isMetabaseEnabled) return true;
  await initPromise;
  const result = await reviewsDb.execute({
    sql: 'SELECT date FROM metabase_sync_log WHERE date = ?',
    args: [date],
  });
  return result.rows.length > 0;
}

export async function syncDateFromMetabase(date: string): Promise<number> {
  const tickets = await fetchTicketsFromMetabase(date, date);
  if (tickets.length === 0) {
    await reviewsDb.execute({
      sql: 'INSERT OR REPLACE INTO metabase_sync_log (date, synced_at, row_count) VALUES (?, ?, ?)',
      args: [date, new Date().toISOString(), 0],
    });
    return 0;
  }

  await initMainPromise;

  // Clear stale data for this date then insert fresh rows in chunks
  await mainDb.execute({ sql: 'DELETE FROM raw_tickets WHERE DAY = ?', args: [date] });

  const chunkSize = 100;
  for (let i = 0; i < tickets.length; i += chunkSize) {
    const chunk = tickets.slice(i, i + chunkSize);
    await mainDb.batch(
      chunk.map(t => ({
        sql: `INSERT INTO raw_tickets
              (TICKET_ID, VISITOR_NAME, VISITOR_EMAIL, SUBJECT, TAGS, TICKET_STATUS,
               PRIORITY, AGENT_EMAIL, RESOLVED_BY, FIRST_RESPONSE_DURATION_SECONDS,
               AVG_RESPONSE_TIME_SECONDS, SPENT_TIME_SECONDS, TICKET_CSAT, AGENT_RATING,
               MESSAGES_JSON, MESSAGE_COUNT, USER_MESSAGE_COUNT, AGENT_MESSAGE_COUNT,
               DAY, GROUP_NAME, INITIALIZED_TIME, RESOLVED_TIME)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          t.TICKET_ID, t.VISITOR_NAME || null, t.VISITOR_EMAIL || null, t.SUBJECT || null,
          t.TAGS || null, t.TICKET_STATUS || null, t.PRIORITY || null, t.AGENT_EMAIL || null,
          t.RESOLVED_BY || null, t.FIRST_RESPONSE_DURATION_SECONDS || null,
          t.AVG_RESPONSE_TIME_SECONDS || null, t.SPENT_TIME_SECONDS || null,
          t.TICKET_CSAT || null, t.AGENT_RATING || null, t.MESSAGES_JSON || null,
          t.MESSAGE_COUNT || null, t.USER_MESSAGE_COUNT || null, t.AGENT_MESSAGE_COUNT || null,
          t.DAY || null, t.GROUP_NAME || null, t.INITIALIZED_TIME || null, t.RESOLVED_TIME || null,
        ],
      })),
      'write',
    );
  }

  await reviewsDb.execute({
    sql: 'INSERT OR REPLACE INTO metabase_sync_log (date, synced_at, row_count) VALUES (?, ?, ?)',
    args: [date, new Date().toISOString(), tickets.length],
  });

  console.log(`[Metabase] Synced ${tickets.length} tickets for ${date}`);
  return tickets.length;
}

export async function ensureDateSynced(date: string): Promise<void> {
  if (!isMetabaseEnabled) return;
  const synced = await isDateSynced(date);
  if (!synced) await syncDateFromMetabase(date);
}

export async function getSyncLog(): Promise<Array<{ date: string; syncedAt: string; rowCount: number }>> {
  await initPromise;
  const result = await reviewsDb.execute(
    'SELECT date, synced_at as syncedAt, row_count as rowCount FROM metabase_sync_log ORDER BY date DESC'
  );
  return result.rows as unknown as Array<{ date: string; syncedAt: string; rowCount: number }>;
}

export { mainDb as db };
