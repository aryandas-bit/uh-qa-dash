import dotenv from 'dotenv';
dotenv.config();

const METABASE_BASE_URL = process.env.METABASE_BASE_URL || 'https://metabase.internal.ultrahuman.com';
const METABASE_SESSION_TOKEN = process.env.METABASE_SESSION_TOKEN || '';
const METABASE_CARD_ID = process.env.METABASE_CARD_ID || '19330';

export const isMetabaseEnabled = Boolean(METABASE_SESSION_TOKEN);

interface MetabaseCol { name: string }
interface MetabaseResponse {
  status: string;
  row_count: number;
  data: { rows: any[][]; cols: MetabaseCol[]; rows_truncated?: number };
}

export interface MetabaseTicket {
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

function toNum(v: any): number {
  if (v === null || v === undefined || v === '' || v === 'NA' || v === '-') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toStr(v: any): string {
  if (v === null || v === undefined) return '';
  if (v === 'NA' || v === '-') return '';
  return String(v);
}

function mapRow(row: any[], colIndex: Record<string, number>): MetabaseTicket {
  const g = (col: string): any => {
    const idx = colIndex[col];
    return idx !== undefined ? row[idx] : null;
  };
  return {
    TICKET_ID: toStr(g('TICKET_ID')),
    VISITOR_NAME: toStr(g('VISITOR_NAME')),
    VISITOR_EMAIL: toStr(g('VISITOR_EMAIL')),
    SUBJECT: toStr(g('SUBJECT')),
    TAGS: toStr(g('TAGS')),
    TICKET_STATUS: toStr(g('TICKET_STATUS')),
    PRIORITY: toStr(g('PRIORITY')),
    AGENT_EMAIL: toStr(g('AGENT_EMAIL')),
    RESOLVED_BY: toStr(g('RESOLVED_BY')),
    FIRST_RESPONSE_DURATION_SECONDS: toNum(g('FIRST_RESPONSE_DURATION_SECONDS')),
    AVG_RESPONSE_TIME_SECONDS: toNum(g('AVG_RESPONSE_TIME_SECONDS')),
    SPENT_TIME_SECONDS: toNum(g('SPENT_TIME_SECONDS')),
    TICKET_CSAT: toNum(g('TICKET_CSAT')),
    AGENT_RATING: toNum(g('AGENT_RATING')),
    MESSAGES_JSON: toStr(g('MESSAGES_JSON')) || '[]',
    MESSAGE_COUNT: toNum(g('MESSAGE_COUNT')),
    USER_MESSAGE_COUNT: toNum(g('USER_MESSAGE_COUNT')),
    AGENT_MESSAGE_COUNT: toNum(g('AGENT_MESSAGE_COUNT')),
    DAY: toStr(g('DAY')),
    GROUP_NAME: toStr(g('GROUP_NAME')),
    INITIALIZED_TIME: toStr(g('INITIALIZED_TIME')),
    RESOLVED_TIME: toStr(g('RESOLVED_TIME')),
  };
}

export async function fetchTicketsFromMetabase(startDate: string, endDate: string): Promise<MetabaseTicket[]> {
  if (!METABASE_SESSION_TOKEN) throw new Error('METABASE_SESSION_TOKEN not configured');

  const response = await fetch(`${METABASE_BASE_URL}/api/card/${METABASE_CARD_ID}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Metabase-Session': METABASE_SESSION_TOKEN,
    },
    body: JSON.stringify({
      parameters: [
        { type: 'category', target: ['variable', ['template-tag', 'start_date']], value: startDate },
        { type: 'category', target: ['variable', ['template-tag', 'end_date']], value: endDate },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Metabase API ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json() as MetabaseResponse;
  if (data.status !== 'completed') throw new Error(`Metabase query status: ${data.status}`);

  const colIndex: Record<string, number> = {};
  data.data.cols.forEach((col, i) => { colIndex[col.name] = i; });

  const tickets = data.data.rows
    .map(row => mapRow(row, colIndex))
    .filter(t => t.TICKET_ID && t.AGENT_EMAIL);

  if (data.data.rows_truncated) {
    console.warn(`[Metabase] Results truncated to ${data.data.rows_truncated} rows for ${startDate}→${endDate}`);
  }

  return tickets;
}
