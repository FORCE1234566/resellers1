import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import { formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { Copy, ExternalLink, Lock, Store, Tag } from 'lucide-react';
import { runValidators, v } from '@/lib/form-validation';
import { computeResellerProfit } from '@/lib/reseller-profit';
import { isValidWhatsAppChannelUrl } from '@/lib/whatsapp-channel';
import { buildResellerStoreUrl } from '@/lib/reseller-store-ref';
import { sortPackagesByBundleSize } from '@/lib/bundle-size';
import NetworkStockBar, { NetworkStockRow } from '@/components/network/NetworkStockBar';

interface StoreData {
  storeName: string;
  slug: string;
  phone: string;
  whatsapp: string;
  whatsappChannelUrl?: string;
  supportEmail: string;
  isActive: boolean;
  storeUrl: string | null;
  pricesReady?: boolean;
  canShareLink?: boolean;
  networksMissing?: string[];
}

interface PackageRow {
  _id: string;
  network: string;
  bundleSize: string;
  resellerBasePrice: number;
  maxSellingPrice: number;
  myPrice: number;
  hasCustomPrice?: boolean;
  profitPerSale?: number;
}

interface PricingMeta {
  pricesReady: boolean;
  configuredCount: number;
  requiredCount: number;
  networksMissing: string[];
  networkStock?: NetworkStockRow[];
}

export default function ResellerStorePage() {
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreData | null>(null);
  const [form, setForm] = useState({
    storeName: '',
    phone: '',
    whatsapp: '',
    whatsappChannelUrl: '',
    supportEmail: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [pricing, setPricing] = useState<PricingMeta>({
    pricesReady: false,
    configuredCount: 0,
    requiredCount: 0,
    networksMissing: [],
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [priceSaving, setPriceSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkJustGenerated, setLinkJustGenerated] = useState(false);
  const generatedLinkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');
  }, [user, loading, navigate]);

  const loadStore = () =>
    api.get('/reseller/store').then((res) => {
      const data = res.data.data as StoreData;
      setStore(data);
      setPricing((prev) => ({
        ...prev,
        pricesReady: data.pricesReady ?? prev.pricesReady,
        networksMissing: data.networksMissing ?? prev.networksMissing,
      }));
      setForm({
        storeName: data.storeName || '',
        phone: data.phone || '',
        whatsapp: data.whatsapp || '',
        whatsappChannelUrl: data.whatsappChannelUrl || '',
        supportEmail: data.supportEmail || user?.email || '',
      });
    });

  const loadPrices = () =>
    api.get('/reseller/prices').then((res) => {
      setPackages(res.data.data);
      if (res.data.meta) {
        setPricing(res.data.meta as PricingMeta);
      }
    });

  useEffect(() => {
    if (user?.role === 'reseller') {
      loadStore().catch(console.error);
      loadPrices();
    }
  }, [user]);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    setError('');
    setSuccess('');
  };

  const saveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pricing.pricesReady) {
      setError('Set your selling prices for every network before saving your store name.');
      return;
    }

    setError('');
    setSuccess('');

    const errors = runValidators(form, {
      storeName: [v.required('Store name')],
      phone: [v.required('Phone'), v.phone],
      whatsapp: [v.required('WhatsApp'), v.phone],
      supportEmail: [v.required('Support email'), v.email],
      whatsappChannelUrl: [
        (value) =>
          isValidWhatsAppChannelUrl(value)
            ? null
            : 'Enter a valid WhatsApp channel or community link (whatsapp.com/channel/… or chat.whatsapp.com/…)',
      ],
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSaving(true);
    try {
      const { data } = await api.put('/reseller/store', form);
      const updated = data.data as StoreData;
      setStore(updated);
      setLinkJustGenerated(true);
      setSuccess('Your store link is ready — copy it below and share with customers.');
      if (user?.resellerStore) {
        setUser({
          ...user,
          resellerStore: {
            ...user.resellerStore,
            storeName: updated.storeName,
            slug: updated.slug,
          },
        });
      }
      requestAnimationFrame(() => {
        generatedLinkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save store');
    } finally {
      setSaving(false);
    }
  };

  const savePrice = async (packageId: string) => {
    setPriceSaving(true);
    setError('');
    try {
      await api.put(`/reseller/prices/${packageId}`, { price: parseFloat(editPrice) });
      setEditingId(null);
      await Promise.all([loadPrices(), loadStore()]);
      setSuccess('Price saved. Set at least one price per network to unlock your store.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update price');
    } finally {
      setPriceSaving(false);
    }
  };

  const copyLink = async (url: string) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || !user) return null;

  const grouped = sortPackagesByBundleSize(packages).reduce<Record<string, PackageRow[]>>((acc, pkg) => {
    if (!acc[pkg.network]) acc[pkg.network] = [];
    acc[pkg.network].push(pkg);
    return acc;
  }, {});

  const shareUrl =
    store?.storeUrl ?? (store?.slug ? buildResellerStoreUrl(store.slug) : null);
  const canShareLink = Boolean(store?.canShareLink && shareUrl);

  const storeLinkCard = shareUrl ? (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-emerald-600 font-semibold mb-1">
          Your store link
        </p>
        <p className="font-mono text-sm text-gray-800 break-all select-all">{shareUrl}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={() => copyLink(shareUrl)}>
          <Copy className="w-4 h-4" />
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        <a href={shareUrl} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="secondary">
            <ExternalLink className="w-4 h-4" />
            Open store
          </Button>
        </a>
      </div>
    </div>
  ) : null;
  const networkStock = pricing.networkStock ?? [];
  const stockByNetwork = Object.fromEntries(networkStock.map((row) => [row.network, row.inStock]));

  return (
    <DashboardLayout role="reseller">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">My Store</h1>
      <p className="text-sm text-gray-400 mb-6">
        Set your prices first, then name your store and share your link with customers.
      </p>

      <FormAlert message={error} />
      {success && (
        <p className="mb-4 text-sm p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
          {success}
        </p>
      )}

      {!pricing.pricesReady && (
        <Card className="p-5 mb-6 border-amber-200 bg-gradient-to-r from-amber-50 to-white">
          <div className="flex gap-3">
            <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900">Set your prices to continue</p>
              <p className="text-sm text-gray-600 mt-1">
                Save at least one selling price for each network ({pricing.configuredCount} of{' '}
                {pricing.requiredCount} done).
                {pricing.networksMissing.length > 0 && (
                  <> Still needed: <strong>{pricing.networksMissing.join(', ')}</strong>.</>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Your store name and share link unlock after pricing is complete.
              </p>
            </div>
          </div>
        </Card>
      )}

      {networkStock.length > 0 && (
        <Card className="p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Network stock</h2>
          <NetworkStockBar stock={networkStock} readOnly />
        </Card>
      )}

      <div className="flex items-center gap-2 mb-4">
        <Tag className="w-5 h-5 text-gold" />
        <h2 className="text-lg font-semibold text-white">Step 1 — Set your prices</h2>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Prices must stay between the admin base price and maximum selling price. Set at least one bundle per network.
      </p>

      <div className="space-y-6 mb-10">
        {Object.entries(grouped).map(([network, items]) => {
          const inStock = stockByNetwork[network] ?? true;
          return (
          <Card key={network} className="overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{network}</h3>
              {!inStock ? (
                <span className="text-xs font-medium text-amber-700">Out of stock</span>
              ) : items.some((p) => p.hasCustomPrice) ? (
                <span className="text-xs font-medium text-emerald-700">Price set</span>
              ) : (
                <span className="text-xs font-medium text-amber-700">Set a price</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-white border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Bundle</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Min (Base)</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Max</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Your price</th>
                    <th className="text-left px-4 py-3 text-emerald-700 font-medium">Your profit</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((pkg) => {
                    const draftPrice = editingId === pkg._id ? parseFloat(editPrice) : pkg.myPrice;
                    const liveProfit = Number.isFinite(draftPrice)
                      ? computeResellerProfit(draftPrice, pkg.resellerBasePrice)
                      : (pkg.profitPerSale ?? 0);
                    return (
                      <tr key={pkg._id} className="border-b last:border-0 hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900">{pkg.bundleSize}</td>
                        <td className="px-4 py-3 text-gray-600">{formatCurrency(pkg.resellerBasePrice)}</td>
                        <td className="px-4 py-3 text-gray-600">{formatCurrency(pkg.maxSellingPrice)}</td>
                        <td className="px-4 py-3">
                          {editingId === pkg._id ? (
                            <input
                              type="number"
                              step="0.01"
                              min={pkg.resellerBasePrice}
                              max={pkg.maxSellingPrice}
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold/50 focus:border-gold outline-none"
                            />
                          ) : (
                            <span className={pkg.hasCustomPrice ? 'font-semibold text-emerald-700' : 'text-gray-500'}>
                              {formatCurrency(pkg.myPrice)}
                              {!pkg.hasCustomPrice && (
                                <span className="block text-[10px] text-gray-400">default base</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-emerald-700">{formatCurrency(liveProfit)}</td>
                        <td className="px-4 py-3">
                          {!inStock ? (
                            <span className="text-xs text-amber-700 font-medium">Out of stock</span>
                          ) : editingId === pkg._id ? (
                            <Button size="sm" loading={priceSaving} onClick={() => savePrice(pkg._id)}>Save</Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(pkg._id);
                                setEditPrice(String(pkg.myPrice));
                                setError('');
                                setSuccess('');
                              }}
                            >
                              Edit
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-5 h-5 text-gold" />
            <h2 className="text-lg font-semibold text-gray-900">Step 2 — Store details</h2>
            {!pricing.pricesReady && <Lock className="w-4 h-4 text-amber-600" />}
          </div>
          {!pricing.pricesReady && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              Complete Step 1 before you can set your store name or generate a share link.
            </p>
          )}
          <form noValidate onSubmit={saveStore} className="space-y-4">
            <Input
              label="Store name"
              value={form.storeName}
              error={fieldErrors.storeName}
              onChange={(e) => updateField('storeName', e.target.value)}
              placeholder="e.g. FastData GH"
              disabled={!pricing.pricesReady}
            />
            <p className="text-xs text-gray-500 -mt-2">Your store link is generated from this name.</p>
            <Input
              label="Phone"
              value={form.phone}
              error={fieldErrors.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="0XXXXXXXXX"
              disabled={!pricing.pricesReady}
            />
            <Input
              label="WhatsApp"
              value={form.whatsapp}
              error={fieldErrors.whatsapp}
              onChange={(e) => updateField('whatsapp', e.target.value)}
              placeholder="0XXXXXXXXX"
              disabled={!pricing.pricesReady}
            />
            <Input
              label="WhatsApp channel or community link (optional)"
              value={form.whatsappChannelUrl}
              error={fieldErrors.whatsappChannelUrl}
              onChange={(e) => updateField('whatsappChannelUrl', e.target.value)}
              placeholder="https://whatsapp.com/channel/… or https://chat.whatsapp.com/…"
              disabled={!pricing.pricesReady}
            />
            <p className="text-xs text-gray-500 -mt-2">
              We strongly recommend creating a WhatsApp channel or community so you can keep customers active,
              promote your business, and send updates. You can skip this for now and add it later — your store link
              will still work. When added, this link powers the WhatsApp button on your store and outage alerts.
            </p>
            <Input
              label="Support email"
              type="email"
              value={form.supportEmail}
              error={fieldErrors.supportEmail}
              onChange={(e) => updateField('supportEmail', e.target.value)}
              disabled={!pricing.pricesReady}
            />
            <Button type="submit" loading={saving} className="w-full" disabled={!pricing.pricesReady}>
              Save store & generate link
            </Button>

            {canShareLink && shareUrl && (
              <div
                ref={generatedLinkRef}
                className={`mt-4 p-4 rounded-xl border-2 ${
                  linkJustGenerated
                    ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200'
                    : 'border-emerald-200 bg-emerald-50/60'
                }`}
              >
                <p className="text-sm font-semibold text-emerald-800 mb-3">
                  {linkJustGenerated ? 'Your link has been generated — share it with customers' : 'Your store link'}
                </p>
                {storeLinkCard}
              </div>
            )}
          </form>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-amber-50 to-white border-amber-200/60">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">How it works</h2>
          <ol className="space-y-3 text-sm text-gray-600 list-decimal list-inside">
            <li>Set your <strong>selling prices</strong> for MTN, Telecel, and AirtelTigo.</li>
            <li>Enter your <strong>store name</strong> and contact details.</li>
            <li>Click save — your unique <strong>main-domain link</strong> is created.</li>
            <li>Share your link — customers buy from your store; you earn profit on every order.</li>
          </ol>
        </Card>
      </div>
    </DashboardLayout>
  );
}
