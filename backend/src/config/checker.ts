export type CheckerType = 'bece' | 'wassce';

export const CHECKER_TYPES: CheckerType[] = ['bece', 'wassce'];

export const CHECKER_BUNDLE_BECE = 'BECE';
export const CHECKER_BUNDLE_WASSCE = 'WASSCE';

/** Platform API / inventory cost for BECE & WASSCE checkers. */
export const CHECKER_API_COST_PRICE = 15.5;
/** Agent buy price and reseller store base price. */
export const CHECKER_DEFAULT_BASE_PRICE = 18.5;
export const CHECKER_DEFAULT_MAX_SELL = 30;
export const CHECKER_DEFAULT_IMAGE = '/images/waec-checker.png';

export function checkerTypeFromBundle(bundleSize: string): CheckerType | null {
  const b = bundleSize.trim().toUpperCase();
  if (b === CHECKER_BUNDLE_BECE) return 'bece';
  if (b === CHECKER_BUNDLE_WASSCE) return 'wassce';
  return null;
}

export function bundleSizeFromCheckerType(type: CheckerType): string {
  return type === 'bece' ? CHECKER_BUNDLE_BECE : CHECKER_BUNDLE_WASSCE;
}

export function isCheckerProduct(productType?: string, bundleSize?: string): boolean {
  if (productType === 'checker') return true;
  return checkerTypeFromBundle(bundleSize || '') !== null;
}

export function normalizeCheckerType(value: string): CheckerType {
  const v = value.trim().toLowerCase();
  if (v === 'bece') return 'bece';
  if (v === 'wassce') return 'wassce';
  throw new Error('Checker type must be bece or wassce');
}

export function checkerTypeLabel(type: CheckerType): string {
  return type === 'bece' ? 'BECE' : 'WASSCE';
}
