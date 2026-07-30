import { Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { Package, Network } from '../models/Package';
import { Order } from '../models/Order';
import { ApiLog } from '../models/ApiLog';
import { Complaint } from '../models/Complaint';
import { Notification } from '../models/Notification';
import { canSubmitComplaint, isComplaintsEnabledForUser } from '../services/settingsService';
import { upload } from '../middleware/upload';
import { env } from '../config/env';
import { getDateRanges } from '../utils/helpers';
import { sortPackagesByBundleSize } from '../utils/bundleSize';
import { getOrCreateWallet } from '../services/walletService';
import { WalletTransaction } from '../models/WalletTransaction';
import { createOrder, validateBulkOrders, processBulkOrders } from '../services/orderService';
import { getAgentPrice } from '../services/agentPricingService';
import { getSettings } from '../services/settingsService';
import { initWalletDepositPayment } from '../services/paystackPaymentService';
import { User } from '../models/User';
import crypto from 'crypto';
import { getOrderGrowthChart } from '../services/growthChartService';
import { getNetworkStockList } from '../services/networkStockService';
import { getAfaStock } from '../services/afaStockService';
import { getAfaPackage } from '../services/afaPackageService';
import { AFA_BASE_PRICE, AFA_BUNDLE_SIZE, AFA_CHECK_USSD, AFA_PROCESSING_HOURS } from '../config/afa';
import { CheckerType, checkerTypeLabel, normalizeCheckerType } from '../config/checker';
import { getAllCheckerStock } from '../services/checkerStockService';
import { getCheckerPackage } from '../services/checkerPackageService';
import {
  getOrderTracking,
  syncFulfillmentStatuses,
  syncInFlightOrders,
  getFulfillmentStatusCounts,
} from '../services/fulfillmentProviderService';
import { purchaseLimiter, walletFundLimiter } from '../middleware/rateLimiter';
import { rejectFields } from '../middleware/rejectFields';
import {
  isAgentApiApproved,
  requestAgentApiAccess,
  serializeAgentApiStatus,
} from '../services/agentApiApprovalService';
import { buildOrderSearchFilter } from '../services/adminSearchService';

const blockClientPricing = rejectFields(
  'sellingPrice',
  'costPrice',
  'totalAmount',
  'profit',
  'processingFee',
  'role',
  'agentId',
  'resellerId',
  'userId',
  'status',
  'balance'
);

const router = Router();
router.use(authenticate, authorize('agent'));

// Dashboard
router.get('/dashboard', asyncHandler(async (req: AuthRequest, res) => {
  const agentId = req.user!._id;
  void syncFulfillmentStatuses({ agentId }, 40).catch(() => {});

  const { startOfToday, startOfWeek, startOfMonth } = getDateRanges();
  const wallet = await getOrCreateWallet(agentId);
  const fulfillmentCounts = await getFulfillmentStatusCounts({ agentId });

  const [
    ordersToday,
    ordersWeek,
    ordersMonth,
    pendingOrders,
    processingOrders,
    deliveredOrders,
    notDeliveredOrders,
    purchaseAgg,
    revenueAgg,
  ] = await Promise.all([
    Order.countDocuments({ agentId, createdAt: { $gte: startOfToday } }),
    Order.countDocuments({ agentId, createdAt: { $gte: startOfWeek } }),
    Order.countDocuments({ agentId, createdAt: { $gte: startOfMonth } }),
    Order.countDocuments({ agentId, status: 'pending' }),
    Order.countDocuments({ agentId, status: 'processing' }),
    Order.countDocuments({ agentId, status: 'delivered' }),
    Order.countDocuments({ agentId, status: { $in: ['failed', 'cancelled', 'refunded'] } }),
    Order.aggregate([
      { $match: { agentId } },
      { $group: { _id: null, total: { $sum: '$sellingPrice' } } },
    ]),
    Order.aggregate([
      { $match: { agentId, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$sellingPrice' } } },
    ]),
  ]);

  const growthChart = await getOrderGrowthChart({ agentId }, 14, 'sellingPrice');

  res.json({
    success: true,
    data: {
      walletBalance: wallet.balance,
      ordersToday,
      ordersThisWeek: ordersWeek,
      ordersThisMonth: ordersMonth,
      pendingOrders,
      processingOrders,
      deliveredOrders,
      notDeliveredOrders,
      totalPurchases: purchaseAgg[0]?.total || 0,
      totalRevenue: revenueAgg[0]?.total || 0,
      growthChart,
      ...fulfillmentCounts,
    },
  });
}));

// Wallet
router.get('/wallet', asyncHandler(async (req: AuthRequest, res) => {
  const wallet = await getOrCreateWallet(req.user!._id);
  res.json({ success: true, data: wallet });
}));

router.get('/wallet/transactions', asyncHandler(async (req: AuthRequest, res) => {
  const transactions = await WalletTransaction.find({
    userId: req.user!._id,
    description: { $ne: '__reserved__' },
    amount: { $ne: 0 },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .select('type amount balanceBefore balanceAfter reference description createdAt');
  res.json({ success: true, data: transactions });
}));

// Fund wallet via Paystack
router.post('/wallet/fund', walletFundLimiter, asyncHandler(async (req: AuthRequest, res) => {
  const { amount } = req.body;
  const depositAmount = Number(amount);
  const MAX_DEPOSIT = 10_000;

  if (!Number.isFinite(depositAmount) || depositAmount < 1) {
    throw new AppError('Minimum deposit is GHS 1');
  }
  if (depositAmount > MAX_DEPOSIT) {
    throw new AppError(`Maximum deposit is GHS ${MAX_DEPOSIT.toLocaleString()}`);
  }

  const data = await initWalletDepositPayment(
    req.user!.email,
    req.user!._id.toString(),
    depositAmount
  );

  res.json({ success: true, data });
}));

// Networks & packages
router.get('/network-stock', asyncHandler(async (_req, res) => {
  const data = await getNetworkStockList();
  res.json({ success: true, data });
}));

router.get('/networks', asyncHandler(async (_req, res) => {
  const stock = await getNetworkStockList();
  res.json({ success: true, data: stock });
}));

router.get('/packages', asyncHandler(async (req: AuthRequest, res) => {
  const stock = await getNetworkStockList();
  const inStock = new Set(stock.filter((s) => s.inStock).map((s) => s.network));
  const filter: Record<string, unknown> = { isEnabled: true, productType: 'data' };
  if (req.query.network) {
    const network = String(req.query.network);
    if (!inStock.has(network as typeof stock[0]['network'])) {
      throw new AppError(`${network} data is currently out of stock`, 503);
    }
    filter.network = network;
  }
  const packages = sortPackagesByBundleSize(await Package.find(filter));
  const agentId = req.user!._id;
  const filtered = packages.filter((p) => inStock.has(p.network));
  const data = await Promise.all(
    filtered.map(async (p) => ({
      _id: p._id,
      network: p.network,
      bundleSize: p.bundleSize,
      agentPrice: await getAgentPrice(agentId, p._id, p),
      sortOrder: p.sortOrder,
    }))
  );
  res.json({ success: true, data });
}));

router.get('/afa', asyncHandler(async (req: AuthRequest, res) => {
  const [stock, pkg, wallet] = await Promise.all([
    getAfaStock(),
    getAfaPackage(),
    getOrCreateWallet(req.user!._id),
  ]);
  if (!pkg) throw new AppError('AFA registration package is not configured', 503);

  const agentId = req.user!._id;
  const fee = await getAgentPrice(agentId, pkg._id, pkg);

  res.json({
    success: true,
    data: {
      packageId: pkg._id,
      fee,
      basePrice: AFA_BASE_PRICE,
      inStock: stock.inStock,
      imageUrl: stock.imageUrl,
      walletBalance: wallet.balance,
      bundleSize: AFA_BUNDLE_SIZE,
      processingHours: AFA_PROCESSING_HOURS,
      checkUssd: AFA_CHECK_USSD,
    },
  });
}));

router.post('/afa/register', purchaseLimiter, blockClientPricing, asyncHandler(async (req: AuthRequest, res) => {
  const { fullName, phone, ghanaCard, location, occupation } = req.body;
  const pkg = await getAfaPackage();
  if (!pkg) throw new AppError('AFA registration is not available', 503);

  const order = await createOrder({
    packageId: pkg._id.toString(),
    afaDetails: { fullName, phone, ghanaCard, location, occupation },
    agentId: req.user!._id.toString(),
    source: 'agent',
  });

  res.status(201).json({
    success: true,
    data: {
      orderId: order.orderId,
      status: order.status,
      message: `Registration submitted. Allow ${AFA_PROCESSING_HOURS} hours, then dial ${AFA_CHECK_USSD} to check status.`,
    },
  });
}));

router.get('/checker', asyncHandler(async (req: AuthRequest, res) => {
  const [stock, wallet] = await Promise.all([
    getAllCheckerStock(),
    getOrCreateWallet(req.user!._id),
  ]);

  const agentId = req.user!._id;
  const types: CheckerType[] = ['bece', 'wassce'];
  const offers = await Promise.all(
    types.map(async (type) => {
      const pkg = await getCheckerPackage(type);
      const stockRow = stock.find((s) => s.type === type)!;
      const fee = pkg ? await getAgentPrice(agentId, pkg._id, pkg) : 0;
      return {
        type,
        label: checkerTypeLabel(type),
        packageId: pkg?._id,
        fee,
        basePrice: pkg?.agentPrice ?? 0,
        inStock: stockRow.inStock,
        availableCount: stockRow.availableCount,
      };
    })
  );

  res.json({
    success: true,
    data: {
      walletBalance: wallet.balance,
      offers,
    },
  });
}));

router.post('/checker/purchase', purchaseLimiter, blockClientPricing, asyncHandler(async (req: AuthRequest, res) => {
  const { type, email, phone } = req.body as { type?: string; email?: string; phone?: string };
  if (!type || !email?.trim() || !phone?.trim()) {
    throw new AppError('Checker type, email, and phone are required');
  }

  const checkerType = normalizeCheckerType(type);
  const pkg = await getCheckerPackage(checkerType);
  if (!pkg) throw new AppError(`${checkerTypeLabel(checkerType)} checker is not available`, 503);

  const order = await createOrder({
    packageId: pkg._id.toString(),
    recipientPhone: phone,
    customerEmail: email.trim().toLowerCase(),
    agentId: req.user!._id.toString(),
    source: 'agent',
  });

  res.status(201).json({
    success: true,
    data: {
      orderId: order.orderId,
      status: order.status,
      type: order.checkerDetails?.type,
      serial: order.checkerDetails?.serial,
      pin: order.checkerDetails?.pin,
      message:
        'Checker delivered. Serial and PIN were sent to the customer email and phone SMS.',
    },
  });
}));

// Single purchase
router.post('/purchase', purchaseLimiter, blockClientPricing, asyncHandler(async (req: AuthRequest, res) => {
  const { packageId, recipientPhone } = req.body;
  if (!packageId || !recipientPhone) throw new AppError('Package and recipient phone required');

  const order = await createOrder({
    packageId,
    recipientPhone,
    agentId: req.user!._id.toString(),
    source: 'agent',
  });

  res.status(201).json({ success: true, data: order });
}));

// Bulk purchase - validate
router.post('/bulk/validate', asyncHandler(async (req: AuthRequest, res) => {
  const { lines, network } = req.body;
  if (!lines || !network) throw new AppError('Lines and network required');

  const parsedLines = (lines as string)
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean)
    .map((line: string) => {
      const [phone, bundle] = line.split(/\s+/);
      return { phone, bundleSize: bundle };
    });

  const result = await validateBulkOrders(parsedLines, network, req.user!._id.toString());
  res.json({ success: true, data: result });
}));

// Bulk purchase - confirm
router.post('/bulk/purchase', purchaseLimiter, blockClientPricing, asyncHandler(async (req: AuthRequest, res) => {
  const { validated } = req.body;
  if (!validated?.length) throw new AppError('No validated orders provided');

  const orders = await processBulkOrders(validated, req.user!._id.toString());
  res.status(201).json({ success: true, data: orders });
}));

// Orders
router.get('/orders', asyncHandler(async (req: AuthRequest, res) => {
  const filter: Record<string, unknown> = { agentId: req.user!._id };
  const search = buildOrderSearchFilter(String(req.query.q || ''));
  if (search) Object.assign(filter, search);

  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100);
  await syncInFlightOrders(orders);
  const refreshed = await Order.find(filter).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: refreshed });
}));

router.get('/orders/:orderId/tracking', asyncHandler(async (req: AuthRequest, res) => {
  const order = await Order.findOne({ orderId: req.params.orderId, agentId: req.user!._id });
  if (!order) throw new AppError('Order not found');
  res.json({ success: true, data: getOrderTracking(order, { forClient: true }) });
}));

router.get('/orders/:orderId', asyncHandler(async (req: AuthRequest, res) => {
  const order = await Order.findOne({ orderId: req.params.orderId, agentId: req.user!._id });
  if (!order) throw new AppError('Order not found');
  res.json({ success: true, data: order });
}));

// Developer API — request / approval flow
router.get('/api/status', asyncHandler(async (req: AuthRequest, res) => {
  const agent = await User.findById(req.user!._id);
  if (!agent) throw new AppError('Agent not found', 404);
  res.json({ success: true, data: serializeAgentApiStatus(agent) });
}));

router.post('/api/request', asyncHandler(async (req: AuthRequest, res) => {
  const { message } = req.body;
  const data = await requestAgentApiAccess(req.user!._id.toString(), message);
  res.status(201).json({
    success: true,
    message: 'API access request submitted. An admin will review it shortly.',
    data,
  });
}));

router.get('/api/credentials', asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findById(req.user!._id).select(
    '+agentApi.secretKey +agentApi.secretKeyHash'
  );
  if (!dealer) throw new AppError('Agent not found', 404);
  if (!isAgentApiApproved(dealer)) {
    throw new AppError('API access not approved yet', 403);
  }

  // Agents who only have a hash (legacy wipe) can't recover the old secret —
  // issue a fresh one so the Developer API page always shows a real value.
  let secretKey = dealer.agentApi?.secretKey;
  if (!secretKey && dealer.agentApi?.secretKeyHash) {
    const { rotateAgentApiSecret } = await import('../services/agentSecretService');
    secretKey = await rotateAgentApiSecret(dealer);
  }

  res.json({
    success: true,
    data: {
      ...serializeAgentApiStatus(dealer),
      apiKey: dealer.agentApi?.apiKey,
      secretKey,
      ipWhitelist: dealer.agentApi?.ipWhitelist,
      webhookUrl: dealer.agentApi?.webhookUrl,
    },
  });
}));

