import { Network } from '../models/Package';
import { AppError } from '../middleware/errorHandler';
import { getSettings } from './settingsService';

export const STOCK_NETWORKS: Network[] = ['MTN', 'MTN Express', 'Telecel', 'AirtelTigo'];

const defaultImage: Record<Network, string> = {
  MTN: '/images/mtn.jpg',
  'MTN Express': '/images/mtn-express.png',
  Telecel: '/images/telecel.jpg',
  AirtelTigo: '/images/airteltigo.jpg',
};

export type NetworkStockRow = {
  network: Network;
  inStock: boolean;
  imageUrl: string;
};

export async function getNetworkStockList(): Promise<NetworkStockRow[]> {
  const settings = await getSettings();
  return STOCK_NETWORKS.map((network) => {
    const entry = settings.serviceImages.find((s) => s.network === network);
    return {
      network,
      inStock: entry?.isAvailable ?? true,
      imageUrl: entry?.imageUrl || defaultImage[network],
    };
  });
}

export async function isNetworkInStock(network: string): Promise<boolean> {
  const settings = await getSettings();
  const entry = settings.serviceImages.find((s) => s.network === network);
  return entry?.isAvailable ?? true;
}

export async function assertNetworkInStock(network: string): Promise<void> {
  if (!(await isNetworkInStock(network))) {
    throw new AppError(`${network} data is currently out of stock. Please try again later.`, 503);
  }
}

export async function setNetworkStock(network: Network, inStock: boolean): Promise<NetworkStockRow[]> {
  if (!STOCK_NETWORKS.includes(network)) {
    throw new AppError('Invalid network');
  }

  const settings = await getSettings();
  const idx = settings.serviceImages.findIndex((s) => s.network === network);
  if (idx >= 0) {
    settings.serviceImages[idx].isAvailable = inStock;
  } else {
    settings.serviceImages.push({
      network,
      imageUrl: defaultImage[network],
      isAvailable: inStock,
    });
  }
  settings.markModified('serviceImages');
  await settings.save();
  return getNetworkStockList();
}

export async function getInStockNetworks(): Promise<Network[]> {
  const list = await getNetworkStockList();
  return list.filter((row) => row.inStock).map((row) => row.network);
}
