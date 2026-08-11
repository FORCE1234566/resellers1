import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { verifyPayment, verifyWebhookSignature } from '../utils/paystack';
import { processPaystackSuccess } from '../services/paymentFulfillmentService';
import { handlePaystackTransferEvent } from '../services/paystackTransferService';
import { env } from '../config/env';
import { isSmartDataHubConfigured } from '../services/smartDataHubClient';
import {
  handleFulfillmentWebhook,
  summarizeFulfillmentWebhookPayload,
  verifyFulfillmentWebhookSignature,
} from '../services/fulfillmentProviderService';
import { recordFulfillmentWebhookDelivery } from '../services/fulfillmentWebhookInbox';
import { logSecurityEvent } from '../services/securityAuditService';
import { verifyPaystackChargeBeforeFulfillment } from '../services/paystackVerificationService';
import { assertTrustedWebhookSource } from '../middleware/paystackIpAllowlist';

function rawPayload(req: Request): string {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  return JSON.stringify(req.body ?? {});
}

function parseFulfillmentBody(payload: string): Record<string, unknown> {
  const trimmed = (payload || '').trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    // form-urlencoded fallback (SDH sometimes posts this)
    if (trimmed.includes('=')) {
      const params = new URLSearchParams(trimmed);
      const out: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) out[k] = v;
      if (Object.keys(out).length) return out;
    }
    return { raw: trimmed.slice(0, 500) };
  }
}

function isFulfillmentPing(body: Record<string, unknown>): boolean {
  if (!body || Object.keys(body).length === 0) return true;
  if (body.test === true || body.ping === true) return true;
  const event = String(body.event || body.type || '').toLowerCase();
  return event === 'ping' || event === 'test' || event === 'webhook.test';
}

function webhookAck(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    status: 'ok',
    message: 'Webhook received',
    ...extra,
  };
}

export async function handlePaystackWebhook(req: Request, res: Response): Promise<void> {
  assertTrustedWebhookSource(req);

  const signature = req.headers['x-paystack-signature'] as string | undefined;
  const payload = rawPayload(req);

  if (env.nodeEnv === 'production' && !signature) {
    throw new AppError('Missing Paystack signature', 400);
  }
  if (signature && !verifyWebhookSignature(payload, signature)) {
    await logSecurityEvent({
      action: 'webhook_rejected',
      entity: 'paystack',
      details: { reason: 'invalid_signature' },
      ip: req.ip,
      success: false,
    });
    res.status(400).json({ success: false, message: 'Invalid signature' });
    return;
  }

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    res.status(400).json({ success: false, message: 'Invalid JSON payload' });
    return;
  }

  let fulfillmentError: Error | null = null;

  if (event.event === 'charge.success' && event.data) {
    const data = event.data as {
      reference?: string;
      metadata?: Record<string, unknown>;
      amount?: number;
      customer?: { email?: string };
    };
    const reference = String(data.reference || '');
    const paidAmount = Number(data.amount) / 100;
    const metadata = (data.metadata || {}) as Record<string, unknown>;
    try {
      await verifyPaystackChargeBeforeFulfillment(reference, data, metadata);
      await processPaystackSuccess(reference, metadata, data.customer?.email, paidAmount);
    } catch (err) {
      fulfillmentError = err instanceof Error ? err : new Error('Fulfillment failed');
      console.error('Paystack fulfillment error:', fulfillmentError);
    }
  }

  if (event.event?.startsWith('transfer.')) {
    try {
      await handlePaystackTransferEvent(event.event, event.data || {});
    } catch (err) {
      console.error('Paystack transfer webhook error:', err);
    }
  }

  if (fulfillmentError) {
    res.status(500).json({ success: false, message: 'Fulfillment failed — will retry' });
    return;
  }

  res.json({ success: true });
}

export async function handleFulfillmentWebhookRoute(req: Request, res: Response): Promise<void> {
  const signature = (
    req.headers['x-fulfillment-signature'] ||
    req.headers['x-webhook-signature'] ||
    req.headers['x-signature'] ||
    req.headers['x-sdh-signature'] ||
    req.headers['x-hub-signature-256'] ||
    req.headers['authorization']
  ) as string | undefined;
  const payload = rawPayload(req);
  const path = req.path || '/api/webhooks/smartdatahub';

  // Soft-check signature: never hard-fail SDH deliveries (they disable the hook on 4xx).
  if (signature && !verifyFulfillmentWebhookSignature(payload, signature)) {
    console.warn('[fulfillment webhook] signature mismatch — continuing (SDH delivery)');
  }

  const body = parseFulfillmentBody(payload || '{}');
  const summary = summarizeFulfillmentWebhookPayload(body);

  if (isFulfillmentPing(body)) {
    void recordFulfillmentWebhookDelivery({
      at: new Date().toISOString(),
      path,
      matched: false,
      refs: summary.refs,
      phones: summary.phones,
      keys: summary.keys,
      preview: payload.slice(0, 400) || '{}',
      note: 'ping/test',
      status: 'ping',
    });
    res.status(200).json(webhookAck({ message: 'Webhook endpoint ready' }));
    return;
  }

  try {
    const order = await handleFulfillmentWebhook(body);
    void recordFulfillmentWebhookDelivery({
      at: new Date().toISOString(),
      path,
      matched: true,
      orderId: order.orderId,
      status: order.status,
      refs: summary.refs,
      phones: summary.phones,
      keys: summary.keys,
      preview: payload.slice(0, 400),
      note: 'matched',
    });
    res.status(200).json(
      webhookAck({
        data: {
          orderId: order.orderId,
          status: order.status,
          providerStatus: order.providerStatus,
        },
        matched: true,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handling failed';
    console.error('[fulfillment webhook]', message, payload.slice(0, 500));
    void recordFulfillmentWebhookDelivery({
      at: new Date().toISOString(),
      path,
      matched: false,
      refs: summary.refs,
      phones: summary.phones,
      keys: summary.keys,
      preview: payload.slice(0, 400),
      note: message,
      status: summary.status || 'unmatched',
    });
    // Always 200 + success so Smart Data Hub keeps the webhook enabled.
    res.status(200).json(
      webhookAck({
        message: /not found|missing order reference/i.test(message)
          ? 'Webhook received (order not matched yet)'
          : 'Webhook received',
        matched: false,
      })
    );
  }
}

export async function handleFulfillmentWebhookHealth(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    success: true,
    status: 'ok',
    message: 'Smart Data Hub delivery webhook is ready',
    path: '/api/webhooks/smartdatahub',
    apiConfigured: isSmartDataHubConfigured(),
    urls: [
      `${env.apiUrl}/api/webhooks/smartdatahub`,
      `${env.apiUrl}/api/webhooks/fulfillment`,
    ],
  });
}

export async function handlePaymentVerify(req: Request, res: Response): Promise<void> {
  const reference = Array.isArray(req.params.reference)
    ? req.params.reference[0]
    : req.params.reference;
  const payment = await verifyPayment(reference);
  const metadata = (payment.metadata || {}) as Record<string, unknown>;

  let fulfillment = null;
  if (payment.status === 'success') {
    try {
      fulfillment = await processPaystackSuccess(
        reference,
        metadata,
        payment.customer?.email,
        payment.amount / 100
      );
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, message: err.message, data: payment });
        return;
      }
      console.error('Payment fulfillment failed:', err);
      res.status(500).json({
        success: false,
        message:
          'Payment was received but your order could not be created. Please contact support with your payment reference.',
        data: payment,
      });
      return;
    }
  }

  res.json({
    success: true,
    data: {
      ...payment,
      fulfillment,
    },
  });
}
