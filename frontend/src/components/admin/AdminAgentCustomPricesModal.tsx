import { useEffect, useState } from 'react';
import { X, Loader2, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import { api } from '@/lib/api';
import { formatCurrency, cn } from '@/lib/utils';

type PriceRow = {
  _id: string;
  network: string;
  bundleSize: string;
  costPrice: number;
  globalAgentPrice: number;
  customPrice: number | null;
  effectivePrice: number;
  maxSellingPrice: number;
};

const NETWORK_ORDER = ['MTN', 'MTN Express', 'Telecel', 'AirtelTigo'] as const;

export default function AdminAgentCustomPricesModal({
  agentId,
  fullName,
  onClose,
}: {
  agentId: string;
  fullName: string;
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadPrices = () => {
    setLoading(true);
    api
      .get(`/admin/agents/${agentId}/prices`)
      .then((res) => {
        setPackages(res.data.data);
        setError('');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load prices');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPrices();
  }, [agentId]);

  const savePrice = async (packageId: string) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await api.put(`/admin/agents/${agentId}/prices/${packageId}`, {
        price: parseFloat(price),
      });
      setEditing(null);
      setMessage('Custom price saved.');
      loadPrices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update price');
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async (packageId: string) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await api.put(`/admin/agents/${agentId}/prices/${packageId}`, { price: null });
      setEditing(null);
      setMessage('Override cleared — using global agent price.');
      loadPrices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear override');
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!window.confirm(`Clear all custom prices for ${fullName}?`)) return;
    setError('');
    setMessage('');
    setResetting(true);
    try {
      const res = await api.delete(`/admin/agents/${agentId}/prices`);
      const cleared = res.data.data?.cleared ?? 0;
      setMessage(cleared > 0 ? `Cleared ${cleared} custom price(s).` : 'No overrides to clear.');
      loadPrices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset prices');
    } finally {
      setResetting(false);
    }
  };

  const grouped = packages.reduce<Record<string, PriceRow[]>>((acc, pkg) => {
    if (!acc[pkg.network]) acc[pkg.network] = [];
    acc[pkg.network].push(pkg);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Custom prices</h2>
            <p className="text-sm text-gray-500">{fullName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={resetting || loading}
            onClick={resetAll}
          >
            {resetting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                Resetting...
              </>
            ) : (
              <>
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset all overrides
              </>
            )}
          </Button>
          <p className="text-xs text-gray-500">
            Override global agent prices for this agent only.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <FormAlert message={error} />
          {message && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
              {message}
            </p>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading packages...
            </div>
          ) : (
            <div className="space-y-6">
              {NETWORK_ORDER.filter((network) => grouped[network]?.length).map((network) => (
                <div key={network}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">{network}</h3>
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Bundle</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Global</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Custom</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped[network].map((pkg) => {
                          const isEditing = editing === pkg._id;
                          const hasOverride = pkg.customPrice != null;
                          return (
                            <tr key={pkg._id} className="border-b border-gray-100 last:border-0">
                              <td className="px-3 py-2 text-gray-900">{pkg.bundleSize}</td>
                              <td className="px-3 py-2 text-gray-700 tabular-nums">
                                {formatCurrency(pkg.globalAgentPrice)}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min={pkg.costPrice}
                                    max={pkg.maxSellingPrice}
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    className="max-w-[120px]"
                                  />
                                ) : (
                                  <span
                                    className={cn(
                                      'tabular-nums',
                                      hasOverride ? 'text-sky-700 font-semibold' : 'text-gray-500'
                                    )}
                                  >
                                    {hasOverride
                                      ? formatCurrency(pkg.customPrice!)
                                      : '—'}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-1">
                                  {isEditing ? (
                                    <>
                                      <Button
                                        size="sm"
                                        loading={saving}
                                        disabled={saving}
                                        onClick={() => savePrice(pkg._id)}
                                      >
                                        Save
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={saving}
                                        onClick={() => setEditing(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setEditing(pkg._id);
                                          setPrice(
                                            String(pkg.customPrice ?? pkg.globalAgentPrice)
                                          );
                                        }}
                                      >
                                        Edit
                                      </Button>
                                      {hasOverride && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={saving}
                                          onClick={() => clearOverride(pkg._id)}
                                        >
                                          Clear
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
