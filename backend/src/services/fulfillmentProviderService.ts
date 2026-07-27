import crypto from 'crypto';
import mongoose from 'mongoose';
import { secureCompare } from '../utils/secureCompare';
import { Order, IOrder, OrderStatus, FulfillmentProvider } from '../models/Order';
import { env } from '../config/env';
import { createNotification } from './notificationService';
import { notifyagentWebhook } from './agentWebhookService';
import { creditWallet } from './walletService';
import { resolveFulfillmentProvider, resolveAfaFulfillmentProvider } from './settingsService';
import {
  SmartDataHubError,
  createSmartDataHubOrder,
  fetchSmartDataHubBulkStatus,
  isSmartDataHubConfigured,
} from './smartDataHubClient';
import {
  DatamaxError,
  createDatamaxOrder,
  fetchDatamaxOrderStatus,
  isDatamaxConfigured,
  registerDatamaxAfa,
} from './datamaxClient';
import { isAfaProduct, AFA_CHECK_USSD, AFA_PROCESSING_HOURS } from '../config/afa';
import { normalizeOrderStatus } from '../utils/orderStatus';
import {
  SUBMITTED_FOR_VERIFICATION,
  VERIFIED_PROVIDER_STATUS,
  applySmartDataHubVerificationOnExported,
  isExportedStatus,
  isBeneficiaryVerificationTriggerStatus,
  markBeneficiaryVerified,
  shouldPreserveSubmittedForVerification,
} from './beneficiaryVerificationService';

export interface StatusHistoryEntry {
  step: string;
  label: string;
  message: string;
  done: boolean;
  at: Date;
}

const QUEUED_PROVIDER_STATUSES = ['awaiting_provider_balance', 'submit_failed'] as const;

function isFulfillmentProviderConfigured(provider: FulfillmentProvider): boolean {
  if (provider === 'smartdatahub') return isSmartDataHubConfigured();
  return isDatamaxConfigured();
}

/** Strip third-party provider names from text shown to agents and resellers. */
export function sanitizeClientFulfillmentText(text: string): string {
  return text
    .replace(/smart\s*data\s*hub/gi, 'network')
    .replace(/smartdatahub[^\s]*/gi, 'network')
    .replace(/datamax[^\s]*/gi, 'network')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function clientStepMessage(message: string): string {
  const sanitized = sanitizeClientFulfillmentText(message);
  if (/api credentials not configured|api error/i.test(sanitized)) {
    return 'Gateway processing in progress';
  }
  return sanitized;
}

export const mapProviderStatus = (raw: string): OrderStatus => {
  const s = raw.toLowerCase().replace(/\s+/g, '_');
  if (['delivered', 'completed', 'success', 'successful'].includes(s)) return 'delivered';
  if (['failed', 'error', 'rejected'].includes(s)) return 'failed';
  if (['cancelled', 'canceled'].includes(s)) return 'cancelled';
  if (['refunded'].includes(s)) return 'refunded';
  if (
    [
      'pending',
      'awaiting',
      'created',
      'awaiting_provider_balance',
    ].includes(s)
  ) {
    return 'pending';
  }
  // extracted / verification / placed / processing all stay in-flight
  return 'processing';
};

export const displayProviderStatus = (providerStatus?: string, status?: OrderStatus): string => {
  if (!providerStatus) return status || 'pending';
  const labels: Record<string, string> = {
    submitting_to_api: 'submitting_to_api',
    submitting: 'submitting_to_api',
    gateway_processing: 'gateway_processing',
    awaiting_provider_balance: 'awaiting_provider_balance',
    submitted_for_verification: SUBMITTED_FOR_VERIFICATION,
    exported: SUBMITTED_FOR_VERIFICATION,
    extracted: SUBMITTED_FOR_VERIFICATION,
    verified: VERIFIED_PROVIDER_STATUS,
    in_progress: 'processing',
    placed: 'processing',
  };
  return labels[providerStatus.toLowerCase()] || providerStatus;
};

function pushHistory(order: IOrder, entry: Omit<StatusHistoryEntry, 'at'> & { at?: Date }) {
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    ...entry,
    at: entry.at || new Date(),
  });
}

