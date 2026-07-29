import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { verifyPayment, verifyWebhookSignature } from '../utils/paystack';
import { processPaystackSuccess } from '../services/paymentFulfillmentService';
import { handlePaystackTransferEvent } from '../services/paystackTransferService';
import { env } from '../config/env';
import {
  handleFulfillmentWebhook,
  verifyFulfillmentWebhookSignature,
} from '../services/fulfillmentProviderService';
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
    req.headers['x-sdh-signature']
  ) as string | undefined;
  const payload = rawPayload(req);

  // Smart Data Hub delivery webhooks often have no signature header.
  // Only reject when a signature IS sent and does not match.
  if (signature && !verifyFulfillmentWebhookSignature(payload, signature)) {
    console.warn('[fulfillment webhook] invalid signature');
    res.status(400).json({ success: false, message: 'Invalid signature' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    res.status(400).json({ success: false, message: 'Invalid JSON payload' });
    return;
  }

  try {
    const order = await handleFulfillmentWebhook(body);
    res.json({
      success: true,
      data: {
        orderId: order.orderId,
        status: order.status,
        providerStatus: order.providerStatus,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handling failed';
    console.error('[fulfillment webhook]', message, JSON.stringify(body).slice(0, 500));
    // Acknowledge unknown refs so Smart Data Hub does not keep marking deliveries failed.
    if (/not found|missing order reference/i.test(message)) {
      res.status(200).json({ success: false, message });
      return;
    }
    res.status(400).json({ success: false, message });
  }
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
