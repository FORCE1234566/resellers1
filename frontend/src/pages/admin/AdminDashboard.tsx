import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';

import { api } from '@/lib/api';

import DashboardLayout from '@/components/layout/DashboardLayout';

import { StatCard } from '@/components/ui/Card';

import { formatCurrency } from '@/lib/utils';

import {

  Users,

  Store,

  ShoppingCart,

  DollarSign,

  MessageSquare,

  Wallet,

  ArrowRight,

  Calendar,

  ClipboardList,

  Clock,

  Settings,

  CheckCircle,

  XCircle,

  AlertCircle,

} from 'lucide-react';

import { Link, useNavigate } from 'react-router';

import Button from '@/components/ui/Button';

import AdminOrderExportMenu from '@/components/admin/AdminOrderExportMenu';

import { cn } from '@/lib/utils';
import DashboardInsights from '@/components/dashboard/DashboardInsights';
import { GrowthPoint } from '@/components/dashboard/GrowthAreaChart';
import { formatOrderStatusLabel, statusBadgeClass } from '@/lib/order-status';
import AdminRewardModal from '@/components/admin/AdminRewardModal';
import AdminFinanceSummary from '@/components/admin/AdminFinanceSummary';
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
import {
  DashboardPanel,
  DashboardPanelEmpty,
  DashboardListItem,
} from '@/components/dashboard/DashboardPanel';
import { networkPillClass } from '@/lib/network-style';
import { Trophy } from 'lucide-react';

type PerformerRow = {
  rank: number;
  rankLabel: string;
  userId: string;
  fullName: string;
  orderCount: number;
  revenue: number;
  platformProfit: number;
};

type RewardTarget = {
  role: 'agent' | 'reseller';
  userId: string;
  fullName: string;
};



interface ComplaintPreview {

  _id: string;

  orderId: string;

  phoneNumber: string;

  status: string;

  createdAt: string;

  userId?: { fullName: string };

}



interface OrderPreview {

  _id: string;

  orderId: string;

  recipientPhone: string;

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

}

function orderPartyLabel(o: OrderPreview) {
  if (o.source === 'reseller_store') return o.storeName || o.resellerName || 'Reseller';
  return o.AgentName || 'agent';
}

const formatOrderDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });



