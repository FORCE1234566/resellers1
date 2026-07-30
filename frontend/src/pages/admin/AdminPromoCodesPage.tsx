import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useNavigate } from 'react-router';
import { Loader2, Copy, Download, Tag } from 'lucide-react';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
  panelTableCellClass,
} from '@/components/ui/PanelTable';
import AdminPasswordConfirm from '@/components/admin/AdminPasswordConfirm';
import AdminActionConfirmModal from '@/components/admin/AdminActionConfirmModal';
import { formatCurrency } from '@/lib/utils';

type PendingDisable =
  | { type: 'code'; id: string }
  | { type: 'batch'; batchId: string };

type GeneratedBatch = {
  batchId: string;
  codes: string[];
  scope: 'all_products';
  discountGhs: number;
  count: number;
};

type PromoRow = {
  _id: string;
  codeLast4: string;
  discountGhs: number;
  batchId: string;
  label?: string;
  status: string;
  usedAt?: string;
  orderId?: string;
  createdAt: string;
  packageId?: { network?: string; bundleSize?: string; productType?: string } | null;
};

type BatchRow = {
  batchId: string;
  label?: string;
  discountGhs: number;
  total: number;
  active: number;
  used: number;
  disabled: number;
  createdAt: string;
  scope?: 'all_products' | 'legacy_package';
  package?: { network?: string; bundleSize?: string; productType?: string } | null;
};

function promoScopeLabel() {
  return 'All products';
}

