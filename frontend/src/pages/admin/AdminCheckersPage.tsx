import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useNavigate } from 'react-router';
import { Loader2, Upload } from 'lucide-react';
import {
  PanelTable,
  PanelTableHeader,
  PanelTableScroll,
  panelTableHeadClass,
  panelTableTh,
  panelTableRowClass,
  panelTableCellClass,
} from '@/components/ui/PanelTable';

type CheckerType = 'bece' | 'wassce';

interface CheckerStockRow {
  type: CheckerType;
  manualInStock: boolean;
  inStock: boolean;
  availableCount: number;
  assignedCount: number;
}

interface CheckerSummary {
  bece: CheckerStockRow;
  wassce: CheckerStockRow;
}

interface CheckerListItem {
  _id: string;
  type: CheckerType;
  serial: string;
  pin?: string;
  status: 'available' | 'assigned';
  assignedAt?: string;
  createdAt: string;
}

export default function AdminCheckersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<CheckerSummary | null>(null);
  const [items, setItems] = useState<CheckerListItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploadType, setUploadType] = useState<CheckerType>('bece');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [toggling, setToggling] = useState<CheckerType | null>(null);
  const [clearing, setClearing] = useState(false);
  const [filterType, setFilterType] = useState<CheckerType | ''>('');
  const [filterStatus, setFilterStatus] = useState<'available' | 'assigned' | ''>('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const load = useCallback(async () => {
    setPageLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      params.set('limit', '50');
      const res = await api.get(`/admin/checkers/overview?${params.toString()}`);
      const data = res.data.data as {
        summary: CheckerSummary;
        items: CheckerListItem[];
      };
      setSummary(data.summary);
      setItems(data.items);
    } catch (err) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const status = axiosErr.response?.status;
      const serverMsg = axiosErr.response?.data?.message;
      if (status === 401 || status === 403) {
        setLoadError('Your admin session expired. Sign out, then log in again at /login/admin.');
      } else if (status === 404) {
        setLoadError(
          serverMsg ||
            'Checker admin API is not available yet. Wait a minute for deployment to finish, then hard-refresh this page (Ctrl+F5).'
        );
      } else {
        setLoadError(serverMsg || (err instanceof Error ? err.message : 'Failed to load checkers'));
      }
    } finally {
      setPageLoading(false);
    }
  }, [filterType, filterStatus]);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user, load]);

  const toggleStock = async (type: CheckerType, inStock: boolean) => {
    setToggling(type);
    try {
      const res = await api.patch(`/admin/checkers/stock/${type}`, { inStock });
      setSummary((prev) => {
        if (!prev) return prev;
        const row = res.data.data as CheckerStockRow;
        return { ...prev, [type]: row };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update stock');
    } finally {
      setToggling(null);
    }
  };

  const clearAllCheckers = async () => {
    if (
      !confirm(
        'Delete ALL BECE and WASSCE checkers (available and used)? You will need to upload a new Excel file.'
      )
    ) {
      return;
    }
    setClearing(true);
    setUploadMsg('');
    setUploadError('');
    try {
      const res = await api.delete('/admin/checkers');
      setUploadMsg(res.data.message || `Deleted ${res.data.data?.deleted ?? 0} checker(s).`);
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to delete checkers');
    } finally {
      setClearing(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadError('Choose an Excel file first');
      return;
    }
    setUploading(true);
    setUploadMsg('');
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', uploadType);
      const res = await api.post('/admin/checkers/upload', form);
      const d = res.data.data as { imported: number; skippedDuplicates: number; skippedInvalid: number };
      setUploadMsg(
        `Imported ${d.imported}. Skipped duplicates: ${d.skippedDuplicates}. Invalid rows: ${d.skippedInvalid}.` +
          (d.imported > 0 ? ' Stock marked in stock automatically.' : '')
      );
      setFile(null);
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (loading || !user) return null;

  const stockCards: { key: CheckerType; label: string; row: CheckerStockRow | null }[] = [
    { key: 'bece', label: 'BECE', row: summary?.bece ?? null },
    { key: 'wassce', label: 'WASSCE', row: summary?.wassce ?? null },
  ];

  return (
    <DashboardLayout role="admin">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">Results Checkers</h1>

      {loadError && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">
          {loadError}
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        {stockCards.map(({ key, label, row }) => (
          <Card key={key} className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{label}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {row?.availableCount ?? 0} available · {row?.assignedCount ?? 0} used
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span
                    className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                      row?.manualInStock ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Sales {row?.manualInStock ? 'enabled' : 'paused'}
                  </span>
                  <span
                    className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                      row?.inStock ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {row?.inStock ? 'Live on stores' : 'Not selling'}
                  </span>
                </div>
                {row && row.manualInStock && row.availableCount === 0 && (
                  <p className="text-xs text-amber-700 mt-2">Upload inventory to start selling.</p>
                )}
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <Button
                  size="sm"
                  variant={row?.manualInStock ? 'outline' : 'primary'}
                  loading={toggling === key}
                  disabled={!row && pageLoading}
                  onClick={() => toggleStock(key, !row?.manualInStock)}
                >
                  {row?.manualInStock ? 'Pause sales' : 'Enable sales'}
                </Button>
                {row && row.availableCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={toggling === key}
                    onClick={() => toggleStock(key, false)}
                  >
                    Force out of stock
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4 sm:p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Upload checkers (Excel)
        </h2>
        <div className="mb-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={clearing}
            disabled={clearing || pageLoading}
            onClick={clearAllCheckers}
            className="border-red-300 text-red-700 hover:bg-red-50"
          >
            Delete all checkers
          </Button>
          <p className="text-xs text-gray-500 mt-2">
            Removes every BECE/WASSCE pin so you can upload a fresh batch.
          </p>
        </div>
        <form onSubmit={handleUpload} className="space-y-4 max-w-xl">
          <div className="flex gap-2">
            {(['bece', 'wassce'] as CheckerType[]).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={uploadType === t ? 'primary' : 'outline'}
                onClick={() => setUploadType(t)}
              >
                {t.toUpperCase()}
              </Button>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Row 1 must include <strong>Serial</strong> and <strong>PIN</strong> column headers. Data starts row 2.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setUploadError('');
            }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:bg-gold file:text-navy file:font-semibold file:cursor-pointer hover:file:bg-gold-hover file:transition-colors"
          />
          {file && <p className="text-xs text-gray-600">Selected: {file.name}</p>}
          <Button type="submit" loading={uploading} disabled={!file}>
            Upload to {uploadType.toUpperCase()}
          </Button>
          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
          {uploadMsg && <p className="text-sm text-emerald-700">{uploadMsg}</p>}
        </form>
      </Card>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Button size="sm" variant={!filterType ? 'primary' : 'outline'} onClick={() => setFilterType('')}>
          All types
        </Button>
        {(['bece', 'wassce'] as CheckerType[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={filterType === t ? 'primary' : 'outline'}
            onClick={() => setFilterType(t)}
          >
            {t.toUpperCase()}
          </Button>
        ))}
        <Button
          size="sm"
          variant={filterStatus === 'available' ? 'primary' : 'outline'}
          onClick={() => setFilterStatus(filterStatus === 'available' ? '' : 'available')}
        >
          Unused
        </Button>
        <Button
          size="sm"
          variant={filterStatus === 'assigned' ? 'primary' : 'outline'}
          onClick={() => setFilterStatus(filterStatus === 'assigned' ? '' : 'assigned')}
        >
          Used
        </Button>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading checkers...
        </div>
      ) : (
        <PanelTable>
          <PanelTableHeader title="Checker inventory" trailing={`${items.length} shown`} />
          <PanelTableScroll minWidth={700}>
            <thead className={panelTableHeadClass}>
              <tr>
                <th className={panelTableTh()}>Type</th>
                <th className={panelTableTh()}>Serial</th>
                <th className={panelTableTh()}>Status</th>
                <th className={panelTableTh()}>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className={`${panelTableCellClass} text-center text-gray-500 py-8`}>
                    No checkers yet. Upload an Excel file above.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item._id} className={panelTableRowClass}>
                    <td className={panelTableCellClass}>{item.type.toUpperCase()}</td>
                    <td className={panelTableCellClass}>{item.serial}</td>
                    <td className={panelTableCellClass}>
                      <span
                        className={
                          item.status === 'available' ? 'text-emerald-700' : 'text-gray-500'
                        }
                      >
                        {item.status === 'available' ? 'Unused' : 'Used'}
                      </span>
                    </td>
                    <td className={panelTableCellClass}>
                      {item.assignedAt ? new Date(item.assignedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </PanelTableScroll>
        </PanelTable>
      )}
    </DashboardLayout>
  );
}
