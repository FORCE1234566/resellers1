import { AppError } from '../middleware/errorHandler';
import { Network } from '../models/Package';
import { assertNetworkPhone } from '../utils/phone';
import {
  isSmartDataHubConfigured,
  verifySmartDataHubMtnExpressNumber,
} from './smartDataHubClient';

export const MTN_EXPRESS_NETWORK: Network = 'MTN Express';
export const MTN_EXPRESS_NOT_VERIFIED = 'MTN_EXPRESS_NOT_VERIFIED';
export const MTN_EXPRESS_FALLBACK_NETWORK: Network = 'MTN';

export type MtnExpressVerifyResult = {
  verified: boolean;
  phone: string;
  message?: string;
  code?: string;
  /** When rejected, websites should offer this network instead. */
  fallbackNetwork?: Network;
  /** Short copy agents can show on their website. */
  websiteMessage?: string;
};

export function isMtnExpressNetwork(network: string | undefined | null): boolean {
  return network === MTN_EXPRESS_NETWORK;
}

function notVerifiedPayload(phone: string, message?: string): MtnExpressVerifyResult {
  return {
    verified: false,
    phone,
    message: message || 'This number is not verified to buy MTN Express.',
    code: MTN_EXPRESS_NOT_VERIFIED,
    fallbackNetwork: MTN_EXPRESS_FALLBACK_NETWORK,
    websiteMessage:
      'This number is not verified for MTN Express. Offer normal MTN data instead.',
  };
}

export async function assertMtnExpressNumberVerified(rawPhone: string): Promise<string> {
  const phone = assertNetworkPhone(rawPhone, MTN_EXPRESS_NETWORK);

  if (!isSmartDataHubConfigured()) {
    throw new AppError(
      'MTN Express verification is temporarily unavailable. Please try again shortly.',
      503
    );
  }

  const result = await verifySmartDataHubMtnExpressNumber(phone);
  if (!result.verified) {
    throw new AppError(
      result.message || 'This number is not verified to buy MTN Express.',
      400,
      MTN_EXPRESS_NOT_VERIFIED
    );
  }

  return phone;
}

export async function checkMtnExpressNumber(rawPhone: string): Promise<MtnExpressVerifyResult> {
  const phone = assertNetworkPhone(rawPhone, MTN_EXPRESS_NETWORK);

  if (!isSmartDataHubConfigured()) {
    return {
      verified: false,
      phone,
      message: 'MTN Express verification is temporarily unavailable. Please try again shortly.',
      websiteMessage:
        'MTN Express verification is temporarily unavailable. Please try again shortly.',
    };
  }

  const result = await verifySmartDataHubMtnExpressNumber(phone);
  if (!result.verified) {
    return notVerifiedPayload(phone, result.message);
  }

  return { verified: true, phone };
}
