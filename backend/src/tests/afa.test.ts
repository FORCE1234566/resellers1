import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidGhanaCard, normalizeGhanaCard } from '../utils/ghanaCard';
import { isAfaProduct, AFA_BUNDLE_SIZE, AFA_BASE_PRICE } from '../config/afa';

test('normalizeGhanaCard uppercases and trims', () => {
  assert.equal(normalizeGhanaCard(' gha-123456789-0 '), 'GHA-123456789-0');
});

test('isValidGhanaCard accepts valid format', () => {
  assert.equal(isValidGhanaCard('GHA-123456789-0'), true);
  assert.equal(isValidGhanaCard('GHA-12345678-0'), false);
  assert.equal(isValidGhanaCard('GHA1234567890'), false);
});

test('isAfaProduct detects afa packages', () => {
  assert.equal(isAfaProduct('afa', AFA_BUNDLE_SIZE), true);
  assert.equal(isAfaProduct('data', '1GB'), false);
  assert.equal(isAfaProduct(undefined, AFA_BUNDLE_SIZE), true);
});

test('AFA base price is 14 for MTN AFA registration API cost', () => {
  assert.equal(AFA_BASE_PRICE, 14);
});
