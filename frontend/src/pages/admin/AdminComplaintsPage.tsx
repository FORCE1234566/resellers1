import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { Loader2, MessageSquare, ShieldOff, ShieldCheck } from 'lucide-react';

interface ResellerComplaintRow {
  _id: string;
  orderId: string;
  phoneNumber: string;
  issueType: string;
  description: string;
  status: string;
  adminResponse?: string;
  createdAt: string;
  userId?: {
    _id: string;
    fullName: string;
    email: string;
    complaintEnabled?: boolean;
    resellerStore?: { storeName: string };
  };
}

interface CustomerComplaintRow {
  _id: string;
  orderId: string;
  storeSlug: string;
  recipientPhone: string;
  customerEmail?: string;
  issueType: string;
  description: string;
  status: string;
  adminResponse?: string;
  createdAt: string;
  resellerId?: {
    _id: string;
    fullName: string;
    email: string;
    resellerStore?: { storeName: string };
  };
}

type Tab = 'reseller' | 'customer';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  under_review: 'bg-sky-100 text-sky-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  refunded: 'bg-violet-100 text-violet-800',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function AdminComplaintsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('reseller');
  const [complaints, setComplaints] = useState<ResellerComplaintRow[]>([]);
  const [customerComplaints, setCustomerComplaints] = useState<CustomerComplaintRow[]>([]);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const load = useCallback(async () => {
    setPageLoading(true);
    try {
      const [complaintsRes, customerRes, settingsRes] = await Promise.all([
        api.get('/admin/complaints'),
        api.get('/admin/customer-complaints'),
        api.get('/admin/settings/complaints'),
      ]);
      setComplaints(complaintsRes.data.data);
      setCustomerComplaints(customerRes.data.data);
      setGlobalEnabled(settingsRes.data.data.globalEnabled);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load complaints');
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user, load]);

  const resolveResellerComplaint = async (id: string) => {
    setUpdating(id);
    try {
      await api.patch(`/admin/complaints/${id}`, { status: 'resolved' });
      setComplaints((prev) =>
        prev.map((c) => (c._id === id ? { ...c, status: 'resolved' } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update complaint');
    } finally {
      setUpdating(null);
    }
  };

  const resolveCustomerComplaint = async (id: string) => {
    setUpdating(id);
    try {
      await api.patch(`/admin/customer-complaints/${id}`, { status: 'resolved' });
      setCustomerComplaints((prev) =>
        prev.map((c) => (c._id === id ? { ...c, status: 'resolved' } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update complaint');
    } finally {
      setUpdating(null);
    }
  };

  const toggleGlobal = async () => {
    setUpdating('global');
    try {
      const next = !globalEnabled;
      await api.put('/admin/settings/complaints', { globalEnabled: next });
      setGlobalEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setUpdating(null);
    }
  };

  const toggleResellerAccess = async (resellerId: string, enabled: boolean) => {
    setUpdating(resellerId);
    try {
      await api.patch(`/admin/resellers/${resellerId}/complaint-access`, {
        complaintEnabled: enabled,
      });
      setComplaints((prev) =>
        prev.map((c) =>
          c.userId?._id === resellerId
            ? { ...c, userId: { ...c.userId!, complaintEnabled: enabled } }
            : c
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update reseller access');
    } finally {
      setUpdating(null);
    }
  };

  if (loading || !user) return null;

  const pendingReseller = complaints.filter(
    (c) => c.status === 'pending' || c.status === 'under_review'
  );
  const pendingCustomer = customerComplaints.filter(
    (c) => c.status === 'pending' || c.status === 'under_review'
  );

  return (
    <DashboardLayout role="admin">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Complaints</h1>
          <p className="text-sm text-gray-400">
            {pendingReseller.length} reseller · {pendingCustomer.length} customer open
          </p>
        </div>
        <Button
          variant={globalEnabled ? 'outline' : 'primary'}
          size="sm"
          loading={updating === 'global'}
          onClick={toggleGlobal}
          className="w-full sm:w-auto"
        >
          {globalEnabled ? (
            <>
              <ShieldOff className="w-4 h-4" />
              Disable all complaints
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              Enable complaints
            </>
          )}
        </Button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab('reseller')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            tab === 'reseller'
              ? 'bg-gold text-navy'
              : 'bg-navy-light text-gray-400 border border-navy-border hover:text-white'
          )}
        >
          Reseller ({complaints.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('customer')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            tab === 'customer'
              ? 'bg-gold text-navy'
              : 'bg-navy-light text-gray-400 border border-navy-border hover:text-white'
          )}
        >
          Customer ({customerComplaints.length})
        </button>
      </div>

      {!globalEnabled && (
        <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg mb-4">
          Complaints are disabled globally — new complaints cannot be submitted.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading complaints...
        </div>
      ) : tab === 'reseller' ? (
        complaints.length === 0 ? (
          <Card className="p-10 text-center">
            <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-900 font-medium">No reseller complaints yet</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {complaints.map((c) => {
              const reseller = c.userId;
              const complaintsAllowed = reseller?.complaintEnabled !== false;
              return (
                <Card key={c._id} className="p-5">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={cn(
                            'px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                            STATUS_STYLES[c.status] || STATUS_STYLES.pending
                          )}
                        >
                          {c.status.replace('_', ' ')}
                        </span>
                        <span className="font-mono text-xs text-gray-500">{c.orderId}</span>
                      </div>
                      <p className="text-gray-900 font-medium">
                        Phone: <span className="text-gold">{c.phoneNumber}</span>
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {c.issueType} — {c.description}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Reseller: {reseller?.fullName || '—'} ({reseller?.email}) ·{' '}
                        {formatDate(c.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                      {c.status !== 'resolved' && (
                        <Button
                          size="sm"
                          loading={updating === c._id}
                          onClick={() => resolveResellerComplaint(c._id)}
                        >
                          Mark resolved
                        </Button>
                      )}
                      {reseller?._id && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={updating === reseller._id}
                          onClick={() => toggleResellerAccess(reseller._id, !complaintsAllowed)}
                        >
                          {complaintsAllowed ? 'Disable complaints' : 'Enable complaints'}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : customerComplaints.length === 0 ? (
        <Card className="p-10 text-center">
          <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">No customer complaints yet</p>
          <p className="text-sm text-gray-500 mt-1">Submitted via the Help Assistant on store pages</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {customerComplaints.map((c) => {
            const reseller = c.resellerId;
            return (
              <Card key={c._id} className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={cn(
                          'px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                          STATUS_STYLES[c.status] || STATUS_STYLES.pending
                        )}
                      >
                        {c.status.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-xs text-gray-500">{c.orderId}</span>
                      <span className="text-xs text-violet-600 font-medium">Customer</span>
                    </div>
                    <p className="text-gray-900 font-medium">
                      Phone: <span className="text-gold">{c.recipientPhone}</span>
                      {c.customerEmail && (
                        <span className="text-gray-600 font-normal"> · {c.customerEmail}</span>
                      )}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Store: {c.storeSlug} · {c.issueType} — {c.description}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      Reseller: {reseller?.fullName || '—'} (
                      {reseller?.resellerStore?.storeName || reseller?.email}) · {formatDate(c.createdAt)}
                    </p>
                  </div>
                  {c.status !== 'resolved' && (
                    <Button
                      size="sm"
                      loading={updating === c._id}
                      onClick={() => resolveCustomerComplaint(c._id)}
                    >
                      Mark resolved
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