function isSubmittedToProvider(order: IOrder): boolean {
  if (order.fulfillmentProvider === 'datamax') {
    return Boolean(order.providerOrderId);
  }
  return Boolean(order.providerBatchId || order.providerReference);
}

export function buildDefaultHistory(order: IOrder): StatusHistoryEntry[] {
  const paid =
    order.source === 'reseller_store' || order.source === 'agent' || order.source === 'agent_api';
  const submitted = isSubmittedToProvider(order);
  const queued = order.providerStatus === 'awaiting_provider_balance';
  const processing = ['processing', 'delivered'].includes(order.status);
  const delivered = order.status === 'delivered';
  const failed = ['failed', 'cancelled', 'refunded'].includes(order.status);
  const isAfa = isAfaProduct(order.productType, order.bundleSize);

  return [
    {
      step: 'created',
      label: 'Order Created',
      message: isAfa
        ? `AFA registration request for ${order.afaDetails?.fullName || order.recipientPhone}`
        : `Request received for ${order.recipientPhone}`,
      done: true,
      at: order.createdAt,
    },
    {
      step: 'payment',
      label: 'Payment Processing',
      message: order.source === 'reseller_store' ? 'Payment verified' : 'Wallet debited',
      done: paid,
      at: order.createdAt,
    },
    {
      step: 'gateway',
      label: queued
        ? 'Awaiting Provider Balance'
        : order.providerStatus === 'submitting_to_api'
          ? 'Submitting to API'
          : 'Gateway Processing',
      message: queued
        ? 'Queued — processing will resume shortly'
        : order.providerStatus === 'submitting_to_api'
          ? 'Sending order to the network'
          : 'Verifying with telecommunication provider',
      done: submitted || processing || delivered,
      at: order.updatedAt,
    },
    {
      step: 'dispatch',
      label: isAfa ? 'Registration Submitted' : 'Bundle Dispatched',
      message: failed
        ? isAfa
          ? 'Registration could not be completed'
          : 'Delivery could not be completed'
        : isAfa
          ? `Registration submitted — allow ${AFA_PROCESSING_HOURS} hours, then dial ${AFA_CHECK_USSD} to check status`
          : 'Resource sent to recipient',
      done: delivered || (isAfa && submitted),
      at: order.updatedAt,
    },
    {
      step: 'confirmation',
      label: 'Final Confirmation',
      message: delivered
        ? isAfa
          ? 'Registration confirmed'
          : 'End-to-end receipt validated'
        : failed
          ? isAfa
            ? 'Registration marked as not completed'
            : 'Order marked as not delivered'
          : isAfa
            ? `Processing — check with ${AFA_CHECK_USSD} after ${AFA_PROCESSING_HOURS} hours`
            : 'Awaiting delivery confirmation',
      done: delivered,
      at: order.updatedAt,
    },
  ];
}

export function getOrderTracking(order: IOrder, options?: { forClient?: boolean }) {
  const forClient = options?.forClient ?? false;
  const steps =
    order.statusHistory && order.statusHistory.length > 0
      ? order.statusHistory.map((h) => ({
          step: h.step,
          label: h.label,
          message: forClient ? clientStepMessage(h.message) : h.message,
          done: h.done,
          at: h.at,
        }))
      : buildDefaultHistory(order).map((h) => ({
          ...h,
          message: forClient ? clientStepMessage(h.message) : h.message,
        }));

  return {
    orderId: order.orderId,
    status: order.status,
    providerStatus: forClient ? undefined : order.providerStatus,
    providerOrderId: forClient ? undefined : order.providerOrderId,
    providerBatchId: forClient ? undefined : order.providerBatchId,
    providerReference: forClient ? undefined : order.providerReference,
    fulfillmentProvider: forClient ? undefined : order.fulfillmentProvider,
    recipientPhone: order.recipientPhone,
    network: order.network,
    bundleSize: order.bundleSize,
    sellingPrice: order.sellingPrice,
    totalAmount: order.totalAmount,
    steps,
    updatedAt: order.updatedAt,
    createdAt: order.createdAt,
  };
}