export default function AdminPromoCodesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<PromoRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [discountGhs, setDiscountGhs] = useState('');
  const [count, setCount] = useState('10');
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [adminOtp, setAdminOtp] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedBatch | null>(null);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterBatchId, setFilterBatchId] = useState('');
  const [pendingDisable, setPendingDisable] = useState<PendingDisable | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const load = useCallback(async () => {
    setPageLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterBatchId) params.set('batchId', filterBatchId);
      params.set('limit', '50');

      const [listRes, batchRes] = await Promise.all([
        api.get(`/admin/promo-codes?${params.toString()}`),
        api.get('/admin/promo-codes/batches'),
      ]);

      setItems(listRes.data.data.items as PromoRow[]);
      setBatches(batchRes.data.data as BatchRow[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load promo codes');
    } finally {
      setPageLoading(false);
    }
  }, [filterStatus, filterBatchId]);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user, load]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discountGhs || !count || adminOtp.length !== 6) {
      alert('Fill in discount, count, and admin OTP');
      return;
    }

    setGenerating(true);
    try {
      const res = await api.post('/admin/promo-codes/generate', {
        discountGhs: Number(discountGhs),
        count: Number(count),
        label: label.trim() || undefined,
        expiresAt: expiresAt || undefined,
        adminOtp,
      });
      setGenerated(res.data.data as GeneratedBatch);
      setAdminOtp('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate codes');
    } finally {
      setGenerating(false);
    }
  };

  const copyCodes = async () => {
    if (!generated?.codes.length) return;
    await navigator.clipboard.writeText(generated.codes.join('\n'));
    alert('Codes copied to clipboard');
  };

  const downloadCsv = () => {
    if (!generated?.codes.length) return;
    const csv = ['code', ...generated.codes].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `promo-codes-${generated.batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const confirmDisable = async (adminOtp: string) => {
    if (!pendingDisable) return;
    if (pendingDisable.type === 'code') {
      await api.patch(`/admin/promo-codes/${pendingDisable.id}/disable`, { adminOtp });
    } else {
      await api.patch(`/admin/promo-codes/batches/${pendingDisable.batchId}/disable`, { adminOtp });
    }
    await load();
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Tag className="w-7 h-7 text-violet-600" />
            Promo Codes
          </h1>
          <p className="text-gray-500 mt-1">
            Generate single-use discount codes that work on any store purchase — data bundles, AFA, and checkers.
          </p>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 text-sm">{loadError}</div>
        )}

        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate codes</h2>
          <form onSubmit={handleGenerate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label="Discount (GHS off)"
              type="number"
              min="0.01"
              step="0.01"
              value={discountGhs}
              onChange={(e) => setDiscountGhs(e.target.value)}
              placeholder="e.g. 2"
            />
            <Input
              label="Number of codes"
              type="number"
              min="1"
              max="500"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <Input
              label="Campaign label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Telecel promo June"
            />
            <Input
              label="Expires at (optional)"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <AdminPasswordConfirm value={adminOtp} onChange={setAdminOtp} autoSendOnMount />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" loading={generating} disabled={adminOtp.length !== 6}>
                Generate promo codes
              </Button>
            </div>
          </form>
        </Card>

        {generated && (
          <Card className="p-4 sm:p-6 border-violet-200 bg-violet-50">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-violet-900">Codes generated — save them now</h2>
                <p className="text-sm text-violet-700 mt-1">
                  {generated.count} codes ({formatCurrency(generated.discountGhs)} off any product). They will not be
                  shown again.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
                  <Copy className="w-4 h-4 mr-1" /> Copy all
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
                  <Download className="w-4 h-4 mr-1" /> CSV
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setGenerated(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg bg-white border border-violet-200 p-3 font-mono text-sm space-y-1">
              {generated.codes.map((code) => (
                <div key={code}>{code}</div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent batches</h2>
          {pageLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <PanelTable>
              <PanelTableHeader title="Recent batches" trailing={`${batches.length} batches`} />
              <PanelTableScroll>
                <thead className={panelTableHeadClass}>
                  <tr>
                    <th className={panelTableTh()}>Batch</th>
                    <th className={panelTableTh()}>Scope</th>
                    <th className={panelTableTh()}>Discount</th>
                    <th className={panelTableTh()}>Active</th>
                    <th className={panelTableTh()}>Used</th>
                    <th className={panelTableTh()}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.batchId} className={panelTableRowClass}>
                      <td className={panelTableCellClass}>
                        <div className="font-medium">{b.label || b.batchId.slice(0, 20)}</div>
                        <div className="text-xs text-gray-500">{new Date(b.createdAt).toLocaleString()}</div>
                      </td>
                      <td className={panelTableCellClass}>{promoScopeLabel()}</td>
                      <td className={panelTableCellClass}>{formatCurrency(b.discountGhs)}</td>
                      <td className={panelTableCellClass}>{b.active}</td>
                      <td className={panelTableCellClass}>{b.used}</td>
                      <td className={panelTableCellClass}>
                        {b.active > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingDisable({ type: 'batch', batchId: b.batchId })}
                          >
                            Disable unused
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!batches.length && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-500">
                        No batches yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </PanelTableScroll>
            </PanelTable>
          )}
        </Card>

        <Card className="p-4 sm:p-6">
          <div className="flex flex-wrap gap-3 mb-4">
            <Select
              label="Status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'used', label: 'Used' },
                { value: 'disabled', label: 'Disabled' },
              ]}
              className="min-w-[160px]"
            />
            <Select
              label="Batch"
              value={filterBatchId}
              onChange={(e) => setFilterBatchId(e.target.value)}
              options={[
                { value: '', label: 'All batches' },
                ...batches.map((b) => ({
                  value: b.batchId,
                  label: b.label || b.batchId.slice(0, 16),
                })),
              ]}
              className="min-w-[200px]"
            />
          </div>

          <PanelTable>
            <PanelTableHeader title="All codes" trailing={`${items.length} shown`} />
            <PanelTableScroll>
              <thead className={panelTableHeadClass}>
                <tr>
                  <th className={panelTableTh()}>Code</th>
                  <th className={panelTableTh()}>Package</th>
                  <th className={panelTableTh()}>Discount</th>
                  <th className={panelTableTh()}>Status</th>
                  <th className={panelTableTh()}>Used</th>
                  <th className={panelTableTh()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row._id} className={panelTableRowClass}>
                    <td className={panelTableCellClass}>****{row.codeLast4}</td>
                    <td className={panelTableCellClass}>{promoScopeLabel()}</td>
                    <td className={panelTableCellClass}>{formatCurrency(row.discountGhs)}</td>
                    <td className={panelTableCellClass}>
                      <span
                        className={
                          row.status === 'active'
                            ? 'text-emerald-700'
                            : row.status === 'used'
                              ? 'text-gray-600'
                              : 'text-amber-700'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className={panelTableCellClass}>
                      {row.usedAt ? (
                        <div>
                          <div className="text-xs">{new Date(row.usedAt).toLocaleString()}</div>
                          {row.orderId && (
                            <div className="text-xs text-gray-500">Order {row.orderId}</div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={panelTableCellClass}>
                      {row.status === 'active' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingDisable({ type: 'code', id: row._id })}
                        >
                          Disable
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!items.length && !pageLoading && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-500">
                      No promo codes found
                    </td>
                  </tr>
                )}
              </tbody>
            </PanelTableScroll>
          </PanelTable>
        </Card>
      </div>

      {pendingDisable && (
        <AdminActionConfirmModal
          title={pendingDisable.type === 'code' ? 'Disable promo code' : 'Disable promo batch'}
          description={
            pendingDisable.type === 'batch'
              ? 'All unused codes in this batch will be revoked.'
              : 'This code will no longer be usable at checkout.'
          }
          confirmLabel="Disable"
          onClose={() => setPendingDisable(null)}
          onConfirm={confirmDisable}
        />
      )}
    </DashboardLayout>
  );
}
