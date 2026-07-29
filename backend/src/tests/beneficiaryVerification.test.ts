import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBeneficiaryVerificationTriggerStatus,
  isExportedStatus,
  shouldPreserveSubmittedForVerification,
  SUBMITTED_FOR_VERIFICATION,
} from '../services/beneficiaryVerificationService.js';
import {
  mapProviderStatus,
  resolveBulkStatus,
} from '../services/fulfillmentProviderService.js';
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

test('verification submission statuses trigger the email', () => {
  assert.equal(isExportedStatus('exported'), true);
  assert.equal(isExportedStatus('EXPORTED'), true);
  assert.equal(isExportedStatus('extracted'), true);
  assert.equal(isExportedStatus('submitted_for_verification'), true);
  assert.equal(isExportedStatus('awaiting_verification'), true);
  assert.equal(isExportedStatus('verification_pending'), true);
  assert.equal(isExportedStatus('unverified'), true);
  assert.equal(isExportedStatus('processing'), false);
  assert.equal(isExportedStatus('delivered'), false);
});

test('resolveBulkStatus prefers exported over batch pending', () => {
  assert.equal(
    resolveBulkStatus({
      status: 'pending',
      orders: [{ status: 'exported', phone_number: '0244123456' }],
    }),
    'exported'
  );
  assert.equal(
    resolveBulkStatus({
      status: 'pending',
      orders: [{ status: 'pending' }],
    }),
    'pending'
  );
  assert.equal(
    resolveBulkStatus(
      {
        status: 'pending',
        orders: [
          { status: 'pending', phone_number: '0200000000' },
          { status: 'exported', phone_number: '0244123456' },
        ],
      },
      { phone: '0244123456' }
    ),
    'exported'
  );
  assert.equal(
    resolveBulkStatus({
      status: 'pending',
      orders: [{ status: 'delivered' }, { status: 'exported' }],
    }),
    'delivered'
  );
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
  assert.equal(
    shouldPreserveSubmittedForVerification(SUBMITTED_FOR_VERIFICATION, 'exported'),
    true
  );
});

test('getVerificationStartedAt reads history entry', async () => {
  const { getVerificationStartedAt } = await import(
    '../services/beneficiaryVerificationService.js'
  );
  const started = new Date('2026-07-01T00:00:00.000Z');
  const at = getVerificationStartedAt({
    statusHistory: [
      {
        step: 'processing',
        label: 'Processing',
        message: 'x',
        done: false,
        at: new Date('2026-06-30T00:00:00.000Z'),
      },
      {
        step: 'submitted_for_verification',
        label: 'Submitted for Verification',
        message: 'x',
        done: false,
        at: started,
      },
    ],
  } as never);
  assert.equal(at?.toISOString(), started.toISOString());
});
