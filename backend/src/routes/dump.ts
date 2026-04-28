import { Router } from 'express';
import multer from 'multer';
import { importXlsxDump } from '../services/dump.service.js';

export const dumpRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx / .xls files are accepted'));
    }
  },
});

// POST /api/dump/import-xlsx
// Accepts a multipart upload of an xlsx whose filename encodes the date (DD.MM.YY.xlsx).
// Parses ticket IDs and seeds daily_picks for that date.
dumpRouter.post('/import-xlsx', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send the xlsx as field "file".' });
    }

    const clearExisting = req.body.clearExisting === 'true' || req.body.clearExisting === true;
    const result = await importXlsxDump(req.file.buffer, req.file.originalname, clearExisting);

    res.json({
      success: true,
      ...result,
      message: `Imported ${result.inserted} tickets for ${result.date}${result.unknownIds.length ? ` (${result.unknownIds.length} IDs not found in raw_tickets — audit data may be incomplete)` : ''}`,
    });
  } catch (err: any) {
    console.error('[DumpImport] Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});
