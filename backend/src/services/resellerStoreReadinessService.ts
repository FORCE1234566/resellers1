import { IUser } from '../models/User';
import { Package } from '../models/Package';
import { AppError } from '../middleware/errorHandler';
import { comparePackagesByNetworkAndSize } from '../utils/bundleSize';
import {
  getParentAssignedPrice,
  getSubResellerDefaultFloor,
  hasParentReseller,
} from './subResellerPricingService';

export const RESELLER_STORE_NETWORKS = ['MTN', 'MTN Express', 'Telecel', 'AirtelTigo'] as const;

export function getCustomPrice(user: IUser, packageId: string): number | undefined {
  const prices = user.resellerStore?.customPrices;
  if (!prices) return undefined;
  if (prices instanceof Map) return prices.get(packageId);
  return (prices as unknown as Record<string, number>)[packageId];
}

/** All enabled packages resellers can sell (data + afa + checker). */
export async function getAllSellablePackages() {
  const [dataPackages, checkerPackages, afaPackages] = await Promise.all([
    Package.find({
      isEnabled: true,
      network: { $in: RESELLER_STORE_NETWORKS },
      productType: 'data',
    }).select('_id network bundleSize productType sortOrder'),
    Package.find({ isEnabled: true, productType: 'checker' }).select(
      '_id network bundleSize productType sortOrder'
    ),
    Package.find({ isEnabled: true, productType: 'afa' }).select(
      '_id network bundleSize productType sortOrder'
    ),
  ]);

  return [...dataPackages, ...afaPackages, ...checkerPackages].sort((a, b) => {
    if (a.productType !== b.productType) {
      const order = { data: 0, afa: 1, checker: 2 };
      return (order[a.productType as keyof typeof order] ?? 9) - (order[b.productType as keyof typeof order] ?? 9);
    }
    return comparePackagesByNetworkAndSize(a, b);
  });
}

function packageHasAssignedBase(
  user: IUser,
  packageId: string,
  getFloor: (u: IUser, id: string) => number | undefined
): boolean {
  return getFloor(user, packageId) !== undefined;
}

/** Parent default template: base price for every sellable package (max is auto-derived). */
export async function getSubResellerTemplateStatus(user: IUser) {
  const packages = await getAllSellablePackages();
  const missingPackageIds: string[] = [];
  let configuredCount = 0;

  for (const pkg of packages) {
    const id = pkg._id.toString();
    const complete = packageHasAssignedBase(user, id, getSubResellerDefaultFloor);
    if (complete) configuredCount++;
    else missingPackageIds.push(id);
  }

  const requiredCount = packages.length;
  const templateReady = requiredCount === 0 || missingPackageIds.length === 0;

  return { templateReady, configuredCount, requiredCount, missingPackageIds };
}

/** Child must have parent-assigned base for every sellable package (max is auto-derived). */
export async function getParentAssignedPricingStatus(user: IUser) {
  if (!hasParentReseller(user)) {
    return {
      parentPricesReady: true,
      configuredCount: 0,
      requiredCount: 0,
      missingPackageIds: [] as string[],
      networksMissing: [] as string[],
    };
  }

  const packages = await getAllSellablePackages();
  const missingPackageIds: string[] = [];
  let configuredCount = 0;

  for (const pkg of packages) {
    const id = pkg._id.toString();
    const floor = getParentAssignedPrice(user, id);
    const complete = floor !== undefined;
    if (complete) configuredCount++;
    else missingPackageIds.push(id);
  }

  const requiredCount = packages.length;
  const parentPricesReady = requiredCount === 0 || missingPackageIds.length === 0;

  const dataPackages = packages.filter((p) => p.productType === 'data');
  const byNetwork = new Map<string, typeof dataPackages>();
  for (const pkg of dataPackages) {
    const list = byNetwork.get(pkg.network) || [];
    list.push(pkg);
    byNetwork.set(pkg.network, list);
  }
  const networksMissing: string[] = [];
  for (const [network, pkgs] of byNetwork) {
    const hasAny = pkgs.some((p) => {
      const id = p._id.toString();
      return getParentAssignedPrice(user, id) !== undefined;
    });
    if (!hasAny) networksMissing.push(network);
  }

  return {
    parentPricesReady,
    configuredCount,
    requiredCount,
    missingPackageIds,
    networksMissing,
  };
}

