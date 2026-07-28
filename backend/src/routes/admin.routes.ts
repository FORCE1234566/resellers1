import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { User } from '../models/User';
import { Package } from '../models/Package';
import { Order, OrderStatus } from '../models/Order';
import { Withdrawal } from '../models/Withdrawal';
import { Complaint } from '../models/Complaint';
import { CustomerComplaint } from '../models/CustomerComplaint';
import { Faq } from '../models/Faq';
import { Wallet } from '../models/Wallet';
import { WalletTransaction } from '../models/WalletTransaction';
import { AuditLog } from '../models/AuditLog';
import { Setting } from '../models/Setting';
import { getDatamaxMtnExpressCost } from '../config/datamaxPrices';
import { getDateRanges } from '../utils/helpers';
import { parseBundleSizeMb, sortPackagesByBundleSize } from '../utils/bundleSize';
import { createAgentWithWallet, ensureNetworkPackages } from '../services/seedService';
import { createResellerAccount } from '../services/resellerAccountService';
import {
  getSettings,
  depositWithdrawalPool,
  validatePackagePrices,
} from '../services/settingsService';
import { createNotification } from '../services/notificationService';
import {
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalPaid,
  processWithdrawal,
  parseWithdrawalAmount,
} from '../services/withdrawalService';
import { requireAdminOtp } from '../middleware/requireAdminPassword';
import { otpLimiter } from '../middleware/rateLimiter';
import { createAndSendAdminActionOtp } from '../services/adminActionOtpService';
import { upload, uploadSpreadsheet } from '../middleware/upload';
import { validatePasswordStrength } from '../utils/password';
import { env } from '../config/env';
import { initPoolDepositPayment } from '../services/paystackPaymentService';
import { processPaystackSuccess } from '../services/paymentFulfillmentService';
import { verifyPayment } from '../utils/paystack';
import { applyPaystackTransferToWithdrawal } from '../services/paystackPayoutService';
import {
  disablePromoBatch,
  disablePromoCode,
  generatePromoCodes,
  listPromoBatches,
  listPromoCodes,
} from '../services/promoCodeService';
import {
  applyOrderStatusUpdate,
  getOrderTracking,
  retryQueuedFulfillmentOrders,
  syncFulfillmentStatuses,
} from '../services/fulfillmentProviderService';
import {
  SUBMITTED_FOR_VERIFICATION,
  applyManualVerificationToOrder,
} from '../services/beneficiaryVerificationService';
import { isSmartDataHubConfigured, testSmartDataHubConnection } from '../services/smartDataHubClient';
import { isDatamaxConfigured, testDatamaxConnection, checkDatamaxBalance } from '../services/datamaxClient';
import { migrateFulfillmentSettings, normalizeNetworkRoute, normalizeAfaRoute } from '../services/settingsService';
import {
  setAgentCustomPrice,
  clearAgentCustomPrices,
} from '../services/agentPricingService';
import {
  approveAgentApiAccess,
  rejectAgentApiAccess,
  serializeAgentApiStatus,
} from '../services/agentApiApprovalService';
import { adminSearch, buildOrderSearchFilter } from '../services/adminSearchService';
import { creditWallet } from '../services/walletService';
import { getResellerPoolSummary, resellerProfitRange } from '../services/resellerProfitService';
import { getAdminDashboardStats } from '../services/adminDashboardService';
import { getNetworkStockList, setNetworkStock } from '../services/networkStockService';
import { getAfaStock, setAfaStock } from '../services/afaStockService';
import { CheckerType, checkerTypeLabel, normalizeCheckerType } from '../config/checker';
import { getCheckerSummary, setCheckerStock } from '../services/checkerStockService';
import { importCheckerInventory, maskSerial } from '../services/checkerInventoryService';
import { ResultChecker } from '../models/ResultChecker';
import fs from 'fs';
import { resetPlatformForProduction } from '../services/productionResetService';
import { Network } from '../models/Package';

const router = Router();
router.use(authenticate, authorize('admin'));

const logAudit = async (req: AuthRequest, action: string, entity: string, entityId?: string, details?: Record<string, unknown>) => {
  await AuditLog.create({
    userId: req.user?._id,
    action,
    entity,
    entityId,
    details,
    ip: req.ip,
  });
};

router.post(
  '/action-otp/request',
  otpLimiter,
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await createAndSendAdminActionOtp(req.user!._id, req.user!.email, {
      waitForEmail: true,
    });
    res.json({
      success: true,
      message: 'Verification code sent to your admin email',
      data: result,
    });
  })
);

// Dashboard stats
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const data = await getAdminDashboardStats(forceRefresh);
    res.json({ success: true, data });
  })
);

// Dealer management
router.get('/agents', asyncHandler(async (_req, res) => {
  const dealers = await User.find({ role: 'agent' }).select('-password').sort({ createdAt: -1 });
  const wallets = await Wallet.find({ userId: { $in: dealers.map((d) => d._id) } });
  const balanceByUser = new Map(wallets.map((w) => [w.userId.toString(), w.balance]));
  const data = dealers.map((d) => ({
    ...d.toObject(),
    walletBalance: balanceByUser.get(d._id.toString()) ?? 0,
    apiAccess: serializeAgentApiStatus(d),
  }));
  res.json({ success: true, data });
}));

router.post('/agents', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const { fullName, email, phone, password, status } = req.body;
  if (!fullName || !email || !phone || !password) throw new AppError('All fields required');
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new AppError(passwordError);

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new AppError('Email already exists');

  const dealer = await createAgentWithWallet({ fullName, email, phone, password });
  if (status) dealer.status = status;
  await dealer.save();

  await logAudit(req, 'agent_create', 'agent', dealer._id.toString());
  res.status(201).json({ success: true, data: dealer });
}));

router.put('/agents/:id', asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!dealer) throw new AppError('Agent not found');

  const { fullName, email, phone, status } = req.body;
  if (fullName) dealer.fullName = fullName;
  if (email) dealer.email = email.toLowerCase();
  if (phone) dealer.phone = phone;
  if (status) dealer.status = status;
  await dealer.save();

  await logAudit(req, 'update', 'agent', dealer._id.toString());
  res.json({ success: true, data: dealer });
}));

router.patch('/agents/:id/email-otp', asyncHandler(async (req: AuthRequest, res) => {
  const { emailOtpEnabled } = req.body;
  if (typeof emailOtpEnabled !== 'boolean') {
    throw new AppError('emailOtpEnabled must be true or false');
  }

  const agent = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!agent) throw new AppError('Agent not found');

  agent.emailOtpEnabled = emailOtpEnabled;
  await agent.save();
  await logAudit(req, 'update', 'agent_email_otp', agent._id.toString(), { emailOtpEnabled });

  res.json({
    success: true,
    message: emailOtpEnabled ? 'Email OTP enabled for agent' : 'Email OTP disabled for agent',
    data: { id: agent._id, emailOtpEnabled: agent.emailOtpEnabled },
  });
}));

