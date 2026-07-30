import { DarkCard } from '@/components/ui/Card';
import { Link } from 'react-router';

type AlertItem = {
  title: string;
  message: string;
  tone: 'amber' | 'sky' | 'rose' | 'emerald' | 'orange';
  href?: string;
};

const toneStyles: Record<AlertItem['tone'], string> = {
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  orange: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
};

export default function RecentAlertsPanel({
  alerts,
  ordersLink,
}: {
  alerts: AlertItem[];
  ordersLink?: string;
}) {
  return (
    <DarkCard className="p-5 h-full border-navy-border/80">
      <h2 className="text-base font-semibold text-white mb-4">Recent Alerts</h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-gray-500">No alerts right now. You are all caught up.</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const body = (
              <div className={`rounded-xl border px-4 py-3 ${toneStyles[alert.tone]}`}>
                <p className="font-semibold text-sm">{alert.title}</p>
                <p className="text-xs mt-1 opacity-90">{alert.message}</p>
              </div>
            );
            return alert.href ? (
              <Link key={alert.title} to={alert.href} className="block hover:opacity-90 transition">
                {body}
              </Link>
            ) : (
              <div key={alert.title}>{body}</div>
            );
          })}
        </div>
      )}
      {ordersLink && (
        <Link to={ordersLink} className="inline-block mt-4 text-xs text-gold hover:underline">
          View all orders
        </Link>
      )}
    </DarkCard>
  );
}