export default function AdminDashboard() {

  const { user, loading } = useAuth();

  const navigate = useNavigate();

  const [stats, setStats] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading] = useState(true);

  const [growthChart, setGrowthChart] = useState<GrowthPoint[]>([]);

  const [recentComplaints, setRecentComplaints] = useState<ComplaintPreview[]>([]);

  const [recentOrders, setRecentOrders] = useState<OrderPreview[]>([]);
  const [topAgents, setTopAgents] = useState<PerformerRow[]>([]);
  const [topResellers, setTopResellers] = useState<PerformerRow[]>([]);
  const [rewardTarget, setRewardTarget] = useState<RewardTarget | null>(null);

  useEffect(() => {

    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');

  }, [user, loading, navigate]);



  const loadDashboard = useCallback(async (refresh = false) => {
    setStatsLoading(true);
    try {
      const dashRes = await api.get('/admin/dashboard', {
        params: refresh ? { refresh: 1 } : undefined,
      });
      const data = dashRes.data.data;
      setStats(data);
      setGrowthChart(data.growthChart || []);
      setTopAgents(data.topPerformers?.agents || data.topPerformers?.dealers || []);
      setTopResellers(data.topPerformers?.resellers || []);
      setRecentComplaints(data.recentComplaints || []);
      setRecentOrders(data.recentOrders || []);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadDashboard().catch(console.error);
    }
  }, [user, loadDashboard]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadDashboard().catch(console.error);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user, loadDashboard]);



  if (loading || !user) return null;



  return (

    <DashboardLayout role="admin">

      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Admin Dashboard</h1>

      <p className="text-sm text-gray-400 mb-6">Platform overview — Agents, resellers, orders &amp; payouts</p>

      {statsLoading && Object.keys(stats).length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : null}

      <AdminFinanceSummary
        platformProfitToday={stats.platformProfitToday || 0}
        totalPlatformProfit={stats.totalPlatformProfit || 0}
        apiCostToday={stats.apiCostToday || 0}
        totalApiCostDeducted={stats.totalApiCostDeducted || 0}
        withdrawalPoolBalance={stats.withdrawalPoolBalance || 0}
        recommendedPoolTopUp={stats.recommendedPoolTopUp || 0}
        poolShortfall={stats.poolShortfall || 0}
        totalResellerProfitOwed={stats.totalResellerProfitOwed || 0}
        pendingWithdrawalTotal={stats.pendingWithdrawalTotal || 0}
      />

      <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Order activity</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        <Link to="/admin/orders" className="block">

          <StatCard title="Orders Today" value={stats.ordersToday || 0} subtitle="orders" icon={<Calendar />} color="blue" />

        </Link>

        <Link to="/admin/orders" className="block">

          <StatCard title="Orders This Week" value={stats.ordersThisWeek || 0} subtitle="orders" icon={<ClipboardList />} color="slate" />

        </Link>

        <Link to="/admin/orders" className="block">

          <StatCard title="Orders This Month" value={stats.ordersThisMonth || 0} subtitle="orders" icon={<ClipboardList />} color="cyan" />

        </Link>

        <StatCard title="Pending Orders" value={stats.pendingOrders || 0} subtitle="orders" icon={<Clock />} color="amber" />

      </div>



      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">

        <StatCard title="Processing" value={stats.processingOrders || 0} subtitle="orders" icon={<Settings />} color="sky" />

        <StatCard title="Delivered" value={stats.deliveredOrders || 0} subtitle="orders" icon={<CheckCircle />} color="emerald" />

        <StatCard title="Cancelled" value={stats.cancelledOrders || 0} subtitle="orders" icon={<XCircle />} color="slate" />

        <StatCard title="Failed" value={stats.failedOrders || 0} subtitle="orders" icon={<AlertCircle />} color="rose" />

        <Link to="/admin/complaints" className="block">

          <StatCard title="Complaints" value={stats.pendingComplaints || 0} subtitle="open" icon={<MessageSquare />} color="orange" />

        </Link>

      </div>

      <DashboardInsights
        growthChart={growthChart}
        stats={stats}
        chartTitle="Purchase Activity"
        chartSubtitle="Last 14 days — platform-wide orders and revenue"
        amountLabel="Revenue"
        ordersLink="/admin/orders"
        accent="amber"
      />

      <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Platform &amp; finance</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">

        <StatCard title="Total Agents" value={stats.totalAgents ?? stats.totalDealers ?? 0} subtitle="accounts" icon={<Users />} color="blue" />

        <StatCard title="Total Resellers" value={stats.totalResellers || 0} subtitle="accounts" icon={<Users />} color="purple" />

        <StatCard title="Active Stores" value={stats.activeResellerStores || 0} subtitle="live" icon={<Store />} color="green" />

        <StatCard title="Total Revenue" value={formatCurrency(stats.totalRevenue || 0)} subtitle="all time" icon={<DollarSign />} color="gold" />

        <StatCard title="Wallet Deposits" value={formatCurrency(stats.walletDeposits || 0)} subtitle="Agent top-ups" icon={<Wallet />} color="cyan" />

        <Link to="/admin/withdrawals" className="block">

          <StatCard title="Pending Withdrawals" value={stats.pendingWithdrawals || 0} subtitle="requests" icon={<Wallet />} color="amber" />

        </Link>

        <StatCard
          title="Reseller Profit Owed"
          value={formatCurrency(stats.totalResellerProfitOwed || 0)}
          subtitle="in reseller wallets"
          icon={<DollarSign />}
          color="purple"
        />

      </div>



      <div className="grid lg:grid-cols-2 gap-5 mb-8">
        <DashboardPanel title="Top Agents this month" icon={Trophy} accent="amber">
          {topAgents.length === 0 ? (
            <DashboardPanelEmpty message="No delivered orders yet" accent="amber" icon={Trophy} />
          ) : (
            <ul>
              {topAgents.map((d) => (
                <DashboardListItem key={d.userId} accentStripe="bg-amber-400">
                  <div className="min-w-0 pl-2">
                    <p className="text-sm font-medium text-white">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 mr-2 rounded-md bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
                        {d.rankLabel}
                      </span>
                      {d.fullName}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 pl-0.5">
                      <span className="text-emerald-400 font-semibold">{d.orderCount}</span> orders
                      <span className="text-gray-600 mx-1.5">·</span>
                      <span className="text-gold font-medium">{formatCurrency(d.revenue)}</span> revenue
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10 shrink-0"
                    onClick={() => setRewardTarget({ role: 'agent', userId: d.userId, fullName: d.fullName })}
                  >
                    Reward
                  </Button>
                </DashboardListItem>
              ))}
            </ul>
          )}
        </DashboardPanel>

        <DashboardPanel title="Top resellers this month" icon={Trophy} accent="purple">
          {topResellers.length === 0 ? (
            <DashboardPanelEmpty message="No delivered orders yet" accent="purple" icon={Trophy} />
          ) : (
            <ul>
              {topResellers.map((r) => (
                <DashboardListItem key={r.userId} accentStripe="bg-purple-400">
                  <div className="min-w-0 pl-2">
                    <p className="text-sm font-medium text-white">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 mr-2 rounded-md bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/30">
                        {r.rankLabel}
                      </span>
                      {r.fullName}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 pl-0.5">
                      <span className="text-emerald-400 font-semibold">{r.orderCount}</span> orders
                      <span className="text-gray-600 mx-1.5">·</span>
                      <span className="text-gold font-medium">{formatCurrency(r.revenue)}</span> revenue
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 shrink-0"
                    onClick={() => setRewardTarget({ role: 'reseller', userId: r.userId, fullName: r.fullName })}
                  >
                    Reward
                  </Button>
                </DashboardListItem>
              ))}
            </ul>
          )}
        </DashboardPanel>
      </div>

      <PanelTable className="mb-8">
        <PanelTableHeader
          title="Recent orders"
          subtitle="Agents & reseller stores"
          actions={
            <>
              <AdminOrderExportMenu />
              <Link to="/admin/orders">
                <Button size="sm" variant="outline">
                  View all <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </>
          }
        />
        {recentOrders.length === 0 ? (
          <PanelTableEmpty
            message="No orders yet"
            icon={<ShoppingCart className="w-10 h-10 text-gray-300 mb-3" />}
          />
        ) : (
          <PanelTableScroll minWidth={920}>
            <thead className={panelTableHeadClass}>
              <tr>
                <th className={panelTableTh()}>Order ID</th>
                <th className={panelTableTh()}>Bundle</th>
                <th className={panelTableTh()}>Phone</th>
                <th className={panelTableTh()}>Party</th>
                <th className={panelTableTh()}>Amount</th>
                <th className={panelTableTh()}>Status</th>
                <th className={panelTableTh()}>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o._id} className={panelTableRowClass}>
                  <td className={cn(panelTableCellClass, 'font-mono text-xs text-gray-700')}>{o.orderId}</td>
                  <td className={panelTableCellClass}>
                    <span className={networkPillClass(o.network)}>{o.network}</span>
                    <span className="ml-2 font-medium text-gray-900">{o.bundleSize}</span>
                  </td>
                  <td className={cn(panelTableCellClass, 'text-gray-700')}>{o.recipientPhone}</td>
                  <td className={panelTableCellClass}>
                    <p className="font-medium text-gray-900">{orderPartyLabel(o)}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{o.source?.replace('_', ' ') ?? '—'}</p>
                  </td>
                  <td className={cn(panelTableCellClass, 'font-semibold text-emerald-700')}>
                    {formatCurrency(o.sellingPrice)}
                  </td>
                  <td className={panelTableCellClass}>
                    <span
                      className={cn(
                        'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border capitalize',
                        statusBadgeClass(o.status, o.providerStatus)
                      )}
                    >
                      {formatOrderStatusLabel(o.status, o.providerStatus)}
                    </span>
                  </td>
                  <td className={cn(panelTableCellClass, 'text-gray-600 whitespace-nowrap text-xs')}>
                    {formatOrderDate(o.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </PanelTableScroll>
        )}
      </PanelTable>

      <PanelTable>
        <PanelTableHeader
          title="Recent complaints"
          subtitle="Open issues from resellers"
          actions={
            <Link to="/admin/complaints">
              <Button size="sm" variant="outline">
                View all <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          }
        />
        {recentComplaints.length === 0 ? (
          <PanelTableEmpty
            message="No open complaints"
            icon={<MessageSquare className="w-10 h-10 text-gray-300 mb-3" />}
          />
        ) : (
          <PanelTableScroll minWidth={640}>
            <thead className={panelTableHeadClass}>
              <tr>
                <th className={panelTableTh()}>Phone</th>
                <th className={panelTableTh()}>Order ID</th>
                <th className={panelTableTh()}>From</th>
                <th className={panelTableTh()}>Status</th>
                <th className={panelTableTh()}>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentComplaints.map((c) => (
                <tr key={c._id} className={panelTableRowClass}>
                  <td className={cn(panelTableCellClass, 'font-medium text-gray-900')}>{c.phoneNumber}</td>
                  <td className={cn(panelTableCellClass, 'font-mono text-xs text-gray-600')}>{c.orderId}</td>
                  <td className={cn(panelTableCellClass, 'text-gray-700')}>{c.userId?.fullName || 'Reseller'}</td>
                  <td className={panelTableCellClass}>
                    <span className="text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full capitalize">
                      {(c.status || 'pending').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={cn(panelTableCellClass, 'text-gray-600 text-xs whitespace-nowrap')}>
                    {formatOrderDate(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </PanelTableScroll>
        )}
      </PanelTable>

      {rewardTarget && (
        <AdminRewardModal
          role={rewardTarget.role}
          userId={rewardTarget.userId}
          fullName={rewardTarget.fullName}
          onClose={() => setRewardTarget(null)}
          onSuccess={() => loadDashboard(true).catch(console.error)}
        />
      )}

    </DashboardLayout>

  );

}