async function notifyStatusChange(order: IOrder, prevStatus: OrderStatus) {
  if (order.status === prevStatus) return;

  if (order.resellerId && order.status === 'delivered') {
    if (order.profit > 0) {
      await creditWallet(
        order.resellerId,
        order.profit,
        'profit_credit',
        `Profit from order ${order.orderId}`,
        order.orderId
      );
    }
    if (order.uplineProfits?.length) {
      for (const entry of order.uplineProfits) {
        if (entry.profit > 0) {
          await creditWallet(
            entry.resellerId,
            entry.profit,
            'profit_credit',
            `Upline profit from order ${order.orderId}`,
            `${order.orderId}-upline-${entry.resellerId.toString()}`
          );
        }
      }
    }
    await createNotification(
      order.resellerId,
      'order_delivered',
      'Order Delivered',
      `Order ${order.orderId} has been delivered successfully.`
    );
  }
  if (order.agentId && order.status === 'delivered') {
    await createNotification(
      order.agentId,
      'order_delivered',
      'Order Delivered',
      `Order ${order.orderId} has been delivered successfully.`
    );
  }
  if (order.agentId && ['delivered', 'failed'].includes(order.status)) {
    await notifyagentWebhook(order);
  }
}

export async function applyOrderStatusUpdate(
  order: IOrder,
  update: {
    status?: OrderStatus;
    providerStatus?: string;
    providerOrderId?: string;
    providerBatchId?: string;
    providerReference?: string;
    fulfillmentProvider?: FulfillmentProvider;
    stepLabel?: string;
    stepMessage?: string;
  }
) {
  const prevStatus = order.status;

  if (update.providerOrderId) order.providerOrderId = update.providerOrderId;
  if (update.providerBatchId) order.providerBatchId = update.providerBatchId;
  if (update.providerReference) order.providerReference = update.providerReference;
  if (update.providerStatus) order.providerStatus = update.providerStatus;
  if (update.fulfillmentProvider) order.fulfillmentProvider = update.fulfillmentProvider;
  if (update.status) {
    order.status = update.status;
  } else if (update.providerStatus) {
    order.status = normalizeOrderStatus(order.status, update.providerStatus);
  }

  if (update.stepLabel || update.stepMessage || update.providerStatus || update.status) {
    pushHistory(order, {
      step: update.providerStatus || update.status || 'update',
      label: update.stepLabel || update.providerStatus || update.status || 'Status Update',
      message: update.stepMessage || `Status updated to ${update.status || order.status}`,
      done: ['delivered', 'failed', 'cancelled', 'refunded'].includes(order.status),
    });
  }

  await order.save();
  await notifyStatusChange(order, prevStatus);
  return order;
}

async function submitToSmartDataHub(order: IOrder): Promise<IOrder | null> {
  try {
    const response = await createSmartDataHubOrder({
      orderId: order.orderId,
      recipientPhone: order.recipientPhone,
      network: order.network,
      bundleSize: order.bundleSize,
    });

    const data = response.data;
    return applyOrderStatusUpdate(order, {
      status: 'processing',
      providerStatus: 'gateway_processing',
      fulfillmentProvider: 'smartdatahub',
      providerBatchId: data.batch_id,
      providerOrderId: data.batch_id,
      providerReference: data.order_number || order.orderId,
      stepLabel: 'Gateway Processing',
      stepMessage: data.message ? clientStepMessage(data.message) : 'Order submitted for processing',
    });
  } catch (err) {
    if (err instanceof SmartDataHubError && err.statusCode === 402) {
      return applyOrderStatusUpdate(order, {
        providerStatus: 'awaiting_provider_balance',
        fulfillmentProvider: 'smartdatahub',
        stepLabel: 'Awaiting Provider Balance',
        stepMessage: 'Queued — processing will resume shortly',
      });
    }

    console.error('Smart Data Hub submit failed:', err instanceof Error ? err.message : err);
    return applyOrderStatusUpdate(order, {
      providerStatus: 'submit_failed',
      fulfillmentProvider: 'smartdatahub',
      stepLabel: 'Gateway Processing',
      stepMessage:
        err instanceof SmartDataHubError
          ? clientStepMessage(err.message)
          : 'Could not reach fulfillment gateway — retrying automatically',
    });
  }
}

