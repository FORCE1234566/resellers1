import test from 'node:test';
import assert from 'node:assert/strict';
import writeXlsxFile, { type Row } from 'write-excel-file/node';
import {
  checkerTypeFromBundle,
  isCheckerProduct,
  bundleSizeFromCheckerType,
} from '../config/checker.js';
import { parseCheckerExcel, maskSerial } from '../services/checkerInventoryService.js';

async function buildTestXlsx(rows: Row[]): Promise<Buffer> {
  const result = await writeXlsxFile(rows);
  return result.toBuffer();
}

test('isCheckerProduct detects checker packages', () => {
  assert.equal(isCheckerProduct('checker', 'BECE'), true);
  assert.equal(isCheckerProduct('data', '1GB'), false);
  assert.equal(isCheckerProduct(undefined, 'WASSCE'), true);
});

test('checkerTypeFromBundle maps bundle sizes', () => {
  assert.equal(checkerTypeFromBundle('BECE'), 'bece');
  assert.equal(checkerTypeFromBundle('WASSCE'), 'wassce');
  assert.equal(checkerTypeFromBundle('1GB'), null);
});

test('bundleSizeFromCheckerType maps types', () => {
  assert.equal(bundleSizeFromCheckerType('bece'), 'BECE');
  assert.equal(bundleSizeFromCheckerType('wassce'), 'WASSCE');
});

test('parseCheckerExcel reads Serial and PIN columns', async () => {
  const buffer = await buildTestXlsx([
    ['Serial', 'PIN'],
    ['ABC123', '999888'],
    ['DEF456', '777666'],
  ]);

  const rows = await parseCheckerExcel(buffer, 'checkers.xlsx');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { serial: 'ABC123', pin: '999888' });
});

test('parseCheckerExcel skips empty rows', async () => {
  const buffer = await buildTestXlsx([
    ['Serial', 'PIN'],
    ['ABC123', '999888'],
    ['', ''],
  ]);

  const rows = await parseCheckerExcel(buffer, 'checkers.xlsx');
  assert.equal(rows.length, 1);
});

test('parseCheckerExcel reads CSV uploads', async () => {
  const buffer = Buffer.from('Serial,PIN\nABC123,999888\n', 'utf8');
  const rows = await parseCheckerExcel(buffer, 'checkers.csv');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { serial: 'ABC123', pin: '999888' });
});

test('parseCheckerExcel reads CSV with quoted commas', async () => {
  const buffer = Buffer.from('Serial,PIN\n"AB,C123","99,9888"\n', 'utf8');
  const rows = await parseCheckerExcel(buffer, 'checkers.csv');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { serial: 'AB,C123', pin: '99,9888' });
});

test('parseCheckerExcel rejects legacy .xls', async () => {
  await assert.rejects(
    () => parseCheckerExcel(Buffer.from('x'), 'old.xls'),
    /xlsx or \.csv/i
  );
});

test('parseCheckerExcel converts safe numeric Excel cells to text', async () => {
  const buffer = await buildTestXlsx([
    ['Serial', 'PIN'],
    [1234567890, 998877],
  ]);
  const rows = await parseCheckerExcel(buffer, 'checkers.xlsx');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serial, '1234567890');
  assert.equal(rows[0].pin, '998877');
});

test('maskSerial hides middle digits', () => {
  assert.equal(maskSerial('1234567890'), '12****90');
});