router.delete('/agents/:id', asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!dealer) throw new AppError('Agent not found');

  const wallet = await Wallet.findOne({ userId: dealer._id });
  if (wallet && wallet.balance > 0) {
    throw new AppError(
      `Cannot delete agent with wallet balance (GHS ${wallet.balance}). Withdraw or adjust first.`
    );
  }

  await Wallet.deleteOne({ userId: dealer._id });
  await User.deleteOne({ _id: dealer._id, role: 'agent' });
  await logAudit(req, 'delete', 'agent', dealer._id.toString(), {
    email: dealer.email,
    fullName: dealer.fullName,
  });
  res.json({ success: true, message: 'Agent deleted' });
}));

router.post('/agents/:id/reward', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!dealer) throw new AppError('Agent not found');

  const amount = parseWithdrawalAmount(req.body.amount);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const description = note || 'Performance reward from admin';
  const reference = `admin-reward-dealer-${Date.now()}`;

  const wallet = await creditWallet(dealer._id, amount, 'adjustment', description, reference, {
    rewardedBy: req.user?._id,
    role: 'agent',
  });

  await createNotification(
    dealer._id,
    'wallet_funded',
    'Performance Reward',
    `You received GHS ${amount} as a performance reward.${note ? ` Note: ${note}` : ''}`
  );
  await logAudit(req, 'reward', 'agent', dealer._id.toString(), { amount, note });

  res.json({
    success: true,
    message: `Reward of GHS ${amount} credited to agent wallet`,
    data: { balance: wallet.balance },
  });
}));

router.post('/agents/:id/wallet/top-up', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!dealer) throw new AppError('Agent not found');

  const amount = parseWithdrawalAmount(req.body.amount);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const description = note || 'Admin wallet top-up';
  const reference = `admin-topup-agent-${Date.now()}`;

  const wallet = await creditWallet(dealer._id, amount, 'deposit', description, reference, {
    toppedUpBy: req.user?._id,
    role: 'agent',
    source: 'admin_manual',
  });

  await createNotification(
    dealer._id,
    'wallet_funded',
    'Wallet topped up',
    `GHS ${amount} was added to your wallet by admin.${note ? ` Note: ${note}` : ''}`
  );
  await logAudit(req, 'wallet_top_up', 'agent', dealer._id.toString(), { amount, note });

  res.json({
    success: true,
    message: `GHS ${amount} added to agent wallet`,
    data: { balance: wallet.balance },
  });
}));

router.post('/agents/:id/wallet/reconcile-paystack', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!dealer) throw new AppError('Agent not found');

  const reference = String(req.body.reference || '').trim();
  if (!reference) throw new AppError('Paystack reference is required');

  const payment = await verifyPayment(reference);
  if (payment.status !== 'success') {
    throw new AppError('Paystack payment is not successful');
  }

  const metadata = (payment.metadata || {}) as Record<string, unknown>;
  if (metadata.type !== 'wallet_deposit') {
    throw new AppError('This Paystack payment is not an agent wallet deposit');
  }
  const paidForUserId = String(metadata.userId ?? '').trim();
  const agentUserId = dealer._id.toString();
  if (!paidForUserId || paidForUserId !== agentUserId) {
    throw new AppError(
      paidForUserId
        ? 'This payment belongs to a different agent account'
        : 'Paystack payment is missing agent metadata — contact support with the reference'
    );
  }

  const fulfillment = await processPaystackSuccess(
    reference,
    metadata,
    payment.customer?.email,
    payment.amount / 100
  );

  const wallet = await Wallet.findOne({ userId: dealer._id });
  await logAudit(req, 'wallet_reconcile', 'agent', dealer._id.toString(), { reference, fulfillment });

  res.json({
    success: true,
    message: fulfillment.type === 'wallet_deposit' && fulfillment.alreadyProcessed
      ? 'Payment was already credited to this wallet'
      : 'Wallet credited from Paystack payment',
    data: { balance: wallet?.balance ?? 0, fulfillment },
  });
}));

router.post('/agents/:id/reset-password', asyncHandler(async (req: AuthRequest, res) => {
  const { password } = req.body;
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new AppError(passwordError);

  const dealer = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!dealer) throw new AppError('Agent not found');

  dealer.password = await bcrypt.hash(password, 12);
  await dealer.save();
  await logAudit(req, 'reset_password', 'agent', dealer._id.toString());
  res.json({ success: true, message: 'Password reset successful' });
}));

router.get('/agents/:id/activity', asyncHandler(async (req, res) => {
  const [orders, transactions] = await Promise.all([
    Order.find({ agentId: req.params.id }).sort({ createdAt: -1 }).limit(50),
    WalletTransaction.find({ userId: req.params.id }).sort({ createdAt: -1 }).limit(50),
  ]);
  res.json({ success: true, data: { orders, transactions } });
}));

router.get('/agents/:id/prices', asyncHandler(async (req, res) => {
  const agent = await User.findOne({ _id: req.params.id, role: 'agent' });
  if (!agent) throw new AppError('Agent not found', 404);

  const packages = sortPackagesByBundleSize(await Package.find({ isEnabled: true }));
  const data = packages.map((pkg) => {
    const customPrice = agent.agentApi?.customPrices?.get(pkg._id.toString()) ?? null;
    return {
      _id: pkg._id,
      network: pkg.network,
      bundleSize: pkg.bundleSize,
      costPrice: pkg.costPrice,
      globalAgentPrice: pkg.agentPrice,
      customPrice,
      effectivePrice: customPrice ?? pkg.agentPrice,
      maxSellingPrice: pkg.maxSellingPrice,
    };
  });

  res.json({ success: true, data });
}));

router.put('/agents/:id/prices/:packageId', asyncHandler(async (req: AuthRequest, res) => {
  const agentId = String(req.params.id);
  const packageId = String(req.params.packageId);
  const { price } = req.body;
  if (price === null || price === undefined || price === '') {
    await setAgentCustomPrice(agentId, packageId, null);
  } else {
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      throw new AppError('Price must be a positive number');
    }
    await setAgentCustomPrice(agentId, packageId, numericPrice);
  }

  await logAudit(req, 'update', 'agent_custom_price', agentId, {
    packageId,
    price: price ?? null,
  });

  res.json({ success: true, message: 'Agent price updated' });
}));

router.delete('/agents/:id/prices', asyncHandler(async (req: AuthRequest, res) => {
  const agentId = String(req.params.id);
  const cleared = await clearAgentCustomPrices(agentId);
  await logAudit(req, 'delete', 'agent_custom_prices', agentId, { cleared });
  res.json({ success: true, data: { cleared } });
}));

router.get('/agents/api-requests', asyncHandler(async (_req, res) => {
  const agents = await User.find({
    role: 'agent',
    'agentApi.approvalStatus': 'pending',
  })
    .select('-password')
    .sort({ 'agentApi.requestedAt': 1 });

  res.json({
    success: true,
    data: agents.map((agent) => ({
      _id: agent._id,
      fullName: agent.fullName,
      email: agent.email,
      phone: agent.phone,
      apiAccess: serializeAgentApiStatus(agent),
    })),
  });
}));

router.post('/agents/:id/api/approve', asyncHandler(async (req: AuthRequest, res) => {
  const agentId = String(req.params.id);
  const credentials = await approveAgentApiAccess(agentId);
  await logAudit(req, 'approve', 'agent_api', agentId);
  res.json({
    success: true,
    message: 'Agent API access approved. The agent can view credentials on their Developer API page.',
    data: { apiKey: credentials.apiKey },
  });
}));

