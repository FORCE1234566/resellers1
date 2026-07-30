import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';

import { api } from '@/lib/api';

import DashboardLayout from '@/components/layout/DashboardLayout';

import { StatCard, Card } from '@/components/ui/Card';

import Button from '@/components/ui/Button';

import { formatCurrency } from '@/lib/utils';

import {
  Wallet,
  DollarSign,
  ExternalLink,
  Calendar,
  ClipboardList,
  Clock,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Trophy,
} from 'lucide-react';

import { Link, useNavigate } from 'react-router';
import DashboardInsights from '@/components/dashboard/DashboardInsights';
import { GrowthPoint } from '@/components/dashboard/GrowthAreaChart';
import { Settings } from 'lucide-react';

export default function ResellerDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Record<string, string | number>>({});
  const [growthChart, setGrowthChart] = useState<GrowthPoint[]>([]);
  const canShareLink = Boolean(stats.canShareLink);
  const storeUrl = typeof stats.storeUrl === 'string' ? stats.storeUrl : null;



  useEffect(() => {

    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');

  }, [user, loading, navigate]);



  const loadStats = useCallback(async () => {
    const res = await api.get('/reseller/dashboard');
    const data = res.data.data;
    setStats(data);
    setGrowthChart(data.growthChart || []);
  }, []);

  useEffect(() => {
    if (user?.role === 'reseller') loadStats().catch(console.error);
  }, [user, loadStats]);

  useEffect(() => {
    if (user?.role !== 'reseller') return;
    const interval = setInterval(() => loadStats().catch(console.error), 30000);
    return () => clearInterval(interval);
  }, [user, loadStats]);



  if (loading || !user) return null;



  return (

    <DashboardLayout role="reseller">

      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Reseller Dashboard</h1>

      <p className="text-sm text-gray-400 mb-6">Your store performance at a glance</p>



      {canShareLink && storeUrl ? (
        <Card className="p-4 border-amber-200/60 bg-gradient-to-r from-amber-50/90 to-white mb-8 max-w-xl">
          <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-1">Store link</p>
          <p className="font-mono text-sm text-gray-800 truncate mb-3">{storeUrl}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(storeUrl)}>Copy</Button>
            <a href={storeUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary"><ExternalLink className="w-4 h-4" /></Button>
            </a>
            <Link to="/reseller/store"><Button size="sm">Edit store</Button></Link>
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-amber-200/60 bg-gradient-to-r from-amber-50/90 to-white mb-8 max-w-xl">
          <p className="text-sm font-medium text-gray-900 mb-1">Your store is not ready to share yet</p>
          <p className="text-sm text-gray-600 mb-3">
            Set your selling prices for every network, then save your store name on My Store.
          </p>
          <Link to="/reseller/store"><Button size="sm">Set up my store</Button></Link>
        </Card>
      )}

      {Number(stats.subResellerCount) > 0 && (
        <Card className="p-4 border-violet-200/60 bg-gradient-to-r from-violet-50/90 to-white mb-8 max-w-xl">
          <p className="text-sm font-medium text-gray-900 mb-1">
            {Number(stats.subResellerCount)} sub-reseller{Number(stats.subResellerCount) === 1 ? '' : 's'} under you
          </p>
          <p className="text-sm text-gray-600 mb-3">
            Set floor prices and track their stores from My Resellers.
          </p>
          <Link to="/reseller/sub-resellers"><Button size="sm">Manage resellers</Button></Link>
        </Card>
      )}

      {stats.parentStore && typeof stats.parentStore === 'object' && (
        <Card className="p-4 mb-8 max-w-xl border-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Parent store</p>
          <p className="text-sm font-medium text-gray-900">
            {(stats.parentStore as { storeName: string }).storeName}
          </p>
        </Card>
      )}

      <DashboardInsights
        growthChart={growthChart}
        stats={stats as Record<string, number>}
        chartTitle="Sales Growth"
        chartSubtitle="Last 14 days — orders and profit"
        amountLabel="Profit"
        ordersLink="/reseller/orders"
        accent="emerald"
      />

      <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Order activity</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">

        <StatCard title="Orders Today" value={Number(stats.ordersToday) || 0} subtitle="orders" icon={<Calendar />} color="blue" />

        <StatCard title="Orders This Week" value={Number(stats.ordersThisWeek) || 0} subtitle="orders" icon={<ClipboardList />} color="slate" />

        <StatCard title="Orders This Month" value={Number(stats.ordersThisMonth) || 0} subtitle="orders" icon={<ClipboardList />} color="cyan" />

        <StatCard title="Pending Orders" value={Number(stats.pendingOrders) || 0} subtitle="orders" icon={<Clock />} color="amber" />
        <StatCard title="Processing" value={Number(stats.processingOrders) || 0} subtitle="orders" icon={<Settings />} color="sky" />

      </div>



      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">

        {user.performance?.rankLabel && (
          <StatCard
            title="Your Rank"
            value={user.performance.rankLabel}
            subtitle={`${user.performance.orderCount} delivered orders this month`}
            icon={<Trophy />}
            color="gold"
          />
        )}

        <StatCard title="Successful" value={Number(stats.successfulOrders) || 0} subtitle="delivered" icon={<CheckCircle />} color="emerald" />

        <StatCard title="Failed" value={Number(stats.failedOrders) || 0} subtitle="orders" icon={<AlertCircle />} color="rose" />

        <StatCard title="Total Revenue" value={formatCurrency(Number(stats.totalRevenue) || 0)} subtitle="all time" icon={<DollarSign />} color="gold" />

        <StatCard title="Total Profit" value={formatCurrency(Number(stats.totalProfit) || 0)} subtitle="earned" icon={<TrendingUp />} color="green" />

      </div>



      <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">Wallet &amp; earnings</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        <StatCard title="Wallet Balance" value={formatCurrency(Number(stats.walletBalance) || 0)} subtitle="account" icon={<Wallet />} color="blue" />

        <Link to="/reseller/withdrawals" className="block">

          <StatCard title="Withdrawable" value={formatCurrency(Number(stats.withdrawableProfit) || 0)} subtitle="profit" icon={<Wallet />} color="purple" />

        </Link>

        <StatCard title="Profit Today" value={formatCurrency(Number(stats.profitToday) || 0)} subtitle="earned" icon={<DollarSign />} color="sky" />

        <StatCard title="Profit This Month" value={formatCurrency(Number(stats.profitThisMonth) || 0)} subtitle="earned" icon={<DollarSign />} color="emerald" />

      </div>

    </DashboardLayout>

  );

}

