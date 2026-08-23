/** Display order for data networks on reseller stores. */
export const STORE_NETWORK_ORDER = ['MTN', 'MTN Express', 'Telecel', 'AirtelTigo'] as const;

export type StoreServiceRow = {
  network: string;
  imageUrl: string;
  isAvailable: boolean;
};

/** One card per network, in platform order (MTN → MTN Express → Telecel → AirtelTigo). */
export function normalizeStoreServices(rows: StoreServiceRow[]): StoreServiceRow[] {
  const byNetwork = new Map<string, StoreServiceRow>();
  for (const row of rows) {
    if (!STORE_NETWORK_ORDER.includes(row.network as (typeof STORE_NETWORK_ORDER)[number])) continue;
    byNetwork.set(row.network, row);
  }
  return STORE_NETWORK_ORDER.flatMap((network) => {
    const row = byNetwork.get(network);
    return row ? [row] : [];
  });
}
