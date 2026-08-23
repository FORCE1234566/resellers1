import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import StoreLayout, { StoreTab } from '@/components/store/StoreLayout';
import OrderHistoryPanel from '@/components/store/OrderHistoryPanel';
import StoreLoadState from '@/components/store/StoreLoadState';
import Button from '@/components/ui/Button';
import { ChevronDown } from 'lucide-react';
import StoreContactLinks from '@/components/store/StoreContactLinks';
import { FeatureCard, ServiceCard, InfoCard } from '@/components/ui/ModernCard';
import { getNetworkImage } from '@/lib/network-images';
import { normalizeStoreServices } from '@/lib/store-services';
import { useParams, Link, useLocation, useSearchParams, useNavigate } from 'react-router';
import { buildStoreBuyPath, buildStoreHomePath, buildStoreAfaPath, buildStoreCheckerPath, buildStoreBecomeResellerPath, persistStoreRef, normalizeStoreSlug } from '@/lib/reseller-store-ref';
import { fetchStore } from '@/lib/store-api';

interface StoreInfo {
  storeName: string;
  slug: string;
  phone: string;
  whatsapp: string;
  whatsappChannelUrl?: string;
  supportEmail: string;
  subResellerSignupOpen?: boolean;
  serviceImages: Array<{ network: string; imageUrl: string; isAvailable: boolean }>;
  afa?: { inStock: boolean; imageUrl?: string };
  checker?: { inStock: boolean; imageUrl?: string };
}

