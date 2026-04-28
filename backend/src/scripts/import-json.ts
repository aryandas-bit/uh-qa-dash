/**
 * Imports ticket data from a Yellow.ai JSON export into raw_tickets (Turso).
 *
 * Usage:
 *   npm run import-json -- /path/to/tickets.json
 *   npm run import-json -- /path/to/tickets.json --clear
 *   npm run import-json -- /path/to/tickets.json --clear --date 2026-04-15
 *
 * --clear              deletes existing raw_tickets rows for every date found before inserting
 * --date <YYYY-MM-DD>  only import tickets for this specific date
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { createClient } from '@libsql/client';
import { createRequire } from 'module';

// stream-json is CJS; use createRequire so this ESM file can load it
const require = createRequire(import.meta.url);
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/stream-array.js');

const mainDb = createClient({
  url: process.env.TURSO_DB_URL || 'file:./dev.db',
  authToken: process.env.TURSO_DB_TOKEN,
});

// ── helpers ────────────────────────────────────────────────────────────────

function nullify(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '' || s === 'NA' || s === 'null' || s === '-' || s === 'N/A') return null;
  return s;
}

function toIntOrNull(val: any): number | null {
  const s = nullify(val);
  if (s === null) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// "2026-4-1, 13:23" → "2026-04-01T13:23:00"
function normalizeDateTime(val: any): string | null {
  const s = nullify(val);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, min, sec = '00'] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${sec}`;
  }
  return s;
}

function countMessages(messagesJson: any): { total: number; user: number; agent: number } {
  if (!messagesJson) return { total: 0, user: 0, agent: 0 };
  try {
    const msgs: Array<{ s?: string }> = typeof messagesJson === 'string'
      ? JSON.parse(messagesJson)
      : messagesJson;
    if (!Array.isArray(msgs)) return { total: 0, user: 0, agent: 0 };
    let user = 0, agent = 0;
    for (const m of msgs) {
      if (m.s === 'U') user++;
      else if (m.s === 'A') agent++;
    }
    return { total: msgs.length, user, agent };
  } catch {
    return { total: 0, user: 0, agent: 0 };
  }
}

// ── arg parsing ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonPathRaw = args.find(a => !a.startsWith('--'));
const shouldClear = args.includes('--clear');
const filterDateIdx = args.indexOf('--date');
const filterDate: string | null = filterDateIdx !== -1 ? args[filterDateIdx + 1] : null;

if (!jsonPathRaw) {
  console.error('Usage: import-json.ts <path-to-json> [--clear] [--date YYYY-MM-DD]');
  process.exit(1);
}

const jsonPath: string = jsonPathRaw;

if (!fs.existsSync(jsonPath)) {
  console.error(`File not found: ${jsonPath}`);
  process.exit(1);
}

// ── main ───────────────────────────────────────────────────────────────────

async function run() {
  await mainDb.execute(`
    CREATE TABLE IF NOT EXISTS raw_tickets (
      TICKET_ID TEXT, VISITOR_NAME TEXT, VISITOR_EMAIL TEXT, SUBJECT TEXT, TAGS TEXT,
      TICKET_STATUS TEXT, PRIORITY TEXT, AGENT_EMAIL TEXT, RESOLVED_BY TEXT,
      FIRST_RESPONSE_DURATION_SECONDS INTEGER, AVG_RESPONSE_TIME_SECONDS INTEGER,
      SPENT_TIME_SECONDS INTEGER, TICKET_CSAT INTEGER, AGENT_RATING INTEGER,
      MESSAGES_JSON TEXT, MESSAGE_COUNT INTEGER, USER_MESSAGE_COUNT INTEGER,
      AGENT_MESSAGE_COUNT INTEGER, DAY TEXT, GROUP_NAME TEXT,
      INITIALIZED_TIME TEXT, RESOLVED_TIME TEXT
    )
  `);
  await mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_day ON raw_tickets(DAY)`).catch(() => {});
  await mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_agent ON raw_tickets(AGENT_EMAIL)`).catch(() => {});
  await mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_init ON raw_tickets(INITIALIZED_TIME)`).catch(() => {});
  await mainDb.execute(`CREATE INDEX IF NOT EXISTS idx_raw_tickets_agent_day ON raw_tickets(AGENT_EMAIL, DAY)`).catch(() => {});

  console.log(`Streaming ${jsonPath}...`);
  if (filterDate) console.log(`Filtering to date: ${filterDate}`);

  const BATCH = 100;
  let batch: any[] = [];
  let totalInserted = 0;
  let skipped = 0;
  const datesCleared = new Set<string>();

  async function flushBatch(rows: any[]) {
    if (rows.length === 0) return;
    await mainDb.batch(rows, 'write');
    totalInserted += rows.length;
    process.stdout.write(`\r  Inserted ${totalInserted} rows...`);
  }

  const pipeline = chain([
    fs.createReadStream(jsonPath),
    parser(),
    streamArray(),
  ]);

  for await (const { value: r } of pipeline) {
    const day = nullify(r.DAY);
    if (filterDate && day !== filterDate) continue;

    const ticketId = nullify(r.TICKET_ID);
    if (!ticketId || !day) { skipped++; continue; }

    const initTime = normalizeDateTime(r.INITIALIZED_TIME);
    if (!initTime) { skipped++; continue; }

    if (shouldClear && !datesCleared.has(day)) {
      await mainDb.execute({ sql: 'DELETE FROM raw_tickets WHERE DAY = ?', args: [day] });
      datesCleared.add(day);
      console.log(`\n  Cleared existing rows for ${day}`);
    }

    const msgsRaw = r.MESSAGES_JSON;
    const msgsStr = msgsRaw && msgsRaw !== 'null'
      ? (typeof msgsRaw === 'string' ? msgsRaw : JSON.stringify(msgsRaw))
      : null;
    const { total, user, agent } = msgsStr ? countMessages(msgsStr) : { total: 0, user: 0, agent: 0 };

    batch.push({
      sql: `INSERT INTO raw_tickets (
              TICKET_ID, VISITOR_NAME, VISITOR_EMAIL, SUBJECT, TAGS,
              TICKET_STATUS, PRIORITY, AGENT_EMAIL, RESOLVED_BY,
              FIRST_RESPONSE_DURATION_SECONDS, AVG_RESPONSE_TIME_SECONDS, SPENT_TIME_SECONDS,
              TICKET_CSAT, AGENT_RATING, MESSAGES_JSON,
              MESSAGE_COUNT, USER_MESSAGE_COUNT, AGENT_MESSAGE_COUNT,
              DAY, GROUP_NAME, INITIALIZED_TIME, RESOLVED_TIME
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        ticketId,
        nullify(r.VISITOR_NAME),
        nullify(r.VISITOR_EMAIL),
        nullify(r.SUBJECT),
        nullify(r.TAGS),
        nullify(r.TICKET_STATUS),
        nullify(r.PRIORITY),
        nullify(r.AGENT_EMAIL),
        nullify(r.RESOLVED_BY),
        toIntOrNull(r.FIRST_RESPONSE_DURATION_SECONDS),
        toIntOrNull(r.AVG_RESPONSE_TIME_SECONDS),
        toIntOrNull(r.SPENT_TIME_SECONDS),
        toIntOrNull(r.TICKET_CSAT),
        toIntOrNull(r.AGENT_RATING),
        msgsStr,
        total || null,
        user || null,
        agent || null,
        day,
        nullify(r.GROUP_NAME),
        initTime,
        normalizeDateTime(r.RESOLVED_TIME),
      ],
    });

    if (batch.length >= BATCH) {
      await flushBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) await flushBatch(batch);

  console.log(`\n\nDone.`);
  if (filterDate) {
    console.log(`  Date imported : ${filterDate}`);
  } else if (datesCleared.size > 0) {
    console.log(`  Dates cleared : ${[...datesCleared].sort().join(', ')}`);
  }
  console.log(`  Total inserted: ${totalInserted}`);
  console.log(`  Skipped rows  : ${skipped}`);
}

run().catch((err) => {
  console.error('\nImport failed:', err.message);
  process.exit(1);
});
