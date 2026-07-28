import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import AdminOrderExportMenu from '@/components/admin/AdminOrderExportMenu';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Button from '@/components/ui/Button';
import { cn, formatCurrency } from '@/lib/utils';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  PanelTableEmpty,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
  panelTableCellClass,
} from '@/components/ui/PanelTable';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LineChart, Loader2, RefreshCw } from 'lucide-react';
import OrderStatusFilters from '@/components/orders/OrderStatusFilters';
import OrderTrackingModal from '@/components/orders/OrderTrackingModal';
import ScrollTable from '@/components/ui/ScrollTable';
import { MobileDataCard, MobileDataCardList, MobileDataCardRow } from '@/components/ui/MobileDataCard';
import {
  OrderStatusFilter,
  formatOrderStatusLabel,
  matchesStatusFilter,
  statusBadgeClass,
} from '@/lib/order-status';

interface OrderRow {
  _id: string;
  orderId: string;
  customerEmail?: string;
  recipientPhone: string;
  network: string;
  bundleSize: string;
  status: string;
  providerStatus?: string;
  providerReference?: string;
  source: string;
  sellingPrice: number;
  profit: number;
  platformProfit?: number;
  adminBasePrice?: number;
  costPrice?: number;
  totalAmount: number;
  AgentName?: string;
  resellerName?: string;
  storeName?: string;
  createdAt: string;
}

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'verification', label: 'Verification' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusSelectValue(order: OrderRow): string {
  if (
    order.providerStatus === 'submitted_for_verification' ||
    order.providerStatus === 'exported' ||
    order.providerStatus === 'extracted'
  ) {
    return 'verification';
  }
  if (order.providerStatus === 'verified') return 'processing';
  return order.status;
}

