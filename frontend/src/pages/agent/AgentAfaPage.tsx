import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { AFA_CHECK_USSD, AFA_PROCESSING_HOURS, formatGhanaCardInput, isValidGhanaCard } from '@/lib/afa';
import { runValidators, v } from '@/lib/form-validation';

interface AfaInfo {
  packageId: string;
  fee: number;
  inStock: boolean;
  walletBalance: number;
  imageUrl?: string;
}

export default function AgentAfaPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<AfaInfo | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ghanaCard, setGhanaCard] = useState('');
  const [location, setLocation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'agent')) navigate('/login/agent');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user?.role === 'agent') {
      api.get('/agent/afa').then((res) => setInfo(res.data.data as AfaInfo)).catch(() => setInfo(null));
    }
  }, [user]);

  const handleSubmit = async () => {
    const errors = runValidators(
      { fullName, phone, ghanaCard, location },
      {
        fullName: [v.required('Full name')],
        phone: [v.required('Phone'), v.phone],
        location: [v.required('Location')],
      }
    );
    if (!isValidGhanaCard(ghanaCard)) {
      errors.ghanaCard = 'Use format GHA-123456789-0';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    setMsg('');
    try {
      const res = await api.post('/agent/afa/register', {
        fullName: fullName.trim(),
        phone,
        ghanaCard: ghanaCard.trim().toUpperCase(),
        location: location.trim(),
      });
      setMsg(res.data.data.message || `Order ${res.data.data.orderId} submitted successfully.`);
      setFullName('');
      setPhone('');
      setGhanaCard('');
      setLocation('');
      api.get('/agent/afa').then((r) => setInfo(r.data.data as AfaInfo));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout role="agent">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">MTN AFA Registration</h1>

      <Card className="p-0 max-w-lg overflow-hidden">
        <div className="bg-blue-600 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">AFA Registration</h2>
        </div>

        <div className="p-6 space-y-4">
          {info && (
            <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500 uppercase text-xs tracking-wide">Wallet</p>
                <p className="font-semibold text-gray-900">{formatCurrency(info.walletBalance)}</p>
              </div>
              <div>
                <p className="text-gray-500 uppercase text-xs tracking-wide">Fee</p>
                <p className="font-semibold text-blue-600">{formatCurrency(info.fee)}</p>
              </div>
            </div>
          )}

          {!info?.inStock && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              AFA registration is currently out of stock. Please check back later.
            </p>
          )}

          <p className="text-xs text-gray-500">
            Registration takes about {AFA_PROCESSING_HOURS} hours. After that, dial{' '}
            <strong className="text-gray-700">{AFA_CHECK_USSD}</strong> on the registered MTN line to check status.
          </p>

          <Input
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={fieldErrors.fullName}
            disabled={!info?.inStock}
          />
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="0XXXXXXXXX"
            error={fieldErrors.phone}
            disabled={!info?.inStock}
          />
          <Input
            label="Ghana Card (GHA-#########-#)"
            value={ghanaCard}
            onChange={(e) => setGhanaCard(formatGhanaCardInput(e.target.value))}
            placeholder="GHA-123456789-0"
            error={fieldErrors.ghanaCard}
            disabled={!info?.inStock}
          />
          <Input
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            error={fieldErrors.location}
            disabled={!info?.inStock}
          />

          {msg && (
            <p
              className={`text-sm p-3 rounded-lg ${
                msg.includes('success') || msg.includes('submitted')
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {msg}
            </p>
          )}

          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!info?.inStock || !info?.packageId}
            className="w-full"
          >
            Register
          </Button>
        </div>
      </Card>
    </DashboardLayout>
  );
}
