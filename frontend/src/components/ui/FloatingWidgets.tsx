import { useLocation, useSearchParams } from 'react-router';
import SupportLine from '@/components/ui/SupportLine';
import { readStoreRef } from '@/lib/reseller-store-ref';

export default function FloatingWidgets() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const storeSlug = readStoreRef(searchParams);

  const isHomeLanding = pathname === '/' && !storeSlug;

  if (!isHomeLanding) return null;

  return <SupportLine />;
}
