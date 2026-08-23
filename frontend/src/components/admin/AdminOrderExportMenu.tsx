import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadAdminReport, OrderExportNetwork } from '@/lib/api';

const EXPORT_OPTIONS: { network: OrderExportNetwork; label: string }[] = [
  { network: 'all', label: 'All networks' },
  { network: 'MTN', label: 'MTN only' },
  { network: 'MTN Express', label: 'MTN Express only' },
  { network: 'Telecel', label: 'Telecel only' },
  { network: 'AirtelTigo', label: 'AirtelTigo only' },
];

export default function AdminOrderExportMenu({
  size = 'sm',
  onError,
}: {
  size?: 'sm' | 'md' | 'lg';
  onError?: (message: string) => void;
}) {
  const [exporting, setExporting] = useState<OrderExportNetwork | null>(null);

  const handleExport = async (network: OrderExportNetwork) => {
    setExporting(network);
    try {
      await downloadAdminReport('orders', { network });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const pillTone: Record<OrderExportNetwork, string> = {
    all: 'bg-gold/20 text-gold border-gold/40 hover:bg-gold/30',
    MTN: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/25',
    'MTN Express': 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25',
    Telecel: 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25',
    AirtelTigo: 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25',
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {EXPORT_OPTIONS.map((option) => (
        <button
          key={option.network}
          type="button"
          disabled={exporting !== null}
          onClick={() => handleExport(option.network)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition disabled:opacity-50 ${pillTone[option.network]}`}
        >
          <Download className="w-3.5 h-3.5" />
          {exporting === option.network ? 'Exporting...' : option.label}
        </button>
      ))}
    </div>
  );
}
