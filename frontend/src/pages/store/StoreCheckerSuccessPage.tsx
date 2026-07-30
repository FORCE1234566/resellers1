import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import StoreLayout, { StoreTab } from '@/components/store/StoreLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { buildStoreHomePath, persistStoreRef, normalizeStoreSlug } from '@/lib/reseller-store-ref';
import { CheckCircle, Copy } from 'lucide-react';

interface CheckerResult {
  orderId: string;
  type: string;
  bundleSize: string;
  serial: string;
  pin: string;
  status: string;
}

export default function StoreCheckerSuccessPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const slug = normalizeStoreSlug(params.slug as string || '');
  const orderId = searchParams.get('orderId') || '';
  const email =
    searchParams.get('email') ||
    sessionStorage.getItem('checker_checkout_email') ||
    '';

  const [store, setStore] = useState<Record<string, string> | null>(null);
  const [result, setResult] = useState<CheckerResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'serial' | 'pin' | null>(null);

  useEffect(() => {
    if (!slug) return;
    persistStoreRef(slug);
    api.get(`/store/${slug}`).then((res) => setStore(res.data.data));
  }, [slug]);

  useEffect(() => {
    if (!orderId || !email) {
      setError('Missing order details. Check your email for your checker.');
      return;
    }
    api
      .get(`/store/checker-order/${encodeURIComponent(orderId)}`, { params: { email } })
      .then((res) => setResult(res.data.data as CheckerResult))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load checker'));
  }, [orderId, email]);

  const handleTabChange = (tab: StoreTab) => {
    const extra: Record<string, string> = {};
    if (tab !== 'home') extra.tab = tab;
    navigate(buildStoreHomePath(slug, Object.keys(extra).length ? extra : undefined));
  };

  const copy = async (value: string, key: 'serial' | 'pin') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!slug) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">Invalid store link</div>
    );
  }

  if (!store) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <StoreLayout
      store={store as {
        storeName: string;
        slug: string;
        phone: string;
        whatsapp: string;
        supportEmail: string;
      }}
      activeTab="services"
      onTabChange={handleTabChange}
    >
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Card className="p-6 text-center">
          {error ? (
            <p className="text-red-600">{error}</p>
          ) : !result ? (
            <p className="text-gray-500">Loading your checker...</p>
          ) : (
            <>
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h1 className="text-xl font-bold text-gray-900 mb-1">Payment successful</h1>
              <p className="text-sm text-gray-500 mb-6">
                Your {result.bundleSize} checker was sent straight to your email and phone SMS.
                You can also copy the codes below.
              </p>

              <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-left space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Serial</p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="font-mono font-semibold text-gray-900 break-all">{result.serial}</p>
                    <button
                      type="button"
                      onClick={() => copy(result.serial, 'serial')}
                      className="text-violet-700 shrink-0"
                      aria-label="Copy serial"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  {copied === 'serial' && <p className="text-xs text-emerald-600 mt-1">Copied</p>}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">PIN</p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="font-mono font-semibold text-gray-900 break-all">{result.pin}</p>
                    <button
                      type="button"
                      onClick={() => copy(result.pin, 'pin')}
                      className="text-violet-700 shrink-0"
                      aria-label="Copy PIN"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  {copied === 'pin' && <p className="text-xs text-emerald-600 mt-1">Copied</p>}
                </div>
              </div>

              <p className="text-xs text-gray-400 mt-4">Order: {result.orderId}</p>
            </>
          )}

          <Button className="w-full mt-6" onClick={() => navigate(buildStoreHomePath(slug))}>
            Back to store
          </Button>
        </Card>
      </div>
    </StoreLayout>
  );
}
