import { Network } from '../models/Package';
import { IOrder } from '../models/Order';

export type NetworkApiMeta = {
  network: Network;
  /** Short display name for websites */
  label: string;
  /** Stable machine code (mtn, mtn_express, …) */
  code: string;
  /** One-line explanation for agent websites */
  description: string;
};

const NETWORK_API_META: Record<Network, Omit<NetworkApiMeta, 'network'>> = {
  MTN: {
    label: 'MTN (normal)',
    code: 'mtn',
    description: 'Standard MTN data. Orders stay on normal MTN and never switch to Express.',
  },
  'MTN Express': {
    label: 'MTN Express',
    code: 'mtn_express',
    description:
      'MTN Express packages. If the provider rejects Express, fulfillment auto-switches to normal MTN.',
  },
  Telecel: {
    label: 'Telecel',
    code: 'telecel',
    description: 'Telecel (Vodafone) data packages.',
  },
  AirtelTigo: {
    label: 'AirtelTigo',
    code: 'airteltigo',
    description: 'AirtelTigo data packages.',
  },
};

export function getNetworkApiMeta(network: string | undefined | null): NetworkApiMeta | null {
  if (!network) return null;
  const meta = NETWORK_API_META[network as Network];
  if (!meta) {
    return {
      network: network as Network,
      label: network,
      code: String(network).toLowerCase().replace(/\s+/g, '_'),
      description: '',
    };
  }
  return { network: network as Network, ...meta };
}

/** Network the customer originally purchased (Express stays Express even after MTN fallback). */
export function getPurchasedNetwork(order: Pick<IOrder, 'network' | 'originalNetwork'>): string {
  return order.originalNetwork || order.network;
}

export function serializeAgentApiOrder(order: IOrder) {
  const purchasedNetwork = getPurchasedNetwork(order);
  const purchasedMeta = getNetworkApiMeta(purchasedNetwork);
  const currentMeta = getNetworkApiMeta(order.network);
  const expressFallbackToMtn = Boolean(order.expressFallbackToMtn);

  return {
    orderId: order.orderId,
    /** Current fulfillment network (may become MTN after Express fallback). */
    network: order.network,
    networkLabel: currentMeta?.label || order.network,
    networkCode: currentMeta?.code || String(order.network).toLowerCase().replace(/\s+/g, '_'),
    /** Network the buyer selected at purchase time. */
    purchasedNetwork,
    purchasedNetworkLabel: purchasedMeta?.label || purchasedNetwork,
    purchasedNetworkCode:
      purchasedMeta?.code || String(purchasedNetwork).toLowerCase().replace(/\s+/g, '_'),
    originalNetwork: order.originalNetwork || null,
    expressFallbackToMtn,
    productType: order.productType,
    bundleSize: order.bundleSize,
    recipientPhone: order.recipientPhone,
    customerEmail: order.customerEmail,
    sellingPrice: order.sellingPrice,
    totalAmount: order.totalAmount,
    status: order.status,
    providerStatus: order.providerStatus || null,
    source: order.source,
    checkerDetails: order.checkerDetails || undefined,
    afaDetails: order.afaDetails || undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
