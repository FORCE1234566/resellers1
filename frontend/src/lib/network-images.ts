export const NETWORK_IMAGES: Record<string, string> = {
  MTN: '/images/mtn.jpg',
  'MTN Express': '/images/mtn.jpg',
  Telecel: '/images/telecel.jpg',
  AirtelTigo: '/images/airteltigo.jpg',
};

export function getNetworkImage(network: string): string | undefined {
  return NETWORK_IMAGES[network] ?? NETWORK_IMAGES[network.split(' ')[0]];
}
