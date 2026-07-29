import { Package } from '../models/Package';
import { AFA_BASE_PRICE, AFA_BUNDLE_SIZE, AFA_DEFAULT_MAX_SELL } from '../config/afa';
import { isMongoDuplicateKeyError } from '../utils/mongoErrors';

export async function getAfaPackage() {
  return Package.findOne({ productType: 'afa', network: 'MTN', isEnabled: true });
}

export async function ensureAfaPackage(): Promise<void> {
  const existing = await Package.findOne({
    network: 'MTN',
    bundleSize: AFA_BUNDLE_SIZE,
    $or: [{ productType: 'afa' }, { productType: { $exists: false } }],
  });

  if (existing) {
    let changed = false;
    if (existing.productType !== 'afa') {
      existing.productType = 'afa';
      changed = true;
    }
    if (existing.costPrice !== AFA_BASE_PRICE) {
      existing.costPrice = AFA_BASE_PRICE;
      changed = true;
    }
    if (changed) await existing.save();
    return;
  }

  const latest = await Package.findOne().sort({ sortOrder: -1 }).select('sortOrder');
  try {
    await Package.create({
      network: 'MTN',
      productType: 'afa',
      bundleSize: AFA_BUNDLE_SIZE,
      costPrice: AFA_BASE_PRICE,
      agentPrice: AFA_BASE_PRICE,
      resellerBasePrice: AFA_BASE_PRICE,
      maxSellingPrice: AFA_DEFAULT_MAX_SELL,
      isEnabled: true,
      sortOrder: (latest?.sortOrder ?? 0) + 1,
    });
  } catch (err) {
    if (isMongoDuplicateKeyError(err)) return;
    throw err;
  }
}