export default function StoreHomePage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const slug = normalizeStoreSlug(params.slug as string || '');
  const tabParam = searchParams.get('tab') as StoreTab | null;
  const paidSuccess = searchParams.get('paid') === '1';
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [faqs, setFaqs] = useState<Array<{ question: string; answer: string }>>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<StoreTab>(
    tabParam || (location.state as { tab?: StoreTab })?.tab || 'home'
  );

  useEffect(() => {
    if (tabParam) setActiveTab(tabParam);
  }, [tabParam]);

  useEffect(() => {
    if (!slug) return;
    persistStoreRef(slug);
    setLoading(true);
    setLoadError('');
    setStore(null);

    fetchStore<StoreInfo>(slug)
      .then((data) => {
        setStore(data);
        document.title = `${data.storeName} — Data bundles`;
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Store not found'))
      .finally(() => setLoading(false));

    api.get(`/store/${encodeURIComponent(slug)}/faqs`)
      .then((res) => setFaqs(res.data.data))
      .catch(() => setFaqs([]));
  }, [slug, retryKey]);

  const handleTabChange = (tab: StoreTab) => {
    setActiveTab(tab);
    if (!slug) return;
    const extra: Record<string, string> = {};
    if (tab !== 'home') extra.tab = tab;
    if (paidSuccess) extra.paid = '1';
    navigate(buildStoreHomePath(slug, Object.keys(extra).length ? extra : undefined), { replace: true });
  };

  if (!slug) {
    return <StoreLoadState loading={false} error="Invalid store link" />;
  }

  if (loading || loadError) {
    return (
      <StoreLoadState
        loading={loading}
        error={loadError}
        onRetry={() => setRetryKey((key) => key + 1)}
      />
    );
  }
  if (!store) return null;

  const buyPath = (network: string) => buildStoreBuyPath(slug, network);
  const afaPath = buildStoreAfaPath(slug);
  const checkerPath = buildStoreCheckerPath(slug);

  const services = normalizeStoreServices(store.serviceImages || []);
  const afaAvailable = store.afa?.inStock ?? false;
  const checkerAvailable = store.checker?.inStock ?? false;

  return (
    <StoreLayout store={store} activeTab={activeTab} onTabChange={handleTabChange}>
      {activeTab === 'home' && (
        <>
          <section className="relative py-16 lg:py-24 overflow-hidden">
            <div className="max-w-6xl mx-auto px-4 text-center relative z-10">
              <h1 className="text-2xl sm:text-3xl lg:text-5xl font-bold text-white mb-4">
                {store.storeName}
              </h1>
              <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto">
                Fast, reliable data bundles for all networks in Ghana. Buy now and get instant delivery.
              </p>
              <Button size="lg" className="shadow-none" onClick={() => handleTabChange('services')}>
                Buy Data Now
              </Button>
            </div>
          </section>

          <section className="py-16 border-t border-navy-border">
            <div className="max-w-6xl mx-auto px-4">
              <h2 className="text-xl sm:text-2xl font-bold text-center text-white mb-10">Why Choose Us</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
                {[
                  { title: 'Instant Activation', desc: 'Data delivered in minutes' },
                  { title: 'Secure Payments', desc: 'Paystack secured checkout' },
                  { title: '24/7 Support', desc: 'Call us anytime' },
                  { title: 'Competitive Pricing', desc: 'Best rates guaranteed' },
                ].map((item) => (
                  <FeatureCard key={item.title} title={item.title} description={item.desc} />
                ))}
              </div>
            </div>
          </section>

          {store.subResellerSignupOpen !== false && (
            <section className="py-12 border-t border-navy-border">
              <div className="max-w-xl mx-auto px-4 text-center">
                <h2 className="text-lg font-bold text-white mb-2">Want to sell data too?</h2>
                <p className="text-sm text-gray-400 mb-5">
                  Create your own store and set your prices on top of ours.
                </p>
                <Link to={buildStoreBecomeResellerPath(slug)}>
                  <Button variant="primary">Become a Reseller</Button>
                </Link>
              </div>
            </section>
          )}
        </>
      )}

      {activeTab === 'services' && (
        <section className="py-16">
          <div className="max-w-6xl mx-auto px-4">
            <h2 className="text-xl sm:text-2xl font-bold text-center text-white mb-10">Our Services</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
              {services.map((service) => (
                <ServiceCard
                  key={service.network}
                  name={service.network}
                  imageUrl={getNetworkImage(service.network) || service.imageUrl}
                  badge={service.isAvailable ? 'Available' : 'Unavailable'}
                  badgeVariant={service.isAvailable ? 'available' : 'unavailable'}
                  action={
                    service.isAvailable ? (
                      <Link to={buyPath(service.network)} className="w-full">
                        <Button className="w-full" size="sm">
                          View Plans
                        </Button>
                      </Link>
                    ) : undefined
                  }
                />
              ))}
              {store.afa && (
                <ServiceCard
                  name="MTN AFA Registration"
                  imageUrl={store.afa.imageUrl || '/images/afa.jpg'}
                  badge={afaAvailable ? 'Available' : 'Unavailable'}
                  badgeVariant={afaAvailable ? 'available' : 'unavailable'}
                  action={
                    afaAvailable ? (
                      <Link to={afaPath} className="w-full">
                        <Button className="w-full" size="sm">
                          Register
                        </Button>
                      </Link>
                    ) : undefined
                  }
                />
              )}
              <ServiceCard
                name="Results Checker"
                imageUrl={store.checker?.imageUrl || '/images/waec-checker.png'}
                badge={checkerAvailable ? 'Available' : 'Unavailable'}
                badgeVariant={checkerAvailable ? 'available' : 'unavailable'}
                action={
                  checkerAvailable ? (
                    <Link to={checkerPath} className="w-full">
                      <Button className="w-full" size="sm">
                        Buy Checker
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            </div>
          </div>
        </section>
      )}

      {activeTab === 'history' && (
        <>
          {paidSuccess && (
            <div className="max-w-3xl mx-auto px-4 mb-4">
              <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg text-center">
                Payment successful. Enter your email below to view your order status.
              </p>
            </div>
          )}
          <OrderHistoryPanel slug={slug} storeName={store.storeName} />
        </>
      )}

      {activeTab === 'faq' && (
        <section className="py-16">
          <div className="max-w-3xl mx-auto px-4">
            <h2 className="text-xl sm:text-2xl font-bold text-center text-white mb-10">
              Frequently Asked Questions
            </h2>
            <div className="space-y-3">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="bg-navy-card/60 backdrop-blur-sm border border-navy-border rounded-2xl overflow-hidden hover:border-gold/30 transition-all duration-300"
                >
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 p-4 text-left font-medium text-white hover:bg-white/5"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span className="min-w-0 flex-1 pr-2">{faq.question}</span>
                    <ChevronDown
                      className={`w-5 h-5 text-gold shrink-0 transition ${openFaq === i ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {openFaq === i && (
                    <div className="px-4 pb-4 text-sm text-gray-400">{faq.answer}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'contact' && (
        <section className="py-16">
          <div className="max-w-md mx-auto px-4 text-center">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-6">Contact Us</h2>
            <InfoCard label="Support line" value={store.phone} className="text-center" />
            <div className="mt-6">
              <StoreContactLinks
                phone={store.phone}
                whatsapp={store.whatsapp}
                whatsappChannelUrl={store.whatsappChannelUrl}
                storeName={store.storeName}
                layout="stacked"
              />
            </div>
          </div>
        </section>
      )}
    </StoreLayout>
  );
}
