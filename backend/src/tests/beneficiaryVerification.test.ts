import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBeneficiaryVerificationTriggerStatus,
  shouldPreserveSubmittedForVerification,
  SUBMITTED_FOR_VERIFICATION,
} from '../services/beneficiaryVerificationService.js';
import { mapProviderStatus } from '../services/fulfillmentProviderService.js';
import { inferOrderStatusFromProvider } from '../utils/orderStatus.js';

test('extracted maps to processing order status', () => {
  assert.equal(mapProviderStatus('extracted'), 'processing');
  assert.equal(inferOrderStatusFromProvider('extracted'), 'processing');
});

test('delivered and processing map correctly from API', () => {
  assert.equal(mapProviderStatus('delivered'), 'delivered');
  assert.equal(mapProviderStatus('processing'), 'processing');
  assert.equal(mapProviderStatus('placed'), 'processing');
});

test('verification trigger statuses are detected', () => {
  assert.equal(isBeneficiaryVerificationTriggerStatus('extracted'), true);
  assert.equal(isBeneficiaryVerificationTriggerStatus('submitted_for_verification'), true);
  assert.equal(isBeneficiaryVerificationTriggerStatus('delivered'), false);
});

test('extracted status is the only email trigger', async () => {
  const { isExtractedStatus } = await import('../services/beneficiaryVerificationService.js');
  assert.equal(isExtractedStatus('extracted'), true);
  assert.equal(isExtractedStatus('EXTRACTED'), true);
  assert.equal(isExtractedStatus('processing'), false);
  assert.equal(isExtractedStatus('submitted_for_verification'), false);
});

test('preserves submitted_for_verification until terminal API status', () => {
  assert.equal(
    shouldPreserveSubmittedForVerification(SUBMITTED_FOR_VERIFICATION, 'processing'),
    true
  );
  assert.equal(
    shouldPreserveSubmittedForVerification(SUBMITTED_FOR_VERIFICATION, 'delivered'),
    false
  );
});
