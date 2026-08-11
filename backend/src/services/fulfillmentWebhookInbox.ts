import { Setting } from '../models/Setting';

export type FulfillmentWebhookInboxEntry = {
  at: string;
  path?: string;
  matched: boolean;
  orderId?: string | null;
  status?: string;
  refs: string[];
  phones: string[];
  keys: string[];
  preview: string;
  note?: string;
};

const MAX_ENTRIES = 25;

/**
 * Persist recent SDH/fulfillment webhook deliveries so admin can see whether
 * Smart Data Hub is reaching us and whether orders matched.
 */
export async function recordFulfillmentWebhookDelivery(
  entry: FulfillmentWebhookInboxEntry
): Promise<void> {
  try {
    const doc = await Setting.findOne();
    if (!doc) return;
    const current = ((doc as unknown as { fulfillmentWebhookInbox?: FulfillmentWebhookInboxEntry[] })
      .fulfillmentWebhookInbox || []) as FulfillmentWebhookInboxEntry[];
    const next = [entry, ...current].slice(0, MAX_ENTRIES);
    (doc as unknown as { fulfillmentWebhookInbox?: FulfillmentWebhookInboxEntry[] }).fulfillmentWebhookInbox =
      next;
    doc.markModified('fulfillmentWebhookInbox');
    await doc.save();
  } catch (err) {
    console.warn(
      '[webhook inbox] failed to persist',
      err instanceof Error ? err.message : err
    );
  }
}

export async function getFulfillmentWebhookInbox(): Promise<FulfillmentWebhookInboxEntry[]> {
  const doc = await Setting.findOne().lean();
  if (!doc) return [];
  const inbox = (doc as { fulfillmentWebhookInbox?: FulfillmentWebhookInboxEntry[] })
    .fulfillmentWebhookInbox;
  return Array.isArray(inbox) ? inbox : [];
}
