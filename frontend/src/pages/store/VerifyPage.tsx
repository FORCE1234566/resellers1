import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import StoreLayout from '@/components/store/StoreLayout';
import { Card } from '@/components/ui/Card';
import { ShieldCheck } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useNavigate, useParams } from 'react-router';
import { StoreTab } from '@/components/store/StoreLayout';
import { normalizeStoreSlug } from '@/lib/reseller-store-ref';

export default function VerifyPage() {
  const params = useParams();
  const navigate = useNavigate();
  const slug = normalizeStoreSlug(params.slug as string || '');

  const handleTabChange = (tab: StoreTab) => {
    navigate(`/store/${slug}`, { state: { tab } });
  };
  const [store, setStore] = useState<Record<string, string> | null>(null);
  const [verify, setVerify] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.get(`/store/${slug}`).then((res) => setStore(res.data.data));
    api.get(`/store/${slug}/verify`).then((res) => setVerify(res.data.data));
  }, [slug]);

  if (!store || !verify) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <StoreLayout
      store={store as { storeName: string; slug: string; phone: string; whatsapp: string; supportEmail: string }}
      activeTab="home"
      onTabChange={handleTabChange}
    >
      <div className="max-w-md mx-auto px-4 py-16">
        <Card className="p-8 text-center">
          <div className="inline-flex p-4 bg-green-100 text-green-600 rounded-full mb-4">
            <ShieldCheck className="w-10 h-10" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{verify.storeName as string}</h1>
          <p className="text-green-600 font-semibold mb-6">{verify.verificationStatus as string}</p>

          <div className="space-y-3 text-sm text-left">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-4 py-2 border-b">
              <span className="text-gray-500 shrink-0">Reseller ID</span>
              <span className="font-medium text-gray-900 break-all sm:text-right">{verify.resellerId as string}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">Member Since</span>
              <span className="font-medium">{formatDate(verify.registrationDate as string)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-500">Status</span>
              <span className={`font-medium ${verify.activeStatus === 'Active' ? 'text-green-600' : 'text-red-600'}`}>
                {verify.activeStatus as string}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </StoreLayout>
  );
}