router.post('/agents/:id/api/reject', asyncHandler(async (req: AuthRequest, res) => {
  const agentId = String(req.params.id);
  const { reason } = req.body;
  await rejectAgentApiAccess(agentId, reason);
  await logAudit(req, 'reject', 'agent_api', agentId, { reason });
  res.json({ success: true, message: 'Agent API request declined' });
}));

// Package management
router.get('/network-stock', asyncHandler(async (_req, res) => {
  const data = await getNetworkStockList();
  res.json({ success: true, data });
}));

router.patch('/network-stock/:network', asyncHandler(async (req: AuthRequest, res) => {
  const network = String(req.params.network) as Network;
  const { inStock } = req.body as { inStock?: boolean };
  if (typeof inStock !== 'boolean') {
    throw new AppError('inStock must be true or false');
  }
  const data = await setNetworkStock(network, inStock);
  await logAudit(req, 'update', 'network_stock', network, { inStock });
  res.json({
    success: true,
    data,
    message: inStock ? `${network} is now in stock` : `${network} marked out of stock`,
  });
}));

router.get('/afa-stock', asyncHandler(async (_req, res) => {
  const data = await getAfaStock();
  res.json({ success: true, data });
}));

router.patch('/afa-stock', asyncHandler(async (req: AuthRequest, res) => {
  const { inStock } = req.body as { inStock?: boolean };
  if (typeof inStock !== 'boolean') {
    throw new AppError('inStock must be true or false');
  }
  const data = await setAfaStock(inStock);
  await logAudit(req, 'update', 'afa_stock', 'MTN AFA', { inStock });
  res.json({
    success: true,
    data,
    message: inStock ? 'AFA registration is now in stock' : 'AFA registration marked out of stock',
  });
}));

router.get('/checkers/summary', asyncHandler(async (_req, res) => {
  const data = await getCheckerSummary();
  res.json({ success: true, data });
}));

/** Single payload for admin Results Checkers page (summary + inventory list). */
router.get('/checkers/overview', asyncHandler(async (req, res) => {
  const type = req.query.type ? normalizeCheckerType(String(req.query.type)) : undefined;
  const status = req.query.status === 'assigned' || req.query.status === 'available'
    ? req.query.status
    : undefined;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  if (status) filter.status = status;

  const [summary, items, total] = await Promise.all([
    getCheckerSummary(),
    ResultChecker.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('type serial pin status orderId assignedAt uploadBatchId createdAt'),
    ResultChecker.countDocuments(filter),
  ]);

  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      summary,
      items: items.map((item) => ({
        ...item.toObject(),
        serial: item.status === 'assigned' ? item.serial : maskSerial(item.serial),
        pin: item.status === 'assigned' ? '****' : undefined,
      })),
      meta: { page, limit, total },
    },
  });
}));

router.patch('/checkers/stock/:type', asyncHandler(async (req: AuthRequest, res) => {
  const type = normalizeCheckerType(req.params.type as string);
  const { inStock } = req.body as { inStock?: boolean };
  if (typeof inStock !== 'boolean') {
    throw new AppError('inStock must be true or false');
  }
  const data = await setCheckerStock(type, inStock);
  await logAudit(req, 'update', 'checker_stock', checkerTypeLabel(type), { inStock });
  res.json({
    success: true,
    data,
    message: inStock
      ? `${checkerTypeLabel(type)} checkers are now in stock`
      : `${checkerTypeLabel(type)} checkers marked out of stock`,
  });
}));

router.post(
  '/checkers/upload',
  uploadSpreadsheet.single('file'),
  asyncHandler(async (req: AuthRequest, res) => {
    let typeRaw = req.body?.type;
    if (Array.isArray(typeRaw)) typeRaw = typeRaw[0];
    let type: CheckerType;
    try {
      type = normalizeCheckerType(String(typeRaw || ''));
    } catch {
      throw new AppError('Checker type must be bece or wassce');
    }
    if (!req.file) throw new AppError('Excel file is required');

    const buffer = req.file.buffer ?? fs.readFileSync(req.file.path);
    const result = await importCheckerInventory(type, buffer, req.file.originalname);
    if (result.imported > 0) {
      await setCheckerStock(type, true);
    }
    await logAudit(req, 'upload', 'checker_inventory', checkerTypeLabel(type), result);
    if (req.file.path) {
      fs.unlink(req.file.path, () => undefined);
    }
    res.json({
      success: true,
      data: result,
      message: `Imported ${result.imported} ${checkerTypeLabel(type)} checker(s)`,
    });
  })
);

router.get('/checkers', asyncHandler(async (req, res) => {
  const type = req.query.type ? normalizeCheckerType(String(req.query.type)) : undefined;
  const status = req.query.status === 'assigned' || req.query.status === 'available'
    ? req.query.status
    : undefined;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    ResultChecker.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('type serial pin status orderId assignedAt uploadBatchId createdAt'),
    ResultChecker.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map((item) => ({
      ...item.toObject(),
      serial: item.status === 'assigned' ? item.serial : maskSerial(item.serial),
      pin: item.status === 'assigned' ? '****' : undefined,
    })),
    meta: { page, limit, total },
  });
}));

router.get('/packages', asyncHandler(async (_req, res) => {
  const packages = sortPackagesByBundleSize(await Package.find());
  const data = packages.map((pkg) => ({
    ...pkg.toObject(),
    ...resellerProfitRange(pkg.resellerBasePrice, pkg.maxSellingPrice),
    ...(pkg.network === 'MTN'
      ? { datamaxCostPrice: getDatamaxMtnExpressCost(pkg.bundleSize) }
      : {}),
  }));
  res.json({ success: true, data });
}));

router.post('/packages/seed', asyncHandler(async (req: AuthRequest, res) => {
  await ensureNetworkPackages();
  const packages = sortPackagesByBundleSize(await Package.find());
  await logAudit(req, 'seed', 'package');
  res.json({ success: true, data: packages, message: 'Packages loaded' });
}));

router.post('/packages', asyncHandler(async (req: AuthRequest, res) => {
  const network = String(req.body.network || '').trim() as Network;
  const bundleRaw = String(req.body.bundleSize || '').trim();
  const bundleSize = bundleRaw.replace(/^(\d+(?:\.\d+)?)\s*(gb|mb)$/i, (_, n, u) => `${n}${u.toUpperCase()}`);

  if (!['MTN', 'Telecel', 'AirtelTigo'].includes(network)) {
    throw new AppError('Network must be MTN, Telecel, or AirtelTigo');
  }
  if (!bundleSize) throw new AppError('Bundle size is required (e.g. 1GB)');

  const costPrice = Number(req.body.costPrice);
  const agentPrice = Number(req.body.agentPrice ?? req.body.AgentPrice);
  const resellerBasePrice = Number(req.body.resellerBasePrice);
  const maxSellingPrice = Number(req.body.maxSellingPrice);

  validatePackagePrices({ costPrice, agentPrice, resellerBasePrice, maxSellingPrice });

  const duplicate = await Package.findOne({ network, bundleSize });
  if (duplicate) {
    throw new AppError(`${network} ${bundleSize} already exists`);
  }

  const latest = await Package.findOne().sort({ sortOrder: -1 }).select('sortOrder');
  const sortOrder = parseBundleSizeMb(bundleSize) || (latest?.sortOrder ?? -1) + 1;

  const pkg = await Package.create({
    network,
    bundleSize,
    costPrice,
    agentPrice,
    resellerBasePrice,
    maxSellingPrice,
    isEnabled: req.body.isEnabled !== false,
    sortOrder,
  });

  await logAudit(req, 'create', 'package', pkg._id.toString(), { network, bundleSize });
  res.status(201).json({ success: true, data: pkg, message: `${network} ${bundleSize} added` });
}));

