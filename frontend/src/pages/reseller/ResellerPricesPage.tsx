import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatCurrency, cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { getNetworkImage } from '@/lib/network-images';
import { computeResellerProfit } from '@/lib/reseller-profit';
import NetworkStockBar, { NetworkStockRow } from '@/components/network/NetworkStockBar';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  PanelTableEmpty,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
  panelTableCellClass,
} from '@/components/ui/PanelTable';

const NETWORK_ORDER = ['MTN', 'Telecel', 'AirtelTigo'] as const;

interface PackageRow {
  _id: string;
  network: string;
  bundleSize: string;
  resellerBasePrice: number;
  maxSellingPrice: number;
  myPrice: number;
  profitPerSale: number;
  maxProfitPerSale: number;
}

export default function ResellerPricesPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [checkerPackages, setCheckerPackages] = useState<PackageRow[]>([]);
  const [afaPackage, setAfaPackage] = useState<PackageRow | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pricingMeta, setPricingMeta] = useState<{
    pricesReady: boolean;
    networksMissing: string[];
    configuredCount: number;
    requiredCount: number;
    parentPricesReady?: boolean;
    parentPricesPending?: boolean;
    parentNetworksMissing?: string[];
    hasParent?: boolean;
    networkStock?: NetworkStockRow[];
    afaStock?: { inStock: boolean };
  } | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'reseller')) navigate('/login/reseller');
  }, [user, loading, navigate]);

  const loadPrices = () => {
    setPageLoading(true);
    setSessionExpired(false);
    api
      .get('/reseller/prices')
      .then((res) => {
        setPackages(res.data.data);
        setCheckerPackages((res.data.checkerPackages as PackageRow[]) || []);
        setAfaPackage((res.data.afaPackage as PackageRow | null) ?? null);
        if (res.data.meta) setPricingMeta(res.data.meta);
        setError('');
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load prices';
        setError(message);
        if (message.includes('Account not found') || message.includes('Authentication required')) {
          setSessionExpired(true);
        }
      })
      .finally(() => setPageLoading(false));
  };

  useEffect(() => {
    if (user?.role === 'reseller') loadPrices();
  }, [user]);

  const savePrice = async (packageId: string) => {
    setError('');
    setSaving(true);
    try {
      await api.put(`/reseller/prices/${packageId}`, { price: parseFloat(price) });
      setEditing(null);
      loadPrices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update price');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) return null;

  const grouped = packages.reduce<Record<string, PackageRow[]>>((acc, pkg) => {
    if (!acc[pkg.network]) acc[pkg.network] = [];
    acc[pkg.network].push(pkg);
    return acc;
  }, {});

  const orderedNetworks = NETWORK_ORDER.filter((network) => grouped[network]?.length);
  const networkStock = pricingMeta?.networkStock ?? [];
  const stockByNetwork = Object.fromEntries(networkStock.map((row) => [row.network, row.inStock]));
  const afaInStock = pricingMeta?.afaStock?.inStock ?? true;

  const renderPriceRow = (p: PackageRow, inStock: boolean) => {
    const draftPrice = editing === p._id ? parseFloat(price) : p.myPrice;
    const liveProfit = Number.isFinite(draftPrice)
      ? computeResellerProfit(draftPrice, p.resellerBasePrice)
      : p.profitPerSale;
    return (
      <tr key={p._id} className={panelTableRowClass}>
        <td className={cn(panelTableCellClass, 'font-medium text-gray-900')}>{p.bundleSize}</td>
        <td className={cn(panelTableCellClass, 'text-gray-600')}>{formatCurrency(p.resellerBasePrice)}</td>
        <td className={cn(panelTableCellClass, 'text-gray-600')}>{formatCurrency(p.maxSellingPrice)}</td>
        <td className={panelTableCellClass}>
          {editing === p._id ? (
            <input
              type="number"
              step="0.01"
              min={p.resellerBasePrice}
              max={p.maxSellingPrice}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold/50 focus:border-gold outline-none"
            />
          ) : (
            <span className="font-semibold text-emerald-700">{formatCurrency(p.myPrice)}</span>
          )}
        </td>
        <td className={panelTableCellClass}>
          <span className="font-semibold text-emerald-700">{formatCurrency(liveProfit)}</span>
        </td>
        <td className={panelTableCellClass}>
          {!inStock ? (
            <span className="text-xs text-amber-700 font-medium">Out of stock</span>
          ) : pricingMeta?.parentPricesPending ? (
            <span className="text-xs text-violet-600 font-medium">Awaiting parent</span>
          ) : editing === p._id ? (
            <div className="flex gap-2">
              <Button size="sm" loading={saving} onClick={() => savePrice(p._id)}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(p._id);
                setPrice(String(p.myPrice));
                setError('');
              }}
            >
              Edit
            </Button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <DashboardLayout role="reseller">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Price Management</h1>
      <p className="text-sm text-gray-400 mb-6">
        Set your selling price above your cost (floor). Your profit per sale is{' '}
        <span className="text-gold font-medium">your price − cost</span> — credited to your wallet when an order is delivered.
      </p>

      {pricingMeta?.parentPricesPending && (
        <Card className="p-4 mb-4 border-violet-200 bg-violet-50">
          <p className="text-sm font-medium text-gray-900">Waiting for your parent reseller</p>
          <p className="text-sm text-gray-600 mt-1">
            Your parent must set your floor and max prices for all products before you can configure selling prices.
            {pricingMeta.parentNetworksMissing && pricingMeta.parentNetworksMissing.length > 0 && (
              <> Missing networks: {pricingMeta.parentNetworksMissing.join(', ')}.</>
            )}
          </p>
        </Card>
      )}

      {pricingMeta && !pricingMeta.pricesReady && !pricingMeta.parentPricesPending && (
        <Card className="p-4 mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-gray-900">Set prices for every network to open your store</p>
          <p className="text-sm text-gray-600 mt-1">
            {pricingMeta.configuredCount} of {pricingMeta.requiredCount} networks done.
            {pricingMeta.networksMissing.length > 0 && (
              <> Still needed: {pricingMeta.networksMissing.join(', ')}.</>
            )}
          </p>
        </Card>
      )}

      {error && !sessionExpired && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}

      {!sessionExpired && networkStock.length > 0 && (
        <Card className="p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Network stock</h2>
          <NetworkStockBar stock={networkStock} readOnly />
        </Card>
      )}

      {sessionExpired ? (
        <Card className="p-8 text-center max-w-md">
          <p className="text-gray-900 font-medium mb-2">Session expired</p>
          <p className="text-sm text-gray-500 mb-6">
            Your login is no longer valid. Please sign in again to manage prices.
          </p>
          <Button
            onClick={() => {
              logout();
              navigate('/login/reseller');
            }}
          >
            Log in again
          </Button>
        </Card>
      ) : pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading packages...
        </div>
      ) : packages.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-900 font-medium">No packages available yet.</p>
          <p className="text-sm text-gray-500 mt-2">
            Ask admin to enable MTN, Telecel, and AirtelTigo packages on the platform.
          </p>
          <Button variant="outline" className="mt-4" onClick={loadPrices}>
            Retry
          </Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {orderedNetworks.map((network) => {
            const items = grouped[network];
            const imageUrl = getNetworkImage(network);
            const inStock = stockByNetwork[network] ?? true;
            return (
              <PanelTable key={network}>
                <PanelTableHeader
                  title={network}
                  imageUrl={imageUrl || undefined}
                  trailing={
                    inStock
                      ? `${items.length} bundles`
                      : `${items.length} bundles · Out of stock`
                  }
                />
                <PanelTableScroll minWidth={560}>
                  <thead className={panelTableHeadClass}>
                    <tr>
                      <th className={panelTableTh()}>Bundle</th>
                      <th className={panelTableTh()}>{pricingMeta?.hasParent ? 'Your cost' : 'Min (Base)'}</th>
                      <th className={panelTableTh()}>Max</th>
                      <th className={panelTableTh()}>Your price</th>
                      <th className={panelTableTh('emerald')}>Your profit</th>
                      <th className={panelTableTh()}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => {
                      const draftPrice = editing === p._id ? parseFloat(price) : p.myPrice;
                      const liveProfit = Number.isFinite(draftPrice)
                        ? computeResellerProfit(draftPrice, p.resellerBasePrice)
                        : p.profitPerSale;
                      const atBase = !editing && p.myPrice === p.resellerBasePrice;
                      return (
                        <tr key={p._id} className={panelTableRowClass}>
                          <td className={cn(panelTableCellClass, 'font-medium text-gray-900')}>{p.bundleSize}</td>
                          <td className={cn(panelTableCellClass, 'text-gray-600')}>{formatCurrency(p.resellerBasePrice)}</td>
                          <td className={cn(panelTableCellClass, 'text-gray-600')}>{formatCurrency(p.maxSellingPrice)}</td>
                          <td className={panelTableCellClass}>
                            {editing === p._id ? (
                              <input
                                type="number"
                                step="0.01"
                                min={p.resellerBasePrice}
                                max={p.maxSellingPrice}
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold/50 focus:border-gold outline-none"
                              />
                            ) : (
                              <>
                                <span className="font-semibold text-emerald-700">{formatCurrency(p.myPrice)}</span>
                                {atBase && (
                                  <span className="block text-[10px] text-gray-400 font-normal">default base</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className={panelTableCellClass}>
                            <span className="font-semibold text-emerald-700">{formatCurrency(liveProfit)}</span>
                            <span className="block text-[10px] text-gray-400">max {formatCurrency(p.maxProfitPerSale)}</span>
                          </td>
                          <td className={panelTableCellClass}>
                            {!inStock ? (
                              <span className="text-xs text-amber-700 font-medium">Out of stock</span>
                            ) : pricingMeta?.parentPricesPending ? (
                              <span className="text-xs text-violet-600 font-medium">Awaiting parent</span>
                            ) : editing === p._id ? (
                              <div className="flex gap-2">
                                <Button size="sm" loading={saving} onClick={() => savePrice(p._id)}>Save</Button>
                                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditing(p._id);
                                  setPrice(String(p.myPrice));
                                  setError('');
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
                </PanelTableScroll>
              </PanelTable>
            );
          })}
          {afaPackage && (
            <PanelTable>
              <PanelTableHeader
                title="MTN AFA Registration"
                imageUrl="/images/afa.jpg"
                trailing="Store price"
              />
              <PanelTableScroll minWidth={560}>
                <thead className={panelTableHeadClass}>
                  <tr>
                    <th className={panelTableTh()}>Service</th>
                    <th className={panelTableTh()}>{pricingMeta?.hasParent ? 'Your cost' : 'Min (Base)'}</th>
                    <th className={panelTableTh()}>Max</th>
                    <th className={panelTableTh()}>Your price</th>
                    <th className={panelTableTh('emerald')}>Your profit</th>
                    <th className={panelTableTh()}>Action</th>
                  </tr>
                </thead>
                <tbody>{renderPriceRow(afaPackage, afaInStock)}</tbody>
              </PanelTableScroll>
            </PanelTable>
          )}
          {checkerPackages.length > 0 && (
            <PanelTable>
              <PanelTableHeader
                title="Results Checkers"
                imageUrl="/images/waec-checker.png"
                trailing={`${checkerPackages.length} types`}
              />
              <PanelTableScroll minWidth={560}>
                <thead className={panelTableHeadClass}>
                  <tr>
                    <th className={panelTableTh()}>Type</th>
                    <th className={panelTableTh()}>{pricingMeta?.hasParent ? 'Your cost' : 'Min (Base)'}</th>
                    <th className={panelTableTh()}>Max</th>
                    <th className={panelTableTh()}>Your price</th>
                    <th className={panelTableTh('emerald')}>Your profit</th>
                    <th className={panelTableTh()}>Action</th>
                  </tr>
                </thead>
                <tbody>{checkerPackages.map((p) => renderPriceRow(p, true))}</tbody>
              </PanelTableScroll>
            </PanelTable>
          )}
        </div>
      )}

      {!sessionExpired && packages.length > 0 && (
        <p className="text-xs text-gray-500 mt-6">
          Tip: You can also set prices from{' '}
          <Link to="/reseller/store" className="text-gold hover:underline">My Store</Link>.
        </p>
      )}
    </DashboardLayout>
  );
}
