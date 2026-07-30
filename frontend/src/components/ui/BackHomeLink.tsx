import { Link } from 'react-router';
import { cn } from '@/lib/utils';

type BackHomeLinkProps = {
  /** Use onLight inside white cards; onDark on navy backgrounds (default). */
  variant?: 'onDark' | 'onLight';
};

export default function BackHomeLink({ variant = 'onDark' }: BackHomeLinkProps) {
  return (
    <Link
      to="/"
      className={cn(
        'inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200',
        variant === 'onLight'
          ? 'bg-gold text-navy hover:bg-gold-hover shadow-md shadow-gold/20'
          : 'bg-gold text-navy hover:bg-gold-hover shadow-md shadow-gold/25 border border-gold/80'
      )}
    >
      Back to homepage
    </Link>
  );
}
