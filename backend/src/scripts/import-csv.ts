/**
 * Imports ticket data from a Yellow.ai CSV export into raw_tickets (Turso).
 *
 * Usage:
 *   node --import tsx/esm src/scripts/import-csv.ts /path/to/tickets.csv
 *   node --import tsx/esm src/scripts/import-csv.ts /path/to/tickets.csv --clear
 *
 * --clear  deletes existing raw_tickets rows for every date found in the CSV before inserting.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { parse } from 'csv-parse';
import { createClient } from '@libsql/client';

const mainDb = createClient({
  url: process.env.TURSO_DB_URL || 'file:./dev.db',
  authToken: process.env.TURSO_DB_TOKEN,
});

// ── helpers ────────────────────────────────────────────────────────────────

function parseTimeToSeconds(val: string | null | undefined): number | null {
  if (!val || val === 'N/A' || val === 'NOT_RESPONDED' || val === 'null') return null;
  const m = val.trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

// "04/01/2026 12:00:38 AM" → { day: "2026-04-01", iso: "2026-04-01T00:00:38" }
function parseDateTime(val: string | null | undefined): { day: string; iso: string } | null {
  if (!val || val === 'N/A' || val === 'null' || val.trim() === '') return null;
  // MM/DD/YYYY HH:MM:SS AM/PM
  const m = val.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mm, dd, yyyy, hStr, min, sec, meridiem] = m;
  let h = parseInt(hStr);
  if (meridiem.toUpperCase() === 'AM') {
    if (h === 12) h = 0;
  } else {
    if (h !== 12) h += 12;
  }
  const day = `${yyyy}-${mm}-${dd}`;
  const iso = `${day}T${String(h).padStart(2, '0')}:${min}:${sec}`;
  return { day, iso };
}

function nullify(val: string | null | undefined): string | null {
  if (!val || val === 'N/A' || val === 'null' || val.trim() === '') return null;
  return val.trim();
}

function parseIntOrNull(val: string | null | undefined): number | null {
  if (!val || val === 'N/A' || val === 'NOT_PROVIDED' || val === 'null') return null;
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

// ── main ───────────────────────────────────────────────────────────────────

const csvPath = process.argv[2];
const shouldClear = process.argv.includes('--clear');

if (!csvPath) {
  console.error('Usage: import-csv.ts <path-to-csv> [--clear]');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

type Row = {
  TICKET_ID: string | null;
  VISITOR_NAME: string | null;
  VISITOR_EMAIL: string | null;
  SUBJECT: string | null;
  TAGS: string | null;
  TICKET_STATUS: string | null;
  PRIORITY: string | null;
  AGENT_EMAIL: string | null;
  RESOLVED_BY: string | null;
  FIRST_RESPONSE_DURATION_SECONDS: number | null;
  AVG_RESPONSE_TIME_SECONDS: number | null;
  SPENT_TIME_SECONDS: number | null;
  TICKET_CSAT: number | null;
  AGENT_RATING: number | null;
  MESSAGES_JSON: null;
  MESSAGE_COUNT: null;
  USER_MESSAGE_COUNT: null;
  AGENT_MESSAGE_COUNT: null;
  DAY: string | null;
  GROUP_NAME: string | null;
  INITIALIZED_TIME: string | null;
  RESOLVED_TIME: string | null;
};

async function run() {
  const BATCH = 200;
  let batch: Row[] = [];
  let totalInserted = 0;
  let skipped = 0;
  const datesFound = new Set<string>();
  const datesCleared = new Set<string>();

  const parser = fs
    .createReadStream(csvPath)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        bom: true,        // strip UTF-8 BOM
        trim: true,
        relax_column_count: true,
      })
    );

  async function flushBatch(rows: Row[]) {
    const stmts = rows.map((r) => ({
      sql: `INSERT INTO raw_tickets (
              TICKET_ID, VISITOR_NAME, VISITOR_EMAIL, SUBJECT, TAGS,
              TICKET_STATUS, PRIORITY, AGENT_EMAIL, RESOLVED_BY,
              FIRST_RESPONSE_DURATION_SECONDS, AVG_RESPONSE_TIME_SECONDS, SPENT_TIME_SECONDS,
              TICKET_CSAT, AGENT_RATING, MESSAGES_JSON,
              MESSAGE_COUNT, USER_MESSAGE_COUNT, AGENT_MESSAGE_COUNT,
              DAY, GROUP_NAME, INITIALIZED_TIME, RESOLVED_TIME
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        r.TICKET_ID, r.VISITOR_NAME, r.VISITOR_EMAIL, r.SUBJECT, r.TAGS,
        r.TICKET_STATUS, r.PRIORITY, r.AGENT_EMAIL, r.RESOLVED_BY,
        r.FIRST_RESPONSE_DURATION_SECONDS, r.AVG_RESPONSE_TIME_SECONDS, r.SPENT_TIME_SECONDS,
        r.TICKET_CSAT, r.AGENT_RATING, null,
        null, null, null,
        r.DAY, r.GROUP_NAME, r.INITIALIZED_TIME, r.RESOLVED_TIME,
      ],
    }));
    await mainDb.batch(stmts, 'write');
    totalInserted += rows.length;
    process.stdout.write(`\r  inserted ${totalInserted} rows...`);
  }

  for await (const record of parser) {
    const initParsed = parseDateTime(record['initialized_time']);
    if (!initParsed) {
      skipped++;
      continue;
    }

    const ticketId = nullify(record['ticket_id']);
    if (!ticketId) {
      skipped++;
      continue;
    }

    // skip agent_email that's clearly a bot / system
    const agentEmail = nullify(record['agent_email']);

    const { day, iso: initIso } = initParsed;
    datesFound.add(day);

    // clear before first insert for this date
    if (shouldClear && !datesCleared.has(day)) {
      await mainDb.execute({
        sql: 'DELETE FROM raw_tickets WHERE DAY = ?',
        args: [day],
      });
      datesCleared.add(day);
      console.log(`\n  Cleared existing rows for ${day}`);
    }

    const resolvedParsed = parseDateTime(record['resolved_time']);

    const row: Row = {
      TICKET_ID: ticketId,
      VISITOR_NAME: nullify(record['visitor_name']),
      VISITOR_EMAIL: nullify(record['visitor_email']),
      SUBJECT: nullify(record['subject']),
      TAGS: nullify(record['tags']),
      TICKET_STATUS: nullify(record['status']),
      PRIORITY: nullify(record['priority']),
      AGENT_EMAIL: agentEmail,
      RESOLVED_BY: nullify(record['resolved_by']),
      FIRST_RESPONSE_DURATION_SECONDS: parseTimeToSeconds(record['first_response_duration']),
      AVG_RESPONSE_TIME_SECONDS: parseTimeToSeconds(record['avg_response_time']),
      SPENT_TIME_SECONDS: parseTimeToSeconds(record['spent_time']),
      TICKET_CSAT: parseIntOrNull(record['ticket_csat']),
      AGENT_RATING: parseIntOrNull(record['agent_rating']),
      MESSAGES_JSON: null,
      MESSAGE_COUNT: null,
      USER_MESSAGE_COUNT: null,
      AGENT_MESSAGE_COUNT: null,
      DAY: day,
      GROUP_NAME: nullify(record['group']),
      INITIALIZED_TIME: initIso,
      RESOLVED_TIME: resolvedParsed ? resolvedParsed.iso : null,
    };

    batch.push(row);

    if (batch.length >= BATCH) {
      await flushBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await flushBatch(batch);
  }

  console.log(`\n\nDone.`);
  console.log(`  Dates covered : ${[...datesFound].sort().join(', ')}`);
  console.log(`  Total inserted: ${totalInserted}`);
  console.log(`  Skipped rows  : ${skipped}`);
}

run().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
