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

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h === candidate || h.includes(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseRow(row: unknown[], serialIdx: number, pinIdx: number): { serial: string; pin: string } | null {
  const serial = String(row[serialIdx] ?? '').trim();
  const pin = String(row[pinIdx] ?? '').trim();
  if (!serial || !pin) return null;
  return { serial, pin };
}

function parseCsvBuffer(buffer: Buffer): unknown[][] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_SPREADSHEET_ROWS) {
    throw new AppError(`CSV file exceeds ${MAX_SPREADSHEET_ROWS} rows`);
  }
  return lines.map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
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
  const isCsv = ext.endsWith('.csv');
  const rawRows = isCsv
    ? parseCsvBuffer(buffer)
    : assertRowLimit(await readSheet(buffer));

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
    'sn',
    'voucher',
    'voucherserial',
  ]);
  const pinIdx = findColumnIndex(headers, ['pin', 'pincode', 'pinnumber', 'pinno', 'scratchpin']);

  if (serialIdx < 0 || pinIdx < 0) {
    throw new AppError('Spreadsheet must have Serial and PIN columns in the first row');
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
  const toInsert: Array<{ type: CheckerType; serial: string; pin: string; uploadBatchId: string }> = [];

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
      const bulkErr = err as { insertedDocs?: unknown[]; writeErrors?: unknown[] };
      if (bulkErr.insertedDocs) {
        imported = bulkErr.insertedDocs.length;
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
