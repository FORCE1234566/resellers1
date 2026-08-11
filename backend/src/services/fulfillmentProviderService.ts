import crypto from 'crypto';
import mongoose from 'mongoose';
import { secureCompare } from '../utils/secureCompare';
import { Order, IOrder, OrderStatus, FulfillmentProvider } from '../models/Order';
import { env } from '../config/env';
import { createNotification } from './notificationService';
import { notifyagentWebhook } from './agentWebhookService';
import {
  creditOrderResellerProfits,
  reverseOrderResellerProfits,
} from './resellerOrderProfitService';
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
  isPlainPendingStatus,
  shouldSendPendingVerificationEmail,
  isBeneficiaryVerificationTriggerStatus,
  markBeneficiaryVerified,
  shouldPreserveSubmittedForVerification,
  resolveVerificationStartDate,
  getVerificationCutoffDate,
  autoVerifyAgedBeneficiaries,
} from './beneficiaryVerificationService';

export interface StatusHistoryEntry {
  step: string;
  label: string;
  message: string;
  done: boolean;
  at: Date;
}

const QUEUED_PROVIDER_STATUSES = ['awaiting_provider_balance', 'submit_failed'] as const;

function isProviderBalanceError(err: { statusCode?: number; message?: string }): boolean {
  if (err.statusCode === 402) return true;
  const msg = String(err.message || '');
  return /insufficient|low\s*balance|no\s*(funds|balance|money)|top\s*-?\s*up|wallet.*(empty|low|insufficient)|balance.*(low|insufficient|not\s*enough)/i.test(
    msg
  );
}

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

