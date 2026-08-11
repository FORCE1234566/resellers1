import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
  panelTableCellClass,
} from '@/components/ui/PanelTable';
import Button from '@/components/ui/Button';
import { cn, formatCurrency } from '@/lib/utils';
import { computeResellerProfit, formatProfitRange } from '@/lib/reseller-profit';
import { useNavigate } from 'react-router';
import { Loader2, Plus, RefreshCw, Save } from 'lucide-react';
import NetworkStockBar, { NetworkStockRow } from '@/components/network/NetworkStockBar';
import AdminAddPackageModal from '@/components/admin/AdminAddPackageModal';
import { sortPackagesByBundleSize } from '@/lib/bundle-size';

type PackageRow = {
  _id: string;
  network: string;
  bundleSize: string;
  productType?: string;
  costPrice: number;
  datamaxCostPrice?: number | null;
  smartDataHubCostPrice?: number | null;
  AgentPrice: number;
  resellerBasePrice: number;
  maxSellingPrice: number;
  isEnabled: boolean;
};

type FulfillmentSnapshot = {
  enabled: boolean;
  defaultProvider: 'smartdatahub' | 'datamax';
  networkRouting: Record<string, 'default' | 'smartdatahub' | 'datamax' | 'off'>;
};

function resolveNetworkFulfillmentProvider(
  fulfillment: FulfillmentSnapshot | null,
  network: string
): 'smartdatahub' | 'datamax' | null {
  if (!fulfillment?.enabled) return null;
  const route = fulfillment.networkRouting[network] ?? 'default';
  if (route === 'off') return null;
  if (route === 'default') return fulfillment.defaultProvider;
  return route;
}

function effectiveApiCost(
  pkg: Pick<PackageRow, 'network' | 'costPrice' | 'datamaxCostPrice' | 'smartDataHubCostPrice'>,
  draftCostPrice: number,
  fulfillment: FulfillmentSnapshot | null
): number {
  const provider = resolveNetworkFulfillmentProvider(fulfillment, pkg.network);
  if (provider === 'smartdatahub' && pkg.smartDataHubCostPrice != null) {
    return pkg.smartDataHubCostPrice;
  }
  if (provider === 'datamax' && pkg.datamaxCostPrice != null) {
    return pkg.datamaxCostPrice;
  }
  return draftCostPrice;
}

type ApiPackageRow = PackageRow & { agentPrice?: number };

function normalizePackage(p: ApiPackageRow): PackageRow {
  return {
    ...p,
    AgentPrice: p.AgentPrice ?? p.agentPrice ?? 0,
  };
}

type PriceDraft = {
  costPrice: string;
  AgentPrice: string;
  resellerBasePrice: string;
  maxSellingPrice: string;
};

const emptyDraft = (): PriceDraft => ({
  costPrice: '',
  AgentPrice: '',
  resellerBasePrice: '',
  maxSellingPrice: '',
});

function draftsFromPackages(list: PackageRow[]): Record<string, PriceDraft> {
  return Object.fromEntries(
    list.map((p) => [
      p._id,
      {
        costPrice: String(p.costPrice),
        AgentPrice: String(p.AgentPrice),
        resellerBasePrice: String(p.resellerBasePrice),
        maxSellingPrice: String(p.maxSellingPrice),
      },
    ])
  );
}

function draftChanged(pkg: PackageRow, draft: PriceDraft) {
  return (
    parseFloat(draft.costPrice) !== pkg.costPrice ||
    parseFloat(draft.AgentPrice) !== pkg.AgentPrice ||
    parseFloat(draft.resellerBasePrice) !== pkg.resellerBasePrice ||
    parseFloat(draft.maxSellingPrice) !== pkg.maxSellingPrice
  );
}