async function submitToDatamaxAfa(order: IOrder): Promise<IOrder | null> {
  const details = order.afaDetails;
  if (!details) {
    return applyOrderStatusUpdate(order, {
      status: 'failed',
      providerStatus: 'submit_failed',
      fulfillmentProvider: 'datamax',
      stepLabel: 'Registration Failed',
      stepMessage: 'Missing AFA registration details',
    });
  }

  try {
    const response = await registerDatamaxAfa({
      fullName: details.fullName,
      phone: details.phone,
      ghanaCard: details.ghanaCard,
      location: details.location,
      occupation: details.occupation,
    });

    const providerOrderId =
      response.order_id != null
        ? String(response.order_id)
        : response.registration_id != null
          ? String(response.registration_id)
          : order.orderId;

    return applyOrderStatusUpdate(order, {
      status: 'processing',
      providerStatus: 'afa_submitted',
      fulfillmentProvider: 'datamax',
      providerOrderId,
      providerReference: order.orderId,
      stepLabel: 'Registration Submitted',
      stepMessage:
        response.message ||
        `Submitted for processing — allow ${AFA_PROCESSING_HOURS} hours, then dial ${AFA_CHECK_USSD} to check`,
    });
  } catch (err) {
    if (err instanceof DatamaxError && err.statusCode === 402) {
      return applyOrderStatusUpdate(order, {
        providerStatus: 'awaiting_provider_balance',
        fulfillmentProvider: 'datamax',
        stepLabel: 'Awaiting Provider Balance',
        stepMessage: 'Queued — processing will resume shortly',
      });
    }

    console.error('Datamax AFA submit failed:', err instanceof Error ? err.message : err);
    return applyOrderStatusUpdate(order, {
      providerStatus: 'submit_failed',
      fulfillmentProvider: 'datamax',
      stepLabel: 'Registration Failed',
      stepMessage:
        err instanceof DatamaxError
          ? clientStepMessage(err.message)
          : 'Could not reach registration gateway — retrying automatically',
    });
  }
}

async function submitToDatamax(order: IOrder): Promise<IOrder | null> {
  if (isAfaProduct(order.productType, order.bundleSize)) {
    return submitToDatamaxAfa(order);
  }

  try {
    const response = await createDatamaxOrder({
      orderId: order.orderId,
      recipientPhone: order.recipientPhone,
      network: order.network,
      bundleSize: order.bundleSize,
    });

    const providerOrderId = response.order_id != null ? String(response.order_id) : undefined;
    return applyOrderStatusUpdate(order, {
      status: 'processing',
      providerStatus: 'gateway_processing',
      fulfillmentProvider: 'datamax',
      providerOrderId,
      providerReference: order.orderId,
      stepLabel: 'Gateway Processing',
      stepMessage: response.message
        ? clientStepMessage(response.message)
        : 'Order submitted for processing',
    });
  } catch (err) {
    if (err instanceof DatamaxError && err.statusCode === 402) {
      return applyOrderStatusUpdate(order, {
        providerStatus: 'awaiting_provider_balance',
        fulfillmentProvider: 'datamax',
        stepLabel: 'Awaiting Provider Balance',
        stepMessage: 'Queued — processing will resume shortly',
      });
    }

    console.error('Datamax submit failed:', err instanceof Error ? err.message : err);
    return applyOrderStatusUpdate(order, {
      providerStatus: 'submit_failed',
      fulfillmentProvider: 'datamax',
      stepLabel: 'Gateway Processing',
      stepMessage:
        err instanceof DatamaxError
          ? clientStepMessage(err.message)
          : 'Could not reach fulfillment gateway — retrying automatically',
    });
  }
}

