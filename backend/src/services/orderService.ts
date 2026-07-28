import mongoose from 'mongoose';
import { Package, Network, ProductType } from '../models/Package';
import { Order, OrderSource, OrderStatus, IAfaDetails } from '../models/Order';
import { Setting } from '../models/Setting';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { generateOrderId, generateOrderNumber, isValidGhanaPhone, roundMoney } from '../utils/helpers';
import { toOrderCreationError } from '../utils/mongoErrors';
import { debitWallet, creditWallet } from './walletService';
import { applyOrderStatusUpdate, submitOrderToProvider } from './fulfillmentProviderService';
import { snapshotPlatformProfitForOrder } from './platformProfitService';
import { getAdminBasePrice, computeResellerOrderProfit } from './profitFormulas';
import { assertNetworkInStock } from './networkStockService';
import { assertAfaInStock } from './afaStockService';
import { isAfaProduct, AFA_CHECK_USSD, AFA_PROCESSING_HOURS } from '../config/afa';
import { isCheckerProduct, checkerTypeFromBundle } from '../config/checker';
import { resolveOrderApiCost } from '../config/datamaxPrices';
import { assertCheckerInStock } from './checkerStockService';
import { assignCheckerToOrder, deliverCheckerNotifications } from './checkerFulfillmentService';
import { isValidGhanaCard, normalizeGhanaCard } from '../utils/ghanaCard';
import { resolveFulfillmentProvider, resolveAfaFulfillmentProvider } from './settingsService';
import { getAgentPrice } from './agentPricingService';
import {
  computeMultiLevelProfitSplit,
  getEffectiveBasePrice,
  getEffectiveMaxPrice,
  getResellerSellPrice,
} from './subResellerPricingService';
import { env } from '../config/env';
import { withMongoTransaction, sessionOpts } from '../utils/mongoTransaction';
import { appendAuditLog } from './immutableAuditService';
import { normalizeGhanaPhone, assertNetworkPhone } from '../utils/phone';
import { redeemPromoCode } from './promoCodeService';
import { sendAfaRegistrationAdminEmail } from '../utils/email';

const getSettings = async () => {
  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({});
  }
  return settings;
};

export const getResellerPrice = async (
  resellerId: mongoose.Types.ObjectId | string,
  packageId: mongoose.Types.ObjectId | string,
  pkg: Pick<import('../models/Package').IPackage, 'resellerBasePrice'>
): Promise<number> => {
  const reseller = await User.findById(resellerId);
  if (!reseller?.resellerStore) {
    return pkg.resellerBasePrice;
  }
  return getResellerSellPrice(reseller, packageId.toString(), pkg);
};

export const validateResellerPrice = (
  price: number,
  basePrice: number,
  maxPrice: number
): void => {
  if (price < basePrice) {
    throw new AppError(`Price cannot be below base price of GHS ${basePrice}`);
  }
  if (price > maxPrice) {
    throw new AppError('Price exceeds allowed limit.');
  }
};

export interface CreateOrderInput {
  packageId: string;
  recipientPhone?: string;
  afaDetails?: Omit<IAfaDetails, 'phone'> & { phone: string };
  userId?: string;
  agentId?: string;
  resellerId?: string;
  customerEmail?: string;
  sellingPrice?: number;
  source: OrderSource;
  paystackReference?: string;
  processingFee?: number;
  skipWalletDebit?: boolean;
  walletReference?: string;
  promoCodeId?: string;
  promoDiscountGhs?: number;
  originalSellingPrice?: number;
  orderNumber?: string;
}

export function validateAfaDetails(details: CreateOrderInput['afaDetails']): IAfaDetails {
  if (!details) {
    throw new AppError('AFA registration details are required');
  }
  const fullName = String(details.fullName || '').trim();
  const location = String(details.location || '').trim();
  const phone = normalizeGhanaPhone(details.phone);
  const ghanaCard = normalizeGhanaCard(String(details.ghanaCard || ''));

  if (!fullName || fullName.length < 2) {
    throw new AppError('Full name is required');
  }
  if (!isValidGhanaPhone(phone)) {
    throw new AppError('Phone must be 10 digits starting with 0');
  }
  if (!isValidGhanaCard(ghanaCard)) {
    throw new AppError('Ghana Card must match format GHA-123456789-0');
  }
  if (!location) {
    throw new AppError('Location is required');
  }

  return {
    fullName,
    phone,
    ghanaCard,
    location,
    occupation: details.occupation?.trim() || 'Farmer',
  };
}