router.put('/packages/:id', asyncHandler(async (req: AuthRequest, res) => {
  const { costPrice, agentPrice, resellerBasePrice, maxSellingPrice, ...rest } = req.body;
  const priceUpdate: Record<string, number> = {};
  if (costPrice !== undefined) priceUpdate.costPrice = Number(costPrice);
  if (agentPrice !== undefined) priceUpdate.agentPrice = Number(agentPrice);
  if (resellerBasePrice !== undefined) priceUpdate.resellerBasePrice = Number(resellerBasePrice);
  if (maxSellingPrice !== undefined) priceUpdate.maxSellingPrice = Number(maxSellingPrice);

  const existing = await Package.findById(req.params.id);
  if (!existing) throw new AppError('Package not found');

  validatePackagePrices({
    costPrice: priceUpdate.costPrice ?? existing.costPrice,
    agentPrice: priceUpdate.agentPrice ?? existing.agentPrice,
    resellerBasePrice: priceUpdate.resellerBasePrice ?? existing.resellerBasePrice,
    maxSellingPrice: priceUpdate.maxSellingPrice ?? existing.maxSellingPrice,
  });

  const pkg = await Package.findByIdAndUpdate(
    req.params.id,
    { ...rest, ...priceUpdate },
    { new: true }
  );
  if (!pkg) throw new AppError('Package not found');
  await logAudit(req, 'update', 'package', pkg._id.toString(), priceUpdate);
  res.json({ success: true, data: pkg });
}));

router.patch('/packages/:id/prices', asyncHandler(async (req: AuthRequest, res) => {
  const { resellerBasePrice, maxSellingPrice, costPrice } = req.body;
  const agentPrice = req.body.agentPrice ?? req.body.AgentPrice;
  const existing = await Package.findById(req.params.id);
  if (!existing) throw new AppError('Package not found');

  const updates: Record<string, number> = {};
  if (costPrice !== undefined) updates.costPrice = Number(costPrice);
  if (agentPrice !== undefined) updates.agentPrice = Number(agentPrice);
  if (resellerBasePrice !== undefined) updates.resellerBasePrice = Number(resellerBasePrice);
  if (maxSellingPrice !== undefined) updates.maxSellingPrice = Number(maxSellingPrice);

  validatePackagePrices({
    costPrice: updates.costPrice ?? existing.costPrice,
    agentPrice: updates.agentPrice ?? existing.agentPrice,
    resellerBasePrice: updates.resellerBasePrice ?? existing.resellerBasePrice,
    maxSellingPrice: updates.maxSellingPrice ?? existing.maxSellingPrice,
  });

  Object.assign(existing, updates);
  await existing.save();
  await logAudit(req, 'update_prices', 'package', existing._id.toString(), updates);
  res.json({ success: true, data: existing, message: 'Prices updated for all agents and resellers' });
}));

router.delete('/packages/:id', asyncHandler(async (req: AuthRequest, res) => {
  await Package.findByIdAndDelete(req.params.id);
  await logAudit(req, 'delete', 'package', req.params.id as string);
  res.json({ success: true, message: 'Package deleted' });
}));

router.patch('/packages/:id/toggle', asyncHandler(async (req: AuthRequest, res) => {
  const pkg = await Package.findById(req.params.id);
  if (!pkg) throw new AppError('Package not found');
  pkg.isEnabled = !pkg.isEnabled;
  await pkg.save();
  res.json({ success: true, data: pkg });
}));

// Resellers
router.get('/resellers', asyncHandler(async (_req, res) => {
  const resellers = await User.find({ role: 'reseller' }).select('-password').sort({ createdAt: -1 });
  const wallets = await Wallet.find({ userId: { $in: resellers.map((r) => r._id) } });
  const walletMap = new Map(wallets.map((w) => [w.userId.toString(), w]));

  const data = resellers.map((r) => {
    const wallet = walletMap.get(r._id.toString());
    return {
      ...r.toObject(),
      profitBalance: wallet?.profitBalance ?? 0,
      totalWithdrawals: wallet?.totalWithdrawals ?? 0,
    };
  });

  res.json({ success: true, data });
}));

router.post('/resellers', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const { fullName, email, phone, password } = req.body;
  if (!fullName || !email || !phone || !password) throw new AppError('All fields required');

  const user = await createResellerAccount({
    fullName,
    email,
    phone,
    password,
    activateImmediately: true,
  });

  await logAudit(req, 'reseller_create', 'reseller', user._id.toString());
  res.status(201).json({
    success: true,
    data: user,
    message: 'Reseller account created',
  });
}));

router.patch('/resellers/:id/toggle', asyncHandler(async (req: AuthRequest, res) => {
  const reseller = await User.findOne({ _id: req.params.id, role: 'reseller' });
  if (!reseller?.resellerStore) throw new AppError('Reseller not found');
  reseller.resellerStore.isActive = !reseller.resellerStore.isActive;
  await reseller.save();
  res.json({ success: true, data: reseller });
}));

router.patch('/resellers/:id/complaint-access', asyncHandler(async (req: AuthRequest, res) => {
  const { complaintEnabled } = req.body;
  if (typeof complaintEnabled !== 'boolean') {
    throw new AppError('complaintEnabled must be true or false');
  }

  const reseller = await User.findOne({ _id: req.params.id, role: 'reseller' });
  if (!reseller) throw new AppError('Reseller not found');

  reseller.complaintEnabled = complaintEnabled;
  await reseller.save();

  const settings = await getSettings();
  if (!settings.complaintSettings.userOverrides) {
    settings.complaintSettings.userOverrides = new Map();
  }
  settings.complaintSettings.userOverrides.set(reseller._id.toString(), complaintEnabled);
  settings.markModified('complaintSettings.userOverrides');
  await settings.save();

  res.json({
    success: true,
    message: complaintEnabled ? 'Complaints enabled for reseller' : 'Complaints disabled for reseller',
    data: { id: reseller._id, complaintEnabled: reseller.complaintEnabled },
  });
}));

router.patch('/resellers/:id/email-otp', asyncHandler(async (req: AuthRequest, res) => {
  const { emailOtpEnabled } = req.body;
  if (typeof emailOtpEnabled !== 'boolean') {
    throw new AppError('emailOtpEnabled must be true or false');
  }

  const reseller = await User.findOne({ _id: req.params.id, role: 'reseller' });
  if (!reseller) throw new AppError('Reseller not found');

  reseller.emailOtpEnabled = emailOtpEnabled;
  await reseller.save();
  await logAudit(req, 'update', 'reseller_email_otp', reseller._id.toString(), { emailOtpEnabled });

  res.json({
    success: true,
    message: emailOtpEnabled ? 'Email OTP enabled for reseller' : 'Email OTP disabled for reseller',
    data: { id: reseller._id, emailOtpEnabled: reseller.emailOtpEnabled },
  });
}));

