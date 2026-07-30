import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { Loader2, Wallet } from 'lucide-react';
import ScrollTable from '@/components/ui/ScrollTable';
import { MobileDataCard, MobileDataCardList, MobileDataCardRow } from '@/components/ui/MobileDataCard';
import { cn } from '@/lib/utils';
import AdminActionConfirmModal from '@/components/admin/AdminActionConfirmModal';

type WithdrawalRow = {
  _id: string;
  amount: number;
  network: string;
  mobileNumber: string;
  accountName: string;
  status: string;
  adminNote?: string;
  paystackTransferStatus?: string;
  paystackTransferReference?: string;
  createdAt: string;
  userId?: { fullName?: string; email?: string };
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  processed: 'bg-green-100 text-green-700',
  paid: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function AdminWithdrawalsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [poolBalance, setPoolBalance] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; status: string } | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const load = async () => {
    setPageLoading(true);
    try {
      const [wRes, sRes] = await Promise.all([
        api.get('/admin/withdrawals'),
        api.get('/admin/settings'),
      ]);
      setWithdrawals(wRes.data.data);
      setPoolBalance(sRes.data.data.withdrawalPoolBalance);
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user]);

  const updateStatus = (id: string, status: string) => {
    setPendingAction({ id, status });
  };

  const confirmUpdateStatus = async (adminOtp: string) => {
    if (!pendingAction) return;
    setUpdatingId(pendingAction.id);
    try {
      await api.patch(`/admin/withdrawals/${pendingAction.id}`, {
        status: pendingAction.status,
        adminOtp,
      });
      await load();
    } finally {
      setUpdatingId(null);
    }
  };

  const actionLabels: Record<string, { title: string; confirm: string }> = {
    approved: { title: 'Pay via Paystack', confirm: 'Send MoMo payout' },
    rejected: { title: 'Reject withdrawal', confirm: 'Reject' },
    processed: { title: 'Retry Paystack payout', confirm: 'Retry payout' },
  };

  const paystackPayoutFailed = (w: WithdrawalRow) =>
    w.status === 'processed' &&
    (!w.paystackTransferStatus || w.paystackTransferStatus === 'failed');

  if (loading || !user) return null;

  return (
    <DashboardLayout role="admin">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Withdrawals</h1>
      <p className="text-sm text-gray-400 mb-6">
        When you approve a request, Paystack sends the exact amount to the reseller&apos;s MoMo from your
        Paystack balance. Paystack transfer fees are deducted from your balance on top of the payout amount.
        Keep enough funds in Paystack (e.g. GHS 3 request may need GHS 3 + fees).
      </p>

      <Card className="p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-100 text-emerald-700">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">In-app pool tracker</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(poolBalance)}</p>
            <p className="text-xs text-gray-500 mt-1">
              Payouts are sent from your Paystack balance. Pool is optional bookkeeping.
            </p>
          </div>
        </div>
        <a href="https://dashboard.paystack.com" target="_blank" rel="noopener noreferrer">
          <Button variant="outline">Open Paystack dashboard</Button>
        </a>
      </Card>

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading withdrawals...
        </div>
      ) : (
        <Card className="overflow-hidden">
          {withdrawals.length === 0 ? (
            <p className="p-10 text-center text-gray-500 text-sm">No withdrawal requests</p>
          ) : (
            <MobileDataCardList>
              {withdrawals.map((w) => {
                const busy = updatingId === w._id;
                return (
                  <MobileDataCard
                    key={w._id}
                    actions={
                      <div className="flex flex-wrap gap-2 w-full">
                        {w.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => updateStatus(w._id, 'approved')}
                            >
                              Pay via Paystack
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => updateStatus(w._id, 'rejected')}>
                              Reject
                            </Button>
                          </>
                        )}
                        {paystackPayoutFailed(w) && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => updateStatus(w._id, 'processed')}>
                            Retry Paystack
                          </Button>
                        )}
                      </div>
                    }
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-gray-900">{w.userId?.fullName || '—'}</p>
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium capitalize shrink-0', STATUS_STYLES[w.status] || 'bg-gray-100 text-gray-600')}>
                        {w.status}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <MobileDataCardRow label="Amount" value={formatCurrency(w.amount)} />
                      <MobileDataCardRow label="MoMo" value={`${w.network} · ${w.mobileNumber}`} />
                      <MobileDataCardRow label="Account" value={w.accountName} />
                      <MobileDataCardRow label="Date" value={new Date(w.createdAt).toLocaleString()} />
                    </div>
                  </MobileDataCard>
                );
              })}
            </MobileDataCardList>
          )}

          <ScrollTable className="hidden md:block">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Reseller</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">MoMo</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => {
                    const busy = updatingId === w._id;
                    return (
                      <tr key={w._id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <p className="text-gray-900 font-medium">{w.userId?.fullName || '—'}</p>
                          <p className="text-xs text-gray-500">{w.userId?.email}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-900 font-semibold">{formatCurrency(w.amount)}</td>
                        <td className="px-4 py-3 text-gray-700">
                          <p>{w.network} · {w.mobileNumber}</p>
                          <p className="text-xs text-gray-500">{w.accountName}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[w.status] || 'bg-gray-100 text-gray-600'}`}>
                            {w.status}
                          </span>
                          {w.paystackTransferStatus && (
                            <p className="text-xs text-gray-500 mt-1">Paystack: {w.paystackTransferStatus}</p>
                          )}
                          {w.adminNote && (
                            <p className="text-xs text-gray-400 mt-0.5 max-w-[200px] truncate" title={w.adminNote}>{w.adminNote}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{new Date(w.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 flex-wrap">
                            {w.status === 'pending' && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => updateStatus(w._id, 'approved')}
                                >
                                  Pay via Paystack
                                </Button>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => updateStatus(w._id, 'rejected')}>
                                  Reject
                                </Button>
                              </>
                            )}
                            {paystackPayoutFailed(w) && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => updateStatus(w._id, 'processed')}>
                                Retry Paystack
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </ScrollTable>
        </Card>
      )}

      {pendingAction && (
        <AdminActionConfirmModal
          title={actionLabels[pendingAction.status]?.title ?? 'Confirm action'}
          confirmLabel={actionLabels[pendingAction.status]?.confirm ?? 'Confirm'}
          onClose={() => setPendingAction(null)}
          onConfirm={confirmUpdateStatus}
        />
      )}
    </DashboardLayout>
  );
}
