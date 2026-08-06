import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { User, UserRole, AgentApiApprovalStatus } from '../models/User';
import { getDateRanges } from '../utils/helpers';

function rankLabel(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

export async function getPerformanceLeaderboard(
  role: 'agent' | 'reseller',
  limit = 10
) {
  const field = role === 'agent' ? 'agentId' : 'resellerId';
  const { startOfMonth } = getDateRanges();

  const rows = await Order.aggregate([
    {
      $match: {
        status: { $nin: ['failed', 'cancelled', 'refunded'] },
        createdAt: { $gte: startOfMonth },
        [field]: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: `$${field}`,
        orderCount: { $sum: 1 },
        revenue: { $sum: '$sellingPrice' },
        platformProfit: { $sum: { $ifNull: ['$platformProfit', 0] } },
      },
    },
    { $sort: { orderCount: -1, revenue: -1 } },
    { $limit: limit },
  ]);

  const userIds = rows.map((r) => r._id);
  const users = await User.find({ _id: { $in: userIds } }).select('fullName email phone role');
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return rows.map((row, index) => {
    const user = userMap.get(row._id.toString());
    return {
      rank: index + 1,
      rankLabel: rankLabel(index + 1),
      userId: row._id,
      fullName: user?.fullName || 'Unknown',
      email: user?.email,
      orderCount: row.orderCount,
      revenue: row.revenue,
      platformProfit: row.platformProfit,
    };
  });
}

export async function getUserPerformanceRank(
  userId: mongoose.Types.ObjectId | string,
  role: UserRole
) {
  if (role !== 'agent' && role !== 'reseller') {
    return null;
  }

  const field = role === 'agent' ? 'agentId' : 'resellerId';
  const { startOfMonth } = getDateRanges();
  const id = userId.toString();

  const leaderboard = await Order.aggregate([
    {
      $match: {
        status: { $nin: ['failed', 'cancelled', 'refunded'] },
        createdAt: { $gte: startOfMonth },
        [field]: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: `$${field}`,
        orderCount: { $sum: 1 },
        revenue: { $sum: '$sellingPrice' },
      },
    },
    { $sort: { orderCount: -1, revenue: -1 } },
  ]);

  const index = leaderboard.findIndex((row) => row._id.toString() === id);
  if (index === -1) {
    return {
      rank: null,
      rankLabel: null,
      orderCount: 0,
      message: 'No delivered orders this month yet',
    };
  }

  const rank = index + 1;
  return {
    rank,
    rankLabel: rankLabel(rank),
    orderCount: leaderboard[index].orderCount,
    totalRanked: leaderboard.length,
  };
}

export function firstNameFromFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'User';
  return trimmed.split(/\s+/)[0];
}

export async function buildAuthUserProfile(user: {
  _id: mongoose.Types.ObjectId;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  status: string;
  resellerStore?: unknown;
  agentApi?: {
    approvalStatus?: AgentApiApprovalStatus;
    isActive: boolean;
  };
}) {
  const performance =
    user.role === 'agent' || user.role === 'reseller'
      ? await getUserPerformanceRank(user._id, user.role)
      : null;

  return {
    id: user._id,
    fullName: user.fullName,
    firstName: firstNameFromFullName(user.fullName),
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    resellerStore: user.resellerStore,
    agentApi: user.agentApi,
    performance,
  };
}