router.put('/api/settings', asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findById(req.user!._id);
  if (!dealer || !isAgentApiApproved(dealer)) {
    throw new AppError('API access not approved', 403);
  }

  if (req.body.ipWhitelist) dealer.agentApi!.ipWhitelist = req.body.ipWhitelist;
  if (req.body.webhookUrl !== undefined) {
    const raw = String(req.body.webhookUrl || '');
    const urls = raw
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url)) {
        throw new AppError(`Invalid webhook URL (must start with http:// or https://): ${url}`);
      }
    }
    dealer.agentApi!.webhookUrl = urls.join('\n');
  }
  await dealer.save();

  res.json({ success: true, data: dealer.agentApi });
}));

router.post('/api/regenerate', asyncHandler(async (req: AuthRequest, res) => {
  const dealer = await User.findById(req.user!._id);
  if (!dealer || !isAgentApiApproved(dealer)) {
    throw new AppError('API access not approved', 403);
  }

  const { generateApiKey } = await import('../utils/helpers');
  const { rotateAgentApiSecret } = await import('../services/agentSecretService');
  dealer.agentApi!.apiKey = generateApiKey();
  const plaintextSecret = await rotateAgentApiSecret(dealer);

  res.json({
    success: true,
    message: 'API keys regenerated.',
    data: { apiKey: dealer.agentApi!.apiKey, secretKey: plaintextSecret },
  });
}));

