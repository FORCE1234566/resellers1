import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn, formatCurrency } from '@/lib/utils';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
} from '@/components/ui/PanelTable';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, ShoppingCart, LineChart, Search } from 'lucide-react';
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
  recipientPhone: string;
  network: string;
  bundleSize: string;
  status: string;
  providerStatus?: string;
  providerReference?: string;
  sellingPrice: number;
  source: string;
  createdAt: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function AgentOrdersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all');
  const [trackOrderId, setTrackOrderId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'agent')) navigate('/login/agent');
  }, [user, loading, navigate]);

  const loadOrders = useCallback(async (silent = false, query = activeSearch) => {
    if (!silent) setPageLoading(true);
    else setRefreshing(true);

    try {
      const params =
        query.trim().length >= 2 ? { q: query.trim() } : undefined;
      const { data } = await api.get('/agent/orders', { params });
      setOrders(data.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setPageLoading(false);
      setRefreshing(false);
    }
  }, [activeSearch]);

  const runSearch = () => {
    const next = searchInput.trim();
    if (next.length > 0 && next.length < 2) {
      setError('Enter at least 2 characters to search');
      return;
    }
    setError('');
    setActiveSearch(next);
  };

  const clearSearch = () => {
    setSearchInput('');
    setActiveSearch('');
  };

  useEffect(() => {
    if (user?.role === 'agent') loadOrders(false, activeSearch);
  }, [user, activeSearch, loadOrders]);

  useEffect(() => {
    if (user?.role !== 'agent') return;
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
    <DashboardLayout role="agent">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Orders</h1>
          <p className="text-sm text-gray-400">
            Statuses sync from your fulfillment provider — delivered, processing, and more
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

      <Card className="p-4 mb-4">
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <div className="flex-1 min-w-0">
            <Input
              label="Search orders"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Order ID or phone number (e.g. ORD-… or 0554634719)"
            />
          </div>
          <div className="flex gap-2 sm:items-end shrink-0">
            <Button type="submit" className="w-full sm:w-auto">
              <Search className="w-4 h-4" />
              Search
            </Button>
            {activeSearch && (
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={clearSearch}>
                Clear
              </Button>
            )}
          </div>
        </form>
        {activeSearch.length >= 2 && (
          <p className="text-xs text-gray-500 mt-2">
            Showing results for “{activeSearch}”
          </p>
        )}
      </Card>

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
            {activeSearch.length >= 2
              ? `No orders match “${activeSearch}”. Try another order ID or phone number.`
              : statusFilter === 'all'
                ? 'Orders from Buy Data, Bulk Purchase, or the Developer API appear here.'
                : 'Try another status filter.'}
          </p>
        </Card>
      ) : (
        <PanelTable>
          <PanelTableHeader
            title="Order history"
            subtitle={`${filteredOrders.length} order${filteredOrders.length === 1 ? '' : 's'}`}
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
                  <MobileDataCardRow label="Phone" value={order.recipientPhone} />
                  <MobileDataCardRow label="Bundle" value={`${order.network} · ${order.bundleSize}`} />
                  <MobileDataCardRow label="Amount" value={formatCurrency(order.sellingPrice)} />
                  <MobileDataCardRow label="Source" value={order.source?.replace('_', ' ')} />
                  <MobileDataCardRow label="Date" value={formatDate(order.createdAt)} />
                </div>
              </MobileDataCard>
            ))}
          </MobileDataCardList>

          <ScrollTable className="hidden md:block">
            <PanelTableScroll minWidth={900}>
              <thead className={panelTableHeadClass}>
                <tr>
                  <th className={panelTableTh()}>Order ID</th>
                  <th className={panelTableTh()}>Phone</th>
                  <th className={panelTableTh()}>Bundle</th>
                  <th className={panelTableTh()}>Amount</th>
                  <th className={panelTableTh()}>Source</th>
                  <th className={panelTableTh()}>Status</th>
                  <th className={panelTableTh()}>Date</th>
                  <th className={panelTableTh()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order._id} className={panelTableRowClass}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{order.orderId}</td>
                    <td className="px-4 py-3 text-gray-700">{order.recipientPhone}</td>
                    <td className="px-4 py-3 text-gray-900">
                      {order.network} · {order.bundleSize}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{formatCurrency(order.sellingPrice)}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{order.source?.replace('_', ' ')}</td>
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
          role="agent"
          onClose={() => setTrackOrderId(null)}
        />
      )}
    </DashboardLayout>
  );
}
