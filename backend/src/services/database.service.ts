import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@libsql/client';

// Main read-only database (yellow_bot_analysis)
const mainDb = createClient({
  url: process.env.TURSO_DB_URL!,
  authToken: process.env.TURSO_DB_TOKEN,
});

// Reviews database (writable)
const reviewsDb = createClient({
  url: process.env.TURSO_REVIEWS_URL || process.env.TURSO_DB_URL!,
  authToken: process.env.TURSO_REVIEWS_TOKEN || process.env.TURSO_DB_TOKEN,
});

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
  reviewsDb.execute(`ALTER TABLE qa_reviews ADD COLUMN reviewer_name TEXT`).catch(() => {
    /* column already exists */
  })
);

export interface QAReview {
  status: 'approved' | 'flagged';
  note: string | null;
  reviewerName: string | null;
  reviewedAt: string;
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
    sql: `SELECT status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt
          FROM qa_reviews WHERE ticket_id = ?`,
    args: [ticketId],
  });
  return result.rows[0] as unknown as QAReview | undefined;
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
    sql: `SELECT ticket_id, status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt
          FROM qa_reviews
          WHERE ticket_id IN (${placeholders})`,
    args: ticketIds,
  });
  const rows = result.rows as unknown as Array<QAReview & { ticket_id: string }>;
  const out: Record<string, QAReview> = {};
  rows.forEach(row => {
    out[row.ticket_id] = { status: row.status, note: row.note, reviewerName: row.reviewerName, reviewedAt: row.reviewedAt };
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
  const result = await mainDb.execute(`
    SELECT DISTINCT DAY
    FROM raw_tickets
    WHERE DAY IS NOT NULL
    ORDER BY DAY DESC
    LIMIT 90
  `);
  return (result.rows as unknown as Array<{ DAY: string }>).map(row => row.DAY);
}

// Get agent summary for a specific date (using DISTINCT to avoid duplicates)
// dateMode: 'activity' = filter by DAY field, 'initialized' = filter by INITIALIZED_TIME date
export async function getAgentsDailySummary(date: string, dateMode: DateMode = 'activity'): Promise<AgentSummary[]> {
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN FIRST_RESPONSE_DURATION_SECONDS > 0 AND FIRST_RESPONSE_DURATION_SECONDS < 86400
                           THEN FIRST_RESPONSE_DURATION_SECONDS ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE ${dateCondition} AND AGENT_EMAIL IS NOT NULL AND AGENT_EMAIL != ''
          GROUP BY AGENT_EMAIL
          ORDER BY totalTickets DESC`,
    args: [date],
  });
  return result.rows as unknown as AgentSummary[];
}

// Get tickets for a specific agent on a specific date (deduplicated by TICKET_ID)
// dateMode: 'activity' = filter by DAY field (when ticket had activity/resolved)
// dateMode: 'initialized' = filter by INITIALIZED_TIME date (when ticket was created)
export async function getAgentTickets(agentEmail: string, date: string, limit = 100, offset = 0, dateMode: DateMode = 'activity'): Promise<TicketRow[]> {
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
  return result.rows as unknown as TicketRow[];
}

// Get agent performance over a date range
export async function getAgentPerformance(agentEmail: string, startDate: string, endDate: string) {
  const result = await mainDb.execute({
    sql: `SELECT
            DAY as date,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN FIRST_RESPONSE_DURATION_SECONDS > 0 AND FIRST_RESPONSE_DURATION_SECONDS < 86400
                           THEN FIRST_RESPONSE_DURATION_SECONDS ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount
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
  return result.rows[0] as unknown as TicketRow | undefined;
}

// Get customer ticket history (deduplicated)
export async function getCustomerHistory(email: string, limit = 50): Promise<TicketRow[]> {
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
  return result.rows as unknown as TicketRow[];
}

// Get agents with frequent low CSAT (defaulters)
export async function getDefaulters(minIssues = 5, days = 30) {
  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            ROUND(100.0 * COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) /
                  NULLIF(COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 THEN TICKET_ID END), 0), 1) as lowCsatPercent
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
              (TICKET_CSAT > 0 AND TICKET_CSAT < 3)
              OR FIRST_RESPONSE_DURATION_SECONDS > 3600
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
  const result = await mainDb.execute({
    sql: `SELECT
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            COUNT(DISTINCT AGENT_EMAIL) as activeAgents,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN FIRST_RESPONSE_DURATION_SECONDS > 0 AND FIRST_RESPONSE_DURATION_SECONDS < 86400
                           THEN FIRST_RESPONSE_DURATION_SECONDS ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE DAY = ?`,
    args: [date],
  });
  return result.rows[0];
}

// Get top issues by category/tag for a date
export async function getTopIssues(date: string, limit = 10, dateMode: DateMode = 'activity') {
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
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            AGENT_EMAIL as agentEmail,
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT >= 4 THEN TICKET_ID END) as highCsatCount,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount
          FROM raw_tickets
          WHERE ${dateCondition}
            AND AGENT_EMAIL IS NOT NULL
            AND AGENT_EMAIL != ''
          GROUP BY AGENT_EMAIL
          HAVING COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 THEN TICKET_ID END) >= 3
          ORDER BY avgCsat DESC, highCsatCount DESC
          LIMIT ?`,
    args: [date, limit],
  });
  return result.rows;
}

// Get most frustrated customers (low CSAT) for a date
export async function getFrustratedCustomers(date: string, limit = 5, dateMode: DateMode = 'activity') {
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            VISITOR_EMAIL as customerEmail,
            MAX(VISITOR_NAME) as customerName,
            COUNT(DISTINCT TICKET_ID) as ticketCount,
            MIN(TICKET_CSAT) as lowestCsat,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            GROUP_CONCAT(SUBJECT, ' | ') as subjects
          FROM raw_tickets
          WHERE ${dateCondition}
            AND VISITOR_EMAIL IS NOT NULL
            AND VISITOR_EMAIL != ''
            AND TICKET_CSAT > 0
            AND TICKET_CSAT < 3
          GROUP BY VISITOR_EMAIL
          ORDER BY lowestCsat ASC, ticketCount DESC
          LIMIT ?`,
    args: [date, limit],
  });
  return result.rows;
}

// Get comprehensive daily insights
export async function getDailyInsights(date: string, dateMode: DateMode = 'activity') {
  const dateCondition = dateMode === 'initialized'
    ? 'DATE(INITIALIZED_TIME) = ?'
    : 'DAY = ?';

  const result = await mainDb.execute({
    sql: `SELECT
            COUNT(DISTINCT TICKET_ID) as totalTickets,
            COUNT(DISTINCT AGENT_EMAIL) as activeAgents,
            COUNT(DISTINCT VISITOR_EMAIL) as uniqueCustomers,
            ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
            ROUND(AVG(CASE WHEN FIRST_RESPONSE_DURATION_SECONDS > 0 AND FIRST_RESPONSE_DURATION_SECONDS < 86400
                           THEN FIRST_RESPONSE_DURATION_SECONDS ELSE NULL END), 0) as avgResponseTime,
            COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount,
            COUNT(DISTINCT CASE WHEN TICKET_CSAT >= 4 THEN TICKET_ID END) as highCsatCount
          FROM raw_tickets
          WHERE ${dateCondition}`,
    args: [date],
  });
  return result.rows[0];
}

export { mainDb as db };