export const fulfillStorePurchase = async (
  reference: string,
  metadata: Record<string, unknown>,
  customerEmail?: string
) => {
  const existing = await Order.findOne({ paystackReference: reference });
  if (existing) return existing;

  const promoCodeId = metadata.promoCodeId ? String(metadata.promoCodeId) : undefined;

  const afaRaw = metadata.afaDetails as Record<string, string> | undefined;
  const afaDetails = afaRaw
    ? validateAfaDetails({
        fullName: String(afaRaw.fullName || ''),
        phone: String(afaRaw.phone || metadata.recipientPhone || ''),
        ghanaCard: String(afaRaw.ghanaCard || ''),
        location: String(afaRaw.location || ''),
        occupation: afaRaw.occupation,
      })
    : undefined;

  const preassignedOrderNumber = generateOrderNumber();
  const email = (metadata.customerEmail as string) || customerEmail;

  if (promoCodeId) {
    await redeemPromoCode({
      promoCodeId,
      paystackReference: reference,
      orderId: preassignedOrderNumber,
      email,
    });
  }

  const order = await createOrder({
    packageId: String(metadata.packageId),
    recipientPhone: afaDetails?.phone || String(metadata.recipientPhone),
    afaDetails,
    resellerId: String(metadata.resellerId),
    customerEmail: (metadata.customerEmail as string) || customerEmail,
    sellingPrice: Number(metadata.sellingPrice),
    processingFee: Number(metadata.processingFee),
    source: 'reseller_store',
    paystackReference: reference,
    promoCodeId,
    promoDiscountGhs: metadata.promoDiscountGhs ? Number(metadata.promoDiscountGhs) : undefined,
    originalSellingPrice: metadata.originalSellingPrice
      ? Number(metadata.originalSellingPrice)
      : undefined,
    orderNumber: preassignedOrderNumber,
  });

  return order;
};

