import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBeneficiaryVerificationTriggerStatus,
  isExportedStatus,
  shouldPreserveSubmittedForVerification,
  SUBMITTED_FOR_VERIFICATION,
} from '../services/beneficiaryVerificationService.js';
import { mapProviderStatus } from '../services/fulfillmentProviderService.js';
import { inferOrderStatusFromProvider } from '../utils/orderStatus.js';

test('exported maps to processing order status', () => {
  assert.equal(mapProviderStatus('exported'), 'processing');
  assert.equal(inferOrderStatusFromProvider('exported'), 'processing');
  assert.equal(mapProviderStatus('extracted'), 'processing');
});

test('delivered and processing map correctly from API', () => {
  assert.equal(mapProviderStatus('delivered'), 'delivered');
  assert.equal(mapProviderStatus('processing'), 'processing');
  assert.equal(mapProviderStatus('placed'), 'processing');
});

test('verification trigger statuses are detected', () => {
  assert.equal(isBeneficiaryVerificationTriggerStatus('exported'), true);
  assert.equal(isBeneficiaryVerificationTriggerStatus('extracted'), true);
  assert.equal(isBeneficiaryVerificationTriggerStatus('submitted_for_verification'), true);
  assert.equal(isBeneficiaryVerificationTriggerStatus('delivered'), false);
});

test('exported status is the email trigger', () => {
  assert.equal(isExportedStatus('exported'), true);
  assert.equal(isExportedStatus('EXPORTED'), true);
  assert.equal(isExportedStatus('extracted'), true);
  assert.equal(isExportedStatus('processing'), false);
  assert.equal(isExportedStatus('submitted_for_verification'), false);
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
