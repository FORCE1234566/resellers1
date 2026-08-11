import { useState } from 'react';
import { X } from 'lucide-react';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import AdminPasswordConfirm from '@/components/admin/AdminPasswordConfirm';
import { api } from '@/lib/api';

export default function AdminAgentTopUpModal({
  userId,
  fullName,
  currentBalance,
  onClose,
  onSuccess,
}: {
  userId: string;
  fullName: string;
  currentBalance: number;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [paystackRef, setPaystackRef] = useState('');
  const [adminOtp, setAdminOtp] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deducting, setDeducting] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const parsedAmount = Number(amount);
  const amountOk = !!amount && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const otpOk = /^\d{6}$/.test(adminOtp);
  const busy = submitting || deducting || reconciling;

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountOk) {
      setError('Enter a valid amount greater than zero');
      return;
    }
    if (!otpOk) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/admin/agents/${userId}/wallet/top-up`, {
        amount: parsedAmount,
        note: note.trim() || undefined,
        adminOtp,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to top up wallet');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeduct = async () => {
    setError('');
    if (!amountOk) {
      setError('Enter a valid amount greater than zero');
      return;
    }
    if (parsedAmount > currentBalance) {
      setError(`Cannot deduct more than current balance (GHS ${currentBalance.toFixed(2)})`);
      return;
    }
    if (!otpOk) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }

    setDeducting(true);
    try {
      await api.post(`/admin/agents/${userId}/wallet/deduct`, {
        amount: parsedAmount,
        note: note.trim() || undefined,
        adminOtp,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deduct from wallet');
    } finally {
      setDeducting(false);
    }
  };

  const handleReconcile = async () => {
    if (!paystackRef.trim()) {
      setError('Enter the Paystack reference from the payment receipt');
      return;
    }
    if (!otpOk) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }
    setError('');
    setReconciling(true);
    try {
      await api.post(`/admin/agents/${userId}/wallet/reconcile-paystack`, {
        reference: paystackRef.trim(),
        adminOtp,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reconcile Paystack payment');
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Adjust agent wallet</h2>
            <p className="text-sm text-gray-500">{fullName}</p>
            <p className="text-xs text-gray-400 mt-0.5">Current balance: GHS {currentBalance.toFixed(2)}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleTopUp} className="p-5 space-y-4">
          <Input
            label="Amount (GHS)"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 100"
          />
          <Textarea
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. MoMo deposit received, or deposit reversal"
            rows={2}
          />
          <AdminPasswordConfirm value={adminOtp} onChange={setAdminOtp} autoSendOnMount />
          <FormAlert message={error} />
          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deducting}
              disabled={busy || !amountOk}
              onClick={handleDeduct}
            >
              Deduct
            </Button>
            <Button type="submit" loading={submitting} disabled={busy || !amountOk}>
              Add to wallet
            </Button>
          </div>
        </form>

        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs font-medium text-gray-700">Agent paid via Paystack but balance did not update?</p>
          <Input
            label="Paystack reference"
            value={paystackRef}
            onChange={(e) => setPaystackRef(e.target.value)}
            placeholder="Paste ref from Paystack receipt"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            loading={reconciling}
            disabled={busy || !paystackRef.trim()}
            onClick={handleReconcile}
          >
            Credit from Paystack reference
          </Button>
        </div>
      </div>
    </div>
  );
}
