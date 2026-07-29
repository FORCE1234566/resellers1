import { Network } from '../models/Package';
import { FulfillmentProvider } from '../models/Setting';

/** Datamax MTN Express (MTNUP2U) dealer/API cost prices — GHS */
export const DATAMAX_MTN_EXPRESS_COSTS: Record<string, number> = {
  '1GB': 3.55,
  '2GB': 7.1,
  '3GB': 10.7,
  '4GB': 14.3,
  '5GB': 17.78,
  '6GB': 21.3,
  '8GB': 28.5,
  '10GB': 35.5,
  '15GB': 53.5,
  '20GB': 71.0,
  '25GB': 88.8,
  '30GB': 106.7,
  '40GB': 143.0,
  '50GB': 177.5,
};

/** Smart Data Hub MTN API cost prices — GHS (from SDH package list) */
export const SMART_DATA_HUB_MTN_COSTS: Record<string, number> = {
  '1GB': 4.1,
  '2GB': 8.2,
  '3GB': 12.3,
  '4GB': 16.4,
  '5GB': 20.5,
  '6GB': 24.6,
  '8GB': 32.8,
  '10GB': 38.5,
  '15GB': 57.7,
  '20GB': 77.0,
  '25GB': 96.2,
  '30GB': 115.5,
  '40GB': 154.0,
  '50GB': 192.5,
};

/** Smart Data Hub Telecel (Vodafone) API cost prices — GHS */
export const SMART_DATA_HUB_TELECEL_COSTS: Record<string, number> = {
  '10GB': 38.0,
  '15GB': 56.0,
  '20GB': 76.0,
  '25GB': 96.0,
  '30GB': 112.0,
  '35GB': 134.0,
  '40GB': 151.0,
  '45GB': 173.0,
  '50GB': 193.0,
  '100GB': 355.0,
  '150GB': 535.0,
};

export function normalizeBundleSizeKey(bundleSize: string): string {
  const trimmed = bundleSize.trim().toUpperCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*GB$/);
  if (match) return `${match[1]}GB`;
  return trimmed;
}

export function getDatamaxMtnExpressCost(bundleSize: string): number | null {
  const key = normalizeBundleSizeKey(bundleSize);
  return DATAMAX_MTN_EXPRESS_COSTS[key] ?? null;
}

export function getSmartDataHubMtnCost(bundleSize: string): number | null {
  const key = normalizeBundleSizeKey(bundleSize);
  return SMART_DATA_HUB_MTN_COSTS[key] ?? null;
}

export function getSmartDataHubTelecelCost(bundleSize: string): number | null {
  const key = normalizeBundleSizeKey(bundleSize);
  return SMART_DATA_HUB_TELECEL_COSTS[key] ?? null;
}

export function resolveOrderApiCost(input: {
  network: Network;
  bundleSize: string;
  costPrice: number;
  fulfillmentProvider: FulfillmentProvider | null;
  isAfa: boolean;
}): number {
  if (!input.fulfillmentProvider) {
    return input.costPrice;
  }
  if (input.isAfa) {
    return input.costPrice;
  }
  if (input.fulfillmentProvider === 'smartdatahub') {
    if (input.network === 'MTN') {
      return getSmartDataHubMtnCost(input.bundleSize) ?? input.costPrice;
    }
    if (input.network === 'Telecel') {
      return getSmartDataHubTelecelCost(input.bundleSize) ?? input.costPrice;
    }
  }
  if (input.fulfillmentProvider === 'datamax' && input.network === 'MTN') {
    return getDatamaxMtnExpressCost(input.bundleSize) ?? input.costPrice;
  }
  return input.costPrice;
}
