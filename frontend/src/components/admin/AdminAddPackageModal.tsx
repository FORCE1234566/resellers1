import { useState } from 'react';
import { X } from 'lucide-react';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { api } from '@/lib/api';

const NETWORKS = [
  { value: 'MTN', label: 'MTN' },
  { value: 'MTN Express', label: 'MTN Express' },
  { value: 'Telecel', label: 'Telecel' },
  { value: 'AirtelTigo', label: 'AirtelTigo' },
];

type FormState = {
  network: string;
  bundleSize: string;
  costPrice: string;
  agentPrice: string;
  resellerBasePrice: string;
  maxSellingPrice: string;
};

const emptyForm = (): FormState => ({
  network: 'MTN',
  bundleSize: '',
  costPrice: '',
  agentPrice: '',
  resellerBasePrice: '',
  maxSellingPrice: '',
});

export default function AdminAddPackageModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const applySuggestedPrices = () => {
    const cost = parseFloat(form.costPrice);
    if (!Number.isFinite(cost) || cost <= 0) return;
    setForm((prev) => ({
      ...prev,
      agentPrice: (cost * 1.05).toFixed(2),
      resellerBasePrice: (cost * 1.1).toFixed(2),
      maxSellingPrice: (cost * 1.22).toFixed(2),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const costPrice = parseFloat(form.costPrice);
    const agentPrice = parseFloat(form.agentPrice);
    const resellerBasePrice = parseFloat(form.resellerBasePrice);
    const maxSellingPrice = parseFloat(form.maxSellingPrice);

    if (!form.bundleSize.trim()) {
      setError('Enter a bundle size (e.g. 1GB)');
      return;
    }
    if ([costPrice, agentPrice, resellerBasePrice, maxSellingPrice].some((n) => !Number.isFinite(n) || n <= 0)) {
      setError('All prices must be positive numbers');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/admin/packages', {
        network: form.network,
        bundleSize: form.bundleSize.trim(),
        costPrice,
        agentPrice,
        resellerBasePrice,
        maxSellingPrice,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add package');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="font-semibold text-gray-900">Add data package</h2>
            <p className="text-sm text-gray-500">Create a new bundle (e.g. MTN 1GB)</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <Select
            label="Network"
            value={form.network}
            onChange={(e) => set('network', e.target.value)}
            options={NETWORKS}
          />
          <Input
            label="Bundle size"
            value={form.bundleSize}
            onChange={(e) => set('bundleSize', e.target.value)}
            placeholder="e.g. 1GB, 500MB, 2GB"
          />
          <Input
            label="API cost (Smart Data) — GHS"
            type="number"
            min="0.01"
            step="0.01"
            value={form.costPrice}
            onChange={(e) => set('costPrice', e.target.value)}
            onBlur={applySuggestedPrices}
            placeholder="e.g. 4.50"
          />
          <p className="text-xs text-gray-500 -mt-2">
            After entering API cost, tab out to auto-fill suggested Agent and reseller prices (you can edit them).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Agent price (GHS)"
              type="number"
              min="0.01"
              step="0.01"
              value={form.agentPrice}
              onChange={(e) => set('agentPrice', e.target.value)}
            />
            <Input
              label="Reseller base (GHS)"
              type="number"
              min="0.01"
              step="0.01"
              value={form.resellerBasePrice}
              onChange={(e) => set('resellerBasePrice', e.target.value)}
            />
            <Input
              label="Max sell (GHS)"
              type="number"
              min="0.01"
              step="0.01"
              value={form.maxSellingPrice}
              onChange={(e) => set('maxSellingPrice', e.target.value)}
            />
          </div>

          {error && <FormAlert message={error} />}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add package'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