export async function submitOrderToProvider(order: IOrder): Promise<IOrder | null> {
  const isAfa = isAfaProduct(order.productType, order.bundleSize);
  const provider = isAfa
    ? order.fulfillmentProvider ?? (await resolveAfaFulfillmentProvider())
    : order.fulfillmentProvider ?? (await resolveFulfillmentProvider(order.network));
  if (!provider) return null;
  if (!isFulfillmentProviderConfigured(provider)) return null;

  if (!order.fulfillmentProvider) {
    order.fulfillmentProvider = provider;
  }

  if (
    isSubmittedToProvider(order) &&
    !QUEUED_PROVIDER_STATUSES.includes(
      order.providerStatus as (typeof QUEUED_PROVIDER_STATUSES)[number]
    )
  ) {
    return order;
  }

  if (provider === 'datamax') return submitToDatamax(order);
  return submitToSmartDataHub(order);
}

function resolveBulkStatus(data: {
  status?: string;
  orders?: { status?: string }[];
}): string {
  if (data.status) return data.status;
  const orders = data.orders || [];
  if (orders.length === 0) return '';
  if (orders.every((o) => o.status === 'delivered')) return 'completed';
  if (orders.some((o) => o.status === 'failed')) return 'failed';
  // Prefer exported status when present (triggers verification email)
  const exportedLine = orders.find((o) => isExportedStatus(o.status));
  if (exportedLine?.status) return exportedLine.status;
  const verificationLine = orders.find((o) =>
    isBeneficiaryVerificationTriggerStatus(o.status)
  );
  if (verificationLine?.status) return verificationLine.status;
  return orders[0]?.status || 'processing';
}

function resolveSyncedProviderStatus(
  order: IOrder,
  rawStatus: string
): { status: OrderStatus; providerStatus: string; stepLabel: string; stepMessage: string } {
  const normalizedRaw = rawStatus.toLowerCase().replace(/\s+/g, '_');
  const mappedStatus = mapProviderStatus(rawStatus);

  // Only "exported" enters the verification display state (email sent separately).
  if (isExportedStatus(normalizedRaw)) {
    return {
      status: 'processing',
      providerStatus: SUBMITTED_FOR_VERIFICATION,
      stepLabel: 'Submitted for Verification',
      stepMessage:
        'Number submitted to MTN for verification (24–144 hours). Subsequent orders will be faster after verification.',
    };
  }

  if (shouldPreserveSubmittedForVerification(order.providerStatus, normalizedRaw)) {
    return {
      status: mappedStatus === 'pending' ? 'processing' : mappedStatus,
      providerStatus: SUBMITTED_FOR_VERIFICATION,
      stepLabel: 'Submitted for Verification',
      stepMessage: `Still awaiting MTN verification (API: ${rawStatus})`,
    };
  }

  if (mappedStatus === 'delivered') {
    return {
      status: 'delivered',
      providerStatus: normalizedRaw,
      stepLabel: 'Delivered',
      stepMessage: `Delivery status: ${rawStatus}`,
    };
  }

  if (mappedStatus === 'processing') {
    return {
      status: 'processing',
      providerStatus: normalizedRaw === 'placed' ? 'processing' : normalizedRaw,
      stepLabel: 'Processing',
      stepMessage: `Delivery status: ${rawStatus}`,
    };
  }

  return {
    status: mappedStatus,
    providerStatus: normalizedRaw,
    stepLabel: 'Gateway Processing',
    stepMessage: `Delivery status: ${rawStatus}`,
  };
}

