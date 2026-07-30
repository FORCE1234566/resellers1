import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn, formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { runValidators, v } from '@/lib/form-validation';
import { CheckCircle } from 'lucide-react';

type CheckerType = 'bece' | 'wassce';

interface CheckerOfferRow {
  type: CheckerType;
  label: string;
  packageId?: string;
  fee: number;
  basePrice: number;
  inStock: boolean;
  availableCount: number;
}

interface CheckerInfo {
  walletBalance: number;
  offers: CheckerOfferRow[];
}

interface PurchaseResult {
  orderId: string;
  serial?: string;
  pin?: string;
  message?: string;
}

export default function AgentCheckerPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<CheckerInfo | null>(null);
  const [selected, setSelected] = useState<CheckerType | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'agent')) navigate('/login/agent');
  }, [user, loading, navigate]);

  const load = () => {
    api.get('/agent/checker').then((res) => setInfo(res.data.data as CheckerInfo)).catch(() => setInfo(null));
  };

  useEffect(() => {
    if (user?.role === 'agent') load();
  }, [user]);

  const offer = selected ? info?.offers.find((o) => o.type === selected) : null;

  const handleSubmit = async () => {
    if (!selected) {
      setFieldErrors({ type: 'Select BECE or WASSCE' });
      return;
    }
    const errors = runValidators(
      { phone, email },
      {
        phone: [v.required('Phone'), v.phone],
        email: [v.required('Email'), v.email],
      }
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    setMsg('');
    setResult(null);
    try {
      const res = await api.post('/agent/checker/purchase', { type: selected, phone, email });
      setResult(res.data.data as PurchaseResult);
      setMsg(res.data.data.message || 'Checker delivered successfully.');
      setPhone('');
      setEmail('');
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout role="agent">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">Results Checker</h1>

      <Card className="p-0 max-w-lg overflow-hidden">
        <div className="bg-violet-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">BECE &amp; WASSCE Checkers</h2>
        </div>

        <div className="p-6 space-y-4">
          {info && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm">
              <p className="text-gray-500 uppercase text-xs tracking-wide">Wallet balance</p>
              <p className="font-semibold text-gray-900">{formatCurrency(info.walletBalance)}</p>
            </div>
          )}

          <p className="text-sm text-gray-600">Select exam type</p>
          <div className="grid grid-cols-2 gap-3">
            {info?.offers.map((row) => (
              <button
                key={row.type}
                type="button"
                disabled={!row.inStock}
                onClick={() => {
                  setSelected(row.type);
                  setFieldErrors((prev) => ({ ...prev, type: '' }));
                  setResult(null);
                }}
                className={cn(
                  'rounded-xl border-2 p-4 text-left transition-all',
                  !row.inStock && 'opacity-50 cursor-not-allowed',
                  selected === row.type
                    ? 'border-violet-600 bg-violet-50'
                    : 'border-gray-200 bg-white hover:border-violet-300'
                )}
              >
                <p className="font-bold text-gray-900">{row.label}</p>
                <p className="text-sm text-gray-600 mt-1">
                  {row.inStock ? formatCurrency(row.fee) : 'Out of stock'}
                </p>
                {row.inStock && (
                  <p className="text-xs text-gray-400 mt-1">{row.availableCount} available</p>
                )}
              </button>
            ))}
          </div>
          {fieldErrors.type && <p className="text-sm text-red-600">{fieldErrors.type}</p>}

          <Input
            label="Customer phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="0XXXXXXXXX"
            error={fieldErrors.phone}
            disabled={!selected || !offer?.inStock}
          />
          <Input
            label="Customer email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            disabled={!selected || !offer?.inStock}
          />

          {result?.serial && result?.pin && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Checker delivered</span>
              </div>
              <p className="text-sm"><strong>Serial:</strong> <span className="font-mono">{result.serial}</span></p>
              <p className="text-sm"><strong>PIN:</strong> <span className="font-mono">{result.pin}</span></p>
              <p className="text-xs text-gray-500">Also sent to customer email and SMS.</p>
            </div>
          )}

          {msg && !result?.serial && (
            <p className={cn('text-sm', msg.includes('failed') || msg.includes('Insufficient') ? 'text-red-600' : 'text-emerald-700')}>
              {msg}
            </p>
          )}

          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!selected || !offer?.inStock}
            className="w-full"
          >
            {offer ? `Buy ${offer.label} — ${formatCurrency(offer.fee)}` : 'Buy Checker'}
          </Button>
        </div>
      </Card>
    </DashboardLayout>
  );
}