// API logs & stats (approved agents only)
router.get('/api/logs', asyncHandler(async (req: AuthRequest, res) => {
  const agent = await User.findById(req.user!._id);
  if (!agent || !isAgentApiApproved(agent)) {
    throw new AppError('API access not approved', 403);
  }
  const logs = await ApiLog.find({ agentId: req.user!._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: logs });
}));

router.get('/api/stats', asyncHandler(async (req: AuthRequest, res) => {
  const agent = await User.findById(req.user!._id);
  if (!agent || !isAgentApiApproved(agent)) {
    throw new AppError('API access not approved', 403);
  }
  const stats = await ApiLog.aggregate([
    { $match: { agentId: req.user!._id } },
    {
      $group: {
        _id: '$endpoint',
        count: { $sum: 1 },
        avgResponseTime: { $avg: '$responseTime' },
      },
    },
  ]);
  res.json({ success: true, data: stats });
}));

// Complaints
router.get('/complaints/eligible-orders', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!._id.toString();
  const complaintsEnabled = await isComplaintsEnabledForUser(userId);

  const orders = await Order.find({
    agentId: req.user!._id,
    source: { $in: ['agent', 'agent_api'] },
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

  const order = await Order.findOne({
    orderId,
    agentId: req.user!._id,
    source: { $in: ['agent', 'agent_api'] },
  });
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
