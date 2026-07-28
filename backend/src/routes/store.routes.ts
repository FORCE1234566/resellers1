import { Router } from 'express';
import crypto from 'crypto';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { User } from '../models/User';
import { Package, Network } from '../models/Package';
import { Faq } from '../models/Faq';
import { Order } from '../models/Order';
import { getSettings } from '../services/settingsService';
import { initializePayment } from '../utils/paystack';
import { isValidGhanaPhone, roundMoney } from '../utils/helpers';
import { assertNetworkPhone } from '../utils/phone';
import { assertNetworkInStock } from '../services/networkStockService';
import { assertAfaInStock, getAfaStock } from '../services/afaStockService';
import { getAfaPackage } from '../services/afaPackageService';
import { isAfaProduct, AFA_CHECK_USSD, AFA_PROCESSING_HOURS } from '../config/afa';
import {
  CHECKER_DEFAULT_IMAGE,
  CheckerType,
  checkerTypeLabel,
  normalizeCheckerType,
  isCheckerProduct,
} from '../config/checker';
import { getAllCheckerStock } from '../services/checkerStockService';
import { getCheckerPackage } from '../services/checkerPackageService';
import { validateAfaDetails } from '../services/orderService';
import { sortPackagesByBundleSize } from '../utils/bundleSize';
import { getEffectiveBasePrice, getEffectiveMaxPrice, getResellerSellPrice } from '../services/subResellerPricingService';
import { canAcceptSubResellerSignup } from '../services/resellerStoreReadinessService';
import { env } from '../config/env';
import { otpLimiter, purchaseLimiter, promoValidateLimiter } from '../middleware/rateLimiter';
import { rejectFields } from '../middleware/rejectFields';
import {
  validatePromoForCheckout,
  computeStoreCheckoutTotals,
} from '../services/promoCodeService';

const blockStorePricing = rejectFields(
  'sellingPrice',
  'costPrice',
  'totalAmount',
  'profit',
  'processingFee',
  'expectedTotal',
  'promoCodeId',
  'promoDiscountGhs',
  'originalSellingPrice',
  'discountGhs'
);

async function resolvePromoCheckout(input: {
  promoCode?: string;
  packageId: string;
  sellingPrice: number;
  paystackChargePercent: number;
}) {
  const base = computeStoreCheckoutTotals(input.sellingPrice, input.paystackChargePercent);
  if (!input.promoCode?.trim()) {
    return {
      ...base,
      promoCodeId: undefined as string | undefined,
      promoMetadata: {} as Record<string, unknown>,
    };
  }

  const promo = await validatePromoForCheckout({
    code: input.promoCode,
    packageId: input.packageId,
    sellingPrice: input.sellingPrice,
    paystackChargePercent: input.paystackChargePercent,
  });

  return {
    originalSellingPrice: promo.originalSellingPrice,
    discountedSellingPrice: promo.discountedSellingPrice,
    discountGhs: promo.discountGhs,
    processingFee: promo.processingFee,
    total: promo.total,
    promoCodeId: promo.promoCodeId,
    promoMetadata: {
      promoCodeId: promo.promoCodeId,
      promoDiscountGhs: promo.discountGhs,
      originalSellingPrice: promo.originalSellingPrice,
      sellingPrice: promo.discountedSellingPrice,
      processingFee: promo.processingFee,
      expectedTotal: promo.total,
    },
  };
}
import {
  requestOrderHistoryOtp,
  requestOrderHistoryOtpByPhone,
  verifyOrderHistoryOtp,
  verifyOrderHistoryOtpByPhone,
} from '../services/orderHistoryService';
import {
  findResellerByStoreSlug,
  requireOpenResellerStore,
  requireResellerStore,
  storeSlugFromRequest,
} from '../services/storeLookupService';

const router = Router();