router.delete('/resellers/:id', asyncHandler(async (req: AuthRequest, res) => {
  const reseller = await User.findOne({ _id: req.params.id, role: 'reseller' });
  if (!reseller) throw new AppError('Reseller not found');

  const wallet = await Wallet.findOne({ userId: reseller._id });
  if (wallet && wallet.profitBalance > 0) {
    throw new AppError(
      `Cannot delete account with withdrawable balance (GHS ${wallet.profitBalance}). Pay out or adjust first.`
    );
  }

  const pendingWithdrawals = await Withdrawal.countDocuments({
    userId: reseller._id,
    status: { $in: ['pending', 'approved'] },
  });
  if (pendingWithdrawals > 0) {
    throw new AppError('Cannot delete account with pending withdrawal requests');
  }

  await Wallet.deleteOne({ userId: reseller._id });
  await User.deleteOne({ _id: reseller._id, role: 'reseller' });
  await logAudit(req, 'delete', 'reseller', reseller._id.toString(), {
    email: reseller.email,
    fullName: reseller.fullName,
  });

  res.json({ success: true, message: 'Reseller account deleted' });
}));

router.post('/resellers/:id/reward', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const reseller = await User.findOne({ _id: req.params.id, role: 'reseller' });
  if (!reseller) throw new AppError('Reseller not found');

  const amount = parseWithdrawalAmount(req.body.amount);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const description = note || 'Performance reward from admin';
  const reference = `admin-reward-reseller-${Date.now()}`;

  const wallet = await creditWallet(reseller._id, amount, 'profit_credit', description, reference, {
    rewardedBy: req.user?._id,
    role: 'reseller',
  });

  await createNotification(
    reseller._id,
    'wallet_funded',
    'Performance Reward',
    `You received GHS ${amount} as a performance reward.${note ? ` Note: ${note}` : ''}`
  );
  await logAudit(req, 'reward', 'reseller', reseller._id.toString(), { amount, note });

  res.json({
    success: true,
    message: `Reward of GHS ${amount} credited to reseller profit wallet`,
    data: { profitBalance: wallet.profitBalance },
  });
}));

// Global search — resellers, phone numbers, order IDs
router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) throw new AppError('Search query is required');
  if (q.length < 2) throw new AppError('Enter at least 2 characters to search');
  const data = await adminSearch(q);
  res.json({ success: true, data });
}));

// Orders (all dealer + reseller store orders)
router.get('/orders', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, source, q } = req.query;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (source) filter.source = source;
  const searchFilter = buildOrderSearchFilter(String(q || ''));
  if (searchFilter) Object.assign(filter, searchFilter);

  // Refresh provider statuses in background — never block the list response.
  void syncFulfillmentStatuses({}, 40).catch(() => {});

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('agentId', 'fullName email')
      .populate('resellerId', 'fullName email resellerStore.storeName')
      .select(
        'orderId customerEmail recipientPhone network bundleSize status providerStatus providerReference source sellingPrice profit platformProfit adminBasePrice costPrice totalAmount agentId resellerId createdAt updatedAt'
      )
      .lean(),
    Order.countDocuments(filter),
  ]);

  const data = orders.map((o) => {
    const dealer = o.agentId as { _id?: unknown; fullName?: string; email?: string } | null;
    const reseller = o.resellerId as {
      _id?: unknown;
      fullName?: string;
      email?: string;
      resellerStore?: { storeName?: string };
    } | null;
    const dealerIsDoc = dealer && typeof dealer === 'object' && 'fullName' in dealer;
    const resellerIsDoc = reseller && typeof reseller === 'object' && 'fullName' in reseller;
    return {
      ...o,
      agentId: dealerIsDoc ? dealer._id : o.agentId,
      resellerId: resellerIsDoc ? reseller._id : o.resellerId,
      dealerName: dealerIsDoc ? dealer.fullName : undefined,
      dealerEmail: dealerIsDoc ? dealer.email : undefined,
      resellerName: resellerIsDoc ? reseller.fullName : undefined,
      resellerEmail: resellerIsDoc ? reseller.email : undefined,
      storeName: resellerIsDoc ? reseller.resellerStore?.storeName : undefined,
    };
  });

  res.json({ success: true, data: { orders: data, total, page: Number(page) } });
}));

router.get('/orders/:orderId/tracking', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) throw new AppError('Order not found');
  res.json({ success: true, data: getOrderTracking(order) });
}));

router.patch('/orders/bulk/status', asyncHandler(async (req: AuthRequest, res) => {
  const allowed = [
    'pending',
    'processing',
    'delivered',
    'failed',
    'refunded',
    'cancelled',
    'verification',
  ];
  const { orderIds, status } = req.body as { orderIds?: string[]; status?: string };

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    throw new AppError('Select at least one order');
  }
  if (orderIds.length > 200) {
    throw new AppError('Maximum 200 orders per bulk update');
  }
  if (!status || !allowed.includes(status)) {
    throw new AppError('Invalid order status');
  }

  const uniqueIds = [...new Set(orderIds.map((id) => String(id).trim()).filter(Boolean))];
  const orders = await Order.find({ orderId: { $in: uniqueIds } });

  const updatedOrders = [];
  for (const order of orders) {
    if (status === 'verification') {
      const verification = await applyManualVerificationToOrder(order);
      const updated = await applyOrderStatusUpdate(order, {
        status: 'processing',
        providerStatus: verification.providerStatus || SUBMITTED_FOR_VERIFICATION,
        stepLabel: verification.stepLabel,
        stepMessage: `${verification.stepMessage}${
          verification.emailSent ? ' Verification email sent.' : ''
        } (bulk)`,
      });
      updatedOrders.push({
        orderId: updated.orderId,
        status: updated.status,
        providerStatus: updated.providerStatus,
      });
      continue;
    }

    const nextStatus = status as OrderStatus;
    const updated = await applyOrderStatusUpdate(order, {
      status: nextStatus,
      providerStatus: nextStatus,
      stepLabel: 'Admin Bulk Update',
      stepMessage: `Status set to ${nextStatus} by admin (bulk)`,
    });
    updatedOrders.push({
      orderId: updated.orderId,
      status: updated.status,
      providerStatus: updated.providerStatus,
    });
  }

  res.json({
    success: true,
    data: {
      requested: uniqueIds.length,
      updated: updatedOrders.length,
      orders: updatedOrders,
    },
  });
}));

router.patch('/orders/:orderId/status', asyncHandler(async (req: AuthRequest, res) => {
  const allowed = [
    'pending',
    'processing',
    'delivered',
    'failed',
    'refunded',
    'cancelled',
    'verification',
  ];
  const { status } = req.body;
  if (!allowed.includes(status)) throw new AppError('Invalid order status');

  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) throw new AppError('Order not found');

  if (status === 'verification') {
    const verification = await applyManualVerificationToOrder(order);
    const updated = await applyOrderStatusUpdate(order, {
      status: 'processing',
      providerStatus: verification.providerStatus || SUBMITTED_FOR_VERIFICATION,
      stepLabel: verification.stepLabel,
      stepMessage: `${verification.stepMessage}${
        verification.emailSent ? ' Verification email sent.' : ' No buyer email on order.'
      }`,
    });
    res.json({ success: true, data: updated });
    return;
  }

  const updated = await applyOrderStatusUpdate(order, {
    status,
    providerStatus: status,
    stepLabel: 'Admin Update',
    stepMessage: `Status set to ${status} by admin`,
  });
  res.json({ success: true, data: updated });
}));

