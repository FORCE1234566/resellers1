import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
} from '@/components/ui/PanelTable';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, ShoppingCart, LineChart } from 'lucide-react';
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
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function ResellerOrdersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all');
  const [trackOrderId, setTrackOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');
  }, [user, loading, navigate]);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setPageLoading(true);
    else setRefreshing(true);

    try {
      const { data } = await api.get('/reseller/orders');
      setOrders(data.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setPageLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'reseller') loadOrders();
  }, [user, loadOrders]);

  useEffect(() => {
    if (user?.role !== 'reseller') return;
    const interval = setInterval(() => loadOrders(true), 15000);
    return () => clearInterval(interval);
  }, [user, loadOrders]);

  const filteredOrders = useMemo(
    () =>
      orders.filter((order) =>
        matchesStatusFilter(order.status, order.providerStatus, statusFilter)
      ),
    [orders, statusFilter]
  );

  if (loading || !user) return null;

  return (
    <DashboardLayout role="reseller">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Store Orders</h1>
          <p className="text-sm text-gray-400">
            Delivery statuses sync from your fulfillment provider in real time
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadOrders(true)}
          disabled={refreshing}
          className="w-full sm:w-auto"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <OrderStatusFilters value={statusFilter} onChange={setStatusFilter} />

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">
          {error}
        </p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading orders...
        </div>
      ) : filteredOrders.length === 0 ? (
        <Card className="p-10 text-center">
          <ShoppingCart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">No orders found</p>
          <p className="text-sm text-gray-500 mt-2">
            {statusFilter === 'all'
              ? 'When customers buy data from your store link, their orders will appear here.'
              : 'Try another status filter.'}
          </p>
        </Card>
      ) : (
        <PanelTable>
          <PanelTableHeader
            title="Order history"
            subtitle={`${filteredOrders.length} store order${filteredOrders.length === 1 ? '' : 's'}`}
          />
          <MobileDataCardList>
            {filteredOrders.map((order) => (
              <MobileDataCard
                key={order._id}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTrackOrderId(order.orderId)}
                  >
                    <LineChart className="w-4 h-4" />
                    Track
                  </Button>
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
                  <MobileDataCardRow label="Email" value={order.customerEmail || '—'} />
                  <MobileDataCardRow label="Phone" value={order.recipientPhone} />
                  <MobileDataCardRow label="Bundle" value={`${order.network} · ${order.bundleSize}`} />
                  <MobileDataCardRow label="Date" value={formatDate(order.createdAt)} />
                </div>
              </MobileDataCard>
            ))}
          </MobileDataCardList>

          <ScrollTable className="hidden md:block">
            <PanelTableScroll minWidth={820}>
              <thead className={panelTableHeadClass}>
                <tr>
                  <th className={panelTableTh()}>Order ID</th>
                  <th className={panelTableTh()}>Email</th>
                  <th className={panelTableTh()}>Phone</th>
                  <th className={panelTableTh()}>Bundle</th>
                  <th className={panelTableTh()}>Status</th>
                  <th className={panelTableTh()}>Date</th>
                  <th className={panelTableTh()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order._id} className={panelTableRowClass}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{order.orderId}</td>
                    <td className="px-4 py-3 text-gray-700 break-all">{order.customerEmail || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{order.recipientPhone}</td>
                    <td className="px-4 py-3 text-gray-900">
                      {order.network} · {order.bundleSize}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border capitalize',
                          statusBadgeClass(order.status, order.providerStatus)
                        )}
                      >
                        {formatOrderStatusLabel(order.status, order.providerStatus)}
                      </span>
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
        </PanelTable>
      )}

      {trackOrderId && (
        <OrderTrackingModal
          orderId={trackOrderId}
          role="reseller"
          onClose={() => setTrackOrderId(null)}
        />
      )}
    </DashboardLayout>
  );
}
