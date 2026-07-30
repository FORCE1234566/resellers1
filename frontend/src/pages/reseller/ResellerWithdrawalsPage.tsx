import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { runValidators, v } from '@/lib/form-validation';
import { Shield } from 'lucide-react';

type Summary = {
  available: number;
  reserved: number;
  minWithdrawal: number;
  pendingCount: number;
  maxPending: number;
};

export default function ResellerWithdrawalsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [withdrawals, setWithdrawals] = useState<Array<Record<string, unknown>>>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState({ amount: '', network: 'MTN', mobileNumber: '', accountName: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');
  }, [user, loading, navigate]);

  const load = useCallback(async () => {
    const [wRes, sRes] = await Promise.all([
      api.get('/reseller/withdrawals'),
      api.get('/reseller/withdrawals/summary'),
    ]);
    setWithdrawals(wRes.data.data);
    setSummary(sRes.data.data);
  }, []);

  useEffect(() => {
    if (user?.role === 'reseller') load().catch(console.error);
  }, [user, load]);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    setSubmitError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    const min = summary?.minWithdrawal ?? 30;
    const max = summary?.available ?? 0;

    const errors = runValidators(form, {
      amount: [v.required('Amount'), v.minAmount(min, 'Amount')],
      mobileNumber: [v.required('Mobile money number'), v.phone],
      accountName: [v.required('Account name')],
    });

    const amount = parseFloat(form.amount);
    if (!errors.amount && amount > max) {
      errors.amount = `Maximum available is ${formatCurrency(max)}`;
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    try {
      await api.post('/reseller/withdrawals', { ...form, amount });
      setForm({ amount: '', network: 'MTN', mobileNumber: '', accountName: '' });
      load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Withdrawal request failed');
    }
  };

  if (loading || !user) return null;

  const available = summary?.available ?? 0;
  const minWithdrawal = summary?.minWithdrawal ?? 30;

  return (
    <DashboardLayout role="reseller">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">Withdrawals</h1>

      <Card className="p-5 mb-6 max-w-md border-emerald-200">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Available to withdraw</p>
            <p className="text-2xl font-bold text-emerald-700">{formatCurrency(available)}</p>
            {summary && summary.reserved > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {formatCurrency(summary.reserved)} reserved in pending requests
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              You can only withdraw verified earnings. Amount is locked when you submit a request.
              Approved withdrawals are paid to your MoMo via Paystack.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 max-w-md mb-6">
        <p className="text-sm text-gray-500 mb-4">Minimum withdrawal: {formatCurrency(minWithdrawal)}</p>
        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg mb-4">{submitError}</p>
        )}
        <form noValidate onSubmit={submit} className="space-y-4">
          <Input
            label="Amount (GHS)"
            type="number"
            step="0.01"
            min={minWithdrawal}
            max={available}
            value={form.amount}
            error={fieldErrors.amount}
            onChange={(e) => updateField('amount', e.target.value)}
          />
          <Select
            label="Mobile Money Network"
            value={form.network}
            onChange={(e) => setForm({ ...form, network: e.target.value })}
            options={[
              { value: 'MTN', label: 'MTN' },
              { value: 'Telecel', label: 'Telecel' },
              { value: 'AirtelTigo', label: 'AirtelTigo' },
            ]}
          />
          <Input
            label="Mobile Money Number"
            value={form.mobileNumber}
            error={fieldErrors.mobileNumber}
            onChange={(e) => updateField('mobileNumber', e.target.value)}
          />
          <Input
            label="Account Name"
            value={form.accountName}
            error={fieldErrors.accountName}
            onChange={(e) => updateField('accountName', e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={available < minWithdrawal}>
            Request Withdrawal
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto -mx-px">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Network</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w._id as string} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 text-gray-900">{formatCurrency(w.amount as number)}</td>
                  <td className="px-4 py-3 text-gray-600">{w.network as string}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs capitalize">
                      {w.status as string}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(w.createdAt as string).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </DashboardLayout>
  );
}