// Withdrawals
router.get('/withdrawals', asyncHandler(async (_req, res) => {
  const withdrawals = await Withdrawal.find().populate('userId', 'fullName email').sort({ createdAt: -1 });
  res.json({ success: true, data: withdrawals });
}));

router.patch('/withdrawals/:id', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  if (req.body.amount !== undefined) {
    throw new AppError('Withdrawal amount cannot be changed');
  }

  const { status, adminNote } = req.body;
  const allowed = ['approved', 'processed', 'paid', 'rejected'];
  if (status && !allowed.includes(status)) {
    throw new AppError('Invalid withdrawal status');
  }

  let withdrawal;
  if (status === 'approved') {
    withdrawal = await approveWithdrawal(req.params.id as string);
    withdrawal = await processWithdrawal(withdrawal._id.toString());
    const payoutResult = await applyPaystackTransferToWithdrawal(withdrawal);
    withdrawal = payoutResult.withdrawal;
    await createNotification(
      withdrawal.userId,
      'withdrawal_paid',
      payoutResult.paystackError ? 'Withdrawal Processing' : 'Withdrawal Sent',
      payoutResult.paystackError
        ? `Your withdrawal of GHS ${withdrawal.amount} was approved. Paystack transfer is pending — admin will retry shortly.`
        : `GHS ${withdrawal.amount} has been sent to your ${withdrawal.network} MoMo (${withdrawal.mobileNumber}) via Paystack.`
    );
  } else if (status === 'processed' || status === 'paid') {
    withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) throw new AppError('Withdrawal not found');

    if (withdrawal.status === 'approved') {
      withdrawal = await processWithdrawal(withdrawal._id.toString());
    } else if (status === 'paid') {
      withdrawal = await markWithdrawalPaid(req.params.id as string);
    } else if (withdrawal.status !== 'processed') {
      throw new AppError('Only approved or processed withdrawals can be paid out');
    }

    const payoutResult = await applyPaystackTransferToWithdrawal(withdrawal);
    withdrawal = payoutResult.withdrawal;
    await createNotification(
      withdrawal.userId,
      'withdrawal_paid',
      payoutResult.paystackError ? 'Withdrawal Processing' : 'Withdrawal Sent',
      payoutResult.paystackError
        ? `Paystack could not send GHS ${withdrawal.amount} yet. Admin will retry.`
        : `GHS ${withdrawal.amount} has been sent to your MoMo via Paystack.`
    );
  } else if (status === 'rejected') {
    withdrawal = await rejectWithdrawal(req.params.id as string, adminNote);
    await createNotification(
      withdrawal.userId,
      'withdrawal_rejected',
      'Withdrawal Rejected',
      adminNote || `Your withdrawal request of GHS ${withdrawal.amount} was rejected.`
    );
  } else {
    throw new AppError('Status update required');
  }

  if (adminNote && status !== 'rejected') {
    withdrawal.adminNote = adminNote;
    await withdrawal.save();
  }

  await logAudit(req, 'update', 'withdrawal', withdrawal._id.toString(), { status: withdrawal.status });
  res.json({ success: true, data: withdrawal });
}));

// Complaints
router.get('/complaints', asyncHandler(async (_req, res) => {
  const complaints = await Complaint.find()
    .populate('userId', 'fullName email complaintEnabled resellerStore.storeName')
    .sort({ createdAt: -1 });
  res.json({ success: true, data: complaints });
}));

router.patch('/complaints/:id', asyncHandler(async (req: AuthRequest, res) => {
  const allowed = ['pending', 'under_review', 'resolved', 'rejected', 'refunded'];
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw new AppError('Complaint not found');

  if (req.body.status) {
    if (!allowed.includes(req.body.status)) throw new AppError('Invalid complaint status');
    complaint.status = req.body.status;
  }
  if (req.body.adminResponse) complaint.adminResponse = req.body.adminResponse;
  await complaint.save();

  await createNotification(
    complaint.userId,
    'complaint_updated',
    'Complaint Updated',
    `Your complaint for order ${complaint.orderId} is now ${complaint.status}.`
  );

  res.json({ success: true, data: complaint });
}));

router.get('/customer-complaints', asyncHandler(async (_req, res) => {
  const complaints = await CustomerComplaint.find()
    .populate('resellerId', 'fullName email resellerStore.storeName')
    .sort({ createdAt: -1 });
  res.json({ success: true, data: complaints });
}));

router.patch('/customer-complaints/:id', asyncHandler(async (req: AuthRequest, res) => {
  const allowed = ['pending', 'under_review', 'resolved', 'rejected', 'refunded'];
  const complaint = await CustomerComplaint.findById(req.params.id);
  if (!complaint) throw new AppError('Customer complaint not found');

  if (req.body.status) {
    if (!allowed.includes(req.body.status)) throw new AppError('Invalid complaint status');
    complaint.status = req.body.status;
  }
  if (req.body.adminResponse) complaint.adminResponse = req.body.adminResponse;
  await complaint.save();
  await logAudit(req, 'update', 'customer_complaint', complaint._id.toString(), {
    status: complaint.status,
  });
  res.json({ success: true, data: complaint });
}));

// Platform settings
router.get('/settings', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const poolSummary = await getResellerPoolSummary();

  res.json({
    success: true,
    data: {
      processingFeePercent: settings.paystackChargePercent ?? 2,
      paystackChargePercent: settings.paystackChargePercent ?? 2,
      minWithdrawal: settings.minWithdrawal ?? 30,
      withdrawalPoolBalance: poolSummary.withdrawalPoolBalance ?? 0,
      totalPoolDeposits: poolSummary.totalPoolDeposits ?? 0,
      pendingWithdrawalTotal: poolSummary.pendingWithdrawalTotal ?? 0,
      totalResellerProfit: poolSummary.totalResellerProfitOwed ?? 0,
      totalResellerProfitOwed: poolSummary.totalResellerProfitOwed ?? 0,
      totalOwed: poolSummary.totalOwed ?? 0,
      poolShortfall: poolSummary.poolShortfall ?? 0,
      recommendedPoolTopUp: poolSummary.recommendedPoolTopUp ?? 0,
      resellerEmailOtpEnabled: settings.authSettings?.resellerEmailOtpEnabled !== false,
      agentEmailOtpEnabled: settings.authSettings?.agentEmailOtpEnabled !== false,
    },
  });
}));

router.post(
  '/production-reset',
  requireAdminOtp,
  asyncHandler(async (req: AuthRequest, res) => {
    const { confirmPhrase, removeNonAdminUsers } = req.body as {
      confirmPhrase?: string;
      removeNonAdminUsers?: boolean;
    };
    if (confirmPhrase !== 'RESET PLATFORM') {
      throw new AppError('Type RESET PLATFORM in confirmPhrase to run this reset');
    }
    const summary = await resetPlatformForProduction({
      removeNonAdminUsers: Boolean(removeNonAdminUsers),
    });
    await logAudit(req, 'production_reset', 'platform', undefined, summary as unknown as Record<string, unknown>);
    res.json({
      success: true,
      message: 'Platform financial data cleared. Reseller stores are active.',
      data: summary,
    });
  })
);

