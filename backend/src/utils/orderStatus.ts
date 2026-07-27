import { OrderStatus } from '../models/Order';

const VALID_STATUSES = new Set<OrderStatus>([
  'pending',
  'processing',
  'delivered',
  'failed',
  'refunded',
  'cancelled',
]);

export function isValidOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value as OrderStatus);
}

/** Map provider gateway states to a stored order status when the main status is missing. */
export function inferOrderStatusFromProvider(providerStatus?: string | null): OrderStatus | null {
  if (!providerStatus?.trim()) return null;
  const p = providerStatus.toLowerCase().replace(/\s+/g, '_');
  if (['delivered', 'completed', 'success', 'successful'].includes(p)) return 'delivered';
  if (['failed', 'error', 'rejected', 'submit_failed'].includes(p)) return 'failed';
  if (['cancelled', 'canceled'].includes(p)) return 'cancelled';
  if (p === 'refunded') return 'refunded';
  if (
    [
      'gateway_processing',
      'submitting_to_api',
      'submitting',
      'processing',
      'in_progress',
      'placed',
      'extracted',
      'submitted_for_verification',
      'awaiting_verification',
      'verification_pending',
      'unverified',
      'verified',
    ].includes(p)
  ) {
    return 'processing';
  }
  if (p === 'awaiting_provider_balance') return 'pending';
  return null;
}

export function normalizeOrderStatus(
  status?: string | null,
  providerStatus?: string | null
): OrderStatus {
  if (isValidOrderStatus(status)) return status;
  return inferOrderStatusFromProvider(providerStatus) ?? 'pending';
}
