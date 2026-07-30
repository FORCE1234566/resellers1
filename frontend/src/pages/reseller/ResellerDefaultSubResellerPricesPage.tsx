import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCurrency, cn } from '@/lib/utils';
import { computeResellerProfit, computeSubResellerMaxFromFloor } from '@/lib/reseller-profit';
import { buildResellerStoreUrl } from '@/lib/reseller-store-ref';
import { Loader2, ArrowLeft } from 'lucide-react';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
  panelTableCellClass,
} from '@/components/ui/PanelTable';

interface PriceRow {
  _id: string;
  network: string;
  bundleSize: string;
  parentCost: number;
  maxCeiling: number;
  inheritedMarkup: number;
  adminCostPrice: number;
  adminMaxSellingPrice: number;
  assignedFloor?: number;
  assignedMax?: number;
  minProfitPerSale?: number;
  maxProfitPerSale?: number;
}

interface TemplateMeta {
  templateReady: boolean;
  configuredCount: number;
  requiredCount: number;
  signupOpen: boolean;
  signupReason?: string;
}

function resolveTheirMax(row: PriceRow, draftFloor: number | undefined): number | undefined {
  if (draftFloor === undefined || !Number.isFinite(draftFloor)) {
    return row.assignedMax;
  }
  return computeSubResellerMaxFromFloor(
    draftFloor,
    row.adminCostPrice,
    row.adminMaxSellingPrice
  );
}

export default function ResellerDefaultSubResellerPricesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [packages, setPackages] = useState<PriceRow[]>([]);
  const [checkerPackages, setCheckerPackages] = useState<PriceRow[]>([]);
  const [afaPackages, setAfaPackages] = useState<PriceRow[]>([]);
  const [meta, setMeta] = useState<TemplateMeta | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [floor, setFloor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');
  }, [user, loading, navigate]);

  const load = () => {
    setPageLoading(true);
    api
      .get('/reseller/sub-reseller-default-prices')
      .then((res) => {
        setPackages(res.data.data.packages);
        setCheckerPackages(res.data.data.checkerPackages || []);
        setAfaPackages(res.data.data.afaPackages || []);
        setMeta(res.data.data.meta);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setPageLoading(false));
  };

  useEffect(() => {
    if (user?.role === 'reseller') load();
  }, [user]);

  const savePrices = async (packageId: string) => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/reseller/sub-reseller-default-prices/${packageId}`, {
        floor: parseFloat(floor),
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update prices');
    } finally {
      setSaving(false);
    }
  };

  const renderTable = (title: string, rows: PriceRow[]) => (
    <PanelTable>
      <PanelTableHeader title={title} trailing={`${rows.length} items`} />
      <PanelTableScroll minWidth={720}>
        <thead className={panelTableHeadClass}>
          <tr>
            <th className={panelTableTh()}>Bundle</th>
            <th className={panelTableTh()}>Your cost</th>
            <th className={panelTableTh()}>Your max</th>
            <th className={panelTableTh()}>Their base</th>
            <th className={panelTableTh()}>Their max</th>
            <th className={panelTableTh('emerald')}>Your margin</th>
            <th className={panelTableTh()}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const draftFloor =
              editing === p._id
                ? parseFloat(floor)
                : p.assignedFloor;
            const theirMax = resolveTheirMax(p, draftFloor);
            const minProfit =
              draftFloor !== undefined && Number.isFinite(draftFloor)
                ? computeResellerProfit(draftFloor, p.parentCost)
                : 0;
            const maxProfit =
              theirMax !== undefined && Number.isFinite(theirMax)
                ? computeResellerProfit(theirMax, p.parentCost)
                : p.maxProfitPerSale ?? 0;
            return (
              <tr key={p._id} className={panelTableRowClass}>
                <td className={cn(panelTableCellClass, 'font-medium text-gray-900')}>
                  {p.network !== 'MTN' || p.bundleSize.includes('GB') ? p.bundleSize : `${p.network} ${p.bundleSize}`}
                </td>
                <td className={cn(panelTableCellClass, 'text-gray-600')}>{formatCurrency(p.parentCost)}</td>
                <td className={cn(panelTableCellClass, 'text-gray-600')}>{formatCurrency(p.maxCeiling)}</td>
                <td className={panelTableCellClass}>
                  {editing === p._id ? (
                    <input
                      type="number"
                      step="0.01"
                      min={p.parentCost}
                      max={p.maxCeiling}
                      value={floor}
                      onChange={(e) => setFloor(e.target.value)}
                      className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold/50 focus:border-gold outline-none"
                    />
                  ) : (
                    <span className="font-semibold text-violet-700">
                      {p.assignedFloor !== undefined ? formatCurrency(p.assignedFloor) : '—'}
                    </span>
                  )}
                </td>
                <td className={panelTableCellClass}>
                  <span className="font-semibold text-violet-700">
                    {theirMax !== undefined ? formatCurrency(theirMax) : '—'}
                  </span>
                  <span className="block text-[10px] text-gray-400">
                    +{formatCurrency(p.inheritedMarkup)} markup
                  </span>
                </td>
                <td className={panelTableCellClass}>
                  <span className="font-semibold text-emerald-700">
                    {formatCurrency(minProfit)} – {formatCurrency(maxProfit)}
                  </span>
                </td>
                <td className={panelTableCellClass}>
                  {editing === p._id ? (
                    <div className="flex gap-2">
                      <Button size="sm" loading={saving} onClick={() => savePrices(p._id)}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(p._id);
                        setFloor(String(p.assignedFloor ?? p.parentCost));
                        setError('');
                      }}
                    >
                      {p.assignedFloor !== undefined ? 'Edit' : 'Set'}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </PanelTableScroll>
    </PanelTable>
  );

  if (loading || !user) return null;

  const storeSlug = user.resellerStore?.slug;
  const signupUrl = storeSlug ? buildResellerStoreUrl(storeSlug) : '';

  return (
    <DashboardLayout role="reseller">
      <Link
        to="/reseller/sub-resellers"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to My Resellers
      </Link>

      <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Default Sub-Reseller Prices</h1>
      <p className="text-sm text-gray-400 mb-6">
        Set the base price for each product before anyone can register under your store. Their maximum
        selling price is calculated automatically: base + your inherited markup from admin.
      </p>

      {meta && (
        <Card className={cn('p-4 mb-4', meta.templateReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          <p className="text-sm font-medium text-gray-900">
            {meta.templateReady
              ? 'All products configured — signup link is open'
              : `Configure all products to open signup (${meta.configuredCount}/${meta.requiredCount} done)`}
          </p>
          {!meta.signupOpen && meta.signupReason && (
            <p className="text-sm text-gray-600 mt-1">{meta.signupReason}</p>
          )}
          {meta.signupOpen && signupUrl && (
            <p className="text-sm text-gray-600 mt-2 break-all">
              Share: <a href={signupUrl} className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">{signupUrl}</a>
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
      ) : (
        <div className="space-y-6">
          {packages.length > 0 && renderTable('Data Bundles', packages)}
          {afaPackages.length > 0 && renderTable('MTN AFA Registration', afaPackages)}
          {checkerPackages.length > 0 && renderTable('Results Checkers', checkerPackages)}
        </div>
      )}
    </DashboardLayout>
  );
}
