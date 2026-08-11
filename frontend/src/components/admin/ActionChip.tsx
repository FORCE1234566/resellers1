import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

export default function ActionChip({
  onClick,
  disabled,
  active,
  activeTone = 'emerald',
  inactiveTone = 'slate',
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  activeTone?: 'emerald' | 'amber' | 'sky' | 'violet' | 'rose';
  inactiveTone?: 'slate' | 'rose';
  children: ReactNode;
  title?: string;
}) {
  const tone = active
    ? {
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
        sky: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
        violet: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100',
        rose: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
      }[activeTone]
    : {
        slate: 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100',
        rose: 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100',
      }[inactiveTone];

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full border transition',
        'disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        tone
      )}
    >
      {children}
    </button>
  );
}
