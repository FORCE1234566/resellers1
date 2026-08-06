import mongoose from 'mongoose';
import { Order, OrderSource } from '../models/Order';
import { getDateRanges, roundMoney } from '../utils/helpers';
import { getSettings } from './settingsService';
import { computeAdminOrderProfit } from './profitFormulas';

/**
 * Platform earnings per delivered order = base price − Smart Data API cost.
 * Dealer orders use dealer price; reseller store orders use reseller base price.
 */
export function computePlatformProfit(input: { basePrice: number; apiCost: number }) {
  const platformProfit = computeAdminOrderProfit(input.basePrice, input.apiCost);
  return {
    basePrice: input.basePrice,
    apiCost: input.apiCost,
    platformProfit,
  };
}

export async function snapshotPlatformProfitForOrder(input: {
  source: OrderSource;
  basePrice: number;
  apiCost: number;
  totalAmount: number;
}) {
  const settings = await getSettings();
  const paystackFee =
    input.source === 'reseller_store'
      ? roundMoney(input.totalAmount * (settings.paystackChargePercent / 100))
      : 0;
  const { platformProfit, apiCost } = computePlatformProfit({
    basePrice: input.basePrice,
    apiCost: input.apiCost,
  });
  return { paystackFee, platformProfit, apiCost };
}

type ProfitScope = {
  agentId?: mongoose.Types.ObjectId | string;
  resellerId?: mongoose.Types.ObjectId | string;
};

function profitMatch(scope: ProfitScope = {}, fromDate?: Date) {
  // Count interest as soon as the order is received; drop only terminal failures.
  const match: Record<string, unknown> = {
    status: { $nin: ['failed', 'cancelled', 'refunded'] },
    ...scope,
  };
  if (scope.agentId) match.agentId = scope.agentId;
  if (scope.resellerId) match.resellerId = scope.resellerId;
  if (fromDate) match.createdAt = { $gte: fromDate };
  return match;
}

export async function getPlatformProfitTotals(scope: ProfitScope = {}) {
  const { startOfToday } = getDateRanges();
  const baseMatch = profitMatch(scope);

  const [lifetime, today] = await Promise.all([
    Order.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: '$platformProfit' },
          apiCost: { $sum: '$costPrice' },
          orders: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate([
      { $match: profitMatch(scope, startOfToday) },
      {
        $group: {
          _id: null,
          total: { $sum: '$platformProfit' },
          apiCost: { $sum: '$costPrice' },
          orders: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    totalPlatformProfit: lifetime[0]?.total || 0,
    platformProfitToday: today[0]?.total || 0,
    totalApiCostDeducted: lifetime[0]?.apiCost || 0,
    apiCostToday: today[0]?.apiCost || 0,
    deliveredOrdersToday: today[0]?.orders || 0,
    ordersCountedToday: today[0]?.orders || 0,
  };
}
