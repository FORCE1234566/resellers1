import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPhoneMatchingNetwork,
  networkPhoneHint,
  assertNetworkPhone,
} from '../utils/phone.js';

test('MTN numbers match MTN prefixes only', () => {
  assert.equal(isPhoneMatchingNetwork('0241234567', 'MTN'), true);
  assert.equal(isPhoneMatchingNetwork('0595399837', 'MTN'), true);
  assert.equal(isPhoneMatchingNetwork('0201234567', 'MTN'), false);
  assert.equal(isPhoneMatchingNetwork('0271234567', 'MTN'), false);
});

test('Telecel and AirtelTigo prefixes', () => {
  assert.equal(isPhoneMatchingNetwork('0201234567', 'Telecel'), true);
  assert.equal(isPhoneMatchingNetwork('0501234567', 'Telecel'), true);
  assert.equal(isPhoneMatchingNetwork('0271234567', 'AirtelTigo'), true);
  assert.equal(isPhoneMatchingNetwork('0571234567', 'AirtelTigo'), true);
  assert.equal(isPhoneMatchingNetwork('0241234567', 'Telecel'), false);
});

test('assertNetworkPhone rejects wrong network', () => {
  assert.throws(() => assertNetworkPhone('0201234567', 'MTN'), /MTN number/i);
  assert.equal(assertNetworkPhone('0241234567', 'MTN'), '0241234567');
});

test('networkPhoneHint lists prefixes', () => {
  assert.match(networkPhoneHint('MTN'), /024/);
  assert.match(networkPhoneHint('Telecel'), /020/);
});
