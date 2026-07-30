import { Package } from '../models/Package';
import {
  CHECKER_BUNDLE_BECE,
  CHECKER_BUNDLE_WASSCE,
  CHECKER_DEFAULT_BASE_PRICE,
  CHECKER_DEFAULT_MAX_SELL,
  CheckerType,
  bundleSizeFromCheckerType,
} from '../config/checker';
import { isMongoDuplicateKeyError } from '../utils/mongoErrors';

async function ensureCheckerPackageForType(type: CheckerType): Promise<void> {
  const bundleSize = bundleSizeFromCheckerType(type);
  const existing = await Package.findOne({
    network: 'MTN',
    bundleSize,
    productType: 'checker',
  });

  if (existing) {
    let changed = false;
    if (existing.isEnabled !== true) {
      existing.isEnabled = true;
      changed = true;
    }
    if (existing.costPrice !== CHECKER_DEFAULT_BASE_PRICE) {
      existing.costPrice = CHECKER_DEFAULT_BASE_PRICE;
      changed = true;
    }
    if (existing.agentPrice !== CHECKER_DEFAULT_BASE_PRICE) {
      existing.agentPrice = CHECKER_DEFAULT_BASE_PRICE;
      changed = true;
    }
    if (existing.resellerBasePrice !== CHECKER_DEFAULT_BASE_PRICE) {
      existing.resellerBasePrice = CHECKER_DEFAULT_BASE_PRICE;
      changed = true;
    }
    if (changed) await existing.save();
    return;
  }

  const legacy = await Package.findOne({ network: 'MTN', bundleSize, productType: { $ne: 'checker' } });
  if (legacy) {
    legacy.productType = 'checker';
    legacy.costPrice = CHECKER_DEFAULT_BASE_PRICE;
    legacy.agentPrice = CHECKER_DEFAULT_BASE_PRICE;
    legacy.resellerBasePrice = CHECKER_DEFAULT_BASE_PRICE;
    await legacy.save();
    return;
  }

  const latest = await Package.findOne().sort({ sortOrder: -1 }).select('sortOrder');
  try {
    await Package.create({
      network: 'MTN',
      productType: 'checker',
      bundleSize,
      costPrice: CHECKER_DEFAULT_BASE_PRICE,
      agentPrice: CHECKER_DEFAULT_BASE_PRICE,
      resellerBasePrice: CHECKER_DEFAULT_BASE_PRICE,
      maxSellingPrice: CHECKER_DEFAULT_MAX_SELL,
      isEnabled: true,
      sortOrder: (latest?.sortOrder ?? 0) + 1,
    });
  } catch (err) {
    if (isMongoDuplicateKeyError(err)) return;
    throw err;
  }
}

export async function ensureCheckerPackages(): Promise<void> {
  await ensureCheckerPackageForType('bece');
  await ensureCheckerPackageForType('wassce');
}

export async function getCheckerPackage(type: CheckerType) {
  const bundleSize = type === 'bece' ? CHECKER_BUNDLE_BECE : CHECKER_BUNDLE_WASSCE;
  return Package.findOne({ productType: 'checker', bundleSize, isEnabled: true });
}

export async function getCheckerPackageById(packageId: string) {
  const pkg = await Package.findById(packageId);
  if (!pkg || !pkg.isEnabled || pkg.productType !== 'checker') return null;
  return pkg;
}
