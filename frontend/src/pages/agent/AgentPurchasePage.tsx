import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import NetworkStockBar, { NetworkStockRow } from '@/components/network/NetworkStockBar';
import { formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router';
import {
  networkPhoneHint,
  networkPhonePlaceholder,
  validateNetworkPhone,
} from '@/lib/network-phone';

interface AgentPackage {
  _id: string;
  network: string;
  bundleSize: string;
  agentPrice: number;
}

export default function AgentPurchasePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [networkStock, setNetworkStock] = useState<NetworkStockRow[]>([]);
  const [packages, setPackages] = useState<AgentPackage[]>([]);
  const [network, setNetwork] = useState('');
  const [packageId, setPackageId] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [expressBlocked, setExpressBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'agent')) navigate('/login/agent');
  }, [user, loading, navigate]);

  const loadStock = () =>
    api.get('/agent/network-stock').then((res) => setNetworkStock(res.data.data as NetworkStockRow[]));

  useEffect(() => {
    if (user?.role === 'agent') loadStock();
  }, [user]);

  useEffect(() => {
    if (network) {
      api.get(`/agent/packages?network=${encodeURIComponent(network)}`).then((res) => {
        setPackages(res.data.data);
      });
    } else {
      setPackages([]);
    }
  }, [network]);

  const selected = packages.find((p) => p._id === packageId);
  const isMtnExpress = network === 'MTN Express';

  const handlePurchase = async () => {
    setSubmitting(true);
    setMsg('');
    setExpressBlocked(false);
    const phoneError = validateNetworkPhone(phone, network);
    if (!network) {
      setMsg('Select a network first');
      setSubmitting(false);
      return;
    }
    if (phoneError) {
      setMsg(phoneError);
      setSubmitting(false);
      return;
    }
    try {
      if (isMtnExpress) {
        const verifyRes = await api.post('/agent/verify-express', { recipientPhone: phone });
        if (!verifyRes.data?.data?.verified) {
          setExpressBlocked(true);
          setMsg(verifyRes.data?.data?.message || 'This number is not verified to buy MTN Express.');
          return;
        }
      }

      const res = await api.post('/agent/purchase', { packageId, recipientPhone: phone });
      setMsg(`Order ${res.data.data.orderId} created successfully!`);
      setPhone('');
      setExpressBlocked(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Purchase failed';
      if (isMtnExpress && /not verified to buy MTN Express/i.test(message)) {
        setExpressBlocked(true);
      }
      setMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout role="agent">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">Buy Data</h1>

      <Card className="p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Network stock</h2>
        <NetworkStockBar stock={networkStock} readOnly />
      </Card>

      <Card className="p-6 max-w-lg">
        <div className="space-y-4">
          <Select
            label="Select Network"
            value={network}
            onChange={(e) => {
              setNetwork(e.target.value);
              setPackageId('');
              setPhone('');
              setMsg('');
              setExpressBlocked(false);
            }}
            options={[
              { value: '', label: 'Choose network...' },
              ...networkStock.map((n) => ({
                value: n.network,
                label: n.inStock ? n.network : `${n.network} (Out of stock)`,
                disabled: !n.inStock,
              })),
            ]}
          />
          <Select
            label="Select Bundle"
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            options={[
              { value: '', label: 'Choose bundle...' },
              ...packages.map((p) => ({
                value: p._id,
                label: `${p.bundleSize} - ${formatCurrency(p.agentPrice)}`,
              })),
            ]}
          />
          {selected && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Price: <strong>{formatCurrency(selected.agentPrice)}</strong></p>
            </div>
          )}
          <Input
            label="Recipient Number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
              setExpressBlocked(false);
            }}
            placeholder={network ? networkPhonePlaceholder(network) : '0XXXXXXXXX'}
          />
          {network && (
            <p className="text-xs text-gray-500 -mt-2">
              Only {network} numbers ({networkPhoneHint(network)})
            </p>
          )}
          {expressBlocked && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
              <p>This number is not verified to buy MTN Express.</p>
              <Button
                type="button"
                className="mt-3 w-full"
                onClick={() => {
                  setNetwork('MTN');
                  setPackageId('');
                  setExpressBlocked(false);
                  setMsg('');
                }}
              >
                Buy here
              </Button>
            </div>
          )}
          {msg && !expressBlocked && (
            <p
              className={`text-sm p-3 rounded-lg ${
                msg.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {msg}
            </p>
          )}
          <Button onClick={handlePurchase} loading={submitting} disabled={!packageId || !phone} className="w-full">
            Confirm Purchase
          </Button>
        </div>
      </Card>
    </DashboardLayout>
  );
}