router.put('/settings', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const settings = await getSettings();
  const {
    processingFeePercent,
    paystackChargePercent,
    minWithdrawal,
    resellerEmailOtpEnabled,
    agentEmailOtpEnabled,
  } = req.body;

  if (paystackChargePercent !== undefined) {
    const fee = Number(paystackChargePercent);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      throw new AppError('Paystack charge must be a number between 0 and 100');
    }
    settings.paystackChargePercent = fee;
    settings.processingFeePercent = fee;
  } else if (processingFeePercent !== undefined) {
    const fee = Number(processingFeePercent);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      throw new AppError('Paystack charge must be a number between 0 and 100');
    }
    settings.paystackChargePercent = fee;
    settings.processingFeePercent = fee;
  }
  if (minWithdrawal !== undefined) {
    const min = Number(minWithdrawal);
    if (!Number.isFinite(min) || min < 1) {
      throw new AppError('Minimum withdrawal must be at least GHS 1');
    }
    settings.minWithdrawal = min;
  }

  if (resellerEmailOtpEnabled !== undefined) {
    if (typeof resellerEmailOtpEnabled !== 'boolean') {
      throw new AppError('resellerEmailOtpEnabled must be true or false');
    }
    if (!settings.authSettings) {
      settings.authSettings = { resellerEmailOtpEnabled: true, agentEmailOtpEnabled: true };
    }
    settings.authSettings.resellerEmailOtpEnabled = resellerEmailOtpEnabled;
    settings.markModified('authSettings');
  }

  if (agentEmailOtpEnabled !== undefined) {
    if (typeof agentEmailOtpEnabled !== 'boolean') {
      throw new AppError('agentEmailOtpEnabled must be true or false');
    }
    if (!settings.authSettings) {
      settings.authSettings = { resellerEmailOtpEnabled: true, agentEmailOtpEnabled: true };
    }
    settings.authSettings.agentEmailOtpEnabled = agentEmailOtpEnabled;
    settings.markModified('authSettings');
  }

  await settings.save();
  await logAudit(req, 'update', 'settings');
  res.json({ success: true, data: settings });
}));

// Fund withdrawal pool via Paystack (card / MoMo)
router.post('/settings/withdrawal-pool/fund', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const amount = parseWithdrawalAmount(req.body.amount);
  const { note } = req.body;

  const data = await initPoolDepositPayment(
    req.user!.email,
    req.user!._id.toString(),
    amount,
    note
  );

  res.json({
    success: true,
    message: 'Redirect to Paystack to fund the withdrawal pool',
    data,
  });
}));

// Manual pool deposit (bank transfer / cash already received)
router.post('/settings/withdrawal-pool/deposit', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const amount = parseWithdrawalAmount(req.body.amount);
  const { note } = req.body;
  const result = await depositWithdrawalPool(amount, note);
  await logAudit(req, 'deposit', 'withdrawal_pool', undefined, {
    amount: result.amount,
    note,
    balanceAfter: result.settings.withdrawalPoolBalance,
    source: 'manual',
  });
  res.json({
    success: true,
    message: `GHS ${result.amount} added to withdrawal pool`,
    data: {
      withdrawalPoolBalance: result.settings.withdrawalPoolBalance,
      totalPoolDeposits: result.settings.totalPoolDeposits,
    },
  });
}));

// External fulfillment API routing (per network)
const FULFILLMENT_NETWORKS = ['MTN', 'Telecel', 'AirtelTigo'] as const;

function buildFulfillmentSettingsPayload(settings: Awaited<ReturnType<typeof getSettings>>) {
  const fulfillment = settings.fulfillmentSettings;
  const migrated = migrateFulfillmentSettings(fulfillment).settings;
  return {
    enabled: migrated.enabled,
    defaultProvider: migrated.defaultProvider,
    networkRouting: {
      MTN: migrated.networkRouting.MTN,
      Telecel: migrated.networkRouting.Telecel,
      AirtelTigo: migrated.networkRouting.AirtelTigo,
    },
    afaRouting: migrated.afaRouting,
    providers: {
      smartdatahub: {
        configured: isSmartDataHubConfigured(),
        apiUrl: env.fulfillment.apiUrl || 'https://smartdatahubgh.com/api/v1',
      },
      datamax: {
        configured: isDatamaxConfigured(),
        apiUrl: env.datamax.apiUrl || 'https://datamax.site/wp-json/api/v1',
      },
    },
    webhookUrl: `${env.apiUrl}/api/webhooks/fulfillment`,
  };
}

router.get('/settings/fulfillment', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({
    success: true,
    data: buildFulfillmentSettingsPayload(settings),
  });
}));

router.post('/settings/fulfillment/test', asyncHandler(async (req, res) => {
  const provider = String(req.query.provider || 'smartdatahub');
  if (provider === 'datamax') {
    if (!isDatamaxConfigured()) {
      throw new AppError('Datamax API is not fully configured on the server', 400);
    }
    const result = await testDatamaxConnection();
    res.json({ success: true, data: result });
    return;
  }

  if (!isSmartDataHubConfigured()) {
    throw new AppError('Smart Data Hub API is not fully configured on the server', 400);
  }
  const result = await testSmartDataHubConnection();
  res.json({ success: true, data: result });
}));

router.post('/settings/fulfillment/check-balance', asyncHandler(async (req, res) => {
  const provider = String(req.query.provider || 'datamax');
  if (provider !== 'datamax') {
    throw new AppError('Balance check is only available for Datamax', 400);
  }
  if (!isDatamaxConfigured()) {
    throw new AppError('Datamax API is not fully configured on the server', 400);
  }
  const result = await checkDatamaxBalance();
  res.json({
    success: true,
    data: {
      ...result,
      balance: result.balance ?? result.wallet_balance,
    },
  });
}));

router.post('/settings/fulfillment/retry-queued', asyncHandler(async (_req, res) => {
  const retried = await retryQueuedFulfillmentOrders(50);
  res.json({ success: true, data: { retried } });
}));

router.put('/settings/fulfillment', asyncHandler(async (req: AuthRequest, res) => {
  const settings = await getSettings();
  const migrated = migrateFulfillmentSettings(settings.fulfillmentSettings).settings;
  settings.fulfillmentSettings = migrated;

  if (typeof req.body.enabled === 'boolean') {
    settings.fulfillmentSettings.enabled = req.body.enabled;
  }

  if (req.body.defaultProvider === 'smartdatahub' || req.body.defaultProvider === 'datamax') {
    settings.fulfillmentSettings.defaultProvider = req.body.defaultProvider;
  }

  if (req.body.networkRouting && typeof req.body.networkRouting === 'object') {
    for (const network of FULFILLMENT_NETWORKS) {
      if (req.body.networkRouting[network] !== undefined) {
        settings.fulfillmentSettings.networkRouting[network] = normalizeNetworkRoute(
          req.body.networkRouting[network]
        );
      }
    }
    settings.markModified('fulfillmentSettings.networkRouting');
  }

  if (req.body.afaRouting !== undefined) {
    settings.fulfillmentSettings.afaRouting = normalizeAfaRoute(req.body.afaRouting);
    settings.markModified('fulfillmentSettings.afaRouting');
  }

  await settings.save();
  await logAudit(req, 'update', 'fulfillment_settings');

  res.json({
    success: true,
    data: buildFulfillmentSettingsPayload(settings),
  });
}));

