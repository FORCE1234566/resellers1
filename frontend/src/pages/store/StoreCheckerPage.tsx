import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import StoreLayout, { StoreTab } from '@/components/store/StoreLayout';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { cn, formatCurrency } from '@/lib/utils';
import { useNavigate, useParams } from 'react-router';
import { runValidators, v } from '@/lib/form-validation';
import { redirectToPaystack } from '@/lib/paystack';
import { buildStoreHomePath, persistStoreRef, normalizeStoreSlug } from '@/lib/reseller-store-ref';
type CheckerType = 'bece' | 'wassce';

interface CheckerOffer {
  type: CheckerType;
  packageId: string;
  bundleSize: string;
  price: number;
  processingFee: number;
  total: number;
  paystackChargePercent: number;
  inStock: boolean;
}

interface CheckerCatalog {
  imageUrl?: string;
  bece: CheckerOffer;
  wassce: CheckerOffer;
}

export default function StoreCheckerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const slug = normalizeStoreSlug(params.slug as string || '');

  const handleTabChange = (tab: StoreTab) => {
    const extra: Record<string, string> = {};
    if (tab !== 'home') extra.tab = tab;
    navigate(buildStoreHomePath(slug, Object.keys(extra).length ? extra : undefined));
  };

  const [store, setStore] = useState<Record<string, string> | null>(null);
  const [catalog, setCatalog] = useState<CheckerCatalog | null>(null);
  const [selected, setSelected] = useState<CheckerType | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) return;
    persistStoreRef(slug);
    api.get(`/store/${slug}`).then((res) => {
      setStore(res.data.data);
      document.title = `${res.data.data.storeName} — Results Checker`;
    });
    api.get(`/store/${slug}/checker`).then((res) => setCatalog(res.data.data as CheckerCatalog)).catch(() => setCatalog(null));
  }, [slug]);

  const offer = selected && catalog ? catalog[selected] : null;

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (Object.keys(errors).length || !offer?.inStock) return;

    setLoading(true);
    try {
      const res = await api.post(`/store/${slug}/checker/purchase/init`, {
        type: selected,
        phone,
        email,
      });
      sessionStorage.setItem('checker_checkout_email', email.trim().toLowerCase());
      redirectToPaystack(res.data.data.authorizationUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  if (!slug) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">Invalid store link</div>
    );
  }

  if (!store || !catalog) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

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
        <Card className="p-0 overflow-hidden">
          <div className="bg-violet-700 px-6 py-4 text-center">
            <img
              src={catalog.imageUrl || '/images/waec-checker.png'}
              alt="WAEC Results Checker"
              className="w-16 h-16 mx-auto mb-2 rounded-full object-contain bg-white p-1"
            />
            <h1 className="text-xl font-bold text-white">Results Checker</h1>
            <p className="text-violet-200 text-sm mt-1">BECE &amp; WASSCE</p>
          </div>

          <form noValidate onSubmit={handlePurchase} className="p-4 sm:p-6 space-y-4">
            <p className="text-sm text-gray-600">Select exam type</p>
            <div className="grid grid-cols-2 gap-3">
              {(['bece', 'wassce'] as CheckerType[]).map((type) => {
                const row = catalog[type];
                const active = selected === type;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={!row.inStock}
                    onClick={() => {
                      setSelected(type);
                      setFieldErrors((prev) => ({ ...prev, type: '' }));
                    }}
                    className={cn(
                      'rounded-xl border-2 p-4 text-left transition-all',
                      !row.inStock && 'opacity-50 cursor-not-allowed',
                      active
                        ? 'border-violet-600 bg-violet-50 ring-2 ring-violet-200'
                        : 'border-gray-200 bg-white hover:border-violet-300'
                    )}
                  >
                    <p className="font-bold text-gray-900 uppercase">{type}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {row.inStock ? formatCurrency(row.price) : 'Out of stock'}
                    </p>
                  </button>
                );
              })}
            </div>
            {fieldErrors.type && <p className="text-sm text-red-600">{fieldErrors.type}</p>}

            <Input
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="0XXXXXXXXX"
              error={fieldErrors.phone}
              disabled={!selected || !offer?.inStock}
            />
            <Input
              label="Email (for receipt & checker)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErrors.email}
              disabled={!selected || !offer?.inStock}
            />

            {offer?.inStock && offer.price > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>{offer.bundleSize} checker</span>
                  <span>{formatCurrency(offer.price)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Paystack fee ({offer.paystackChargePercent}%)</span>
                  <span>{formatCurrency(offer.processingFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 pt-2 border-t border-gray-200">
                  <span>Total to pay</span>
                  <span>{formatCurrency(offer.total)}</span>
                </div>
              </div>
            )}

            <Button
              type="submit"
              loading={loading}
              disabled={!selected || !offer?.inStock}
              className="w-full"
            >
              {offer?.inStock && offer.total > 0
                ? `Pay ${formatCurrency(offer.total)} & Get Checker`
                : 'Pay & Get Checker'}
            </Button>
          </form>
        </Card>
      </div>
    </StoreLayout>
  );
}