async function syncFromSmartDataHub(order: IOrder): Promise<IOrder | null> {
  if (!isSmartDataHubConfigured()) return null;
  if (['delivered', 'failed', 'cancelled', 'refunded'].includes(order.status)) return order;

  if (
    !isSubmittedToProvider(order) ||
    QUEUED_PROVIDER_STATUSES.includes(
      order.providerStatus as (typeof QUEUED_PROVIDER_STATUSES)[number]
    )
  ) {
    return submitOrderToProvider(order);
  }

  const ref = order.providerReference || order.orderId;
  try {
    const response = await fetchSmartDataHubBulkStatus(ref);
    const payload = response.data;
    const rawStatus = resolveBulkStatus(payload);
    if (!rawStatus) return order;

    const line = payload.orders?.[0];
    const resolved = resolveSyncedProviderStatus(order, rawStatus);

    if (isExportedStatus(rawStatus)) {
      await applySmartDataHubVerificationOnExported(order);
    }

    const updated = await applyOrderStatusUpdate(order, {
      status: resolved.status,
      providerStatus: resolved.providerStatus,
      providerBatchId: payload.batch_id || order.providerBatchId,
      providerOrderId: line?.id || order.providerOrderId,
      providerReference: payload.order_number || order.providerReference,
      stepLabel: resolved.stepLabel,
      stepMessage: resolved.stepMessage,
    });

    if (resolved.status === 'delivered') {
      await markBeneficiaryVerified(order.recipientPhone, order.network, order.orderId);
    }

    return updated;
  } catch (err) {
    if (err instanceof SmartDataHubError && err.statusCode === 404) {
      return submitOrderToProvider(order);
    }
    return order;
  }
}

async function syncFromDatamax(order: IOrder): Promise<IOrder | null> {
  if (!isDatamaxConfigured()) return null;
  if (['delivered', 'failed', 'cancelled', 'refunded'].includes(order.status)) return order;
  if (isAfaProduct(order.productType, order.bundleSize)) {
    if (
      !isSubmittedToProvider(order) ||
      QUEUED_PROVIDER_STATUSES.includes(
        order.providerStatus as (typeof QUEUED_PROVIDER_STATUSES)[number]
      )
    ) {
      return submitOrderToProvider(order);
    }
    return order;
  }

  if (
    !isSubmittedToProvider(order) ||
    QUEUED_PROVIDER_STATUSES.includes(
      order.providerStatus as (typeof QUEUED_PROVIDER_STATUSES)[number]
    )
  ) {
    return submitOrderToProvider(order);
  }

  if (!order.providerOrderId) return submitOrderToProvider(order);

  try {
    const response = await fetchDatamaxOrderStatus(order.providerOrderId);
    const rawStatus = response.status || '';
    if (!rawStatus) return order;

    return applyOrderStatusUpdate(order, {
      status: mapProviderStatus(rawStatus),
      providerStatus: rawStatus.toLowerCase().replace(/\s+/g, '_'),
      stepLabel: 'Gateway Processing',
      stepMessage: `Delivery status: ${rawStatus}`,
    });
  } catch (err) {
    if (err instanceof DatamaxError && err.statusCode === 404) {
      return submitOrderToProvider(order);
    }
    return order;
  }
}

export async function syncOrderFromProvider(order: IOrder): Promise<IOrder | null> {
  const provider =
    order.fulfillmentProvider ?? (await resolveFulfillmentProvider(order.network));
  if (!provider) return order;

  if (provider === 'datamax') return syncFromDatamax(order);
  return syncFromSmartDataHub(order);
}

