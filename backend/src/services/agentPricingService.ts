import mongoose from 'mongoose';
import { Package, IPackage } from '../models/Package';
import { User, IUser, IAgentApi } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { validatePackagePrices } from './settingsService';

function readCustomPriceMap(
  prices: Map<string, number> | Record<string, number> | undefined | null,
  packageId: string
): number | undefined {
  if (!prices) return undefined;
  if (prices instanceof Map) {
    const value = prices.get(packageId);
    return value == null ? undefined : Number(value);
  }
  const value = (prices as Record<string, number>)[packageId];
  return value == null ? undefined : Number(value);
}

export function getStoredAgentCustomPrice(
  agent: Pick<IUser, 'agentApi'>,
  packageId: mongoose.Types.ObjectId | string
): number | undefined {
  return readCustomPriceMap(agent.agentApi?.customPrices as Map<string, number> | undefined, packageId.toString());
}

function ensureAgentApiStub(agent: IUser): IAgentApi {
  if (!agent.agentApi) {
    agent.agentApi = {
      ipWhitelist: [],
      isActive: false,
      approvalStatus: 'none',
      customPrices: new Map(),
    };
  }
  if (!agent.agentApi.customPrices) {
    agent.agentApi.customPrices = new Map();
  }
  return agent.agentApi;
}

export async function getAgentPrice(
  agentId: mongoose.Types.ObjectId | string,
  packageId: mongoose.Types.ObjectId | string,
  pkg: Pick<IPackage, 'agentPrice'>
): Promise<number> {
  const agent = await User.findById(agentId);
  if (!agent?.agentApi?.customPrices) return pkg.agentPrice;

  const customPrice = getStoredAgentCustomPrice(agent, packageId);
  return customPrice ?? pkg.agentPrice;
}

export function validateAgentCustomPrice(
  price: number,
  pkg: Pick<IPackage, 'costPrice' | 'maxSellingPrice'>
): void {
  validatePackagePrices({
    costPrice: pkg.costPrice,
    agentPrice: price,
    maxSellingPrice: pkg.maxSellingPrice,
  });
  if (price > pkg.maxSellingPrice) {
    throw new AppError('Agent price cannot exceed max selling price');
  }
}

export async function setAgentCustomPrice(
  agentId: string,
  packageId: string,
  price: number | null
): Promise<void> {
  const [agent, pkg] = await Promise.all([
    User.findOne({ _id: agentId, role: 'agent' }),
    Package.findById(packageId),
  ]);

  if (!agent) throw new AppError('Agent not found', 404);
  if (!pkg) throw new AppError('Package not found', 404);

  const agentApi = ensureAgentApiStub(agent);

  if (price === null) {
    agentApi.customPrices!.delete(packageId);
  } else {
    validateAgentCustomPrice(price, pkg);
    agentApi.customPrices!.set(packageId, price);
  }

  agent.markModified('agentApi');
  agent.markModified('agentApi.customPrices');
  await agent.save();
}

export async function clearAgentCustomPrices(agentId: string): Promise<number> {
  const agent = await User.findOne({ _id: agentId, role: 'agent' });
  if (!agent) throw new AppError('Agent not found', 404);
  if (!agent.agentApi?.customPrices) return 0;

  const count =
    agent.agentApi.customPrices instanceof Map
      ? agent.agentApi.customPrices.size
      : Object.keys(agent.agentApi.customPrices as unknown as Record<string, number>).length;
  agent.agentApi.customPrices = new Map();
  agent.markModified('agentApi.customPrices');
  await agent.save();
  return count;
}
