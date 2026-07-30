import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Loader2, Users } from 'lucide-react';
import { buildResellerStoreUrl } from '@/lib/reseller-store-ref';

interface SubResellerRow {
  _id: string;
  fullName: string;
  email: string;
  phone: string;
  status: string;
  storeName?: string;
  slug?: string;
  isActive?: boolean;
  pricesReady: boolean;
  parentPricesConfigured: boolean;
  createdAt: string;
}

interface ListMeta {
  subResellerSignupReady: boolean;
  subResellerSignupReason?: string;
  templateConfigured: number;
  templateRequired: number;
}

export default function ResellerSubResellersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SubResellerRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');
  }, [user, loading, navigate]);

  const load = () => {
    setPageLoading(true);
    api
      .get('/reseller/sub-resellers')
      .then((res) => {
        setRows(res.data.data);
        setMeta(res.data.meta ?? null);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setPageLoading(false));
  };

  useEffect(() => {
    if (user?.role === 'reseller') load();
  }, [user]);

  if (loading || !user) return null;

  const storeSlug = user.resellerStore?.slug;
  const signupUrl = storeSlug ? buildResellerStoreUrl(storeSlug) : '';

  return (
    <DashboardLayout role="reseller">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">My Resellers</h1>
      <p className="text-sm text-gray-400 mb-4">
        Set default prices for all products before sharing your signup link. You can override prices per reseller later.
      </p>

      <div className="flex flex-wrap gap-3 mb-6">
        <Link to="/reseller/sub-resellers/default-prices">
          <Button variant="primary">Default Sub-Reseller Prices</Button>
        </Link>
      </div>

      {meta && (
        <Card
          className={`p-4 mb-4 ${meta.subResellerSignupReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
        >
          <p className="text-sm font-medium text-gray-900">
            {meta.subResellerSignupReady
              ? 'Signup link is open — visitors can tap Become a Reseller on your store'
              : `Complete default pricing to open signup (${meta.templateConfigured}/${meta.templateRequired} products)`}
          </p>
          {!meta.subResellerSignupReady && meta.subResellerSignupReason && (
            <p className="text-sm text-gray-600 mt-1">{meta.subResellerSignupReason}</p>
          )}
          {meta.subResellerSignupReady && signupUrl && (
            <p className="text-sm text-gray-600 mt-2 break-all">
              Store link:{' '}
              <a href={signupUrl} className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">
                {signupUrl}
              </a>
            </p>
          )}
        </Card>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading...
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">No sub-resellers yet</p>
          <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            {meta?.subResellerSignupReady
              ? 'Share your store link — visitors can tap "Become a Reseller" to register under you.'
              : 'Finish default sub-reseller prices first, then share your store link.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row._id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{row.fullName}</p>
                <p className="text-sm text-gray-600">{row.storeName || 'Unnamed store'}</p>
                <p className="text-xs text-gray-500 mt-1">{row.email} · {row.phone}</p>
                {row.slug && (
                  <a
                    href={buildResellerStoreUrl(row.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-violet-600 hover:underline mt-1 inline-block"
                  >
                    {buildResellerStoreUrl(row.slug)}
                  </a>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${row.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {row.status}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${row.parentPricesConfigured ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                    {row.parentPricesConfigured ? 'Prices set' : 'Needs prices'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${row.pricesReady ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                    {row.pricesReady ? 'Store live' : 'Store not ready'}
                  </span>
                </div>
              </div>
              <Link to={`/reseller/sub-resellers/${row._id}/prices`}>
                <Button size="sm">Set Prices</Button>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