// Parent store info for sub-reseller signup form
router.get('/:slug/reseller-signup-info', asyncHandler(async (req, res) => {
  const reseller = await User.findOne({
    'resellerStore.slug': storeSlugFromRequest(req.params.slug),
    role: 'reseller',
  });

  if (!reseller?.resellerStore) throw new AppError('Store not found', 404);

  const signupStatus = await canAcceptSubResellerSignup(reseller);

  if (!signupStatus.signupOpen && signupStatus.reason === 'This store is not accepting new resellers right now') {
    throw new AppError(signupStatus.reason, 403);
  }

  res.json({
    success: true,
    data: {
      storeName: reseller.resellerStore.storeName,
      storeId: reseller._id.toString(),
      slug: reseller.resellerStore.slug,
      signupOpen: signupStatus.signupOpen,
      signupReason: signupStatus.reason,
      templateConfigured: signupStatus.templateConfigured,
      templateRequired: signupStatus.templateRequired,
    },
  });
}));

// Get store by slug
router.get('/:slug', asyncHandler(async (req, res) => {
  const reseller = await requireOpenResellerStore(req.params.slug, '-password');
  const store = reseller.resellerStore!;

  const settings = await getSettings();
  const afaStock = await getAfaStock();
  const checkerStock = await getAllCheckerStock();
  const signupStatus = await canAcceptSubResellerSignup(reseller);

  res.json({
    success: true,
    data: {
      storeName: store.storeName,
      slug: store.slug,
      phone: store.phone,
      whatsapp: store.whatsapp,
      whatsappChannelUrl: store.whatsappChannelUrl || '',
      supportEmail: store.supportEmail,
      resellerId: reseller._id,
      isVerified: store.isVerified,
      memberSince: reseller.createdAt,
      subResellerSignupOpen: signupStatus.signupOpen,
      serviceImages: settings.serviceImages,
      afa: {
        inStock: afaStock.inStock,
        imageUrl: afaStock.imageUrl,
        processingHours: AFA_PROCESSING_HOURS,
        checkUssd: AFA_CHECK_USSD,
      },
      checker: {
        imageUrl: CHECKER_DEFAULT_IMAGE,
        bece: { inStock: checkerStock[0].inStock },
        wassce: { inStock: checkerStock[1].inStock },
        inStock: checkerStock.some((s) => s.inStock),
      },
    },
  });
}));

// Verify page
router.get('/:slug/verify', asyncHandler(async (req, res) => {
  const reseller = await requireResellerStore(req.params.slug, {
    select: 'resellerStore createdAt status',
  });
  const store = reseller.resellerStore!;

  res.json({
    success: true,
    data: {
      storeName: store.storeName,
      resellerId: reseller._id,
      verificationStatus: store.isVerified ? 'Verified Reseller' : 'Unverified',
      registrationDate: reseller.createdAt,
      activeStatus: store.isActive && reseller.status === 'active' ? 'Active' : 'Inactive',
    },
  });
}));

// Network packages for store
router.get('/:slug/packages/:network', asyncHandler(async (req, res) => {
  const reseller = await findResellerByStoreSlug(req.params.slug, {
    requireActiveStore: true,
  });

  if (!reseller) throw new AppError('Store not found', 404);

  const network = decodeURIComponent(req.params.network as string) as Network;
  await assertNetworkInStock(network);

  const packages = sortPackagesByBundleSize(
    await Package.find({
      network,
      productType: 'data',
      isEnabled: true,
    })
  );

  const priced = packages.map((pkg) => {
    const packageId = pkg._id.toString();
    const effectiveBase = getEffectiveBasePrice(reseller, packageId, pkg);
    const price = getResellerSellPrice(reseller, packageId, pkg);
    return {
      id: pkg._id,
      bundleSize: pkg.bundleSize,
      price,
      basePrice: effectiveBase,
      maxPrice: getEffectiveMaxPrice(reseller, packageId, pkg),
    };
  });

  const prices = priced.map((p) => p.price);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  res.json({
    success: true,
    data: {
      network: req.params.network,
      priceRange: { min: minPrice, max: maxPrice },
      packages: priced,
    },
  });
}));

