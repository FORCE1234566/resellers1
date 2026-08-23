import { AppError } from '../middleware/errorHandler';
import { Network } from '../models/Package';
import { assertNetworkPhone } from '../utils/phone';
import {
  isSmartDataHubConfigured,
  verifySmartDataHubMtnExpressNumber,
} from './smartDataHubClient';

export const MTN_EXPRESS_NETWORK: Network = 'MTN Express';
export const MTN_EXPRESS_NOT_VERIFIED = 'MTN_EXPRESS_NOT_VERIFIED';

export function isMtnExpressNetwork(network: string | undefined | null): boolean {
  return network === MTN_EXPRESS_NETWORK;
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

export async function checkMtnExpressNumber(rawPhone: string): Promise<{
  verified: boolean;
  phone: string;
  message?: string;
  code?: string;
}> {
  const phone = assertNetworkPhone(rawPhone, MTN_EXPRESS_NETWORK);

  if (!isSmartDataHubConfigured()) {
    return {
      verified: false,
      phone,
      message: 'MTN Express verification is temporarily unavailable. Please try again shortly.',
    };
  }

  const result = await verifySmartDataHubMtnExpressNumber(phone);
  if (!result.verified) {
    return {
      verified: false,
      phone,
      message: result.message || 'This number is not verified to buy MTN Express.',
      code: MTN_EXPRESS_NOT_VERIFIED,
    };
  }

  return { verified: true, phone };
}
