import { cn } from '@/lib/utils';
import { ReactNode, useEffect, useState } from 'react';

export function FeatureCard({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group relative flex flex-col bg-navy-card/60 backdrop-blur-sm',
        'border border-navy-border rounded-2xl p-6 md:p-7',
        'hover:border-gold/40 hover:-translate-y-1 hover:shadow-lg hover:shadow-gold/5',
        'transition-all duration-300 ease-out',
        className
      )}
    >
      <div className="w-10 h-1 bg-gold/80 rounded-full mb-5 group-hover:w-14 group-hover:bg-gold transition-all duration-300" />
      <h3 className="font-semibold text-white text-lg mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

export function ServiceCard({
  name,
  imageUrl,
  badge,
  badgeVariant = 'available',
  action,
  className,
}: {
  name: string;
  imageUrl?: string;
  badge: string;
  badgeVariant?: 'available' | 'unavailable';
  action?: ReactNode;
  className?: string;
}) {
  const shortName = name.split(' ')[0];
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <div
      className={cn(
        'group relative flex flex-col items-center bg-navy-card/60 backdrop-blur-sm',
        'border border-navy-border rounded-2xl p-6 md:p-7',
        'hover:border-gold/40 hover:-translate-y-1 hover:shadow-lg hover:shadow-gold/5',
        'transition-all duration-300 ease-out',
        className
      )}
    >
      {imageUrl && !imageFailed ? (
        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-gold/40 mb-5 group-hover:border-gold group-hover:shadow-md group-hover:shadow-gold/20 transition-all duration-300 bg-white">
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : (
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gold/20 to-gold/5 border-2 border-gold/40 flex items-center justify-center mb-5 group-hover:border-gold group-hover:shadow-md group-hover:shadow-gold/20 transition-all duration-300">
          <span className="text-gold font-bold text-sm">{shortName}</span>
        </div>
      )}
      <h3 className="font-semibold text-white text-center mb-3">{name}</h3>
      <span
        className={cn(
          'inline-block px-3 py-1 text-xs font-medium rounded-full mb-4',
          badgeVariant === 'available'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
            : 'bg-red-500/15 text-red-400 border border-red-500/25'
        )}
      >
        {badge}
      </span>
      {action}
    </div>
  );
}

export function InfoCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-navy-card/60 backdrop-blur-sm border border-navy-border rounded-2xl p-5',
        'hover:border-gold/30 transition-all duration-300',
        className
      )}
    >
      <p className="text-gray-500 text-sm mb-1">{label}</p>
      <p className="font-medium text-white">{value}</p>
    </div>
  );
}
