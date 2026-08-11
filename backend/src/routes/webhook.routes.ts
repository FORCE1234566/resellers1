import { Router } from 'express';
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { webhookLimiter, webhookVerifyLimiter } from '../middleware/rateLimiter';
import { paystackIpAllowlist } from '../middleware/paystackIpAllowlist';
import {
  handleFulfillmentWebhookRoute,
  handleFulfillmentWebhookHealth,
  handlePaystackWebhook,
  handlePaymentVerify,
} from './webhook.handlers';

const router = Router();

router.get(
  '/verify/:reference',
  webhookVerifyLimiter,
  asyncHandler(handlePaymentVerify)
);

router.get('/fulfillment', asyncHandler(handleFulfillmentWebhookHealth));
router.get('/smartdatahub', asyncHandler(handleFulfillmentWebhookHealth));
router.head('/smartdatahub', asyncHandler(handleFulfillmentWebhookHealth));
router.head('/fulfillment', asyncHandler(handleFulfillmentWebhookHealth));
router.options('/smartdatahub', (_req, res) => {
  res.status(204).end();
});
router.options('/fulfillment', (_req, res) => {
  res.status(204).end();
});

export const paystackWebhookMiddleware = [
  paystackIpAllowlist,
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '512kb' }),
  asyncHandler(handlePaystackWebhook),
];

export const fulfillmentWebhookMiddleware = [
  webhookLimiter,
  // Always buffer the body — SDH may send json, text/plain, form, or odd content-types.
  express.raw({ type: () => true, limit: '512kb' }),
  asyncHandler(handleFulfillmentWebhookRoute),
];

export default router;