router.get('/:slug/afa', asyncHandler(async (req, res) => {
  const reseller = await findResellerByStoreSlug(req.params.slug, {
    requireActiveStore: true,
  });
  if (!reseller) throw new AppError('Store not found', 404);

  const [stock, pkg] = await Promise.all([getAfaStock(), getAfaPackage()]);
  if (!pkg || !pkg.isEnabled) throw new AppError('AFA registration is not available', 503);

  const packageId = pkg._id.toString();
  const effectiveBase = getEffectiveBasePrice(reseller, packageId, pkg);
  const price = getResellerSellPrice(reseller, packageId, pkg);

  const settings = await getSettings();
  const paystackChargePercent = settings.paystackChargePercent ?? 2;
  const processingFee = roundMoney(price * (paystackChargePercent / 100));
  const total = roundMoney(price + processingFee);

  res.json({
    success: true,
    data: {
      packageId: pkg._id,
      bundleSize: pkg.bundleSize,
      price,
      processingFee,
      total,
      paystackChargePercent,
      basePrice: effectiveBase,
      maxPrice: getEffectiveMaxPrice(reseller, packageId, pkg),
      inStock: stock.inStock,
      imageUrl: stock.imageUrl,
      processingHours: AFA_PROCESSING_HOURS,
      checkUssd: AFA_CHECK_USSD,
    },
  });
}));

async function buildCheckerOffer(
  reseller: NonNullable<Awaited<ReturnType<typeof User.findOne>>>,
  type: CheckerType
) {
  const [stockRow, pkg, settings] = await Promise.all([
    getAllCheckerStock().then((rows) => rows.find((r) => r.type === type)!),
    getCheckerPackage(type),
    getSettings(),
  ]);
  if (!pkg) throw new AppError(`${checkerTypeLabel(type)} checker is not configured`, 503);

  const packageId = pkg._id.toString();
  const effectiveBase = getEffectiveBasePrice(reseller!, packageId, pkg);
  const price = getResellerSellPrice(reseller!, packageId, pkg);
  const paystackChargePercent = settings.paystackChargePercent ?? 2;
  const processingFee = roundMoney(price * (paystackChargePercent / 100));
  const total = roundMoney(price + processingFee);

  return {
    type,
    packageId: pkg._id,
    bundleSize: pkg.bundleSize,
    price,
    processingFee,
    total,
    paystackChargePercent,
    basePrice: effectiveBase,
    maxPrice: getEffectiveMaxPrice(reseller!, packageId, pkg),
    inStock: stockRow.inStock,
    availableCount: stockRow.availableCount,
  };
}

router.get('/:slug/checker', asyncHandler(async (req, res) => {
  const reseller = await findResellerByStoreSlug(req.params.slug, {
    requireActiveStore: true,
  });
  if (!reseller) throw new AppError('Store not found', 404);

  const [bece, wassce] = await Promise.all([
    buildCheckerOffer(reseller, 'bece'),
    buildCheckerOffer(reseller, 'wassce'),
  ]);

  res.json({
    success: true,
    data: {
      imageUrl: CHECKER_DEFAULT_IMAGE,
      bece,
      wassce,
    },
  });
}));

router.post('/:slug/promo/validate', promoValidateLimiter, asyncHandler(async (req, res) => {
  const { code, packageId } = req.body as { code?: string; packageId?: string };
  if (!code?.trim() || !packageId) {
    throw new AppError('Promo code and package are required', 400);
  }

  const reseller = await findResellerByStoreSlug(req.params.slug, {
    requireActiveStore: true,
  });
  if (!reseller) throw new AppError('Store not found', 404);

  const pkg = await Package.findById(packageId);
  if (!pkg || !pkg.isEnabled) throw new AppError('Package not available', 404);

  const sellingPrice = getResellerSellPrice(reseller, pkg._id.toString(), pkg);
  const settings = await getSettings();
  const paystackChargePercent = settings.paystackChargePercent ?? 2;

  const promo = await validatePromoForCheckout({
    code,
    packageId: pkg._id.toString(),
    sellingPrice,
    paystackChargePercent,
  });

  res.json({
    success: true,
    data: {
      packageId: pkg._id.toString(),
      originalSellingPrice: promo.originalSellingPrice,
      discountedSellingPrice: promo.discountedSellingPrice,
      discountGhs: promo.discountGhs,
      processingFee: promo.processingFee,
      total: promo.total,
    },
  });
}));

