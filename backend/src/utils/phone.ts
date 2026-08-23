import { AppError } from '../middleware/errorHandler';
import { isValidGhanaPhone } from './helpers';
import { Network } from '../models/Package';

/** Ghana mobile prefixes by network (local 0XXXXXXXXX format). */
export const NETWORK_PHONE_PREFIXES: Record<Network, readonly string[]> = {
  MTN: ['024', '025', '053', '054', '055', '059'],
  'MTN Express': ['024', '025', '053', '054', '055', '059'],
  Telecel: ['020', '050'],
  AirtelTigo: ['026', '027', '056', '057'],
};

/** Normalize to local Ghana format 0XXXXXXXXX. */
export function normalizeGhanaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }
  if (digits.length === 9) {
    return `0${digits}`;
  }
  throw new AppError('Enter a valid Ghana phone number (e.g. 0241234567)');
}

export function assertGhanaPhone(raw: string): string {
  const phone = normalizeGhanaPhone(raw);
  if (!isValidGhanaPhone(phone)) {
    throw new AppError('Enter a valid Ghana phone number (e.g. 0241234567)');
  }
  return phone;
}

export function getNetworkPhonePrefixes(network: string): readonly string[] | undefined {
  return NETWORK_PHONE_PREFIXES[network as Network];
}

export function isPhoneMatchingNetwork(phone: string, network: string): boolean {
  const prefixes = getNetworkPhonePrefixes(network);
  if (!prefixes) return isValidGhanaPhone(phone);
  return prefixes.some((prefix) => phone.startsWith(prefix));
}

export function networkPhoneHint(network: string): string {
  const prefixes = getNetworkPhonePrefixes(network);
  if (!prefixes?.length) return '0XXXXXXXXX';
  return prefixes.join(', ');
}

/** Normalize and ensure the number belongs to the selected network. */
export function assertNetworkPhone(raw: string, network: string): string {
  const phone = assertGhanaPhone(raw);
  if (!isPhoneMatchingNetwork(phone, network)) {
    throw new AppError(
      `Enter a valid ${network} number (starts with ${networkPhoneHint(network)})`
    );
  }
  return phone;
}