// Complaint settings
router.get('/settings/complaints', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({ success: true, data: settings.complaintSettings });
}));

router.put('/settings/complaints', asyncHandler(async (req: AuthRequest, res) => {
  const settings = await getSettings();
  if (typeof req.body.globalEnabled === 'boolean') {
    settings.complaintSettings.globalEnabled = req.body.globalEnabled;
  }
  if (req.body.activeNotice !== undefined) {
    settings.complaintSettings.activeNotice = req.body.activeNotice;
  }
  await settings.save();
  res.json({ success: true, data: settings.complaintSettings });
}));

// Service images
router.put('/settings/service-images', upload.single('image'), asyncHandler(async (req: AuthRequest, res) => {
  const { network } = req.body;
  const settings = await getSettings();
  const imageUrl = req.file ? `/${env.uploadDir}/${req.file.filename}` : req.body.imageUrl;

  const idx = settings.serviceImages.findIndex((s) => s.network === network);
  if (idx >= 0) {
    settings.serviceImages[idx].imageUrl = imageUrl;
    if (req.body.isAvailable !== undefined) {
      settings.serviceImages[idx].isAvailable = req.body.isAvailable === 'true';
    }
  } else {
    settings.serviceImages.push({ network, imageUrl, isAvailable: true });
  }
  await settings.save();
  res.json({ success: true, data: settings.serviceImages });
}));

// FAQs
router.get('/faqs', asyncHandler(async (_req, res) => {
  const faqs = await Faq.find().sort({ sortOrder: 1 });
  res.json({ success: true, data: faqs });
}));

router.post('/faqs', asyncHandler(async (req, res) => {
  const faq = await Faq.create(req.body);
  res.status(201).json({ success: true, data: faq });
}));

router.put('/faqs/:id', asyncHandler(async (req, res) => {
  const faq = await Faq.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, data: faq });
}));

router.delete('/faqs/:id', asyncHandler(async (req, res) => {
  await Faq.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'FAQ deleted' });
}));

// Reports export (CSV)
router.get('/reports/:type', asyncHandler(async (req, res) => {
  const { type } = req.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] = [];
  let headers: string[] = [];

  switch (type) {
    case 'orders': {
      const allowedNetworks = ['MTN', 'Telecel', 'AirtelTigo'] as const;
      const networkFilter = typeof req.query.network === 'string' ? req.query.network : '';
      const orderQuery: Record<string, unknown> = {};
      if (networkFilter) {
        if (!allowedNetworks.includes(networkFilter as (typeof allowedNetworks)[number])) {
          throw new AppError('Invalid network filter. Use MTN, Telecel, or AirtelTigo.');
        }
        orderQuery.network = networkFilter;
      }

      const rawOrders = await Order.find(orderQuery)
        .sort({ createdAt: -1 })
        .populate('agentId', 'fullName email')
        .populate('resellerId', 'fullName email resellerStore.storeName')
        .lean();
      headers = [
        'orderId',
        'source',
        'status',
        'network',
        'bundleSize',
        'recipientPhone',
        'customerEmail',
        'dealerName',
        'dealerEmail',
        'resellerName',
        'resellerEmail',
        'storeName',
        'sellingPrice',
        'profit',
        'totalAmount',
        'createdAt',
      ];
      data = rawOrders.map((o) => {
        const dealer = o.agentId as { fullName?: string; email?: string } | null;
        const reseller = o.resellerId as {
          fullName?: string;
          email?: string;
          resellerStore?: { storeName?: string };
        } | null;
        return {
          orderId: o.orderId,
          source: o.source,
          status: o.status,
          network: o.network,
          bundleSize: o.bundleSize,
          recipientPhone: o.recipientPhone,
          customerEmail: o.customerEmail ?? '',
          dealerName: dealer?.fullName ?? '',
          dealerEmail: dealer?.email ?? '',
          resellerName: reseller?.fullName ?? '',
          resellerEmail: reseller?.email ?? '',
          storeName: reseller?.resellerStore?.storeName ?? '',
          sellingPrice: o.sellingPrice,
          profit: o.profit,
          totalAmount: o.totalAmount,
          createdAt: o.createdAt,
        };
      });
      break;
    }
    case 'withdrawals':
      data = await Withdrawal.find().lean();
      headers = ['amount', 'network', 'mobileNumber', 'status', 'createdAt'];
      break;
    case 'complaints':
      data = await Complaint.find().lean();
      headers = ['orderId', 'issueType', 'status', 'createdAt'];
      break;
    case 'dealers':
      data = await User.find({ role: 'agent' }).select('-password').lean();
      headers = ['fullName', 'email', 'phone', 'status', 'createdAt'];
      break;
    case 'resellers':
      data = await User.find({ role: 'reseller' }).select('-password').lean();
      headers = ['fullName', 'email', 'phone', 'status', 'createdAt'];
      break;
    default:
      throw new AppError('Invalid report type');
  }

  const csv = [
    headers.join(','),
    ...data.map((row) =>
      headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')
    ),
  ].join('\n');

  const networkSuffix =
    type === 'orders' && typeof req.query.network === 'string'
      ? `-${req.query.network.toLowerCase()}`
      : '';
  const dateStamp = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${type}-report${networkSuffix}-${dateStamp}.csv`
  );
  res.send(csv);
}));

router.get('/audit-logs', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const logs = await AuditLog.find()
    .populate('userId', 'fullName email role')
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json({ success: true, data: logs });
}));

router.get('/promo-codes', asyncHandler(async (req: AuthRequest, res) => {
  const { packageId, status, batchId, page, limit } = req.query as Record<string, string | undefined>;
  const data = await listPromoCodes({
    packageId,
    status: status as import('../models/PromoCode').PromoCodeStatus | undefined,
    batchId,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  res.json({ success: true, data });
}));

router.get('/promo-codes/batches', asyncHandler(async (_req: AuthRequest, res) => {
  const batches = await listPromoBatches();
  res.json({ success: true, data: batches });
}));

router.post('/promo-codes/generate', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const { discountGhs, count, label, expiresAt } = req.body as {
    discountGhs?: number;
    count?: number;
    label?: string;
    expiresAt?: string;
  };

  if (discountGhs === undefined || !count) {
    throw new AppError('Discount and count are required', 400);
  }

  const parsedExpiry = expiresAt ? new Date(expiresAt) : undefined;
  if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) {
    throw new AppError('Invalid expiry date', 400);
  }

  const result = await generatePromoCodes({
    discountGhs: Number(discountGhs),
    count: Number(count),
    label,
    expiresAt: parsedExpiry,
    adminId: req.user!._id.toString(),
  });

  res.status(201).json({ success: true, data: result });
}));

router.patch(
  '/promo-codes/batches/:batchId/disable',
  requireAdminOtp,
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await disablePromoBatch(String(req.params.batchId), req.user!._id.toString());
    res.json({ success: true, data: result });
  })
);

router.patch('/promo-codes/:id/disable', requireAdminOtp, asyncHandler(async (req: AuthRequest, res) => {
  const updated = await disablePromoCode(String(req.params.id), req.user!._id.toString());
  res.json({ success: true, data: updated });
}));

export default router;
