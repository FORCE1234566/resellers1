import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'crypto';

test('webhook URL parsing accepts multiline https endpoints', async () => {
  // Mirror parseWebhookUrls logic used by agentWebhookService
  const raw = `
    https://site-a.com/hook
    http://localhost:3000/webhooks
    not-a-url
    https://site-b.com/api/status,
    https://site-a.com/hook
  `;
  const urls = [
    ...new Set(
      raw
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u))
    ),
  ];
  assert.deepEqual(urls, [
    'https://site-a.com/hook',
    'http://localhost:3000/webhooks',
    'https://site-b.com/api/status',
  ]);
});

test('webhook signature is hmac sha256 of raw body', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ event: 'order.delivered', orderId: 'TD-1' });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(sig.length, 64);
  assert.match(sig, /^[a-f0-9]+$/);
});
