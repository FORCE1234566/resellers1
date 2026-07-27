import { cn } from '@/lib/utils';

export type OrderStatusFilter =
  | 'all'
  | 'pending'
  | 'submitting'
  | 'processing'
  | 'verification'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export const ORDER_STATUS_FILTERS: { id: OrderStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'submitting', label: 'Submitting to API' },
  { id: 'processing', label: 'Processing' },
  { id: 'verification', label: 'Submitted for Verification' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const STATUS_STYLES: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  processing: 'bg-sky-100 text-sky-800 border-sky-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  refunded: 'bg-violet-100 text-violet-800 border-violet-200',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
  submitting_to_api: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  gateway_processing: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  awaiting_provider_balance: 'bg-orange-100 text-orange-800 border-orange-200',
  submitted_for_verification: 'bg-amber-100 text-amber-900 border-amber-300',
  exported: 'bg-amber-100 text-amber-900 border-amber-300',
  extracted: 'bg-amber-100 text-amber-900 border-amber-300',
  verified: 'bg-teal-100 text-teal-800 border-teal-200',
};

export function formatOrderStatusLabel(status?: string | null, providerStatus?: string) {
  if (status === 'delivered') return 'Delivered';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'refunded') return 'Refunded';

  if (
    providerStatus === 'submitted_for_verification' ||
    providerStatus === 'exported' ||
    providerStatus === 'extracted' ||
    providerStatus === 'awaiting_verification' ||
    providerStatus === 'verification_pending' ||
    providerStatus === 'unverified'
  ) {
    return 'Submitted for verification';
  }
  if (providerStatus === 'verified') {
    return 'Verified';
  }
  if (providerStatus === 'submitting_to_api' || providerStatus === 'submitting') {
    return 'Submitting to API';
  }
  if (providerStatus === 'gateway_processing') {
    return 'Gateway Processing';
  }
  if (providerStatus === 'awaiting_provider_balance') {
    return 'Awaiting Provider Balance';
  }
  if (status === 'processing') {
    return 'Processing';
  }
  if (status) {
    return status.replace(/_/g, ' ');
  }
  if (providerStatus) {
    return providerStatus.replace(/_/g, ' ');
  }
  return 'pending';
}

export function statusBadgeClass(status?: string | null, providerStatus?: string) {
  if (status === 'delivered') return STATUS_STYLES.delivered;
  if (status === 'failed') return STATUS_STYLES.failed;
  if (status === 'cancelled') return STATUS_STYLES.cancelled;
  if (status === 'refunded') return STATUS_STYLES.refunded;
  if (providerStatus && STATUS_STYLES[providerStatus]) {
    return STATUS_STYLES[providerStatus];
  }
  return (status && STATUS_STYLES[status]) || STATUS_STYLES.pending;
}

export function matchesStatusFilter(
  status: string | undefined | null,
  providerStatus: string | undefined,
  filter: OrderStatusFilter
) {
  const normalizedStatus = status || '';
  if (filter === 'all') return true;
  if (filter === 'submitting') {
    return (
      providerStatus === 'submitting_to_api' ||
      providerStatus === 'submitting' ||
      providerStatus === 'awaiting_provider_balance'
    );
  }
  if (filter === 'verification') {
    return (
      providerStatus === 'submitted_for_verification' ||
      providerStatus === 'exported' ||
      providerStatus === 'extracted' ||
      providerStatus === 'awaiting_verification' ||
      providerStatus === 'verification_pending' ||
      providerStatus === 'unverified' ||
      providerStatus === 'verified'
    );
  }
  if (filter === 'processing') {
    return (
      normalizedStatus === 'processing' &&
      providerStatus !== 'submitting_to_api' &&
      providerStatus !== 'awaiting_provider_balance' &&
      providerStatus !== 'submitted_for_verification' &&
      providerStatus !== 'exported' &&
      providerStatus !== 'extracted' &&
      providerStatus !== 'verified'
    );
  }
  return normalizedStatus === filter;
}

export function statusFilterButtonClass(active: boolean) {
  return cn(
    'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition',
    active
      ? 'bg-sky-600 text-white shadow-sm'
      : 'bg-navy-card text-gray-400 border border-navy-border hover:text-white hover:border-sky-500/40'
  );
}