async function notifyStatusChange(
  order: IOrder,
  prevStatus: OrderStatus,
  prevProviderStatus?: string | null
) {
  const statusChanged = order.status !== prevStatus;
  const providerChanged = (order.providerStatus || null) !== (prevProviderStatus || null);

  if (statusChanged && order.resellerId && order.status === 'delivered') {
    // Idempotent fallback for orders created before immediate profit credit.
    await creditOrderResellerProfits(order);
    await createNotification(
      order.resellerId,
      'order_delivered',
      'Order Delivered',
      `Order ${order.orderId} has been delivered successfully.`
    );
  }

  if (
    statusChanged &&
    order.resellerId &&
    ['failed', 'cancelled', 'refunded'].includes(order.status) &&
    !['failed', 'cancelled', 'refunded'].includes(prevStatus)
  ) {
    try {
      await reverseOrderResellerProfits(order);
    } catch (err) {
      console.error('Failed to reverse reseller profit for', order.orderId, err);
    }
  }
  if (statusChanged && order.agentId && order.status === 'delivered') {
    await createNotification(
      order.agentId,
      'order_delivered',
      'Order Delivered',
      `Order ${order.orderId} has been delivered successfully.`
    );
  }

  // Push every meaningful status/provider change to connected agent websites.
  if (order.agentId && (statusChanged || providerChanged)) {
    void notifyagentWebhook(order, {
      prevStatus,
      prevProviderStatus,
    }).catch(() => {});
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
  const prevProviderStatus = order.providerStatus || null;

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
  await notifyStatusChange(order, prevStatus, prevProviderStatus);
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
    if (err instanceof SmartDataHubError && isProviderBalanceError(err)) {
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
      stepLabel: 'Registration Processing',
      stepMessage:
        response.message ||
        `AFA submitted — stays processing for ${AFA_PROCESSING_HOURS} hours, then marked delivered. Dial ${AFA_CHECK_USSD} to check status.`,
    });
  } catch (err) {
    if (err instanceof DatamaxError && isProviderBalanceError(err)) {
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
      status: 'delivered',
      providerStatus: 'delivered',
      fulfillmentProvider: 'datamax',
      providerOrderId,
      providerReference: order.orderId,
      stepLabel: 'Bundle Delivered',
      stepMessage: response.message
        ? clientStepMessage(response.message)
        : 'Order submitted to network and marked delivered',
    });
  } catch (err) {
    if (err instanceof DatamaxError && isProviderBalanceError(err)) {
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

function providerStatusRank(raw?: string | null): number {
  if (!raw?.trim()) return 0;
  const s = raw.toLowerCase().replace(/\s+/g, '_');
  if (['delivered', 'completed', 'success', 'successful'].includes(s)) return 100;
  if (['failed', 'error', 'rejected'].includes(s)) return 90;
  if (['cancelled', 'canceled', 'refunded'].includes(s)) return 85;
  // Prefer verification/export over generic pending/processing so MTN emails fire.
  if (isExportedStatus(s) || isBeneficiaryVerificationTriggerStatus(s)) return 80;
  if (['processing', 'in_progress', 'placed', 'gateway_processing'].includes(s)) return 40;
  if (['pending', 'awaiting', 'created'].includes(s)) return 20;
  return 10;
}

/**
 * Pick the most advanced status from Smart Data Hub bulk payload.
 * Line-item statuses (e.g. exported) win over a stale batch-level pending.
 */
function linePhoneDigits(line: {
  phone_number?: string;
  beneficiary_number?: string;
  _beneficiary_number?: string;
  phone?: string;
}): string {
  return String(
    line.phone_number || line.beneficiary_number || line._beneficiary_number || line.phone || ''
  ).replace(/\D/g, '');
}

export function resolveBulkStatus(
  data: {
    status?: string;
    orders?: {
      status?: string;
      phone_number?: string;
      beneficiary_number?: string;
      _beneficiary_number?: string;
      phone?: string;
    }[];
  },
  options?: { phone?: string }
): string {
  const orders = data.orders || [];
  const matched =
    options?.phone && orders.length > 0
      ? orders.find((o) => {
          const phone = linePhoneDigits(o);
          const want = String(options.phone || '').replace(/\D/g, '');
          return (
            phone &&
            want &&
            (phone === want || phone.endsWith(want.slice(-9)) || want.endsWith(phone.slice(-9)))
          );
        })
      : undefined;

  const candidates = [
    matched?.status,
    ...orders.map((o) => o.status),
    data.status,
  ].filter((s): s is string => Boolean(s && String(s).trim()));

  if (candidates.length === 0) return '';

  let best = candidates[0];
  let bestRank = providerStatusRank(best);
  for (const candidate of candidates.slice(1)) {
    const rank = providerStatusRank(candidate);
    if (rank > bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

function resolveSyncedProviderStatus(
  order: IOrder,
  rawStatus: string
): { status: OrderStatus; providerStatus: string; stepLabel: string; stepMessage: string } {
  const normalizedRaw = rawStatus.toLowerCase().replace(/\s+/g, '_');
  const mappedStatus = mapProviderStatus(rawStatus);

  // Exported / verification-submission statuses enter MTN verification display + email.
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

  // Smart Data Hub "pending" must still sync onto TopDeals (keep order in-flight).
  if (mappedStatus === 'pending') {
    return {
      status: 'processing',
      providerStatus: 'pending',
      stepLabel: 'Gateway Processing',
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

async function fetchSmartDataHubStatusForOrder(order: IOrder) {
  const refs = [
    ...new Set(
      [order.providerReference, order.providerBatchId, order.providerOrderId, order.orderId]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    ),
  ];

  let lastError: unknown;
  for (const ref of refs) {
    try {
      return await fetchSmartDataHubBulkStatus(ref);
    } catch (err) {
      lastError = err;
      if (err instanceof SmartDataHubError && err.statusCode === 404) {
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Smart Data Hub status lookup failed');
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

  try {
    const response = await fetchSmartDataHubStatusForOrder(order);
    const payload = response.data;
    const rawStatus = resolveBulkStatus(payload, { phone: order.recipientPhone });
    if (!rawStatus) return order;

    const line =
      payload.orders?.find((o) => {
        const phone = linePhoneDigits(o);
        const want = String(order.recipientPhone || '').replace(/\D/g, '');
        return (
          phone &&
          want &&
          (phone === want || phone.endsWith(want.slice(-9)) || want.endsWith(phone.slice(-9)))
        );
      }) || payload.orders?.[0];

    const resolvedBase = resolveSyncedProviderStatus(order, rawStatus);
    let resolved = resolvedBase;

    // Exported → notify immediately. Plain pending → only after 3 hours in Ghana daytime (7am–9pm).
    if (isExportedStatus(rawStatus)) {
      await applySmartDataHubVerificationOnExported(order);
    } else if (isPlainPendingStatus(rawStatus)) {
      // Ensure pending starts are recorded for the 1-hour clock, then check delay.
      if (order.providerStatus !== 'pending') {
        await applyOrderStatusUpdate(order, {
          status: 'processing',
          providerStatus: 'pending',
          providerBatchId: payload.batch_id || order.providerBatchId,
          providerOrderId: line?.id || order.providerOrderId,
          providerReference: payload.order_number || order.providerReference,
          stepLabel: 'Gateway Processing',
          stepMessage: `Delivery status: ${rawStatus}`,
        });
      }
      if (shouldSendPendingVerificationEmail(order)) {
        await applySmartDataHubVerificationOnExported(order);
        resolved = {
          status: 'processing',
          providerStatus: SUBMITTED_FOR_VERIFICATION,
          stepLabel: 'Submitted for Verification',
          stepMessage:
            'Number still pending after 3 hours — submitted for MTN verification (24–144 hours). Email notification sent.',
        };
      }
    }

    // Avoid rewriting history when nothing meaningful changed.
    if (
      order.status === resolved.status &&
      order.providerStatus === resolved.providerStatus
    ) {
      return order;
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
    console.error(
      '[Smart Data Hub sync failed]',
      order.orderId,
      err instanceof Error ? err.message : err
    );
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
  const isAfa = isAfaProduct(order.productType, order.bundleSize);
  const provider = isAfa
    ? order.fulfillmentProvider ?? (await resolveAfaFulfillmentProvider())
    : order.fulfillmentProvider ?? (await resolveFulfillmentProvider(order.network));
  if (!provider) return order;

  if (provider === 'datamax') return syncFromDatamax(order);
  return syncFromSmartDataHub(order);
}

export async function retryQueuedFulfillmentOrders(limit = 30): Promise<number> {
  // Include AFA orders that never got a Datamax order id (e.g. no funds at submit time).
  const queued = await Order.find({
    status: { $in: ['pending', 'processing'] },
    $or: [
      { providerStatus: { $in: [...QUEUED_PROVIDER_STATUSES] } },
      {
        productType: 'afa',
        $or: [{ providerOrderId: { $exists: false } }, { providerOrderId: null }, { providerOrderId: '' }],
      },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let retried = 0;
  for (const order of queued) {
    const isAfa = isAfaProduct(order.productType, order.bundleSize);
    const provider = isAfa
      ? order.fulfillmentProvider ?? (await resolveAfaFulfillmentProvider())
      : order.fulfillmentProvider ?? (await resolveFulfillmentProvider(order.network));
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
  void retryQueuedFulfillmentOrders(Math.min(limit, 30)).catch((err) => {
    console.error('[retryQueuedFulfillmentOrders]', err instanceof Error ? err.message : err);
  });

  // Prefer Smart Data Hub in-flight MTN orders so exported/pending sync into verification.
  const sdhFirst = await Order.find({
    ...scopeFilter(scope),
    status: { $in: ['pending', 'processing'] },
    fulfillmentProvider: 'smartdatahub',
    providerStatus: {
      $in: [
        'gateway_processing',
        'pending',
        'exported',
        'extracted',
        SUBMITTED_FOR_VERIFICATION,
        'processing',
        'placed',
      ],
    },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  const remaining = Math.max(0, limit - sdhFirst.length);
  const others =
    remaining > 0
      ? await Order.find({
          ...scopeFilter(scope),
          status: { $in: ['pending', 'processing'] },
          _id: { $nin: sdhFirst.map((o) => o._id) },
        })
          .sort({ updatedAt: 1 })
          .limit(remaining)
      : [];

  const orders = [...sdhFirst, ...others];
  const chunkSize = 5;
  for (let i = 0; i < orders.length; i += chunkSize) {
    const chunk = orders.slice(i, i + chunkSize);
    await Promise.all(chunk.map((order) => syncOrderFromProvider(order).catch(() => null)));
  }

  // Also promote aged verification / AFA orders so dashboards stay current without waiting for cron.
  void autoDeliverAgedVerificationOrders(Math.min(limit, 40)).catch((err) => {
    console.error(
      '[autoDeliverAgedVerificationOrders]',
      err instanceof Error ? err.message : err
    );
  });
  void autoDeliverAgedAfaOrders(Math.min(limit, 40)).catch((err) => {
    console.error('[autoDeliverAgedAfaOrders]', err instanceof Error ? err.message : err);
  });
  void sendVerificationEmailsForAgedPendingOrders(Math.min(limit, 30)).catch((err) => {
    console.error(
      '[sendVerificationEmailsForAgedPendingOrders]',
      err instanceof Error ? err.message : err
    );
  });
}

/**
 * After exactly 1 week in "submitted for verification", mark the order delivered
 * (mirrors the end of the MTN verification window when the API has not already delivered).
 */
export async function autoDeliverAgedVerificationOrders(limit = 100): Promise<number> {
  const cutoff = await getVerificationCutoffDate();
  const orders = await Order.find({
    providerStatus: SUBMITTED_FOR_VERIFICATION,
    status: { $in: ['pending', 'processing'] },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  let delivered = 0;
  for (const order of orders) {
    const startedAt = await resolveVerificationStartDate(order);
    if (!startedAt || startedAt > cutoff) continue;

    await applyOrderStatusUpdate(order, {
      status: 'delivered',
      providerStatus: 'delivered',
      stepLabel: 'Delivered',
      stepMessage:
        'Automatically marked delivered after the 1-week MTN verification period.',
    });
    await markBeneficiaryVerified(order.recipientPhone, order.network, order.orderId);
    delivered++;
  }

  await autoVerifyAgedBeneficiaries(limit);
  return delivered;
}

/** When AFA was submitted to Datamax (for the 24-hour auto-deliver clock). */
export function getAfaSubmittedAt(order: IOrder): Date | null {
  if (!isAfaProduct(order.productType, order.bundleSize)) return null;

  const history = [...(order.statusHistory || [])].reverse();
  for (const entry of history) {
    const step = String(entry.step || '').toLowerCase().replace(/\s+/g, '_');
    const label = String(entry.label || '').toLowerCase();
    if (
      step === 'afa_submitted' ||
      label.includes('registration processing') ||
      label.includes('registration submitted')
    ) {
      return entry.at ? new Date(entry.at) : null;
    }
  }

  if (order.providerStatus === 'afa_submitted') {
    return order.updatedAt ? new Date(order.updatedAt) : order.createdAt ? new Date(order.createdAt) : null;
  }
  return null;
}

/**
 * MTN AFA registrations stay on processing after Datamax accept,
 * then are marked delivered exactly AFA_PROCESSING_HOURS (24) later.
 */
export async function autoDeliverAgedAfaOrders(limit = 100): Promise<number> {
  const delayMs = AFA_PROCESSING_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - delayMs);

  const orders = await Order.find({
    productType: 'afa',
    status: 'processing',
    providerStatus: { $in: ['afa_submitted', 'processing', 'gateway_processing'] },
    fulfillmentProvider: 'datamax',
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  let delivered = 0;
  for (const order of orders) {
    const submittedAt = getAfaSubmittedAt(order) || (order.createdAt ? new Date(order.createdAt) : null);
    if (!submittedAt || submittedAt > cutoff) continue;

    await applyOrderStatusUpdate(order, {
      status: 'delivered',
      providerStatus: 'delivered',
      stepLabel: 'Registration Delivered',
      stepMessage: `Automatically marked delivered after ${AFA_PROCESSING_HOURS} hours. Dial ${AFA_CHECK_USSD} if you still need to confirm on the line.`,
    });
    delivered++;
  }
  return delivered;
}

/**
 * MTN orders stuck on Smart Data Hub "pending" for ≥ 3 hours during Ghana daytime (7am–9pm)
 * are marked submitted for verification; buyer gets email + SMS. Overnight pending is left alone.
 */
export async function sendVerificationEmailsForAgedPendingOrders(limit = 50): Promise<number> {
  const candidates = await Order.find({
    network: { $regex: /^mtn$/i },
    fulfillmentProvider: 'smartdatahub',
    providerStatus: 'pending',
    status: { $in: ['pending', 'processing'] },
  })
    .sort({ updatedAt: 1 })
    .limit(Math.max(limit * 3, limit));

  let emailed = 0;
  for (const order of candidates) {
    if (!shouldSendPendingVerificationEmail(order)) continue;

    await applySmartDataHubVerificationOnExported(order);
    await applyOrderStatusUpdate(order, {
      status: 'processing',
      providerStatus: SUBMITTED_FOR_VERIFICATION,
      stepLabel: 'Submitted for Verification',
      stepMessage:
        'Number still pending after 3 hours — submitted for MTN verification (24–144 hours). Email notification sent.',
    });
    emailed++;
    if (emailed >= limit) break;
  }
  return emailed;
}

/** Background job: mirror Smart Data Hub/Datamax statuses and auto-deliver aged verifications. */
export async function runFulfillmentBackgroundSync(limit = 80): Promise<{
  synced: number;
  autoDelivered: number;
  pendingEmails: number;
}> {
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

  const pendingEmails = await sendVerificationEmailsForAgedPendingOrders(40);
  const autoDelivered = await autoDeliverAgedVerificationOrders(100);
  const afaDelivered = await autoDeliverAgedAfaOrders(100);
  return { synced, autoDelivered: autoDelivered + afaDelivered, pendingEmails };
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
  // Retry queued submits, but don't block list sync if the queue is large/slow.
  void retryQueuedFulfillmentOrders(15).catch((err) => {
    console.error('[retryQueuedFulfillmentOrders]', err instanceof Error ? err.message : err);
  });

  const inFlight = orders
    .filter((o) => ['pending', 'processing'].includes(o.status))
    .sort((a, b) => {
      const rank = (o: IOrder) => {
        const ps = String(o.providerStatus || '');
        if (o.fulfillmentProvider === 'smartdatahub') {
          if (['gateway_processing', 'pending', 'exported', SUBMITTED_FOR_VERIFICATION].includes(ps)) {
            return 0;
          }
          return 1;
        }
        return 2;
      };
      return rank(a) - rank(b);
    })
    .slice(0, 25);

  const chunkSize = 5;
  for (let i = 0; i < inFlight.length; i += chunkSize) {
    const chunk = inFlight.slice(i, i + chunkSize);
    await Promise.all(chunk.map((order) => syncOrderFromProvider(order).catch(() => null)));
  }

  void autoDeliverAgedVerificationOrders(20).catch(() => {});
  void autoDeliverAgedAfaOrders(20).catch(() => {});
  void sendVerificationEmailsForAgedPendingOrders(20).catch(() => {});
}

export function verifyFulfillmentWebhookSignature(payload: string, signature: string): boolean {
  if (!env.fulfillment.webhookSecret) return true;

  const secret = env.fulfillment.webhookSecret.trim();
  const providedRaw = signature.trim();
  const provided = providedRaw
    .replace(/^sha256=/i, '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  // Some providers send the shared secret directly (Bearer / plain header).
  if (secureCompare(provided, secret) || secureCompare(providedRaw, secret)) {
    return true;
  }

  const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (secureCompare(hash, provided)) return true;

  // Also try hex digest of secret||payload variants used by some gateways.
  const hashSecretFirst = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('base64');
  return secureCompare(hashSecretFirst, provided);
}

function unwrapWebhookBody(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...body, ...(data as Record<string, unknown>) };
  }
  const order = body.order;
  if (order && typeof order === 'object' && !Array.isArray(order)) {
    return { ...body, ...(order as Record<string, unknown>) };
  }
  return body;
}

function asWebhookRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectWebhookRefs(payload: Record<string, unknown>): string[] {
  const refs = [
    payload.reference,
    payload.orderId,
    payload.order_id,
    payload.orderNumber,
    payload.order_number,
    payload.order_reference,
    payload.orderReference,
    payload.external_reference,
    payload.externalOrderId,
    payload.client_reference,
    payload.request_id,
    payload.provider_reference,
    payload.api_reference,
    payload.order_api_reference,
    payload.order_api_ref,
    payload.batch_id,
    payload.batchId,
    payload.transaction_id,
    payload.transactionId,
    payload.id,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const orders = Array.isArray(payload.orders) ? payload.orders : [];
  for (const raw of orders) {
    const line = asWebhookRecord(raw);
    if (!line) continue;
    for (const key of [
      'id',
      'order_number',
      'orderNumber',
      'order_reference',
      'order_api_reference',
      'order_api_ref',
      'reference',
      'batch_id',
      'external_reference',
    ]) {
      const value = String(line[key] || '').trim();
      if (value) refs.push(value);
    }
  }

  return [...new Set(refs)];
}

function phoneVariants(raw: string): string[] {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 9) return [];
  const out = new Set<string>([digits]);
  if (digits.startsWith('233') && digits.length >= 12) {
    out.add(`0${digits.slice(3)}`);
    out.add(digits.slice(3));
  }
  if (digits.startsWith('0') && digits.length === 10) {
    out.add(`233${digits.slice(1)}`);
    out.add(digits.slice(1));
  }
  if (!digits.startsWith('0') && !digits.startsWith('233') && digits.length === 9) {
    out.add(`0${digits}`);
    out.add(`233${digits}`);
  }
  return [...out];
}

function collectWebhookPhones(payload: Record<string, unknown>): string[] {
  const phones = [
    payload.phone_number,
    payload.beneficiary_number,
    payload._beneficiary_number,
    payload.recipientPhone,
    payload.phone,
    payload.msisdn,
    payload.customer_phone,
  ]
    .flatMap((v) => phoneVariants(String(v || '')));

  const orders = Array.isArray(payload.orders) ? payload.orders : [];
  for (const raw of orders) {
    const line = asWebhookRecord(raw);
    if (!line) continue;
    for (const key of [
      'phone_number',
      'beneficiary_number',
      '_beneficiary_number',
      'phone',
      'msisdn',
    ]) {
      phones.push(...phoneVariants(String(line[key] || '')));
    }
  }

  return [...new Set(phones)];
}

function extractWebhookStatus(payload: Record<string, unknown>): string {
  const orders = (Array.isArray(payload.orders) ? payload.orders : [])
    .map((raw) => asWebhookRecord(raw))
    .filter((line): line is Record<string, unknown> => Boolean(line))
    .map((line) => ({
      status: String(
        line.status ||
          line.order_status ||
          line.delivery_status ||
          line.transaction_status ||
          line.newStatus ||
          line.new_status ||
          ''
      ).trim(),
      phone_number: String(
        line.phone_number || line.beneficiary_number || line._beneficiary_number || line.phone || ''
      ),
    }));

  // Prefer strongest line-item status over a stale batch-level pending.
  return resolveBulkStatus({
    status: String(
      payload.status ||
        payload.order_status ||
        payload.delivery_status ||
        payload.transaction_status ||
        payload.newStatus ||
        payload.new_status ||
        payload.state ||
        ''
    ).trim(),
    orders,
  });
}

async function findOrderForWebhook(payload: Record<string, unknown>): Promise<IOrder | null> {
  const refs = collectWebhookRefs(payload);
  if (refs.length > 0) {
    const order = await Order.findOne({
      $or: [
        { orderId: { $in: refs } },
        { orderNumber: { $in: refs } },
        { providerOrderId: { $in: refs } },
        { providerReference: { $in: refs } },
        { providerBatchId: { $in: refs } },
      ],
    }).sort({ updatedAt: -1 });
    if (order) return order;
  }

  const phones = collectWebhookPhones(payload);
  for (const phone of phones) {
    const phoneTail = phone.slice(-9);
    const order = await Order.findOne({
      status: { $in: ['pending', 'processing'] },
      $or: [
        { recipientPhone: phone },
        { recipientPhone: phoneTail },
        { recipientPhone: { $regex: `${phoneTail}$` } },
      ],
    }).sort({ updatedAt: -1 });
    if (order) return order;
  }

  return null;
}

/** Summarize an inbound SDH/fulfillment webhook for admin inbox / debugging. */
export function summarizeFulfillmentWebhookPayload(body: Record<string, unknown>) {
  const payload = unwrapWebhookBody(body);
  return {
    keys: Object.keys(payload).slice(0, 30),
    refs: collectWebhookRefs(payload).slice(0, 10),
    phones: collectWebhookPhones(payload).slice(0, 5),
    status: extractWebhookStatus(payload) || undefined,
  };
}

export async function handleFulfillmentWebhook(body: Record<string, unknown>) {
  const payload = unwrapWebhookBody(body);
  const summary = summarizeFulfillmentWebhookPayload(body);
  console.log('[fulfillment webhook] received', JSON.stringify(summary));

  const order = await findOrderForWebhook(payload);
  if (!order) throw new Error('Order not found');

  const rawStatus = summary.status || '';
  if (!rawStatus) {
    console.warn('[fulfillment webhook] no status in payload for', order.orderId);
    return order;
  }

  let resolved = resolveSyncedProviderStatus(order, rawStatus);
  const line =
    (Array.isArray(payload.orders) ? payload.orders : [])
      .map((raw) => asWebhookRecord(raw))
      .find((entry) => entry && String(entry.status || '').trim()) || null;

  const nextProviderOrderId = String(
    line?.id || payload.provider_order_id || payload.order_id || order.providerOrderId || ''
  );
  const nextProviderBatchId = String(
    payload.batch_id || payload.batchId || order.providerBatchId || ''
  );
  const nextProviderReference = String(
    payload.provider_reference ||
      payload.order_api_reference ||
      payload.order_number ||
      payload.orderNumber ||
      payload.request_id ||
      order.providerReference ||
      ''
  );

  if (order.fulfillmentProvider === 'smartdatahub' || !order.fulfillmentProvider) {
    if (isExportedStatus(rawStatus)) {
      await applySmartDataHubVerificationOnExported(order);
    } else if (isPlainPendingStatus(rawStatus)) {
      if (order.providerStatus !== 'pending') {
        await applyOrderStatusUpdate(order, {
          status: 'processing',
          providerStatus: 'pending',
          providerOrderId: nextProviderOrderId,
          providerBatchId: nextProviderBatchId,
          providerReference: nextProviderReference,
          stepLabel: 'Gateway Processing',
          stepMessage: `Delivery status: ${rawStatus}`,
        });
      }
      if (shouldSendPendingVerificationEmail(order)) {
        await applySmartDataHubVerificationOnExported(order);
        resolved = {
          status: 'processing',
          providerStatus: SUBMITTED_FOR_VERIFICATION,
          stepLabel: 'Submitted for Verification',
          stepMessage:
            'Number still pending after 3 hours — submitted for MTN verification (24–144 hours). Email notification sent.',
        };
      }
    }
  }

  if (
    order.status === resolved.status &&
    order.providerStatus === resolved.providerStatus
  ) {
    return order;
  }

  const updated = await applyOrderStatusUpdate(order, {
    status: resolved.status,
    providerStatus: resolved.providerStatus,
    providerOrderId: nextProviderOrderId,
    providerBatchId: nextProviderBatchId,
    providerReference: nextProviderReference,
    stepLabel: resolved.stepLabel,
    stepMessage: resolved.stepMessage,
  });

  if (
    resolved.status === 'delivered' &&
    (order.fulfillmentProvider === 'smartdatahub' || !order.fulfillmentProvider)
  ) {
    await markBeneficiaryVerified(order.recipientPhone, order.network, order.orderId);
  }

  console.log(
    '[fulfillment webhook] updated',
    updated.orderId,
    `${order.status}/${order.providerStatus} -> ${updated.status}/${updated.providerStatus}`
  );

  return updated;
}
