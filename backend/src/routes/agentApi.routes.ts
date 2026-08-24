import { Router } from 'express';
import { agentApiAuth, AgentApiRequest } from '../middleware/agentApiAuth';
import { apiLimiter } from '../middleware/rateLimiter';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { Package } from '../models/Package';
import { Order } from '../models/Order';
import { getOrCreateWallet } from '../services/walletService';
import { createOrder, validateBulkOrders, processBulkOrders } from '../services/orderService';
import { getNetworkStockList } from '../services/networkStockService';
import { checkMtnExpressNumber } from '../services/mtnExpressVerificationService';
import {
  getNetworkApiMeta,
  serializeAgentApiOrder,
} from '../services/agentApiOrderSerializer';
import { getAfaStock } from '../services/afaStockService';
import { getAfaPackage } from '../services/afaPackageService';
import { AFA_CHECK_USSD, AFA_PROCESSING_HOURS } from '../config/afa';
import { CheckerType, checkerTypeLabel, normalizeCheckerType } from '../config/checker';
import { getAllCheckerStock } from '../services/checkerStockService';
import { getCheckerPackage } from '../services/checkerPackageService';
import { getAgentPrice } from '../services/agentPricingService';
import { sortPackagesByBundleSize } from '../utils/bundleSize';
import { rejectFields } from '../middleware/rejectFields';

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
router.use(apiLimiter, agentApiAuth);

// Wallet balance
router.get('/wallet', asyncHandler(async (req: AgentApiRequest, res) => {
  const wallet = await getOrCreateWallet(req.user!._id);
  res.json({ success: true, data: { balance: wallet.balance } });
}));

// Networks
router.get('/networks', asyncHandler(async (_req, res) => {
  const stock = await getNetworkStockList();
  res.json({
    success: true,
    data: stock.map((row) => {
      const meta = getNetworkApiMeta(row.network);
      return {
        network: row.network,
        label: meta?.label || row.network,
        code: meta?.code || String(row.network).toLowerCase().replace(/\s+/g, '_'),
        description: meta?.description || '',
        inStock: row.inStock,
        imageUrl: row.imageUrl,
      };
    }),
  });
}));

// Packages
router.get('/packages', asyncHandler(async (req: AgentApiRequest, res) => {
  const stock = await getNetworkStockList();
  const inStock = new Set(stock.filter((s) => s.inStock).map((s) => s.network));
  const filter: Record<string, unknown> = { isEnabled: true, productType: 'data' };
  if (req.query.network) filter.network = req.query.network;
  const packages = sortPackagesByBundleSize(
    await Package.find(filter).select('network bundleSize agentPrice')
  );
  const agentId = req.user!._id;
  const filtered = packages.filter((p) => inStock.has(p.network));
  const data = await Promise.all(
    filtered.map(async (p) => {
      const meta = getNetworkApiMeta(p.network);
      return {
        _id: p._id,
        network: p.network,
        networkLabel: meta?.label || p.network,
        networkCode: meta?.code || String(p.network).toLowerCase().replace(/\s+/g, '_'),
        bundleSize: p.bundleSize,
        agentPrice: await getAgentPrice(agentId, p._id, p),
      };
    })
  );
  res.json({
    success: true,
    data,
  });
}));

// Purchase
router.post('/purchase', asyncHandler(async (req: AgentApiRequest, res) => {
  const { packageId, recipientPhone } = req.body;
  if (!packageId || !recipientPhone) throw new AppError('packageId and recipientPhone required');

  const order = await createOrder({
    packageId,
    recipientPhone,
    agentId: req.user!._id.toString(),
    source: 'agent_api',
  });

  res.status(201).json({ success: true, data: serializeAgentApiOrder(order) });
}));

// Pre-purchase MTN Express number check
router.post('/verify-express', asyncHandler(async (req: AgentApiRequest, res) => {
  const { recipientPhone, phone } = req.body as { recipientPhone?: string; phone?: string };
  const raw = recipientPhone || phone;
  if (!raw) throw new AppError('recipientPhone is required');
  const result = await checkMtnExpressNumber(String(raw));
  res.json({ success: true, data: result });
}));

router.get('/afa', asyncHandler(async (req: AgentApiRequest, res) => {
  const [stock, pkg, wallet] = await Promise.all([
    getAfaStock(),
    getAfaPackage(),
    getOrCreateWallet(req.user!._id),
  ]);
  if (!pkg) throw new AppError('AFA registration package is not configured', 503);

  const fee = await getAgentPrice(req.user!._id, pkg._id, pkg);
  res.json({
    success: true,
    data: {
      packageId: pkg._id,
      bundleSize: pkg.bundleSize,
      fee,
      inStock: stock.inStock,
      processingHours: AFA_PROCESSING_HOURS,
      checkUssd: AFA_CHECK_USSD,
      walletBalance: wallet.balance,
    },
  });
}));

router.post('/afa/register', blockClientPricing, asyncHandler(async (req: AgentApiRequest, res) => {
  const { phone, email, fullName, ghanaCard, location, occupation } = req.body;
  if (!email || !String(email).trim()) throw new AppError('Email is required');
  const pkg = await getAfaPackage();
  if (!pkg) throw new AppError('AFA registration is not available', 503);

  const order = await createOrder({
    packageId: pkg._id.toString(),
    afaDetails: { fullName, phone, ghanaCard, location, occupation },
    customerEmail: String(email).trim().toLowerCase(),
    agentId: req.user!._id.toString(),
    source: 'agent_api',
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

router.get('/checker', asyncHandler(async (req: AgentApiRequest, res) => {
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

router.post('/checker/purchase', blockClientPricing, asyncHandler(async (req: AgentApiRequest, res) => {
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
    source: 'agent_api',
  });

  res.status(201).json({
    success: true,
    data: {
      orderId: order.orderId,
      status: order.status,
      type: order.checkerDetails?.type,
      bundleSize: order.bundleSize,
      serial: order.checkerDetails?.serial,
      pin: order.checkerDetails?.pin,
      message:
        'Checker delivered. Serial and PIN were sent to the customer email and phone SMS.',
    },
  });
}));

// Bulk purchase
router.post('/bulk-purchase', asyncHandler(async (req: AgentApiRequest, res) => {
  const { lines, network } = req.body;
  if (!lines || !network) throw new AppError('lines and network required');

  const parsedLines = (lines as string)
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean)
    .map((line: string) => {
      const [phone, bundle] = line.split(/\s+/);
      return { phone, bundleSize: bundle };
    });

  const { validated } = await validateBulkOrders(parsedLines, network, req.user!._id.toString());
  const orders = await processBulkOrders(validated, req.user!._id.toString(), 'agent_api');

  res.status(201).json({
    success: true,
    data: orders.map((order) => serializeAgentApiOrder(order)),
  });
}));

// Order status
router.get('/orders/:orderId', asyncHandler(async (req: AgentApiRequest, res) => {
  const order = await Order.findOne({
    orderId: req.params.orderId,
    agentId: req.user!._id,
  });
  if (!order) throw new AppError('Order not found', 404);
  res.json({
    success: true,
    data: serializeAgentApiOrder(order),
  });
}));

export default router;
