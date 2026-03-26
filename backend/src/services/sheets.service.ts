import { google } from 'googleapis';
import path from 'path';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1DyAe6X8KxxWs9K6Qor3yLLMWDBjoj8KayrXEk489yAs';
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH ||
  path.join(process.cwd(), 'qa-dashboard-491311-7ec519d746d0.json');
const SHEET_NAME = 'QC Reviews';

const HEADERS = [
  'Ticket ID', 'Subject', 'Agent', 'CSAT', 'Ticket Date',
  'QC Status', 'Note', 'Reviewed By', 'Reviewed At'
];

function getAuth() {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  if (credentialsJson) {
    const credentials = JSON.parse(credentialsJson);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// Ensure the sheet tab and header row exist
async function ensureSheet(sheets: any) {
  // Get existing sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = meta.data.sheets.map((s: any) => s.properties.title);

  if (!existing.includes(SHEET_NAME)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS] },
    });
    return;
  }

  // Check if headers exist
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:H1`,
  });
  if (!headerRes.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS] },
    });
  }
}

// Find the row number (1-based) for a given ticket ID, or -1 if not found
async function findTicketRow(sheets: any, ticketId: string): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });
  const rows: string[][] = res.data.values || [];
  for (let i = 1; i < rows.length; i++) { // skip header row
    if (rows[i]?.[0] === ticketId) return i + 1; // 1-based row number
  }
  return -1;
}

export interface ReviewTicketInfo {
  subject?: string;
  agentEmail?: string;
  csat?: number | string;
  day?: string;
}

export async function upsertReviewToSheet(
  ticketId: string,
  status: 'approved' | 'flagged',
  note: string | undefined,
  reviewerName: string | undefined,
  ticketInfo: ReviewTicketInfo
): Promise<void> {
  try {
    const sheets = await getSheets();
    await ensureSheet(sheets);

    const row = [
      ticketId,
      ticketInfo.subject || '',
      ticketInfo.agentEmail || '',
      ticketInfo.csat ?? '',
      ticketInfo.day || '',
      status === 'approved' ? 'Approved ✓' : 'Flagged ✗',
      note || '',
      reviewerName || '',
      new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    ];

    const existingRow = await findTicketRow(sheets, ticketId);

    if (existingRow > 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A${existingRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
    }
    console.log(`[Sheets] Upserted review for ticket ${ticketId} → ${status}`);
  } catch (err: any) {
    console.error('[Sheets] Failed to upsert review:', err.message);
    // Don't throw — sheet sync failure shouldn't break the API response
  }
}

export async function deleteReviewFromSheet(ticketId: string): Promise<void> {
  try {
    const sheets = await getSheets();
    const rowNum = await findTicketRow(sheets, ticketId);
    if (rowNum < 0) return;

    // Get sheet ID for the tab
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetTab = meta.data.sheets?.find((s: any) => s.properties?.title === SHEET_NAME);
    if (!sheetTab) return;
    const sheetTabId = sheetTab.properties?.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetTabId,
              dimension: 'ROWS',
              startIndex: rowNum - 1,
              endIndex: rowNum,
            },
          },
        }],
      },
    });
    console.log(`[Sheets] Deleted review row for ticket ${ticketId}`);
  } catch (err: any) {
    console.error('[Sheets] Failed to delete review:', err.message);
  }
}
