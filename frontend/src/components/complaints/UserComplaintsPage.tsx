import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Textarea from '@/components/ui/Textarea';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router';
import { AlertTriangle, Loader2, MessageSquare, Phone } from 'lucide-react';

interface EligibleOrder {
  orderId: string;
  recipientPhone: string;
  customerEmail?: string;
  network: string;
  bundleSize: string;
  status: string;
  createdAt: string;
  canComplain: boolean;
  reason?: string;
  hasComplaint: boolean;
}

interface ComplaintRow {
  _id: string;
  orderId: string;
  phoneNumber: string;
  issueType: string;
  description: string;
  status: string;
  createdAt: string;
}

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

type Props = {
  role: 'agent' | 'reseller';
};

export default function UserComplaintsPage({ role }: Props) {
  const apiPrefix = role === 'agent' ? '/agent' : '/reseller';
  const loginPath = role === 'agent' ? '/login/agent' : '/login/reseller';

  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [complaintsEnabled, setComplaintsEnabled] = useState(true);
  const [orders, setOrders] = useState<EligibleOrder[]>([]);
  const [submitted, setSubmitted] = useState<ComplaintRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<EligibleOrder | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== role)) navigate(loginPath);
  }, [user, loading, navigate, role, loginPath]);

  const load = useCallback(async () => {
    setPageLoading(true);
    try {
      const [eligibleRes, complaintsRes] = await Promise.all([
        api.get(`${apiPrefix}/complaints/eligible-orders`),
        api.get(`${apiPrefix}/complaints`),
      ]);
      setComplaintsEnabled(eligibleRes.data.data.complaintsEnabled);
      setOrders(eligibleRes.data.data.orders);
      setSubmitted(complaintsRes.data.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load complaints');
    } finally {
      setPageLoading(false);
    }
  }, [apiPrefix]);

  useEffect(() => {
    if (user?.role === role) load();
  }, [user, role, load]);

  const submitComplaint = async () => {
    if (!activeOrder) return;
    setSubmitting(activeOrder.orderId);
    setError('');
    setSuccess('');
    try {
      await api.post(`${apiPrefix}/complaints`, {
        orderId: activeOrder.orderId,
        issueType: 'Data Not Received',
        description: description.trim() || 'Data not received more than 2 hours after purchase',
      });
      setSuccess(`Complaint submitted for order ${activeOrder.orderId}`);
      setActiveOrder(null);
      setDescription('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit complaint');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout role={role}>
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Complaints</h1>
      <p className="text-sm text-gray-400 mb-6">
        Submit a complaint if data was not received more than 2 hours after the order was placed.
      </p>

      {!complaintsEnabled && (
        <div className="flex items-start gap-3 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          Complaints are disabled for your account. Contact admin if you need help.
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}
      {success && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg mb-4">{success}</p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading...
        </div>
      ) : (
        <>
          <Card className="overflow-hidden mb-8">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Orders — not yet received</h2>
              <p className="text-xs text-gray-500 mt-1">Phone numbers eligible for complaint after 2 hours</p>
            </div>
            {orders.length === 0 ? (
              <p className="p-8 text-center text-gray-500 text-sm">No pending orders to complain about.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-white border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Phone</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Order ID</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Bundle</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Placed</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.orderId} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
                            <Phone className="w-3.5 h-3.5 text-gold" />
                            {order.recipientPhone}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{order.orderId}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {order.network} · {order.bundleSize}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(order.createdAt)}</td>
                        <td className="px-4 py-3">
                          {order.hasComplaint ? (
                            <span className="text-xs font-medium text-emerald-700">Submitted</span>
                          ) : order.canComplain ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                setActiveOrder(order);
                                setDescription('');
                                setError('');
                              }}
                            >
                              Submit complaint
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-500">{order.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {activeOrder && (
            <Card className="p-6 mb-8 border-amber-200">
              <h3 className="font-semibold text-gray-900 mb-1">Submit complaint</h3>
              <p className="text-sm text-gray-600 mb-4">
                Phone <strong>{activeOrder.recipientPhone}</strong> · Order{' '}
                <strong className="font-mono text-xs">{activeOrder.orderId}</strong>
              </p>
              <Textarea
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Describe the issue — data not received after 2+ hours"
              />
              <div className="flex flex-wrap gap-2 mt-4">
                <Button loading={submitting === activeOrder.orderId} onClick={submitComplaint}>
                  Send complaint to admin
                </Button>
                <Button variant="outline" onClick={() => setActiveOrder(null)}>
                  Cancel
                </Button>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gold" />
              <h2 className="font-semibold text-gray-900">Your submitted complaints</h2>
            </div>
            {submitted.length === 0 ? (
              <p className="p-8 text-center text-gray-500 text-sm">No complaints submitted yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-white border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Phone</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Order ID</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submitted.map((c) => (
                      <tr key={c._id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3 text-gray-900">{c.phoneNumber}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.orderId}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'px-2 py-1 rounded-full text-xs font-semibold capitalize',
                              STATUS_STYLES[c.status] || STATUS_STYLES.pending
                            )}
                          >
                            {c.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </DashboardLayout>
  );
}
