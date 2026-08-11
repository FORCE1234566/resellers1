import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import StoreLayout, { StoreTab } from '@/components/store/StoreLayout';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { useNavigate, useParams } from 'react-router';
import { runValidators, v } from '@/lib/form-validation';
import { redirectToPaystack } from '@/lib/paystack';
import { formatCurrency } from '@/lib/utils';
import { buildStoreHomePath, persistStoreRef, normalizeStoreSlug } from '@/lib/reseller-store-ref';
import { AFA_CHECK_USSD, AFA_PROCESSING_HOURS } from '@/lib/afa';
interface AfaOffer {
  packageId: string;
  price: number;
  processingFee?: number;
  total?: number;
  inStock: boolean;
  imageUrl?: string;
}

export default function StoreAfaPage() {
  const params = useParams();
  const navigate = useNavigate();
  const slug = normalizeStoreSlug(params.slug as string || '');

  const handleTabChange = (tab: StoreTab) => {
    const extra: Record<string, string> = {};
    if (tab !== 'home') extra.tab = tab;
    navigate(buildStoreHomePath(slug, Object.keys(extra).length ? extra : undefined));
  };

  const [store, setStore] = useState<Record<string, string> | null>(null);
  const [offer, setOffer] = useState<AfaOffer | null>(null);
  const [offerLoading, setOfferLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) return;
    persistStoreRef(slug);
    api.get(`/store/${slug}`).then((res) => {
      setStore(res.data.data);
      document.title = `${res.data.data.storeName} — AFA Registration`;
    });
    api
      .get(`/store/${slug}/afa`)
      .then((res) => setOffer(res.data.data as AfaOffer))
      .catch(() => setOffer(null))
      .finally(() => setOfferLoading(false));
  }, [slug]);

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = runValidators(
      { phone, email },
      {
        phone: [v.required('Phone'), v.phone],
        email: [v.required('Email'), v.email],
      }
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length || !offer?.packageId) return;

    setLoading(true);
    try {
      const res = await api.post(`/store/${slug}/purchase/init`, {
        packageId: offer.packageId,
        recipientPhone: phone,
        email,
      });
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
        <Card className="p-0 overflow-hidden">
          <div className="bg-blue-600 px-6 py-4 text-center">
            <h1 className="text-xl font-bold text-white">AFA Registration</h1>
          </div>

          <form noValidate onSubmit={handlePurchase} className="p-4 sm:p-6 space-y-4">
            {!offer?.inStock && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                AFA registration is currently out of stock.
              </p>
            )}

            <p className="text-xs text-gray-500">
              Registration takes about {AFA_PROCESSING_HOURS} hours. Dial{' '}
              <strong>{AFA_CHECK_USSD}</strong> on the registered line to check status.
            </p>

            <Input
              label="Beneficiary Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="enter number here (0598104488)"
              error={fieldErrors.phone}
              disabled={!offer?.inStock}
              required
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="enter email here"
              error={fieldErrors.email}
              disabled={!offer?.inStock}
              required
            />

            {offerLoading ? (
              <p className="text-sm text-gray-500 text-center py-2">Loading store price…</p>
            ) : (
              offer?.inStock &&
              offer.price > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  <div className="flex justify-between font-semibold text-gray-900">
                    <span>Total to pay</span>
                    <span>{formatCurrency(offer.total ?? offer.price)}</span>
                  </div>
                </div>
              )
            )}

            <Button
              type="submit"
              loading={loading}
              disabled={!offer?.inStock || offerLoading}
              className="w-full"
            >
              {offerLoading
                ? 'Loading…'
                : offer?.inStock && offer.price > 0
                  ? `Pay ${formatCurrency(offer.total ?? offer.price)} & Register`
                  : 'Pay & Register'}
            </Button>
          </form>
        </Card>
      </div>
    </StoreLayout>
  );
}
