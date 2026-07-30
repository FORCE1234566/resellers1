import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import AdminSearchBar from '@/components/admin/AdminSearchBar';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatCurrency, cn } from '@/lib/utils';
import { formatOrderStatusLabel, statusBadgeClass } from '@/lib/order-status';
import { networkPillClass } from '@/lib/network-style';
import {
  Loader2,
  Store,
  ShoppingCart,
  LineChart,
  Users,
  Phone,
  Mail,
} from 'lucide-react';
import OrderTrackingModal from '@/components/orders/OrderTrackingModal';
import {
  DashboardPanel,
  DashboardPanelEmpty,
  DashboardListItem,
} from '@/components/dashboard/DashboardPanel';

type ResellerHit = {
  _id: string;
  fullName: string;
  email: string;
  phone: string;
  storeName?: string;
  storeSlug?: string;
  storeActive?: boolean;
  profitBalance: number;
};

type OrderHit = {
  _id: string;
  orderId: string;
  recipientPhone: string;
  customerEmail?: string;
  network: string;
  bundleSize: string;
  status: string;
  providerStatus?: string;
  source: string;
  sellingPrice: number;
  AgentName?: string;
  resellerName?: string;
  storeName?: string;
  createdAt: string;
};

export default function AdminSearchPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() || '';

  const [resellers, setResellers] = useState<ResellerHit[]>([]);
  const [orders, setOrders] = useState<OrderHit[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState('');
  const [trackOrderId, setTrackOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const runSearch = useCallback(async () => {
    if (q.length < 2) {
      setResellers([]);
      setOrders([]);
      setError('');
      return;
    }
    setPageLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/search', { params: { q } });
      setResellers(res.data.data.resellers || []);
      setOrders(res.data.data.orders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResellers([]);
      setOrders([]);
    } finally {
      setPageLoading(false);
    }
  }, [q]);

  useEffect(() => {
    if (user?.role === 'admin') runSearch();
  }, [user, runSearch]);

  if (loading || !user) return null;

  const total = resellers.length + orders.length;

  return (
    <DashboardLayout role="admin">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Search</h1>
      <p className="text-sm text-gray-400 mb-4">
        Find resellers by name, email, or store · orders by ID or phone number
      </p>

      <AdminSearchBar className="mb-6 max-w-2xl" />

      {q.length > 0 && q.length < 2 && (
        <p className="text-sm text-amber-400 mb-4">Enter at least 2 characters to search.</p>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">
          {error}
        </p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Searching…
        </div>
      ) : q.length >= 2 ? (
        <>
          <p className="text-xs text-gray-500 mb-4">
            {total === 0
              ? `No results for “${q}”`
              : `${total} result${total === 1 ? '' : 's'} for “${q}”`}
          </p>

          <div className="grid lg:grid-cols-2 gap-5 mb-8">
            <DashboardPanel
              title="Resellers"
              subtitle={`${resellers.length} match${resellers.length === 1 ? '' : 'es'}`}
              icon={Users}
              accent="purple"
              actions={
                <Link to="/admin/resellers">
                  <Button size="sm" variant="outline" className="border-purple-500/30 text-purple-300">
                    All resellers
                  </Button>
                </Link>
              }
            >
              {resellers.length === 0 ? (
                <DashboardPanelEmpty message="No resellers match this search" accent="purple" icon={Store} />
              ) : (
                <ul>
                  {resellers.map((r) => (
                    <DashboardListItem key={r._id} accentStripe="bg-purple-400">
                      <div className="min-w-0 pl-2 flex-1">
                        <p className="text-sm font-semibold text-white">{r.fullName}</p>
                        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                          <Mail className="w-3 h-3 shrink-0" />
                          {r.email}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                          <Phone className="w-3 h-3 shrink-0" />
                          {r.phone}
                        </p>
                        {r.storeName && (
                          <p className="text-xs text-purple-300 mt-1">
                            {r.storeName}
                            {r.storeSlug && (
                              <span className="text-gray-500"> · /store/{r.storeSlug}</span>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-emerald-400 mt-1 font-medium">
                          Withdrawable {formatCurrency(r.profitBalance)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0',
                          r.storeActive
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        )}
                      >
                        {r.storeActive ? 'Store on' : 'Store off'}
                      </span>
                    </DashboardListItem>
                  ))}
                </ul>
              )}
            </DashboardPanel>

            <DashboardPanel
              title="Orders"
              subtitle={`${orders.length} match${orders.length === 1 ? '' : 'es'}`}
              icon={ShoppingCart}
              accent="orange"
              actions={
                <Link to={`/admin/orders${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
                  <Button size="sm" variant="outline" className="border-orange-500/30 text-orange-300">
                    All orders
                  </Button>
                </Link>
              }
            >
              {orders.length === 0 ? (
                <DashboardPanelEmpty message="No orders match this search" accent="orange" icon={ShoppingCart} />
              ) : (
                <ul>
                  {orders.map((o) => (
                    <DashboardListItem key={o._id} accentStripe="bg-orange-400">
                      <div className="min-w-0 pl-2 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={networkPillClass(o.network)}>{o.network}</span>
                          <span className="font-mono text-xs text-gray-300">{o.orderId}</span>
                        </div>
                        <p className="text-sm text-white">
                          {o.bundleSize} → <span className="text-gold">{o.recipientPhone}</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-1 capitalize">
                          {o.source?.replace('_', ' ')}
                          {' · '}
                          {o.storeName || o.resellerName || o.AgentName || '—'}
                          {' · '}
                          {formatCurrency(o.sellingPrice)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span
                          className={cn(
                            'text-xs font-semibold px-2 py-0.5 rounded-full border capitalize',
                            statusBadgeClass(o.status, o.providerStatus)
                          )}
                        >
                          {formatOrderStatusLabel(o.status, o.providerStatus)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-orange-500/30 text-orange-300"
                          onClick={() => setTrackOrderId(o.orderId)}
                        >
                          <LineChart className="w-4 h-4" />
                          Track
                        </Button>
                      </div>
                    </DashboardListItem>
                  ))}
                </ul>
              )}
            </DashboardPanel>
          </div>
        </>
      ) : (
        <Card className="p-8 text-center text-gray-500 text-sm">
          Use the search box above to find resellers, phone numbers, or order IDs.
        </Card>
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
