import { Navigate, useParams, useSearchParams } from 'react-router';
import { buildStoreBuyPath, buildStoreHomePath, readStoreRef } from '@/lib/reseller-store-ref';

/** Legacy /?r=slug → /store/slug */
export function LegacyStoreHomeRedirect() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get('r')?.trim();
  if (!slug) return <Navigate to="/" replace />;
  const tab = searchParams.get('tab');
  const paid = searchParams.get('paid');
  const extra: Record<string, string> = {};
  if (tab) extra.tab = tab;
  if (paid) extra.paid = paid;
  return <Navigate to={buildStoreHomePath(slug, Object.keys(extra).length ? extra : undefined)} replace />;
}

/** Legacy /buy/:network?r=slug → /store/slug/buy/:network */
export function LegacyStoreBuyRedirect() {
  const { network } = useParams();
  const [searchParams] = useSearchParams();
  const slug = readStoreRef(searchParams);
  if (!slug || !network) return <Navigate to="/" replace />;
  return <Navigate to={buildStoreBuyPath(slug, decodeURIComponent(network))} replace />;
}
