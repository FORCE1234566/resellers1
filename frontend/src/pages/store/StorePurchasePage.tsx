import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import StoreLayout from '@/components/store/StoreLayout';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import { useNavigate, useParams } from 'react-router-dom';
import { StoreTab } from '@/components/store/StoreLayout';
import { runValidators, v } from '@/lib/form-validation';
import { redirectToPaystack } from '@/lib/paystack';
import { buildStoreHomePath, persistStoreRef, normalizeStoreSlug } from '@/lib/reseller-store-ref';
import StorePromoCodeInput, { PromoPreview } from '@/components/store/StorePromoCodeInput';
import { sortPackagesByBundleSize } from '@/lib/bundle-size';
import { networkPhoneHint, networkPhonePlaceholder, validateNetworkPhone } from '@/lib/network-phone';

export default function StorePurchasePage() {
  const params = useParams();
  const navigate = useNavigate();
  const slug = normalizeStoreSlug(params.slug as string || '');
  const network = decodeURIComponent(params.network as string);

  const handleTabChange = (tab: StoreTab) => {
    const extra: Record<string, string> = {};
    if (tab !== 'home') extra.tab = tab;
    navigate(buildStoreHomePath(slug, Object.keys(extra).length ? extra : undefined));
  };

  const [store, setStore] = useState<Record<string, string> | null>(null);
  const [packages, setPackages] = useState<Array<Record<string, unknown>>>([]);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 0 });
  const [packageId, setPackageId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null);

  useEffect(() => {
    if (!slug) return;
    persistStoreRef(slug);
    api.get(`/store/${slug}`).then((res) => {
      setStore(res.data.data);
      document.title = `${res.data.data.storeName} — ${network}`;
    });
    api.get(`/store/${slug}/packages/${encodeURIComponent(network)}`).then((res) => {
      setPackages(res.data.data.packages);
      setPriceRange(res.data.data.priceRange);
    });
  }, [slug, network]);

  const selected = packages.find((p) => p.id === packageId);

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = runValidators(
      { packageId, phone, email },
      {
        packageId: [v.required('Bundle')],
        phone: [v.required('Recipient number'), v.networkPhone(network)],
        email: [v.required('Email'), v.email],
      }
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      const res = await api.post(`/store/${slug}/purchase/init`, {
        packageId,
        recipientPhone: phone,
        email,
        ...(promoCode ? { promoCode } : {}),
      });
      redirectToPaystack(res.data.data.authorizationUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    setPhone(digits);
    if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: '' }));
    if (digits.length === 10) {
      const networkError = validateNetworkPhone(digits, network);
      if (networkError) setFieldErrors((prev) => ({ ...prev, phone: networkError }));
    }
  };

  if (!slug) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">Invalid store link</div>
    );
  }

  if (!store) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  const sortedPackages = sortPackagesByBundleSize(
    packages as Array<{ id?: string; bundleSize: string; price?: number }>
  );

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
        <Card className="p-4 sm:p-6">
          <div className="text-center mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{network}</h1>
            <p className="text-gray-500 mt-1">
              {formatCurrency(priceRange.min)} - {formatCurrency(priceRange.max)}
            </p>
          </div>

          <form noValidate onSubmit={handlePurchase} className="space-y-4">
            <Select
              label="Select Bundle"
              value={packageId}
              onChange={(e) => {
                setPackageId(e.target.value);
                if (fieldErrors.packageId) setFieldErrors((prev) => ({ ...prev, packageId: '' }));
              }}
              error={fieldErrors.packageId}
              options={[
                { value: '', label: 'Choose a bundle' },
                ...sortedPackages.map((pkg) => ({
                  value: String(pkg.id),
                  label: `${String(pkg.bundleSize)} — ${formatCurrency(Number(pkg.price))}`,
                })),
              ]}
            />

            <Input
              label="Recipient phone number"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder={networkPhonePlaceholder(network)}
              error={fieldErrors.phone}
            />
            <p className="text-xs text-gray-500 -mt-2">
              Only {network} numbers ({networkPhoneHint(network)})
            </p>

            <Input
              label="Your email (for receipt)"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
              }}
              error={fieldErrors.email}
            />

            <StorePromoCodeInput
              key={packageId}
              slug={slug}
              packageId={packageId || undefined}
              onApplied={(code, preview) => {
                setPromoCode(code);
                setPromoPreview(preview);
              }}
            />

            {selected && (
              <p className="text-sm text-gray-600 text-center">
                Total:{' '}
                <strong>
                  {formatCurrency(
                    promoPreview?.total ?? Number(selected.price)
                  )}
                </strong>
              </p>
            )}

            <Button type="submit" className="w-full" loading={loading} disabled={!packageId}>
              Pay with Paystack
            </Button>
          </form>
        </Card>
      </div>
    </StoreLayout>
  );
}