export const createOrder = async (input: CreateOrderInput) => {
  const pkg = await Package.findById(input.packageId);
  if (!pkg || !pkg.isEnabled) {
    throw new AppError('Package not found or disabled');
  }

  const isAfa = isAfaProduct(pkg.productType, pkg.bundleSize);
  const isChecker = isCheckerProduct(pkg.productType, pkg.bundleSize);
  let recipientPhone: string;
  let afaDetails: IAfaDetails | undefined;

  if (isChecker) {
    const checkerType = checkerTypeFromBundle(pkg.bundleSize);
    if (!checkerType) {
      throw new AppError('Invalid checker package');
    }
    if (!input.customerEmail?.trim()) {
      throw new AppError('Email is required for checker purchase');
    }
    if (!input.recipientPhone) {
      throw new AppError('Phone number is required');
    }
    recipientPhone = normalizeGhanaPhone(input.recipientPhone);
    if (!isValidGhanaPhone(recipientPhone)) {
      throw new AppError('Phone must be 10 digits starting with 0');
    }
    await assertCheckerInStock(checkerType);
  } else if (isAfa) {
    await assertAfaInStock();
    afaDetails = validateAfaDetails(
      input.afaDetails ?? {
        fullName: '',
        phone: input.recipientPhone || '',
        ghanaCard: '',
        location: '',
      }
    );
    recipientPhone = afaDetails.phone;
  } else {
    if (!input.recipientPhone) {
      throw new AppError('Recipient phone is required');
    }
    recipientPhone = assertNetworkPhone(input.recipientPhone, pkg.network);
    await assertNetworkInStock(pkg.network);
  }

  const settings = await getSettings();
  const fulfillmentProvider = isChecker
    ? null
    : isAfa
      ? await resolveAfaFulfillmentProvider()
      : await resolveFulfillmentProvider(pkg.network);
  const apiCost = resolveOrderApiCost({
    network: pkg.network,
    bundleSize: pkg.bundleSize,
    costPrice: pkg.costPrice,
    fulfillmentProvider: fulfillmentProvider ?? null,
    isAfa,
  });
  let sellingPrice = input.sellingPrice ?? pkg.agentPrice;
  let profit = 0;
  let uplineProfits: import('../models/Order').IUplineProfit[] = [];

  const needsWalletDebit =
    (input.source === 'agent' || input.source === 'agent_api') &&
    !!input.agentId &&
    !input.skipWalletDebit;

  if (input.source === 'agent' || input.source === 'agent_api') {
    sellingPrice = input.agentId
      ? await getAgentPrice(input.agentId, pkg._id, pkg)
      : pkg.agentPrice;
  } else if (input.source === 'reseller_store') {
    const reseller = input.resellerId ? await User.findById(input.resellerId) : null;
    const basePrice = reseller
      ? getEffectiveBasePrice(reseller, pkg._id.toString(), pkg)
      : pkg.resellerBasePrice;
    const customPrice = input.resellerId
      ? await getResellerPrice(input.resellerId, pkg._id, pkg)
      : basePrice;

    sellingPrice = input.sellingPrice ?? customPrice;
    const effectiveMax = reseller
      ? getEffectiveMaxPrice(reseller, pkg._id.toString(), pkg)
      : pkg.maxSellingPrice;
    validateResellerPrice(sellingPrice, basePrice, effectiveMax);

    const split = input.resellerId
      ? await computeMultiLevelProfitSplit(
          sellingPrice,
          input.resellerId,
          pkg._id.toString(),
          pkg
        )
      : { leafProfit: computeResellerOrderProfit(sellingPrice, basePrice), uplineProfits: [] };
    profit = split.leafProfit;
    uplineProfits = split.uplineProfits;
  }

  const processingFee =
    input.processingFee ??
    roundMoney(sellingPrice * ((settings.paystackChargePercent ?? 2) / 100));
  const totalAmount = roundMoney(sellingPrice + processingFee);

  const adminBasePrice = getAdminBasePrice(input.source, {
    resellerBasePrice: pkg.resellerBasePrice,
    agentPrice: pkg.agentPrice,
  });

  const { paystackFee, platformProfit } = await snapshotPlatformProfitForOrder({
    source: input.source,
    basePrice: adminBasePrice,
    apiCost,
    totalAmount,
  });

  const orderNumber = input.orderNumber ?? generateOrderNumber();
  const orderStatus: OrderStatus =
    isChecker
      ? 'processing'
      : input.source === 'reseller_store' && input.paystackReference
        ? 'processing'
        : 'pending';

  const productType: ProductType = isChecker ? 'checker' : isAfa ? 'afa' : 'data';

  const orderPayload = {
    orderId: orderNumber,
    orderNumber,
    userId: input.userId,
    agentId: input.agentId,
    resellerId: input.resellerId,
    customerEmail: input.customerEmail,
    network: pkg.network,
    productType,
    bundleSize: pkg.bundleSize,
    packageId: pkg._id,
    recipientPhone,
    afaDetails,
    costPrice: apiCost,
    adminBasePrice,
    sellingPrice,
    profit,
    ...(uplineProfits.length > 0 ? { uplineProfits } : {}),
    platformProfit,
    paystackFee,
    processingFee,
    totalAmount,
    status: orderStatus,
    source: input.source,
    paystackReference: input.paystackReference,
    ...(input.promoCodeId
      ? {
          promoCodeId: new mongoose.Types.ObjectId(input.promoCodeId),
          promoDiscountGhs: input.promoDiscountGhs,
          originalSellingPrice: input.originalSellingPrice,
        }
      : {}),
    fulfillmentProvider: fulfillmentProvider ?? undefined,
    complaintDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  let order: InstanceType<typeof Order>;
  try {
    if (needsWalletDebit) {
      const orderRef = input.walletReference ?? generateOrderId();
      order = await withMongoTransaction(async (session) => {
        await debitWallet(
          input.agentId!,
          sellingPrice,
          'purchase',
          isAfa
            ? `AFA registration: ${afaDetails!.fullName} (${recipientPhone})`
            : isChecker
              ? `${pkg.bundleSize} checker to ${recipientPhone}`
              : `Data purchase: ${pkg.network} ${pkg.bundleSize} to ${recipientPhone}`,
          orderRef,
          { packageId: pkg._id.toString() },
          session
        );

        const created = await Order.create([orderPayload], sessionOpts(session));
        const doc = created[0];
        await appendAuditLog({
          userId: input.agentId,
          action: 'purchase',
          entity: 'order',
          entityId: doc.orderId,
          details: { amount: sellingPrice, source: input.source },
        });
        return doc;
      });
    } else {
      order = await Order.create(orderPayload);
      if (input.agentId || input.resellerId) {
        await appendAuditLog({
          userId: input.agentId || input.resellerId,
          action: 'purchase',
          entity: 'order',
          entityId: order.orderId,
          details: { amount: sellingPrice, source: input.source },
        });
      }
    }
  } catch (err) {
    throw toOrderCreationError(err);
  }

  if (isChecker) {
    try {
      const checker = await assignCheckerToOrder(order);
      await deliverCheckerNotifications(order, checker);
    } catch (err) {
      console.error('Checker fulfillment failed:', err);
      if (needsWalletDebit && input.agentId) {
        try {
          await creditWallet(
            input.agentId,
            sellingPrice,
            'refund',
            `Refund for failed checker order ${order.orderId}`,
            `${order.orderId}-checker-refund`
          );
          await applyOrderStatusUpdate(order, {
            status: 'refunded',
            providerStatus: 'refunded',
            stepLabel: 'Checker Refunded',
            stepMessage:
              err instanceof AppError
                ? `${err.message} Wallet refunded.`
                : 'Could not assign checker — wallet refunded.',
          });
        } catch (refundErr) {
          console.error('Checker refund failed:', refundErr);
          await applyOrderStatusUpdate(order, {
            status: 'failed',
            providerStatus: 'failed',
            stepLabel: 'Checker Unavailable',
            stepMessage: err instanceof AppError ? err.message : 'Could not assign checker',
          });
        }
      } else {
        await applyOrderStatusUpdate(order, {
          status: 'failed',
          providerStatus: 'failed',
          stepLabel: 'Checker Unavailable',
          stepMessage: err instanceof AppError ? err.message : 'Could not assign checker',
        });
      }
      throw err;
    }
  } else if (env.fulfillment.enabled || env.datamax.enabled) {
    await submitOrderToProvider(order);
  } else if (env.devAutoDeliver) {
  // Simulate order processing (local dev only)
    setTimeout(async () => {
      try {
        const updated = await Order.findById(order._id);
        if (updated && updated.status === 'processing') {
          await applyOrderStatusUpdate(updated, {
            status: 'delivered',
            providerStatus: 'delivered',
            stepLabel: 'Bundle Dispatched',
            stepMessage: 'Simulated delivery (dev)',
          });
        }
      } catch (err) {
        console.error('Order processing error:', err);
      }
    }, 5000);
  }

  if (isAfa && order.afaDetails) {
    void sendAfaRegistrationAdminEmail({
      orderId: order.orderId,
      fullName: order.afaDetails.fullName,
      phone: order.afaDetails.phone,
      ghanaCard: order.afaDetails.ghanaCard,
      location: order.afaDetails.location,
      occupation: order.afaDetails.occupation,
      customerEmail: order.customerEmail,
      source: order.source,
    }).catch((err) => {
      console.error(
        '[AFA admin notification email failed]',
        order.orderId,
        err instanceof Error ? err.message : err
      );
    });
  }

  return order;
};

export interface BulkOrderLine {
  phone: string;
  bundleSize: string;
}

export const validateBulkOrders = async (
  lines: BulkOrderLine[],
  network: string,
  agentId: string
) => {
  await assertNetworkInStock(network);

  const seenPhones = new Set<string>();
  const validated: Array<{
    phone: string;
    bundleSize: string;
    packageId: string;
    price: number;
    network: string;
  }> = [];
  let totalCost = 0;

  for (const line of lines) {
    let phone: string;
    try {
      phone = assertNetworkPhone(line.phone, network);
    } catch {
      throw new AppError(
        `Invalid ${network} number: ${line.phone}. Use a number that starts with the correct ${network} prefix.`
      );
    }
    if (seenPhones.has(phone)) {
      throw new AppError(`Duplicate phone number: ${phone}`);
    }
    seenPhones.add(phone);

    const bundle = line.bundleSize.toUpperCase().endsWith('GB')
      ? line.bundleSize.toUpperCase()
      : `${line.bundleSize}GB`;

    const pkg = await Package.findOne({
      network: network as Network,
      bundleSize: bundle,
      productType: 'data',
      isEnabled: true,
    });
    if (!pkg) {
      throw new AppError(`Bundle ${bundle} not found for ${network}`);
    }

    validated.push({
      phone,
      bundleSize: bundle,
      packageId: pkg._id.toString(),
      price: pkg.agentPrice,
      network: pkg.network,
    });
    totalCost += pkg.agentPrice;
  }

  const wallet = await import('./walletService').then((m) => m.getOrCreateWallet(agentId));
  if (wallet.balance < totalCost) {
    throw new AppError('Insufficient wallet balance for bulk purchase');
  }

  return { validated, totalCost };
};

export const processBulkOrders = async (
  validated: Array<{ phone: string; packageId: string; price?: number }>,
  agentId: string,
  source: OrderSource = 'agent'
) => {
  const priced: Array<{ phone: string; packageId: string; price: number }> = [];
  for (const item of validated) {
    const pkg = await Package.findById(item.packageId);
    if (!pkg || !pkg.isEnabled) {
      throw new AppError(`Package not found or disabled for ${item.phone}`);
    }
    priced.push({ phone: item.phone, packageId: item.packageId, price: pkg.agentPrice });
  }

  const totalCost = roundMoney(priced.reduce((sum, item) => sum + item.price, 0));
  const bulkRef = `BULK-${generateOrderId()}`;

  if (totalCost > 0) {
    await debitWallet(
      agentId,
      totalCost,
      'purchase',
      `Bulk purchase (${priced.length} orders)`,
      bulkRef
    );
  }

  const orders = [];
  for (const item of priced) {
    const order = await createOrder({
      packageId: item.packageId,
      recipientPhone: item.phone,
      agentId,
      source,
      skipWalletDebit: true,
      walletReference: bulkRef,
    });
    orders.push(order);
  }
  return orders;
};