router.post('/:slug/checker/purchase/init', purchaseLimiter, blockStorePricing, asyncHandler(async (req, res) => {
  const { type, email, phone, promoCode } = req.body as {
    type?: string;
    email?: string;
    phone?: string;
    promoCode?: string;
  };
  if (!type || !email?.trim() || !phone?.trim()) {
    throw new AppError('Checker type, email, and phone are required');
  }

  const checkerType = normalizeCheckerType(type);
  const reseller = await findResellerByStoreSlug(req.params.slug, {
    requireActiveStore: true,
  });
  if (!reseller) throw new AppError('Store not found', 404);

  const offer = await buildCheckerOffer(reseller, checkerType);
  if (!offer.inStock) {
    throw new AppError(`${checkerTypeLabel(checkerType)} checkers are out of stock`, 503);
  }

  const recipientPhone = phone.replace(/\D/g, '').slice(0, 10);
  if (!isValidGhanaPhone(recipientPhone)) {
    throw new AppError('Phone must be 10 digits starting with 0');
  }

  const reference = `CUS-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const checkout = await resolvePromoCheckout({
    promoCode,
    packageId: offer.packageId.toString(),
    sellingPrice: offer.price,
    paystackChargePercent: offer.paystackChargePercent,
  });

  const payment = await initializePayment(email.trim().toLowerCase(), Math.round(checkout.total * 100), {
    type: 'customer_purchase',
    resellerId: reseller._id.toString(),
    packageId: offer.packageId.toString(),
    recipientPhone,
    customerEmail: email.trim().toLowerCase(),
    sellingPrice: checkout.discountedSellingPrice,
    processingFee: checkout.processingFee,
    expectedTotal: checkout.total,
    reference,
    storeSlug: storeSlugFromRequest(req.params.slug),
    productKind: 'checker',
    ...checkout.promoMetadata,
  });

  res.json({
    success: true,
    data: {
      authorizationUrl: payment.authorization_url,
      reference: payment.reference,
    },
  });
}));

router.get('/checker-order/:orderId', asyncHandler(async (req, res) => {
  const { email } = req.query as { email?: string };
  if (!email?.trim()) throw new AppError('Email is required');

  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) throw new AppError('Order not found', 404);
  if (!isCheckerProduct(order.productType, order.bundleSize)) {
    throw new AppError('Not a checker order', 400);
  }
  if (order.customerEmail?.toLowerCase() !== email.trim().toLowerCase()) {
    throw new AppError('Email does not match this order', 403);
  }
  if (order.status !== 'delivered' || !order.checkerDetails) {
    throw new AppError('Checker is not ready yet. Check your email shortly.', 404);
  }

  res.json({
    success: true,
    data: {
      orderId: order.orderId,
      type: order.checkerDetails.type,
      bundleSize: order.bundleSize,
      serial: order.checkerDetails.serial,
      pin: order.checkerDetails.pin,
      status: order.status,
    },
  });
}));

// FAQs (public)
router.get('/:slug/faqs', asyncHandler(async (_req, res) => {
  const faqs = await Faq.find({ isActive: true }).sort({ sortOrder: 1 });
  res.json({ success: true, data: faqs });
}));

// Initialize customer purchase
router.post('/:slug/purchase/init', purchaseLimiter, blockStorePricing, asyncHandler(async (req, res) => {
  const { packageId, recipientPhone, email, fullName, ghanaCard, location, occupation, promoCode } =
    req.body;

  if (!packageId || !email) {
    throw new AppError('Package and email are required');
  }

  const reseller = await findResellerByStoreSlug(req.params.slug, {
    requireActiveStore: true,
  });
  if (!reseller) throw new AppError('Store not found', 404);

  const pkg = await Package.findById(packageId);
  if (!pkg || !pkg.isEnabled) throw new AppError('Package not available');

  const isAfa = isAfaProduct(pkg.productType, pkg.bundleSize);
  let afaDetails: ReturnType<typeof validateAfaDetails> | undefined;
  let phone = recipientPhone;

  if (isAfa) {
    await assertAfaInStock();
    afaDetails = validateAfaDetails({ fullName, phone: recipientPhone, ghanaCard, location, occupation });
    phone = afaDetails.phone;
  } else {
    if (!recipientPhone) throw new AppError('Recipient phone is required');
    phone = assertNetworkPhone(recipientPhone, pkg.network);
    await assertNetworkInStock(pkg.network);
  }

  const pkgIdStr = pkg._id.toString();
  const sellingPrice = getResellerSellPrice(reseller, pkgIdStr, pkg);

  const settings = await getSettings();
  const paystackChargePercent = settings.paystackChargePercent ?? 2;

  const checkout = await resolvePromoCheckout({
    promoCode,
    packageId: pkgIdStr,
    sellingPrice,
    paystackChargePercent,
  });

  const reference = `CUS-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const payment = await initializePayment(email, Math.round(checkout.total * 100), {
    type: 'customer_purchase',
    resellerId: reseller._id.toString(),
    packageId: pkg._id.toString(),
    recipientPhone: phone,
    customerEmail: email.toLowerCase().trim(),
    sellingPrice: checkout.discountedSellingPrice,
    processingFee: checkout.processingFee,
    expectedTotal: checkout.total,
    reference,
    storeSlug: storeSlugFromRequest(req.params.slug),
    ...checkout.promoMetadata,
    ...(afaDetails
      ? {
          afaDetails: {
            fullName: afaDetails.fullName,
            phone: afaDetails.phone,
            ghanaCard: afaDetails.ghanaCard,
            location: afaDetails.location,
            occupation: afaDetails.occupation,
          },
        }
      : {}),
  });

  res.json({
    success: true,
    data: {
      authorizationUrl: payment.authorization_url,
      reference: payment.reference,
    },
  });
}));

