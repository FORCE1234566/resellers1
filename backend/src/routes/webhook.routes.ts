import { Router } from 'express';
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { webhookLimiter, webhookVerifyLimiter } from '../middleware/rateLimiter';
import { paystackIpAllowlist } from '../middleware/paystackIpAllowlist';
import {
  handleFulfillmentWebhookRoute,
  handlePaystackWebhook,
  handlePaymentVerify,
} from './webhook.handlers';

const router = Router();

router.get(
  '/verify/:reference',
  webhookVerifyLimiter,
  asyncHandler(handlePaymentVerify)
);

export const paystackWebhookMiddleware = [
  paystackIpAllowlist,
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '512kb' }),
  asyncHandler(handlePaystackWebhook),
];

export const fulfillmentWebhookMiddleware = [
  webhookLimiter,
  // Accept common SDH content types (some send text/plain or charset suffixes).
  express.raw({
    type: (req) => {
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      return (
        !ct ||
        ct.includes('json') ||
        ct.includes('text/plain') ||
        ct.includes('octet-stream')
      );
    },
    limit: '512kb',
  }),
  asyncHandler(handleFulfillmentWebhookRoute),
];

export default router;
