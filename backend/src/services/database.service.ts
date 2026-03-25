import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';

// Use absolute path from environment, or default relative to cwd
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), '../../yellow_bot_analysis.db');

// Initialize database connection (readonly for safety)
console.log('Connecting to database:', dbPath);
const db: DatabaseType = new Database(dbPath, { readonly: true });

// Separate writable database for QA reviews (project root = one level up from backend/)
const reviewsDbPath = process.env.REVIEWS_DB_PATH || path.join(process.cwd(), '../qa_reviews.db');
const reviewsDb: DatabaseType = new Database(reviewsDbPath);
reviewsDb.exec(`
  CREATE TABLE IF NOT EXISTS qa_reviews (
    ticket_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('approved', 'flagged')),
    note TEXT,
    reviewer_name TEXT,
    reviewed_at TEXT NOT NULL
  )
`);
// Migrate existing tables that don't have reviewer_name yet
try {
  reviewsDb.exec(`ALTER TABLE qa_reviews ADD COLUMN reviewer_name TEXT`);
} catch (_) { /* column already exists */ }

export interface QAReview {
  status: 'approved' | 'flagged';
  note: string | null;
  reviewerName: string | null;
  reviewedAt: string;
}

export function saveQAReview(ticketId: string, status: 'approved' | 'flagged', note?: string, reviewerName?: string): void {
  const stmt = reviewsDb.prepare(`
    INSERT OR REPLACE INTO qa_reviews (ticket_id, status, note, reviewer_name, reviewed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(ticketId, status, note || null, reviewerName || null);
}

export function getQAReview(ticketId: string): QAReview | undefined {
  const stmt = reviewsDb.prepare(`
    SELECT status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt
    FROM qa_reviews WHERE ticket_id = ?
  `);
  return stmt.get(ticketId) as QAReview | undefined;
}

export function deleteQAReview(ticketId: string): void {
  const stmt = reviewsDb.prepare(`DELETE FROM qa_reviews WHERE ticket_id = ?`);
  stmt.run(ticketId);
}

export function getQAReviewsBulk(ticketIds: string[]): Record<string, QAReview> {
  if (ticketIds.length === 0) return {};
  const placeholders = ticketIds.map(() => '?').join(',');
  const stmt = reviewsDb.prepare(`
    SELECT ticket_id, status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt
    FROM qa_reviews
    WHERE ticket_id IN (${placeholders})
  `);
  const rows = stmt.all(...ticketIds) as Array<QAReview & { ticket_id: string }>;
  const result: Record<string, QAReview> = {};
  rows.forEach(row => {
    result[row.ticket_id] = { status: row.status, note: row.note, reviewerName: row.reviewerName, reviewedAt: row.reviewedAt };
  });
  return result;
}

export function getAllQAReviews(): Array<QAReview & { ticketId: string }> {
  const stmt = reviewsDb.prepare(`
    SELECT ticket_id as ticketId, status, note, reviewer_name as reviewerName, reviewed_at as reviewedAt
    FROM qa_reviews
    ORDER BY reviewed_at DESC
  `);
  return stmt.all() as Array<QAReview & { ticketId: string }>;
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

export function getAllQAReviewsWithTickets(): ReviewWithTicket[] {
  // Get all reviews first
  const reviews = getAllQAReviews();
  if (reviews.length === 0) return [];

  // Fetch ticket details for each review from main DB
  const placeholders = reviews.map(() => '?').join(',');
  const ticketIds = reviews.map(r => r.ticketId);
  const stmt = db.prepare(`
    SELECT
      TICKET_ID,
      MAX(SUBJECT) as SUBJECT,
      MAX(AGENT_EMAIL) as AGENT_EMAIL,
      MAX(VISITOR_EMAIL) as VISITOR_EMAIL,
      MAX(TICKET_CSAT) as TICKET_CSAT,
      MAX(DAY) as DAY,
      MAX(TICKET_STATUS) as TICKET_STATUS
    FROM raw_tickets
    WHERE TICKET_ID IN (${placeholders})
    GROUP BY TICKET_ID
  `);
  const ticketRows = stmt.all(...ticketIds) as any[];
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

// Get unique dates available in database
export function getAvailableDates(): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT DAY
    FROM raw_tickets
    WHERE DAY IS NOT NULL
    ORDER BY DAY DESC
    LIMIT 90
  `);
  return stmt.all().map((row: any) => row.DAY);
}

// Get agent summary for a specific date (using DISTINCT to avoid duplicates)
// dateMode: 'activity' = filter by DAY field, 'initialized' = filter by INITIALIZED_TIME date
export function getAgentsDailySummary(date: string, dateMode: DateMode = 'activity'): AgentSummary[] {
  const dateCondition = dateMode === 'initialized'
    ? "DATE(INITIALIZED_TIME) = ?"
    : "DAY = ?";

  const stmt = db.prepare(`
    SELECT
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
    ORDER BY totalTickets DESC
  `);
  return stmt.all(date) as AgentSummary[];
}

// Date mode type for filtering
export type DateMode = 'activity' | 'initialized';

