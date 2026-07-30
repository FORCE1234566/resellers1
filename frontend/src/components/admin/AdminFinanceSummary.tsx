import { Link } from 'react-router';
import { DollarSign, TrendingUp, Wallet, AlertTriangle } from 'lucide-react';
import { StatCard } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';

type AdminFinanceSummaryProps = {
  platformProfitToday: number;
  totalPlatformProfit: number;
  apiCostToday?: number;
  totalApiCostDeducted?: number;
  withdrawalPoolBalance: number;
  recommendedPoolTopUp: number;
  poolShortfall: number;
  totalResellerProfitOwed: number;
  pendingWithdrawalTotal: number;
};

export default function AdminFinanceSummary({
  platformProfitToday,
  totalPlatformProfit,
  apiCostToday = 0,
  totalApiCostDeducted = 0,
  withdrawalPoolBalance,
  recommendedPoolTopUp,
  poolShortfall,
  totalResellerProfitOwed,
  pendingWithdrawalTotal,
}: AdminFinanceSummaryProps) {
  const needsTopUp = recommendedPoolTopUp > 0;
  const topUpLink = needsTopUp
    ? `/admin/settings?topUp=${recommendedPoolTopUp}`
    : '/admin/settings';

  return (
    <section className="mb-8">
      <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
        Admin profit &amp; pool
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <StatCard
          title="Admin Profit Today"
          value={formatCurrency(platformProfitToday)}
          subtitle={`reseller/agent base − API on delivered orders · API ${formatCurrency(apiCostToday)}`}
          icon={<TrendingUp />}
          color="emerald"
        />
        <StatCard
          title="Total Admin Profit"
          value={formatCurrency(totalPlatformProfit)}
          subtitle={`all delivered orders · API deducted ${formatCurrency(totalApiCostDeducted)} · reseller share is separate`}
          icon={<DollarSign />}
          color="green"
        />
        <Link to="/admin/settings" className="block">
          <StatCard
            title="Withdrawal Pool"
            value={formatCurrency(withdrawalPoolBalance)}
            subtitle="available balance"
            icon={<Wallet />}
            color="cyan"
          />
        </Link>
        <StatCard
          title="Add to Pool"
          value={formatCurrency(recommendedPoolTopUp)}
          subtitle={needsTopUp ? 'needed to cover payouts' : 'Pool funded'}
          icon={<Wallet />}
          color={needsTopUp ? 'rose' : 'emerald'}
        />
      </div>

      {needsTopUp && (
        <div className="rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-950/40 via-navy-card to-navy-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex gap-3 min-w-0">
            <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                Pool shortfall: {formatCurrency(poolShortfall)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Reseller profit owed ({formatCurrency(totalResellerProfitOwed)}) plus pending
                withdrawals ({formatCurrency(pendingWithdrawalTotal)}) exceeds the pool balance.
                Add at least {formatCurrency(recommendedPoolTopUp)}.
              </p>
            </div>
          </div>
          <Link to={topUpLink} className="shrink-0">
            <Button variant="primary" className="w-full sm:w-auto">
              Add to pool
            </Button>
          </Link>
        </div>
      )}
    </section>
  );
}
