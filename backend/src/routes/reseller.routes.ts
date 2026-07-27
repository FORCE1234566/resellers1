import { Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { User } from '../models/User';
import { Package, Network } from '../models/Package';
import { Order } from '../models/Order';
import { Withdrawal } from '../models/Withdrawal';
import { Complaint } from '../models/Complaint';
import { Notification } from '../models/Notification';
import { getDateRanges, slugify, isValidGhanaPhone } from '../utils/helpers';
import { parseOptionalWhatsAppChannelUrl } from '../utils/whatsappChannel';
import { sortPackagesByBundleSize } from '../utils/bundleSize';
import { getOrCreateWallet } from '../services/walletService';
import { validateResellerPrice } from '../services/orderService';
import { computeResellerProfit, resellerProfitRange } from '../services/resellerProfitService';
import { getNetworkStockList } from '../services/networkStockService';
import { getAfaStock } from '../services/afaStockService';
import { getAfaPackage } from '../services/afaPackageService';
import { getAllCheckerStock } from '../services/checkerStockService';
import { getSettings } from '../services/settingsService';
import { canSubmitComplaint, isComplaintsEnabledForUser } from '../services/settingsService';
import {
  requestWithdrawal,
  getWithdrawalSummary,
} from '../services/withdrawalService';
import { upload } from '../middleware/upload';
import { withdrawalLimiter } from '../middleware/rateLimiter';
import { env } from '../config/env';
import { buildStoreShareUrl } from '../config/urls';
import { getOrderGrowthChart } from '../services/growthChartService';
import {
  getOrderTracking,
  syncFulfillmentStatuses,
  syncInFlightOrders,
  getFulfillmentStatusCounts,
} from '../services/fulfillmentProviderService';
import {
  getCustomPrice,
  getResellerPricingStatus,
  getParentAssignedPricingStatus,
  getSubResellerTemplateStatus,
  canAcceptSubResellerSignup,
  RESELLER_STORE_NETWORKS,
} from '../services/resellerStoreReadinessService';
import { activateResellerStore } from '../services/resellerOnboardingService';
import {
  getEffectiveBasePrice,
  getEffectiveMaxPrice,
  getParentAssignableRange,
  getSubResellerDefaultFloor,
  computeSubResellerMaxFromFloor,
  computeInheritedMaxMarkup,
  setSubResellerAssignedPricing,
  setSubResellerDefaultPricing,
  hasParentReseller,
} from '../services/subResellerPricingService';

const router = Router();
router.use(authenticate, authorize('reseller'));

// Dashboard
router.get('/dashboard', asyncHandler(async (req: AuthRequest, res) => {
  const resellerId = req.user!._id;
  void syncFulfillmentStatuses({ resellerId }, 40).catch(() => {});

  const { startOfToday, startOfWeek, startOfMonth } = getDateRanges();
  const wallet = await getOrCreateWallet(resellerId);
  const fulfillmentCounts = await getFulfillmentStatusCounts({ resellerId });

  const [
    ordersToday, ordersWeek, ordersMonth,
    successful, failed, pending, processing,
    revenueAgg, profitToday, profitWeek, profitMonth, profitLifetime, uplineProfitLifetime,
  ] = await Promise.all([
    Order.countDocuments({ resellerId, createdAt: { $gte: startOfToday } }),
    Order.countDocuments({ resellerId, createdAt: { $gte: startOfWeek } }),
    Order.countDocuments({ resellerId, createdAt: { $gte: startOfMonth } }),
    Order.countDocuments({ resellerId, status: 'delivered' }),
    Order.countDocuments({ resellerId, status: 'failed' }),
    Order.countDocuments({ resellerId, status: 'pending' }),
    Order.countDocuments({ resellerId, status: 'processing' }),
    Order.aggregate([{ $match: { resellerId } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.aggregate([{ $match: { resellerId, createdAt: { $gte: startOfToday } } }, { $group: { _id: null, total: { $sum: '$profit' } } }]),
    Order.aggregate([{ $match: { resellerId, createdAt: { $gte: startOfWeek } } }, { $group: { _id: null, total: { $sum: '$profit' } } }]),
    Order.aggregate([{ $match: { resellerId, createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$profit' } } }]),
    Order.aggregate([{ $match: { resellerId } }, { $group: { _id: null, total: { $sum: '$profit' } } }]),
    Order.aggregate([
      { $match: { 'uplineProfits.resellerId': resellerId } },
      { $unwind: '$uplineProfits' },
      { $match: { 'uplineProfits.resellerId': resellerId } },
      { $group: { _id: null, total: { $sum: '$uplineProfits.profit' } } },
    ]),
  ]);

  const growthChart = await getOrderGrowthChart({ resellerId }, 14, 'profit');
  const user = await User.findById(resellerId);
  const pricing = user?.resellerStore
    ? await getResellerPricingStatus(user)
    : {
        pricesReady: false,
        configuredCount: 0,
        requiredCount: 0,
        networksMissing: [] as string[],
        parentPricesReady: true,
        parentPricesPending: false,
        parentNetworksMissing: [] as string[],
      };

  let parentStore: { storeName: string; slug: string } | null = null;
  if (user?.resellerStore?.referredBy) {
    const parent = await User.findById(user.resellerStore.referredBy).select('resellerStore');
    if (parent?.resellerStore) {
      parentStore = { storeName: parent.resellerStore.storeName, slug: parent.resellerStore.slug };
    }
  }

  const subResellerCount = await User.countDocuments({
    role: 'reseller',
    'resellerStore.referredBy': resellerId,
  });

  const canShareLink = Boolean(
    pricing.pricesReady && user?.resellerStore?.isActive && user.resellerStore.slug
  );
  const leafProfit = profitLifetime[0]?.total || 0;
  const uplineProfit = uplineProfitLifetime[0]?.total || 0;

  res.json({
    success: true,
    data: {
      walletBalance: wallet.balance,
      ordersToday,
      ordersThisWeek: ordersWeek,
      ordersThisMonth: ordersMonth,
      successfulOrders: successful,
      failedOrders: failed,
      pendingOrders: pending,
      processingOrders: processing,
      totalRevenue: revenueAgg[0]?.total || 0,
      growthChart,
      totalProfit: leafProfit + uplineProfit,
      storeProfit: leafProfit,
      uplineProfit,
      withdrawableProfit: wallet.profitBalance,
      profitToday: profitToday[0]?.total || 0,
      profitThisWeek: profitWeek[0]?.total || 0,
      profitThisMonth: profitMonth[0]?.total || 0,
      ...fulfillmentCounts,
      pricesReady: pricing.pricesReady,
      configuredCount: pricing.configuredCount,
      requiredCount: pricing.requiredCount,
      networksMissing: pricing.networksMissing,
      parentPricesReady: pricing.parentPricesReady,
      parentPricesPending: pricing.parentPricesPending,
      parentNetworksMissing: pricing.parentNetworksMissing,
      parentStore,
      subResellerCount,
      hasParent: user ? hasParentReseller(user) : false,
      canShareLink,
      storeUrl: canShareLink ? buildStoreShareUrl(user!.resellerStore!.slug) : null,
    },
  });
}));

const generateUniqueStoreSlug = async (storeName: string, excludeUserId: string): Promise<string> => {
  const base = slugify(storeName) || 'my-store';
  let slug = base;
  let counter = 1;
  while (await User.findOne({ 'resellerStore.slug': slug, _id: { $ne: excludeUserId } })) {
    slug = `${base}-${counter++}`;
  }
  return slug;
};

// Store setup
router.get('/store', asyncHandler(async (req: AuthRequest, res) => {
  const user = await User.findById(req.user!._id);
  if (!user?.resellerStore) throw new AppError('Store not found');

  const pricing = await getResellerPricingStatus(user);
  const canShareLink = pricing.pricesReady && user.resellerStore.isActive;

  let parentStore: { storeName: string; slug: string } | null = null;
  if (user.resellerStore.referredBy) {
    const parent = await User.findById(user.resellerStore.referredBy).select('resellerStore');
    if (parent?.resellerStore) {
      parentStore = { storeName: parent.resellerStore.storeName, slug: parent.resellerStore.slug };
    }
  }

  const networkStock = await getNetworkStockList();

  res.json({
    success: true,
    data: {
      storeName: user.resellerStore.storeName,
      slug: user.resellerStore.slug,
      phone: user.resellerStore.phone,
      whatsapp: user.resellerStore.whatsapp,
      whatsappChannelUrl: user.resellerStore.whatsappChannelUrl || '',
      supportEmail: user.resellerStore.supportEmail,
      storeDescription: user.resellerStore.storeDescription || '',
      isActive: user.resellerStore.isActive,
      pricesReady: pricing.pricesReady,
      configuredCount: pricing.configuredCount,
      requiredCount: pricing.requiredCount,
      networksMissing: pricing.networksMissing,
      parentPricesReady: pricing.parentPricesReady,
      parentPricesPending: pricing.parentPricesPending,
      parentNetworksMissing: pricing.parentNetworksMissing,
      parentStore,
      hasParent: hasParentReseller(user),
      networkStock,
      canShareLink,
      storeUrl: canShareLink ? buildStoreShareUrl(user.resellerStore.slug) : null,
    },
  });
}));

router.put('/store', asyncHandler(async (req: AuthRequest, res) => {
  const { storeName, phone, whatsapp, supportEmail, whatsappChannelUrl } = req.body;
  const user = await User.findById(req.user!._id);
  if (!user?.resellerStore) throw new AppError('Store not found');

  if (!storeName?.trim()) throw new AppError('Store name is required');
  if (storeName.trim().length < 2) throw new AppError('Store name must be at least 2 characters');
  if (phone && !isValidGhanaPhone(phone)) throw new AppError('Phone must be 10 digits starting with 0');
  if (whatsapp && !isValidGhanaPhone(whatsapp)) throw new AppError('WhatsApp must be 10 digits starting with 0');

  let parsedChannelUrl: string | undefined;
  try {
    parsedChannelUrl = parseOptionalWhatsAppChannelUrl(whatsappChannelUrl);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : 'Invalid WhatsApp channel link');
  }

  user.resellerStore.storeName = storeName.trim();
  user.resellerStore.slug = await generateUniqueStoreSlug(storeName, user._id.toString());
  if (phone) user.resellerStore.phone = phone;
  if (whatsapp) user.resellerStore.whatsapp = whatsapp;
  if (supportEmail) user.resellerStore.supportEmail = supportEmail.toLowerCase().trim();
  if (parsedChannelUrl !== undefined) user.resellerStore.whatsappChannelUrl = parsedChannelUrl;
  activateResellerStore(user);
  await user.save();

  const pricing = await getResellerPricingStatus(user);
  const canShareLink = pricing.pricesReady && user.resellerStore.isActive;

  res.json({
    success: true,
    message: 'Store updated successfully',
    data: {
      storeName: user.resellerStore.storeName,
      slug: user.resellerStore.slug,
      phone: user.resellerStore.phone,
      whatsapp: user.resellerStore.whatsapp,
      whatsappChannelUrl: user.resellerStore.whatsappChannelUrl || '',
      supportEmail: user.resellerStore.supportEmail,
      isActive: user.resellerStore.isActive,
      pricesReady: pricing.pricesReady,
      configuredCount: pricing.configuredCount,
      requiredCount: pricing.requiredCount,
      networksMissing: pricing.networksMissing,
      canShareLink,
      storeUrl: canShareLink ? buildStoreShareUrl(user.resellerStore.slug) : null,
    },
  });
}));

// Price management
router.get('/network-stock', asyncHandler(async (_req, res) => {
  const data = await getNetworkStockList();
  res.json({ success: true, data });
}));

router.get('/prices', asyncHandler(async (req: AuthRequest, res) => {
  const stock = await getNetworkStockList();
  const afaStock = await getAfaStock();
  const packages = sortPackagesByBundleSize(
    await Package.find({
      isEnabled: true,
      network: { $in: RESELLER_STORE_NETWORKS },
      productType: 'data',
    })
  );

  const checkerPackages = sortPackagesByBundleSize(
    await Package.find({
      isEnabled: true,
      productType: 'checker',
    })
  );

  const checkerStock = await getAllCheckerStock();

  const user = await User.findById(req.user!._id);
  if (!user?.resellerStore) throw new AppError('Store not found');

  const pricing = await getResellerPricingStatus(user);

  const mapOwnPriceRow = (pkg: InstanceType<typeof Package>) => {
    const packageId = pkg._id.toString();
    const custom = getCustomPrice(user, packageId);
    const effectiveBase = getEffectiveBasePrice(user, packageId, pkg);
    const effectiveMax = getEffectiveMaxPrice(user, packageId, pkg);
    const myPrice = custom ?? effectiveBase;
    return {
      _id: pkg._id,
      network: pkg.network,
      bundleSize: pkg.bundleSize,
      productType: pkg.productType,
      resellerBasePrice: effectiveBase,
      adminBasePrice: pkg.resellerBasePrice,
      maxSellingPrice: effectiveMax,
      adminMaxSellingPrice: pkg.maxSellingPrice,
      myPrice,
      hasCustomPrice: custom !== undefined,
      profitPerSale: computeResellerProfit(myPrice, effectiveBase),
      ...resellerProfitRange(effectiveBase, effectiveMax),
    };
  };

  const data = packages.map(mapOwnPriceRow);
  const checkerData = checkerPackages.map(mapOwnPriceRow);

  const afaPkg = await getAfaPackage();
  let afaPackage = null;
  if (afaPkg) {
    afaPackage = mapOwnPriceRow(afaPkg);
  }

  const templateStatus = await getSubResellerTemplateStatus(user);
  const signupStatus = await canAcceptSubResellerSignup(user);

  res.json({
    success: true,
    data,
    checkerPackages: checkerData,
    afaPackage,
    meta: {
      pricesReady: pricing.pricesReady,
      configuredCount: pricing.configuredCount,
      requiredCount: pricing.requiredCount,
      networksMissing: pricing.networksMissing,
      parentPricesReady: pricing.parentPricesReady,
      parentPricesPending: pricing.parentPricesPending,
      parentNetworksMissing: pricing.parentNetworksMissing,
      parentPackagesConfigured: pricing.parentPackagesConfigured,
      parentPackagesRequired: pricing.parentPackagesRequired,
      hasParent: hasParentReseller(user),
      subResellerTemplateReady: templateStatus.templateReady,
      subResellerTemplateConfigured: templateStatus.configuredCount,
      subResellerTemplateRequired: templateStatus.requiredCount,
      subResellerSignupReady: signupStatus.signupOpen,
      subResellerSignupReason: signupStatus.reason,
      networkStock: stock,
      afaStock,
      checkerStock,
    },
  });
}));

router.put('/prices/:packageId', asyncHandler(async (req: AuthRequest, res) => {
  const { price } = req.body;
  const pkg = await Package.findById(req.params.packageId);
  if (!pkg) throw new AppError('Package not found');
  const isChecker = pkg.productType === 'checker';
  const isAfa = pkg.productType === 'afa';
  if (
    !isChecker &&
    !isAfa &&
    !RESELLER_STORE_NETWORKS.includes(pkg.network as (typeof RESELLER_STORE_NETWORKS)[number])
  ) {
    throw new AppError('This package cannot be priced');
  }

  const user = await User.findById(req.user!._id);
  if (!user?.resellerStore) throw new AppError('Store not found');

  const effectiveBase = getEffectiveBasePrice(user, pkg._id.toString(), pkg);
  const effectiveMax = getEffectiveMaxPrice(user, pkg._id.toString(), pkg);
  if (hasParentReseller(user)) {
    const parentStatus = await getParentAssignedPricingStatus(user);
    if (!parentStatus.parentPricesReady) {
      throw new AppError(
        'Your parent reseller must set your floor and max prices for all products before you can set store prices.'
      );
    }
  }

  validateResellerPrice(price, effectiveBase, effectiveMax);

  if (!user.resellerStore.customPrices) {
    user.resellerStore.customPrices = new Map();
  }
  user.resellerStore.customPrices.set(pkg._id.toString(), price);
  user.markModified('resellerStore.customPrices');
  await user.save();

  const profitPerSale = computeResellerProfit(price, effectiveBase);

  res.json({
    success: true,
    message: 'Price updated',
    data: {
      packageId: pkg._id,
      price,
      resellerBasePrice: effectiveBase,
      profitPerSale,
    },
  });
}));

// Default sub-reseller pricing template (gates signup link)
router.get('/sub-reseller-default-prices', asyncHandler(async (req: AuthRequest, res) => {
  const parent = await User.findById(req.user!._id);
  if (!parent?.resellerStore) throw new AppError('Store not found');

  const packages = sortPackagesByBundleSize(
    await Package.find({
      isEnabled: true,
      network: { $in: RESELLER_STORE_NETWORKS },
      productType: 'data',
    })
  );

  const checkerPackages = sortPackagesByBundleSize(
    await Package.find({ isEnabled: true, productType: 'checker' })
  );
  const afaPackages = sortPackagesByBundleSize(
    await Package.find({ isEnabled: true, productType: 'afa' })
  );

  const mapRow = (pkg: InstanceType<typeof Package>) => {
    const packageId = pkg._id.toString();
    const { parentCost, maxCeiling, inheritedMarkup } = getParentAssignableRange(parent, packageId, pkg);
    const assignedFloor = getSubResellerDefaultFloor(parent, packageId);
    const assignedMax =
      assignedFloor !== undefined ? computeSubResellerMaxFromFloor(assignedFloor, pkg) : undefined;
    return {
      _id: pkg._id,
      network: pkg.network,
      bundleSize: pkg.bundleSize,
      productType: pkg.productType,
      parentCost,
      maxCeiling,
      inheritedMarkup,
      adminCostPrice: pkg.costPrice,
      adminMaxSellingPrice: pkg.maxSellingPrice,
      assignedFloor,
      assignedMax,
      profitPerSale:
        assignedFloor !== undefined ? computeResellerProfit(assignedFloor, parentCost) : 0,
      ...resellerProfitRange(parentCost, assignedMax ?? maxCeiling),
    };
  };

  const templateStatus = await getSubResellerTemplateStatus(parent);
  const signupStatus = await canAcceptSubResellerSignup(parent);

  res.json({
    success: true,
    data: {
      packages: packages.map(mapRow),
      checkerPackages: checkerPackages.map(mapRow),
      afaPackages: afaPackages.map(mapRow),
      meta: {
        templateReady: templateStatus.templateReady,
        configuredCount: templateStatus.configuredCount,
        requiredCount: templateStatus.requiredCount,
        signupOpen: signupStatus.signupOpen,
        signupReason: signupStatus.reason,
      },
    },
  });
}));

router.put('/sub-reseller-default-prices/:packageId', asyncHandler(async (req: AuthRequest, res) => {
  const floor = req.body.floor ?? req.body.price;
  if (floor === undefined || floor === null) {
    throw new AppError('Base price is required');
  }

  const pkg = await Package.findById(req.params.packageId);
  if (!pkg) throw new AppError('Package not found');

  const max = await setSubResellerDefaultPricing(
    req.user!._id.toString(),
    pkg._id.toString(),
    Number(floor),
    pkg
  );

  const parent = await User.findById(req.user!._id);
  const parentCost = parent
    ? getEffectiveBasePrice(parent, pkg._id.toString(), pkg)
    : pkg.resellerBasePrice;

  res.json({
    success: true,
    message: 'Default sub-reseller base price updated',
    data: {
      packageId: pkg._id,
      floor: Number(floor),
      max,
      inheritedMarkup: computeInheritedMaxMarkup(pkg),
      parentCost,
      minProfitPerSale: computeResellerProfit(Number(floor), parentCost),
      maxProfitPerSale: computeResellerProfit(max, parentCost),
    },
  });
}));

// Sub-resellers (direct children)
router.get('/sub-resellers', asyncHandler(async (req: AuthRequest, res) => {
  const parentId = req.user!._id;
  const children = await User.find({
    role: 'reseller',
    'resellerStore.referredBy': parentId,
  })
    .select('fullName email phone status resellerStore createdAt')
    .sort({ createdAt: -1 });

  const signupStatus = await canAcceptSubResellerSignup(
    (await User.findById(parentId))!
  );

  const data = await Promise.all(
    children.map(async (child) => {
      const pricing = child.resellerStore ? await getResellerPricingStatus(child) : null;
      const parentPricing = child.resellerStore
        ? await getParentAssignedPricingStatus(child)
        : null;
      return {
        _id: child._id,
        fullName: child.fullName,
        email: child.email,
        phone: child.phone,
        status: child.status,
        storeName: child.resellerStore?.storeName,
        slug: child.resellerStore?.slug,
        isActive: child.resellerStore?.isActive,
        createdAt: child.createdAt,
        pricesReady: pricing?.pricesReady ?? false,
        parentPricesConfigured: parentPricing?.parentPricesReady ?? false,
      };
    })
  );

  res.json({
    success: true,
    data,
    meta: {
      subResellerSignupReady: signupStatus.signupOpen,
      subResellerSignupReason: signupStatus.reason,
      templateConfigured: signupStatus.templateConfigured,
      templateRequired: signupStatus.templateRequired,
    },
  });
}));

router.get('/sub-resellers/:childId/prices', asyncHandler(async (req: AuthRequest, res) => {
  const parentId = req.user!._id.toString();
  const child = await User.findOne({
    _id: req.params.childId,
    role: 'reseller',
    'resellerStore.referredBy': parentId,
  });
  if (!child?.resellerStore) throw new AppError('Sub-reseller not found', 404);

  const parent = await User.findById(parentId);
  if (!parent?.resellerStore) throw new AppError('Store not found', 404);

  const packages = sortPackagesByBundleSize(
    await Package.find({
      isEnabled: true,
      network: { $in: RESELLER_STORE_NETWORKS },
      productType: 'data',
    })
  );

  const checkerPackages = sortPackagesByBundleSize(
    await Package.find({
      isEnabled: true,
      productType: 'checker',
    })
  );

  const afaPackages = sortPackagesByBundleSize(
    await Package.find({
      isEnabled: true,
      productType: 'afa',
    })
  );

  const mapRow = (pkg: InstanceType<typeof Package>) => {
    const packageId = pkg._id.toString();
    const { parentCost, maxCeiling, inheritedMarkup } = getParentAssignableRange(parent, packageId, pkg);
    const assignedFloor = child.resellerStore!.parentAssignedPrices?.get(packageId);
    const assignedMax =
      assignedFloor !== undefined ? computeSubResellerMaxFromFloor(assignedFloor, pkg) : undefined;
    return {
      _id: pkg._id,
      network: pkg.network,
      bundleSize: pkg.bundleSize,
      productType: pkg.productType,
      parentCost,
      maxCeiling,
      inheritedMarkup,
      adminCostPrice: pkg.costPrice,
      adminMaxSellingPrice: pkg.maxSellingPrice,
      assignedFloor,
      assignedMax,
      profitPerSale:
        assignedFloor !== undefined ? computeResellerProfit(assignedFloor, parentCost) : 0,
      ...resellerProfitRange(parentCost, assignedMax ?? maxCeiling),
    };
  };

  res.json({
    success: true,
    data: {
      child: {
        _id: child._id,
        fullName: child.fullName,
        storeName: child.resellerStore.storeName,
        slug: child.resellerStore.slug,
      },
      packages: packages.map(mapRow),
      checkerPackages: checkerPackages.map(mapRow),
      afaPackages: afaPackages.map(mapRow),
    },
  });
}));

router.put('/sub-resellers/:childId/prices/:packageId', asyncHandler(async (req: AuthRequest, res) => {
  const floor = req.body.floor ?? req.body.price;
  if (floor === undefined || floor === null) {
    throw new AppError('Base price is required');
  }

  const pkg = await Package.findById(req.params.packageId);
  if (!pkg) throw new AppError('Package not found');

  const max = await setSubResellerAssignedPricing(
    req.user!._id.toString(),
    String(req.params.childId),
    pkg._id.toString(),
    Number(floor),
    pkg
  );

  const parent = await User.findById(req.user!._id);
  const parentCost = parent
    ? getEffectiveBasePrice(parent, pkg._id.toString(), pkg)
    : pkg.resellerBasePrice;

  res.json({
    success: true,
    message: 'Sub-reseller base price updated',
    data: {
      packageId: pkg._id,
      floor: Number(floor),
      max,
      inheritedMarkup: computeInheritedMaxMarkup(pkg),
      parentCost,
      minProfitPerSale: computeResellerProfit(Number(floor), parentCost),
      maxProfitPerSale: computeResellerProfit(max, parentCost),
    },
  });
}));

// Orders (store purchases)
router.get('/orders', asyncHandler(async (req: AuthRequest, res) => {
  const orders = await Order.find({
    resellerId: req.user!._id,
    source: 'reseller_store',
  })
    .sort({ createdAt: -1 })
    .limit(200);

  await syncInFlightOrders(orders);

  const refreshed = await Order.find({
    resellerId: req.user!._id,
    source: 'reseller_store',
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .select(
      'orderId customerEmail recipientPhone network bundleSize status providerStatus providerReference totalAmount sellingPrice createdAt updatedAt'
    );

  res.json({ success: true, data: refreshed });
}));

router.get('/orders/:orderId/tracking', asyncHandler(async (req: AuthRequest, res) => {
  const order = await Order.findOne({
    orderId: req.params.orderId,
    resellerId: req.user!._id,
    source: 'reseller_store',
  });
  if (!order) throw new AppError('Order not found');
  res.json({ success: true, data: getOrderTracking(order, { forClient: true }) });
}));

// Withdrawals
router.get('/withdrawals/summary', asyncHandler(async (req: AuthRequest, res) => {
  const summary = await getWithdrawalSummary(req.user!._id);
  res.json({ success: true, data: summary });
}));

router.post('/withdrawals', withdrawalLimiter, asyncHandler(async (req: AuthRequest, res) => {
  const withdrawal = await requestWithdrawal(req.user!._id, req.body);
  res.status(201).json({ success: true, data: withdrawal });
}));

router.get('/withdrawals', asyncHandler(async (req: AuthRequest, res) => {
  const withdrawals = await Withdrawal.find({ userId: req.user!._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: withdrawals });
}));

// Complaints
router.get('/complaints/eligible-orders', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!._id.toString();
  const complaintsEnabled = await isComplaintsEnabledForUser(userId);

  const orders = await Order.find({
    resellerId: req.user!._id,
    source: 'reseller_store',
    status: { $nin: ['refunded', 'cancelled'] },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .select('orderId recipientPhone customerEmail network bundleSize status createdAt');

  const submitted = await Complaint.find({ userId: req.user!._id }).distinct('orderId');
  const submittedSet = new Set(submitted);

  const eligible = await Promise.all(
    orders.map(async (order) => {
      const check = await canSubmitComplaint(userId, {
        orderId: order.orderId,
        network: order.network,
        status: order.status,
        createdAt: order.createdAt,
      });
      return {
        orderId: order.orderId,
        recipientPhone: order.recipientPhone,
        customerEmail: order.customerEmail,
        network: order.network,
        bundleSize: order.bundleSize,
        status: order.status,
        createdAt: order.createdAt,
        canComplain: complaintsEnabled && check.allowed,
        reason: check.reason,
        hasComplaint: submittedSet.has(order.orderId),
      };
    })
  );

  res.json({
    success: true,
    data: { complaintsEnabled, orders: eligible },
  });
}));

router.post('/complaints', upload.single('screenshot'), asyncHandler(async (req: AuthRequest, res) => {
  const { orderId, issueType, description } = req.body;
  if (!orderId) throw new AppError('Order ID is required');

  const order = await Order.findOne({ orderId, resellerId: req.user!._id });
  if (!order) throw new AppError('Order not found');

  const check = await canSubmitComplaint(req.user!._id.toString(), {
    orderId: order.orderId,
    network: order.network,
    status: order.status,
    createdAt: order.createdAt,
  });
  if (!check.allowed) throw new AppError(check.reason || 'Cannot submit complaint');

  const screenshotUrl = req.file ? `/${env.uploadDir}/${req.file.filename}` : undefined;

  const complaint = await Complaint.create({
    orderId,
    userId: req.user!._id,
    phoneNumber: order.recipientPhone,
    issueType: issueType || 'Data Not Received',
    description: description || 'Data not received after 2+ hours',
    screenshotUrl,
  });

  res.status(201).json({ success: true, message: 'Complaint submitted', data: complaint });
}));

router.get('/complaints', asyncHandler(async (req: AuthRequest, res) => {
  const complaints = await Complaint.find({ userId: req.user!._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: complaints });
}));

// Notifications
router.get('/notifications', asyncHandler(async (req: AuthRequest, res) => {
  const notifications = await Notification.find({ userId: req.user!._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: notifications });
}));

router.patch('/notifications/:id/read', asyncHandler(async (req: AuthRequest, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.user!._id }, { isRead: true });
  res.json({ success: true, message: 'Marked as read' });
}));

export default router;
