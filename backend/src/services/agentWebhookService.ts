import crypto from 'crypto';
import axios from 'axios';
import { User } from '../models/User';
import { IOrder } from '../models/Order';
import { getNetworkApiMeta, getPurchasedNetwork } from './agentApiOrderSerializer';

export type AgentWebhookEvent =
  | 'order.status_updated'
  | 'order.delivered'
  | 'order.failed'
  | 'order.cancelled'
  | 'order.refunded';

function parseWebhookUrls(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u))
    ),
  ];
}

function resolveEvent(status: string): AgentWebhookEvent {
  if (status === 'delivered') return 'order.delivered';
  if (status === 'failed') return 'order.failed';
  if (status === 'cancelled') return 'order.cancelled';
  if (status === 'refunded') return 'order.refunded';
  return 'order.status_updated';
}

function buildPayload(order: IOrder, event: AgentWebhookEvent) {
  const purchasedNetwork = getPurchasedNetwork(order);
  const purchasedMeta = getNetworkApiMeta(purchasedNetwork);
  const currentMeta = getNetworkApiMeta(order.network);
  return {
    event,
    orderId: order.orderId,
    status: order.status,
    providerStatus: order.providerStatus || null,
    recipientPhone: order.recipientPhone,
    network: order.network,
    networkLabel: currentMeta?.label || order.network,
    networkCode: currentMeta?.code || String(order.network).toLowerCase().replace(/\s+/g, '_'),
    purchasedNetwork,
    purchasedNetworkLabel: purchasedMeta?.label || purchasedNetwork,
    purchasedNetworkCode:
      purchasedMeta?.code || String(purchasedNetwork).toLowerCase().replace(/\s+/g, '_'),
    originalNetwork: order.originalNetwork || null,
    expressFallbackToMtn: Boolean(order.expressFallbackToMtn),
    bundleSize: order.bundleSize,
    sellingPrice: order.sellingPrice,
    productType: order.productType || 'data',
    source: order.source,
    providerReference: order.providerReference || null,
    updatedAt: order.updatedAt,
    createdAt: order.createdAt,
  };
}

function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function postToUrl(
  webhookUrl: string,
  payload: Record<string, unknown>,
  secret?: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'TopDealsGH-AgentWebhook/1.0',
    'X-TopDeals-Event': String(payload.event || 'order.status_updated'),
  };
  if (secret) {
    headers['X-TopDeals-Signature'] = `sha256=${signBody(body, secret)}`;
  }

  await axios.post(webhookUrl, body, {
    timeout: 8000,
    headers,
    // body already stringified so axios does not re-encode / change the signature base
    transformRequest: [(data) => data],
  });
}

/**
 * Push order status updates to every webhook URL configured on the owning agent.
 * Supports multiple sites (one URL per line) on agentApi.webhookUrl.
 */
export async function notifyagentWebhook(
  order: IOrder,
  options?: { prevStatus?: string; prevProviderStatus?: string | null }
): Promise<void> {
  if (!order.agentId) return;

  // Notify for Agent API and dashboard agent orders (connected websites use the agent account).
  if (order.source && !['agent_api', 'agent'].includes(order.source)) return;

  const statusChanged =
    options?.prevStatus === undefined || options.prevStatus !== order.status;
  const providerChanged =
    options?.prevProviderStatus === undefined ||
    options.prevProviderStatus !== (order.providerStatus || null);

  if (!statusChanged && !providerChanged) return;

  try {
    const dealer = await User.findById(order.agentId).select(
      '+agentApi.secretKey agentApi.webhookUrl agentApi.isActive'
    );
    if (!dealer?.agentApi?.isActive) return;

    const urls = parseWebhookUrls(dealer.agentApi.webhookUrl);
    if (urls.length === 0) return;

    const event = resolveEvent(order.status);
    const payload = buildPayload(order, event);
    const secret = dealer.agentApi.secretKey || undefined;

    await Promise.allSettled(
      urls.map(async (url) => {
        try {
          await postToUrl(url, payload, secret);
        } catch (err) {
          console.error(
            '[agent webhook]',
            order.orderId,
            url,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  } catch (err) {
    console.error(
      'Agent webhook delivery failed:',
      order.orderId,
      err instanceof Error ? err.message : err
    );
  }
}
