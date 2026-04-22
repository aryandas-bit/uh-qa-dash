/**
 * Syncs tickets from Metabase → Turso for a date range.
 * Run from your local machine (which has VPN access to internal Metabase).
 *
 * Usage:
 *   npm run sync                          # last 7 days
 *   npm run sync -- --days 30             # last 30 days
 *   npm run sync -- --date 2026-04-20     # single date
 *   npm run sync -- --from 2026-04-01 --to 2026-04-20   # date range
 */

import dotenv from 'dotenv';
dotenv.config();

import { syncDateFromMetabase, isDateSynced } from '../services/database.service.js';
import { isMetabaseEnabled } from '../services/metabase.service.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  if (get('--date')) return { dates: [get('--date')!] };

  const from = get('--from');
  const to = get('--to');
  if (from && to) return { dates: dateRange(from, to) };

  const days = parseInt(get('--days') || '7');
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return { dates };
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function main() {
  if (!isMetabaseEnabled) {
    console.error('Error: METABASE_SESSION_TOKEN not set in .env');
    process.exit(1);
  }

  const { dates } = parseArgs();
  console.log(`Syncing ${dates.length} date(s): ${dates[0]} → ${dates[dates.length - 1]}`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const date of dates) {
    const already = await isDateSynced(date);
    if (already) {
      console.log(`  ${date} — already synced, skipping`);
      skipped++;
      continue;
    }
    try {
      const count = await syncDateFromMetabase(date);
      console.log(`  ${date} — synced ${count} tickets`);
      synced++;
    } catch (err: any) {
      console.error(`  ${date} — FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Synced: ${synced}, Skipped: ${skipped}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
