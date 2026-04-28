import XLSX from 'xlsx';
import { saveDailyPicks, clearDailyPicks, db } from './database.service.js';

// Parse DD.MM.YY or DD.MM.YYYY from a filename like "27.04.26.xlsx"
function parseDateFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const m = base.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm}-${dd}`;
}

export interface ImportResult {
  date: string;
  totalIds: number;
  inserted: number;
  unknownIds: string[];
}

export async function importXlsxDump(
  buffer: Buffer,
  filename: string,
  clearExisting = false,
): Promise<ImportResult> {
  const date = parseDateFromFilename(filename);
  if (!date) {
    throw new Error(`Cannot parse date from filename "${filename}". Expected format: DD.MM.YY.xlsx`);
  }

  // Read xlsx — expect a list of ticket IDs in any column
  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const rawIds: string[] = [];
  for (const row of rawRows) {
    for (const cell of row) {
      const val = cell != null ? String(cell).trim() : '';
      if (val) rawIds.push(val);
    }
  }

  if (rawIds.length === 0) throw new Error('No ticket IDs found in the xlsx file');

  const ticketIds = [...new Set(rawIds)];

  // Look up which IDs exist in raw_tickets and what their agent email is
  const placeholders = ticketIds.map(() => '?').join(',');
  const knownResult = await db.execute({
    sql: `SELECT TICKET_ID, MAX(AGENT_EMAIL) as AGENT_EMAIL
          FROM raw_tickets
          WHERE TICKET_ID IN (${placeholders})
          GROUP BY TICKET_ID`,
    args: ticketIds,
  });
  const agentMap = new Map<string, string>();
  for (const row of knownResult.rows as any[]) {
    agentMap.set(String(row.TICKET_ID), String(row.AGENT_EMAIL || 'unknown'));
  }

  const unknownIds = ticketIds.filter((id) => !agentMap.has(id));

  if (clearExisting) {
    await clearDailyPicks(date, 'activity');
  }

  const picks = ticketIds.map((ticketId, i) => ({
    pickDate: date,
    dateMode: 'activity' as const,
    agentEmail: agentMap.get(ticketId) ?? 'unknown',
    ticketId,
    pickOrder: i + 1,
    pick_reason: 'xlsx-import',
  }));

  await saveDailyPicks(picks);

  console.log(`[DumpImport] ${filename} → ${date}: ${picks.length} picks, ${unknownIds.length} unknown IDs`);
  return { date, totalIds: rawIds.length, inserted: picks.length, unknownIds };
}
