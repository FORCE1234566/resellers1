import crypto from 'crypto';
import { readSheet } from 'read-excel-file/node';
import { AppError } from '../middleware/errorHandler';
import { CheckerType } from '../config/checker';
import { ResultChecker } from '../models/ResultChecker';

export type CheckerUploadResult = {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  uploadBatchId: string;
};

const MAX_SPREADSHEET_ROWS = 10_000;

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Prefer exact header matches; only allow substring matches for longer labels. */
function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const exact = headers.findIndex((h) => h === candidate);
    if (exact >= 0) return exact;
  }
  for (const candidate of candidates) {
    if (candidate.length < 4) continue;
    const partial = headers.findIndex((h) => h.includes(candidate));
    if (partial >= 0) return partial;
  }
  return -1;
}

function cellToText(value: unknown, field: 'serial' | 'pin'): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (!Number.isSafeInteger(value)) {
      throw new AppError(
        `Excel stored a ${field} as a large number and precision was lost. Format the Serial and PIN columns as Text, then re-upload.`
      );
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) {
    throw new AppError(
      `A ${field} cell looks like a date. Format Serial and PIN columns as Text in Excel.`
    );
  }
  return String(value).trim();
}

function parseRow(
  row: unknown[],
  serialIdx: number,
  pinIdx: number
): { serial: string; pin: string } | null {
  const serial = cellToText(row[serialIdx], 'serial');
  const pin = cellToText(row[pinIdx], 'pin');
  if (!serial || !pin) return null;
  return { serial, pin };
}

/** Minimal CSV parser that respects quoted commas. */
function parseCsvBuffer(buffer: Buffer): unknown[][] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_SPREADSHEET_ROWS) {
    throw new AppError(`CSV file exceeds ${MAX_SPREADSHEET_ROWS} rows`);
  }

  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

function assertRowLimit(rawRows: unknown[][]): unknown[][] {
  if (rawRows.length > MAX_SPREADSHEET_ROWS) {
    throw new AppError(`Spreadsheet exceeds ${MAX_SPREADSHEET_ROWS} rows`);
  }
  return rawRows;
}

export async function parseCheckerExcel(
  buffer: Buffer,
  filename?: string
): Promise<Array<{ serial: string; pin: string }>> {
  const ext = (filename || '').toLowerCase();
  if (ext.endsWith('.xls') && !ext.endsWith('.xlsx')) {
    throw new AppError(
      'Legacy .xls files are not supported. Save as .xlsx or .csv (UTF-8) and upload again.'
    );
  }

  const isCsv = ext.endsWith('.csv');
  let rawRows: unknown[][];
  try {
    rawRows = isCsv ? parseCsvBuffer(buffer) : assertRowLimit(await readSheet(buffer));
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/xls_file_not_supported|not supported/i.test(message)) {
      throw new AppError(
        'This Excel format is not supported. Save as .xlsx or .csv and upload again.'
      );
    }
    throw new AppError(`Could not read spreadsheet: ${message}`);
  }

  if (rawRows.length < 2) {
    throw new AppError('Spreadsheet must contain a header row and at least one data row');
  }

  const headers = (rawRows[0] || []).map(normalizeHeader);
  const serialIdx = findColumnIndex(headers, [
    'serial',
    'serialnumber',
    'serialno',
    'serialnum',
    's/n',
    'voucher',
    'voucherserial',
    'sn',
  ]);
  const pinIdx = findColumnIndex(headers, ['pin', 'pincode', 'pinnumber', 'pinno', 'scratchpin']);

  if (serialIdx < 0 || pinIdx < 0) {
    throw new AppError(
      'Spreadsheet must have Serial and PIN columns in the first row (e.g. Serial, PIN).'
    );
  }

  const parsed: Array<{ serial: string; pin: string }> = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row)) continue;
    const item = parseRow(row, serialIdx, pinIdx);
    if (item) parsed.push(item);
  }
  return parsed;
}

export async function importCheckerInventory(
  type: CheckerType,
  buffer: Buffer,
  filename?: string
): Promise<CheckerUploadResult> {
  const rows = await parseCheckerExcel(buffer, filename);
  if (rows.length === 0) {
    throw new AppError('No valid checker rows found in file');
  }

  const uploadBatchId = `CHK-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let imported = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  const existingSerials = new Set(
    (
      await ResultChecker.find({ type, serial: { $in: rows.map((r) => r.serial) } }).select('serial')
    ).map((d) => d.serial)
  );

  const seenInFile = new Set<string>();
  const toInsert: Array<{ type: CheckerType; serial: string; pin: string; uploadBatchId: string }> =
    [];

  for (const row of rows) {
    if (!row.serial || !row.pin) {
      skippedInvalid++;
      continue;
    }
    if (seenInFile.has(row.serial) || existingSerials.has(row.serial)) {
      skippedDuplicates++;
      continue;
    }
    seenInFile.add(row.serial);
    toInsert.push({
      type,
      serial: row.serial,
      pin: row.pin,
      uploadBatchId,
    });
  }

  if (toInsert.length > 0) {
    try {
      const result = await ResultChecker.insertMany(toInsert, { ordered: false });
      imported = result.length;
    } catch (err) {
      const bulkErr = err as { insertedDocs?: unknown[]; writeErrors?: unknown[]; result?: { nInserted?: number } };
      if (Array.isArray(bulkErr.insertedDocs)) {
        imported = bulkErr.insertedDocs.length;
        skippedDuplicates += bulkErr.writeErrors?.length ?? 0;
      } else if (typeof bulkErr.result?.nInserted === 'number') {
        imported = bulkErr.result.nInserted;
        skippedDuplicates += bulkErr.writeErrors?.length ?? 0;
      } else {
        throw err;
      }
    }
  }

  return { imported, skippedDuplicates, skippedInvalid, uploadBatchId };
}

export async function clearCheckerInventory(type?: CheckerType): Promise<{
  deleted: number;
  type?: CheckerType;
}> {
  const filter = type ? { type } : {};
  const result = await ResultChecker.deleteMany(filter);
  return { deleted: result.deletedCount ?? 0, ...(type ? { type } : {}) };
}

export function maskSerial(serial: string): string {
  if (serial.length <= 4) return '****';
  return `${serial.slice(0, 2)}****${serial.slice(-2)}`;
}