// Get tickets for a specific agent on a specific date (deduplicated by TICKET_ID)
// dateMode: 'activity' = filter by DAY field (when ticket had activity/resolved)
// dateMode: 'initialized' = filter by INITIALIZED_TIME date (when ticket was created)
export function getAgentTickets(agentEmail: string, date: string, limit = 100, offset = 0, dateMode: DateMode = 'activity'): TicketRow[] {
  const dateCondition = dateMode === 'initialized'
    ? "DATE(INITIALIZED_TIME) = ?"
    : "DAY = ?";

  const stmt = db.prepare(`
    SELECT
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
    LIMIT ? OFFSET ?
  `);
  return stmt.all(agentEmail, date, limit, offset) as TicketRow[];
}

// Get agent performance over a date range
export function getAgentPerformance(agentEmail: string, startDate: string, endDate: string) {
  const stmt = db.prepare(`
    SELECT
      DAY as date,
      COUNT(DISTINCT TICKET_ID) as totalTickets,
      ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
      ROUND(AVG(CASE WHEN FIRST_RESPONSE_DURATION_SECONDS > 0 AND FIRST_RESPONSE_DURATION_SECONDS < 86400
                     THEN FIRST_RESPONSE_DURATION_SECONDS ELSE NULL END), 0) as avgResponseTime,
      COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount
    FROM raw_tickets
    WHERE AGENT_EMAIL = ? AND DAY BETWEEN ? AND ?
    GROUP BY DAY
    ORDER BY DAY ASC
  `);
  return stmt.all(agentEmail, startDate, endDate);
}

// Get single ticket by ID (returns first match if duplicates exist)
export function getTicketById(ticketId: string): TicketRow | undefined {
  const stmt = db.prepare(`
    SELECT
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
    GROUP BY TICKET_ID
  `);
  return stmt.get(ticketId) as TicketRow | undefined;
}

// Get customer ticket history (deduplicated)
export function getCustomerHistory(email: string, limit = 50): TicketRow[] {
  const stmt = db.prepare(`
    SELECT
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
    LIMIT ?
  `);
  return stmt.all(email, limit) as TicketRow[];
}

// Get agents with frequent low CSAT (defaulters)
export function getDefaulters(minIssues = 5, days = 30) {
  const stmt = db.prepare(`
    SELECT
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
    ORDER BY lowCsatCount DESC
  `);
  return stmt.all(days, minIssues);
}

// Get flagged tickets (low CSAT or slow response) - deduplicated
export function getFlaggedTickets(date: string, limit = 50) {
  const stmt = db.prepare(`
    SELECT
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
    LIMIT ?
  `);
  return stmt.all(date, limit);
}

// Get daily summary stats (using DISTINCT for accurate counts)
export function getDailySummary(date: string) {
  const stmt = db.prepare(`
    SELECT
      COUNT(DISTINCT TICKET_ID) as totalTickets,
      COUNT(DISTINCT AGENT_EMAIL) as activeAgents,
      ROUND(AVG(CASE WHEN TICKET_CSAT > 0 THEN TICKET_CSAT ELSE NULL END), 2) as avgCsat,
      ROUND(AVG(CASE WHEN FIRST_RESPONSE_DURATION_SECONDS > 0 AND FIRST_RESPONSE_DURATION_SECONDS < 86400
                     THEN FIRST_RESPONSE_DURATION_SECONDS ELSE NULL END), 0) as avgResponseTime,
      COUNT(DISTINCT CASE WHEN TICKET_STATUS = 'Resolved' THEN TICKET_ID END) as resolvedCount,
      COUNT(DISTINCT CASE WHEN TICKET_CSAT > 0 AND TICKET_CSAT < 3 THEN TICKET_ID END) as lowCsatCount
    FROM raw_tickets
    WHERE DAY = ?
  `);
  return stmt.get(date);
}

// Get top issues by category/tag for a date
export function getTopIssues(date: string, limit = 10, dateMode: DateMode = 'activity') {
  const dateCondition = dateMode === 'initialized'
    ? "DATE(INITIALIZED_TIME) = ?"
    : "DAY = ?";

  const stmt = db.prepare(`
    SELECT
      COALESCE(GROUP_NAME, 'Uncategorized') as category,
      COUNT(DISTINCT TICKET_ID) as count
    FROM raw_tickets
    WHERE ${dateCondition}
    GROUP BY GROUP_NAME
    ORDER BY count DESC
    LIMIT ?
  `);
  return stmt.all(date, limit);
}

// Get best performing agents by CSAT for a date
export function getBestAgents(date: string, limit = 5, dateMode: DateMode = 'activity') {
  const dateCondition = dateMode === 'initialized'
    ? "DATE(INITIALIZED_TIME) = ?"
    : "DAY = ?";

  const stmt = db.prepare(`
    SELECT
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
    LIMIT ?
  `);
  return stmt.all(date, limit);
}

// Get most frustrated customers (low CSAT) for a date
export function getFrustratedCustomers(date: string, limit = 5, dateMode: DateMode = 'activity') {
  const dateCondition = dateMode === 'initialized'
    ? "DATE(INITIALIZED_TIME) = ?"
    : "DAY = ?";

  const stmt = db.prepare(`
    SELECT
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
    LIMIT ?
  `);
  return stmt.all(date, limit);
}

// Get comprehensive daily insights
export function getDailyInsights(date: string, dateMode: DateMode = 'activity') {
  const dateCondition = dateMode === 'initialized'
    ? "DATE(INITIALIZED_TIME) = ?"
    : "DAY = ?";

  const summaryStmt = db.prepare(`
    SELECT
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
    WHERE ${dateCondition}
  `);

  return summaryStmt.get(date);
}

export { db };