export default function AdminPackagesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({});
  const [filter, setFilter] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [networkStock, setNetworkStock] = useState<NetworkStockRow[]>([]);
  const [afaStock, setAfaStock] = useState<{ inStock: boolean; imageUrl?: string } | null>(null);
  const [stockToggling, setStockToggling] = useState<string | null>(null);
  const [afaStockToggling, setAfaStockToggling] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [fulfillment, setFulfillment] = useState<FulfillmentSnapshot | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const load = useCallback(async () => {
    setPageLoading(true);
    setError('');
    try {
      const [pkgRes, stockRes, afaRes, fulfillmentRes] = await Promise.all([
        api.get('/admin/packages'),
        api.get('/admin/network-stock'),
        api.get('/admin/afa-stock'),
        api.get('/admin/settings/fulfillment'),
      ]);
      const list = (pkgRes.data.data as ApiPackageRow[]).map(normalizePackage);
      setPackages(list);
      setDrafts(draftsFromPackages(list));
      setNetworkStock(stockRes.data.data as NetworkStockRow[]);
      setAfaStock(afaRes.data.data as { inStock: boolean; imageUrl?: string });
      setFulfillment(fulfillmentRes.data.data as FulfillmentSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packages');
      setPackages([]);
      setDrafts({});
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user, load]);

  const seedPackages = async () => {
    setSeeding(true);
    setError('');
    try {
      const res = await api.post('/admin/packages/seed');
      const list = (res.data.data as ApiPackageRow[]).map(normalizePackage);
      setPackages(list);
      setDrafts(draftsFromPackages(list));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load default packages');
    } finally {
      setSeeding(false);
    }
  };

  const updateDraft = (id: string, field: keyof PriceDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
    setSavedId(null);
  };

  const saveRow = async (pkg: PackageRow) => {
    const draft = drafts[pkg._id];
    if (!draft) return;
    setSavingId(pkg._id);
    setError('');
    try {
      await api.patch(`/admin/packages/${pkg._id}/prices`, {
        costPrice: parseFloat(draft.costPrice),
        agentPrice: parseFloat(draft.AgentPrice),
        resellerBasePrice: parseFloat(draft.resellerBasePrice),
        maxSellingPrice: parseFloat(draft.maxSellingPrice),
      });
      setPackages((prev) =>
        prev.map((p) =>
          p._id === pkg._id
            ? {
                ...p,
                costPrice: parseFloat(draft.costPrice),
                AgentPrice: parseFloat(draft.AgentPrice),
                resellerBasePrice: parseFloat(draft.resellerBasePrice),
                maxSellingPrice: parseFloat(draft.maxSellingPrice),
              }
            : p
        )
      );
      setSavedId(pkg._id);
      setTimeout(() => setSavedId((id) => (id === pkg._id ? null : id)), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prices');
    } finally {
      setSavingId(null);
    }
  };

  const toggleStock = async (network: string, inStock: boolean) => {
    setStockToggling(network);
    setError('');
    try {
      const res = await api.patch(`/admin/network-stock/${network}`, { inStock });
      setNetworkStock(res.data.data as NetworkStockRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update stock');
    } finally {
      setStockToggling(null);
    }
  };

  const toggleAfaStock = async (inStock: boolean) => {
    setAfaStockToggling(true);
    setError('');
    try {
      const res = await api.patch('/admin/afa-stock', { inStock });
      setAfaStock(res.data.data as { inStock: boolean; imageUrl?: string });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update AFA stock');
    } finally {
      setAfaStockToggling(false);
    }
  };

  const toggle = async (id: string) => {
    try {
      await api.patch(`/admin/packages/${id}/toggle`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle package');
    }
  };

  const filtered = sortPackagesByBundleSize(
    filter
      ? filter === 'Checkers'
        ? packages.filter((p) => p.productType === 'checker')
        : packages.filter((p) => p.network === filter && p.productType !== 'checker')
      : packages
  );
  const networks = [...new Set(packages.map((p) => p.network))];

  if (loading || !user) return null;

  return (
    <DashboardLayout role="admin">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Data Packages</h1>
          <p className="text-sm text-gray-400">
            Edit Smart Data API cost, Agent &amp; reseller prices anytime — admin profit updates live.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add package
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={pageLoading}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}

      <Card className="p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Network stock</h2>
        <NetworkStockBar
          stock={networkStock}
          onToggle={toggleStock}
          togglingNetwork={stockToggling}
        />
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">MTN AFA Registration stock</h2>
            <p className="text-xs text-gray-500 mt-1">
              Toggle availability for agents and reseller stores. Edit AFA prices in the table below.
            </p>
          </div>
          {afaStock && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-xs font-medium px-2 py-1 rounded-full',
                  afaStock.inStock ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                )}
              >
                {afaStock.inStock ? 'In stock' : 'Out of stock'}
              </span>
              <Button
                size="sm"
                variant="outline"
                loading={afaStockToggling}
                onClick={() => toggleAfaStock(!afaStock.inStock)}
              >
                Mark {afaStock.inStock ? 'out of stock' : 'in stock'}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Button size="sm" variant={!filter ? 'primary' : 'outline'} onClick={() => setFilter('')}>All</Button>
        {networks.map((n) => (
          <Button key={n} size="sm" variant={filter === n ? 'primary' : 'outline'} onClick={() => setFilter(n)}>{n}</Button>
        ))}
        <Button size="sm" variant={filter === 'Checkers' ? 'primary' : 'outline'} onClick={() => setFilter('Checkers')}>
          Checkers
        </Button>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading packages...
        </div>
      ) : packages.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-gray-900 font-medium mb-2">No packages found</p>
          <p className="text-sm text-gray-500 mb-4">Load default MTN, Telecel &amp; AirtelTigo bundles to start editing prices.</p>
          <Button onClick={seedPackages} disabled={seeding}>
            {seeding ? 'Loading...' : 'Load default packages'}
          </Button>
        </Card>
      ) : (
        <PanelTable>
          <PanelTableHeader
            title={filter || 'All networks'}
            subtitle="Agent price applies to Buy Data and Bulk Purchase — save each row after editing"
            trailing={`${filtered.length} bundles`}
          />
          <PanelTableScroll minWidth={1100}>
            <thead className={panelTableHeadClass}>
              <tr>
                <th className={panelTableTh()}>Network</th>
                <th className={panelTableTh()}>Bundle</th>
                <th className={panelTableTh()}>API cost (Smart Data)</th>
                <th className={panelTableTh('amber')}>Agent (GHS)</th>
                <th className={panelTableTh('blue')}>Reseller Base (GHS)</th>
                <th className={panelTableTh('blue')}>Max Sell (GHS)</th>
                <th className={panelTableTh('violet')}>Admin profit</th>
                <th className={panelTableTh('emerald')}>Reseller profit (max)</th>
                <th className={panelTableTh()}>Status</th>
                <th className={panelTableTh()}>Save</th>
              </tr>
            </thead>
            <tbody>
                {filtered.map((p) => {
                  const draft = drafts[p._id] || emptyDraft();
                  const changed = draftChanged(p, draft);
                  const isSaving = savingId === p._id;
                  const justSaved = savedId === p._id;
                  const apiCost = effectiveApiCost(p, parseFloat(draft.costPrice), fulfillment);
                  const base = parseFloat(draft.resellerBasePrice);
                  const Agent = parseFloat(draft.AgentPrice);
                  const maxSell = parseFloat(draft.maxSellingPrice);
                  const adminProfitStore =
                    Number.isFinite(base) && Number.isFinite(apiCost)
                      ? formatCurrency(Math.max(0, base - apiCost))
                      : '—';
                  const adminProfitAgent =
                    Number.isFinite(Agent) && Number.isFinite(apiCost)
                      ? formatCurrency(Math.max(0, Agent - apiCost))
                      : '—';
                  const profitRange = Number.isFinite(base) && Number.isFinite(maxSell)
                    ? formatProfitRange(0, computeResellerProfit(maxSell, base))
                    : '—';
                  return (
                    <tr key={p._id} className={panelTableRowClass}>
                      <td className={cn(panelTableCellClass, 'font-medium text-gray-900')}>{p.network}</td>
                      <td className={cn(panelTableCellClass, 'text-gray-900')}>{p.bundleSize}</td>
                      <td className={panelTableCellClass}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft.costPrice}
                          onChange={(e) => updateDraft(p._id, 'costPrice', e.target.value)}
                          className="w-28 px-2 py-1.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400/50"
                        />
                        {p.smartDataHubCostPrice != null && (
                          <span className="block text-[10px] text-emerald-600 mt-0.5">
                            Smart Data Hub: {formatCurrency(p.smartDataHubCostPrice)}
                          </span>
                        )}
                        {p.network === 'MTN' && p.datamaxCostPrice != null && (
                          <span className="block text-[10px] text-gray-400 mt-0.5">
                            Datamax: {formatCurrency(p.datamaxCostPrice)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft.AgentPrice}
                          onChange={(e) => updateDraft(p._id, 'AgentPrice', e.target.value)}
                          className="w-28 px-2 py-1.5 rounded-lg border border-amber-300 bg-amber-50/50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft.resellerBasePrice}
                          onChange={(e) => updateDraft(p._id, 'resellerBasePrice', e.target.value)}
                          className="w-28 px-2 py-1.5 rounded-lg border border-blue-300 bg-blue-50/50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft.maxSellingPrice}
                          onChange={(e) => updateDraft(p._id, 'maxSellingPrice', e.target.value)}
                          className="w-28 px-2 py-1.5 rounded-lg border border-blue-300 bg-blue-50/50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                        />
                      </td>
                      <td className="px-4 py-3 text-violet-700 text-xs font-medium whitespace-nowrap">
                        {adminProfitStore}
                        <span className="block text-[10px] text-gray-400 font-normal">store: base − API</span>
                        <span className="block text-[10px] text-gray-500">{adminProfitAgent} Agent</span>
                      </td>
                      <td className="px-4 py-3 text-emerald-700 text-xs font-medium whitespace-nowrap">
                        {profitRange}
                        <span className="block text-[10px] text-gray-400 font-normal">max sell − base</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggle(p._id)}
                          className={`px-2 py-1 rounded-full text-xs font-medium ${p.isEnabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {p.isEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          onClick={() => saveRow(p)}
                          disabled={isSaving || !changed}
                          variant={justSaved ? 'primary' : changed ? 'primary' : 'outline'}
                        >
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : justSaved ? (
                            'Saved'
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5 mr-1" />
                              Save
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </PanelTableScroll>
        </PanelTable>
      )}

      {showAddModal && (
        <AdminAddPackageModal onClose={() => setShowAddModal(false)} onSuccess={load} />
      )}
    </DashboardLayout>
  );
}
