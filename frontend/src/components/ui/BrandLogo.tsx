import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { PLATFORM_NAME } from '@/lib/brand';

interface BrandLogoProps {
  to?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showText?: boolean;
  textClassName?: string;
}

const sizeClass = {
  sm: 'h-7 w-auto',
  md: 'h-8 w-auto',
  lg: 'h-10 w-auto',
} as const;

export function LogoImage({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <img
      src="/logo.png"
      alt={PLATFORM_NAME}
      className={cn('object-contain', sizeClass[size], className)}
      width={size === 'lg' ? 40 : size === 'md' ? 32 : 28}
      height={size === 'lg' ? 40 : size === 'md' ? 32 : 28}
      decoding="async"
    />
  );
}

export function BrandMark({
  className,
  size = 'md',
  showText = true,
  textClassName,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  textClassName?: string;
}) {
  const textSize = {
    sm: 'text-sm sm:text-base',
    md: 'text-base sm:text-lg',
    lg: 'text-lg sm:text-xl',
  }[size];

  return (
    <span className={cn('inline-flex items-center gap-2 min-w-0', className)}>
      <LogoImage size={size} className="shrink-0" />
      {showText && (
        <span
          className={cn(
            'font-bold tracking-tight truncate',
            textSize,
            textClassName ?? 'text-white'
          )}
        >
          topdeals<span className="text-gold">gh</span>
        </span>
      )}
    </span>
  );
}

export default function BrandLogo({
  to = '/',
  size = 'md',
  className,
  showText = true,
  textClassName,
}: BrandLogoProps & { textClassName?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center shrink-0', className)} aria-label={PLATFORM_NAME}>
      <BrandMark size={size} showText={showText} textClassName={textClassName} />
    </Link>
  );
}