export async function retryQueuedFulfillmentOrders(limit = 30): Promise<number> {
  const queued = await Order.find({
    providerStatus: { $in: [...QUEUED_PROVIDER_STATUSES] },
    status: { $in: ['pending', 'processing'] },
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let retried = 0;
  for (const order of queued) {
    const provider =
      order.fulfillmentProvider ?? (await resolveFulfillmentProvider(order.network));
    if (!provider || !isFulfillmentProviderConfigured(provider)) continue;
    await submitOrderToProvider(order);
    retried++;
  }
  return retried;
}

export type FulfillmentScope = {
  agentId?: mongoose.Types.ObjectId | string;
  resellerId?: mongoose.Types.ObjectId | string;
};

function scopeFilter(scope: FulfillmentScope = {}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (scope.agentId) filter.agentId = scope.agentId;
  if (scope.resellerId) filter.resellerId = scope.resellerId;
  return filter;
}

/** Pull latest provider statuses into MongoDB before dashboards/lists render. */
export async function syncFulfillmentStatuses(scope: FulfillmentScope = {}, limit = 50) {
  await retryQueuedFulfillmentOrders(Math.min(limit, 30));

  const orders = await Order.find({
    ...scopeFilter(scope),
    status: { $in: ['pending', 'processing'] },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  for (const order of orders) {
    await syncOrderFromProvider(order);
  }
}

/** Background job: sync in-flight orders from APIs and auto-verify aged MTN numbers. */
export async function runFulfillmentBackgroundSync(limit = 80): Promise<{
  synced: number;
  verified: number;
}> {
  const { autoVerifyAgedBeneficiaries } = await import('./beneficiaryVerificationService');
  await retryQueuedFulfillmentOrders(Math.min(limit, 40));

  const orders = await Order.find({
    status: { $in: ['pending', 'processing'] },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  let synced = 0;
  for (const order of orders) {
    const beforeStatus = order.status;
    const beforeProvider = order.providerStatus;
    const updated = await syncOrderFromProvider(order);
    if (
      updated &&
      (updated.status !== beforeStatus || updated.providerStatus !== beforeProvider)
    ) {
      synced++;
    }
  }

  const verified = await autoVerifyAgedBeneficiaries(100);
  return { synced, verified };
}

export async function getFulfillmentStatusCounts(scope: FulfillmentScope = {}) {
  const base = scopeFilter(scope);
  const [awaitingProviderBalance, submittingToApi] = await Promise.all([
    Order.countDocuments({
      ...base,
      providerStatus: 'awaiting_provider_balance',
      status: { $in: ['pending', 'processing'] },
    }),
    Order.countDocuments({
      ...base,
      providerStatus: { $in: ['submitting_to_api', 'gateway_processing', 'submit_failed'] },
      status: { $in: ['pending', 'processing'] },
    }),
  ]);
  return { awaitingProviderBalance, submittingToApi };
}

export async function syncInFlightOrders(orders: IOrder[]) {
  await retryQueuedFulfillmentOrders();

  const inFlight = orders.filter((o) => ['pending', 'processing'].includes(o.status)).slice(0, 20);
  for (const order of inFlight) {
    await syncOrderFromProvider(order);
  }
}

export function verifyFulfillmentWebhookSignature(payload: string, signature: string): boolean {
  if (!env.fulfillment.webhookSecret) return env.nodeEnv !== 'production';
  const hash = crypto
    .createHmac('sha256', env.fulfillment.webhookSecret)
    .update(payload)
    .digest('hex');
  return secureCompare(hash, signature);
}

export async function handleFulfillmentWebhook(body: Record<string, unknown>) {
  const reference = String(
    body.reference ||
      body.orderId ||
      body.order_id ||
      body.order_number ||
      body.external_reference ||
      body.request_id ||
      ''
  );
  const providerRef = String(
    body.provider_reference || body.api_reference || body.order_api_reference || body.id || ''
  );
  if (!reference && !providerRef) throw new Error('Missing order reference');

  const order = await Order.findOne({
    $or: [
      { orderId: reference },
      { providerOrderId: reference },
      { providerReference: reference },
      { providerBatchId: reference },
      ...(providerRef
        ? [
            { providerReference: providerRef },
            { providerOrderId: providerRef },
            { providerBatchId: providerRef },
          ]
        : []),
    ],
  });

  if (!order) throw new Error('Order not found');

  const rawStatus = String(body.status || body.order_status || '');
  if (!rawStatus) return order;

  const resolved = resolveSyncedProviderStatus(order, rawStatus);

  if (order.fulfillmentProvider === 'smartdatahub' && isExportedStatus(rawStatus)) {
    await applySmartDataHubVerificationOnExported(order);
  }

  const updated = await applyOrderStatusUpdate(order, {
    status: resolved.status,
    providerStatus: resolved.providerStatus,
    providerOrderId: String(body.provider_order_id || body.order_id || order.providerOrderId || ''),
    providerBatchId: String(body.batch_id || order.providerBatchId || ''),
    providerReference: String(
      body.provider_reference || body.order_api_reference || body.request_id || order.providerReference || ''
    ),
    stepLabel: resolved.stepLabel,
    stepMessage: resolved.stepMessage,
  });

  if (resolved.status === 'delivered' && order.fulfillmentProvider === 'smartdatahub') {
    await markBeneficiaryVerified(order.recipientPhone, order.network, order.orderId);
  }

  return updated;
}