const SOURCE_FILTERS = [
  { value: '', label: 'All sources' },
  { value: 'agent', label: 'agent' },
  { value: 'Agent_api', label: 'Agent API' },
  { value: 'reseller_store', label: 'Reseller store' },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function partyLabel(order: OrderRow) {
  if (order.source === 'reseller_store') {
    return order.storeName || order.resellerName || 'Reseller';
  }
  if (order.source === 'agent' || order.source === 'Agent_api') {
    return order.AgentName || 'agent';
  }
  return '—';
}

export default function AdminOrdersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('q')?.trim() || '';
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [trackOrderId, setTrackOrderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('delivered');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setPageLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 500 };
      if (sourceFilter) params.source = sourceFilter;
      if (searchQuery.length >= 2) params.q = searchQuery;
      const { data } = await api.get('/admin/orders', { params });
      setOrders(data.data.orders);
      setTotal(data.data.total);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setPageLoading(false);
    }
  }, [sourceFilter, searchQuery]);

  useEffect(() => {
    if (user?.role === 'admin') loadOrders();
  }, [user, loadOrders]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const interval = setInterval(() => {
      loadOrders(true).catch(() => undefined);
    }, 15000);
    return () => clearInterval(interval);
  }, [user, loadOrders]);

  const filteredOrders = useMemo(
    () =>
      orders.filter((order) =>
        matchesStatusFilter(order.status, order.providerStatus, statusFilter)
      ),
    [orders, statusFilter]
  );

  const updateStatus = async (orderId: string, status: string) => {
    setUpdatingId(orderId);
    setError('');
    try {
      const { data } = await api.patch(`/admin/orders/${orderId}/status`, { status });
      const updated = data.data as OrderRow;
      setOrders((prev) =>
        prev.map((o) =>
          o.orderId === orderId
            ? {
                ...o,
                status: updated.status || (status === 'verification' ? 'processing' : status),
                providerStatus:
                  updated.providerStatus ||
                  (status === 'verification' ? 'submitted_for_verification' : o.providerStatus),
              }
            : o
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleSelected = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const allFilteredSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((o) => selectedIds.has(o.orderId));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredOrders.map((o) => o.orderId)));
  };

  const applyBulkStatus = async () => {
    const orderIds = [...selectedIds];
    if (orderIds.length === 0) return;

    setBulkUpdating(true);
    setError('');
    try {
      const { data } = await api.patch('/admin/orders/bulk/status', {
        orderIds,
        status: bulkStatus,
      });
      const updatedMap = new Map(
        (
          data.data.orders as Array<{
            orderId: string;
            status: string;
            providerStatus?: string;
          }>
        ).map((o) => [o.orderId, o])
      );
      setOrders((prev) =>
        prev.map((o) => {
          const updated = updatedMap.get(o.orderId);
          if (!updated) return o;
          return {
            ...o,
            status: updated.status,
            providerStatus: updated.providerStatus || o.providerStatus,
          };
        })
      );
      setSelectedIds(new Set());
      await loadOrders(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setBulkUpdating(false);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout role="admin">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">All Orders</h1>
          <p className="text-sm text-gray-400">
            {searchQuery.length >= 2
              ? `Showing orders matching “${searchQuery}” — ${total} found`
              : `Every order from Agents and reseller stores — ${total} total`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => loadOrders()} disabled={pageLoading}>
            <RefreshCw className={cn('w-4 h-4', pageLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Export orders by network</p>
        <AdminOrderExportMenu onError={setError} />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {SOURCE_FILTERS.map((f) => (
          <Button
            key={f.value || 'all'}
            size="sm"
            variant={sourceFilter === f.value ? 'primary' : 'outline'}
            onClick={() => setSourceFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <OrderStatusFilters value={statusFilter} onChange={setStatusFilter} />

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-gold/30 bg-gold/10">
          <p className="text-sm font-medium text-white shrink-0">
            {selectedIds.size} order{selectedIds.size === 1 ? '' : 's'} selected
          </p>
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              disabled={bulkUpdating}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 capitalize text-gray-700 bg-white"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={applyBulkStatus} disabled={bulkUpdating}>
              {bulkUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating…
                </>
              ) : (
                `Apply to ${selectedIds.size}`
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkUpdating}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading orders...
        </div>
      ) : (
        <PanelTable>
          <PanelTableHeader
            title="Order history"
            subtitle={`${filteredOrders.length} of ${total} orders`}
          />
          {filteredOrders.length === 0 ? (
            <PanelTableEmpty message="No orders found" />
          ) : (
            <>
            <MobileDataCardList>
              {filteredOrders.map((order) => (
                <MobileDataCard
                  key={order._id}
                  leading={
                    <input
                      type="checkbox"
                      checked={selectedIds.has(order.orderId)}
                      onChange={() => toggleSelected(order.orderId)}
                      className="w-4 h-4 rounded border-gray-300 text-gold focus:ring-gold/40"
                      aria-label={`Select ${order.orderId}`}
                    />
                  }
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTrackOrderId(order.orderId)}
                      >
                        <LineChart className="w-4 h-4" />
                        Track
                      </Button>
                      <select
                        value={statusSelectValue(order)}
                        disabled={updatingId === order.orderId}
                        onChange={(e) => updateStatus(order.orderId, e.target.value)}
                        className="px-2 py-1.5 rounded-lg text-xs font-medium border border-gray-200 capitalize text-gray-700 bg-white"
                      >
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            Set: {s.label}
                          </option>
                        ))}
                      </select>
                    </>
                  }
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-mono text-xs text-gray-900">{order.orderId}</p>
                    <span
                      className={cn(
                        'inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize shrink-0',
                        statusBadgeClass(order.status, order.providerStatus)
                      )}
                    >
                      {formatOrderStatusLabel(order.status, order.providerStatus)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <MobileDataCardRow label="Party" value={partyLabel(order)} />
                    <MobileDataCardRow label="Phone" value={order.recipientPhone} />
                    <MobileDataCardRow label="Bundle" value={`${order.network} · ${order.bundleSize}`} />
                    <MobileDataCardRow label="Amount" value={formatCurrency(order.sellingPrice || order.totalAmount)} />
                    <MobileDataCardRow label="Admin profit" value={formatCurrency(order.platformProfit ?? 0)} />
                    {order.source === 'reseller_store' && order.profit > 0 && (
                      <MobileDataCardRow label="Reseller profit" value={`+${formatCurrency(order.profit)}`} />
                    )}
                    <MobileDataCardRow label="Source" value={order.source?.replace('_', ' ')} />
                    <MobileDataCardRow label="Date" value={formatDate(order.createdAt)} />
                  </div>
                </MobileDataCard>
              ))}
            </MobileDataCardList>

          <ScrollTable className="hidden md:block">
            <PanelTableScroll minWidth={1200}>
              <thead className={panelTableHeadClass}>
                <tr>
                  <th className={cn(panelTableTh(), 'w-10')}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 text-gold focus:ring-gold/40"
                      aria-label="Select all orders"
                    />
                  </th>
                  <th className={panelTableTh()}>Order ID</th>
                  <th className={panelTableTh()}>Party</th>
                  <th className={panelTableTh()}>Phone</th>
                  <th className={panelTableTh()}>Bundle</th>
                  <th className={panelTableTh()}>Amount</th>
                  <th className={panelTableTh('violet')}>Profit</th>
                  <th className={panelTableTh()}>Source</th>
                  <th className={panelTableTh()}>Status</th>
                  <th className={panelTableTh()}>Date</th>
                  <th className={panelTableTh()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                    <tr
                      key={order._id}
                      className={cn(
                        panelTableRowClass,
                        selectedIds.has(order.orderId) && 'bg-gold/5'
                      )}
                    >
                      <td className={panelTableCellClass}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.orderId)}
                          onChange={() => toggleSelected(order.orderId)}
                          className="w-4 h-4 rounded border-gray-300 text-gold focus:ring-gold/40"
                          aria-label={`Select ${order.orderId}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-900">{order.orderId}</td>
                      <td className="px-4 py-3 text-gray-900">
                        <p className="font-medium">{partyLabel(order)}</p>
                        {order.customerEmail && (
                          <p className="text-xs text-gray-500 break-all">{order.customerEmail}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{order.recipientPhone}</td>
                      <td className="px-4 py-3 text-gray-900">
                        {order.network} · {order.bundleSize}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {formatCurrency(order.sellingPrice || order.totalAmount)}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <span className="text-violet-700 font-medium">Admin: {formatCurrency(order.platformProfit ?? 0)}</span>
                        {order.source === 'reseller_store' && order.profit > 0 && (
                          <span className="block text-emerald-600">Reseller: +{formatCurrency(order.profit)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{order.source?.replace('_', ' ')}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          <span
                            className={cn(
                              'inline-flex w-fit px-2.5 py-1 rounded-full text-xs font-semibold border capitalize',
                              statusBadgeClass(order.status, order.providerStatus)
                            )}
                          >
                            {formatOrderStatusLabel(order.status, order.providerStatus)}
                          </span>
                          <select
                            value={statusSelectValue(order)}
                            disabled={updatingId === order.orderId}
                            onChange={(e) => updateStatus(order.orderId, e.target.value)}
                            className="px-2 py-1 rounded-lg text-xs font-medium border border-gray-200 capitalize text-gray-700 bg-white"
                          >
                            {STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                Set: {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(order.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTrackOrderId(order.orderId)}
                          title="Track delivery"
                        >
                          <LineChart className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </PanelTableScroll>
          </ScrollTable>
            </>
          )}
        </PanelTable>
      )}

      {trackOrderId && (
        <OrderTrackingModal
          orderId={trackOrderId}
          role="admin"
          onClose={() => setTrackOrderId(null)}
        />
      )}
    </DashboardLayout>
  );
}
