export type GhanaNetwork = 'MTN' | 'Telecel' | 'AirtelTigo';

/** Ghana mobile prefixes by network (local 0XXXXXXXXX format). */
export const NETWORK_PHONE_PREFIXES: Record<GhanaNetwork, readonly string[]> = {
  MTN: ['024', '025', '053', '054', '055', '059'],
  Telecel: ['020', '050'],
  AirtelTigo: ['026', '027', '056', '057'],
};

export function getNetworkPhonePrefixes(network: string): readonly string[] | undefined {
  return NETWORK_PHONE_PREFIXES[network as GhanaNetwork];
}

export function networkPhoneHint(network: string): string {
  const prefixes = getNetworkPhonePrefixes(network);
  if (!prefixes?.length) return '0XXXXXXXXX';
  return prefixes.join(', ');
}

export function networkPhonePlaceholder(network: string): string {
  const prefixes = getNetworkPhonePrefixes(network);
  return prefixes?.[0] ? `${prefixes[0]}XXXXXXX` : '0XXXXXXXXX';
}

export function isPhoneMatchingNetwork(phone: string, network: string): boolean {
  if (!/^0\d{9}$/.test(phone)) return false;
  const prefixes = getNetworkPhonePrefixes(network);
  if (!prefixes) return true;
  return prefixes.some((prefix) => phone.startsWith(prefix));
}

export function validateNetworkPhone(phone: string, network: string): string | null {
  if (!phone.trim()) return null;
  if (!/^0\d{9}$/.test(phone)) return 'Phone must be 10 digits starting with 0';
  if (!isPhoneMatchingNetwork(phone, network)) {
    return `Enter a valid ${network} number (starts with ${networkPhoneHint(network)})`;
  }
  return null;
}