// Become a reseller (store setup after registration)
router.post('/become-reseller', asyncHandler(async (req, res) => {
  const { storeName, phone, whatsapp, supportEmail } = req.body;
  if (!storeName || !phone || !whatsapp || !supportEmail) {
    throw new AppError('All store fields are required');
  }

  res.json({
    success: true,
    message: 'Please complete registration at /register to create your reseller account',
    data: { storeName, phone, whatsapp, supportEmail },
  });
}));

// Order history (OTP protected)
router.post(
  '/:slug/history/request',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email?.trim()) throw new AppError('Email is required');

    const result = await requestOrderHistoryOtp(req.params.slug as string, email);
    res.json({
      success: true,
      message: `Verification code sent to ${result.maskedEmail}`,
      data: result,
    });
  })
);

router.post(
  '/:slug/history/verify',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    if (!email?.trim() || !code) throw new AppError('Email and verification code are required');

    const orders = await verifyOrderHistoryOtp(req.params.slug as string, email, String(code));
    res.json({ success: true, data: orders });
  })
);

router.post(
  '/:slug/history/request-phone',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { phone } = req.body;
    if (!phone?.trim()) throw new AppError('Phone number is required');

    const result = await requestOrderHistoryOtpByPhone(req.params.slug as string, phone);
    res.json({
      success: true,
      message: `Verification code sent to ${result.maskedEmail}`,
      data: result,
    });
  })
);

router.post(
  '/:slug/history/verify-phone',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body;
    if (!phone?.trim() || !code) throw new AppError('Phone and verification code are required');

    const result = await verifyOrderHistoryOtpByPhone(
      req.params.slug as string,
      phone,
      String(code)
    );
    res.json({ success: true, data: result });
  })
);

// Order status (public with reference)
router.get('/order/:orderId', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) throw new AppError('Order not found', 404);

  res.json({
    success: true,
    data: {
      orderId: order.orderId,
      network: order.network,
      bundleSize: order.bundleSize,
      recipientPhone: order.recipientPhone,
      status: order.status,
      createdAt: order.createdAt,
    },
  });
}));

export default router;