/** At least one explicit selling price per data network with enabled packages. */
export async function getResellerPricingStatus(user: IUser) {
  const packages = await Package.find({
    isEnabled: true,
    network: { $in: RESELLER_STORE_NETWORKS },
    productType: 'data',
  }).select('_id network');

  const byNetwork = new Map<string, Array<{ _id: { toString(): string }; network: string }>>();
  for (const pkg of packages) {
    const list = byNetwork.get(pkg.network) || [];
    list.push(pkg);
    byNetwork.set(pkg.network, list);
  }

  const networksMissing: string[] = [];
  let configuredCount = 0;

  for (const [network, pkgs] of byNetwork) {
    const hasAny = pkgs.some((pkg) => getCustomPrice(user, pkg._id.toString()) !== undefined);
    if (hasAny) configuredCount++;
    else networksMissing.push(network);
  }

  const requiredCount = byNetwork.size;
  const ownPricesReady = requiredCount > 0 && networksMissing.length === 0;
  const parentStatus = await getParentAssignedPricingStatus(user);
  const pricesReady = ownPricesReady && parentStatus.parentPricesReady;

  return {
    pricesReady,
    ownPricesReady,
    configuredCount,
    requiredCount,
    networksMissing,
    parentPricesReady: parentStatus.parentPricesReady,
    parentPricesPending: !parentStatus.parentPricesReady,
    parentNetworksMissing: parentStatus.networksMissing,
    parentPackagesConfigured: parentStatus.configuredCount,
    parentPackagesRequired: parentStatus.requiredCount,
  };
}

export async function canAcceptSubResellerSignup(parent: IUser): Promise<{
  signupOpen: boolean;
  reason?: string;
  templateReady: boolean;
  templateConfigured: number;
  templateRequired: number;
  pricesReady: boolean;
}> {
  if (!parent.resellerStore?.isActive || parent.status !== 'active') {
    return {
      signupOpen: false,
      reason: 'This store is not accepting new resellers right now',
      templateReady: false,
      templateConfigured: 0,
      templateRequired: 0,
      pricesReady: false,
    };
  }

  const [templateStatus, pricingStatus] = await Promise.all([
    getSubResellerTemplateStatus(parent),
    getResellerPricingStatus(parent),
  ]);

  if (!pricingStatus.pricesReady) {
    return {
      signupOpen: false,
      reason: 'The store owner must finish setting their own store prices first',
      templateReady: templateStatus.templateReady,
      templateConfigured: templateStatus.configuredCount,
      templateRequired: templateStatus.requiredCount,
      pricesReady: false,
    };
  }

  if (!templateStatus.templateReady) {
    return {
      signupOpen: false,
      reason: 'Default sub-reseller prices are not fully configured yet',
      templateReady: false,
      templateConfigured: templateStatus.configuredCount,
      templateRequired: templateStatus.requiredCount,
      pricesReady: true,
    };
  }

  return {
    signupOpen: true,
    templateReady: true,
    templateConfigured: templateStatus.configuredCount,
    templateRequired: templateStatus.requiredCount,
    pricesReady: true,
  };
}

export async function assertResellerPricesReady(user: IUser) {
  const status = await getResellerPricingStatus(user);
  if (!status.pricesReady) {
    const missing =
      status.networksMissing.length > 0
        ? ` Set at least one price for: ${status.networksMissing.join(', ')}.`
        : ' No packages are available yet.';
    throw new AppError(`Set your store prices before continuing.${missing}`);
  }
  return status;
}
