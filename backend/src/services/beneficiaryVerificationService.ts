import { IOrder } from '../models/Order';
import { User } from '../models/User';
import {
  BeneficiaryVerification,
  BeneficiaryVerificationStatus,
} from '../models/BeneficiaryVerification';
import { normalizeGhanaPhone } from '../utils/phone';
import { sendMtnNumberVerificationEmail } from '../utils/email';
import { sendMtnVerificationSms } from './smsService';

/** MTN first-time numbers can take up to a week to verify. */
export const BENEFICIARY_VERIFICATION_DAYS = 7;
/** SDH "pending" must stay this long (during Ghana daytime) before verification + SMS. */
export const PENDING_VERIFICATION_EMAIL_DELAY_MS = 3 * 60 * 60 * 1000;
/** Ghana local hour when daytime verification promotion may run (inclusive). */
export const VERIFICATION_DAY_START_HOUR = 7;
/** Ghana local hour when daytime verification promotion stops (exclusive) — 21 = 9pm. */
export const VERIFICATION_DAY_END_HOUR = 21;
export const SUBMITTED_FOR_VERIFICATION = 'submitted_for_verification';
export const VERIFIED_PROVIDER_STATUS = 'verified';
export const GHANA_TIME_ZONE = 'Africa/Accra';

const VERIFICATION_TRIGGER_STATUSES = new Set([
  'exported',
  'extracted',
  'submitted_for_verification',
  'awaiting_verification',
  'verification_pending',
  'unverified',
]);

/** Current hour (0–23) in Ghana (Africa/Accra, no DST). */
export function getGhanaHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: GHANA_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const raw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/**
 * Verification promotion runs only 7:00–20:59 Ghana time.
 * From 9pm to 7am, SDH pending orders stay pending (no submitted-for-verification).
 */
export function isGhanaVerificationDaytime(now: Date = new Date()): boolean {
  const hour = getGhanaHour(now);
  return hour >= VERIFICATION_DAY_START_HOUR && hour < VERIFICATION_DAY_END_HOUR;
}

/**
 * Immediate email triggers (exported / verification submission). Plain SDH "pending"
 * is intentionally excluded — see pending delay helpers below.
 */
export function isExportedStatus(raw?: string | null): boolean {
  if (!raw?.trim()) return false;
  const normalized = raw.toLowerCase().replace(/\s+/g, '_');
  return (
    normalized === 'exported' ||
    normalized === 'extracted' ||
    normalized === 'submitted_for_verification' ||
    normalized === 'awaiting_verification' ||
    normalized === 'verification_pending' ||
    normalized === 'unverified'
  );
}

/** Smart Data Hub delivery status exactly "pending" (not verification_pending). */
export function isPlainPendingStatus(raw?: string | null): boolean {
  if (!raw?.trim()) return false;
  return raw.toLowerCase().replace(/\s+/g, '_') === 'pending';
}

/**
 * Start of the current SDH pending streak from order history.
 * Used for the 3-hour daytime verification delay.
 */
export function getSdhPendingStartedAt(order: IOrder): Date | null {
  if (!isPlainPendingStatus(order.providerStatus)) return null;

  let streakStart: Date | null = null;
  for (const entry of order.statusHistory || []) {
    const step = String(entry.step || '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (step === 'pending') {
      if (!streakStart) streakStart = entry.at ? new Date(entry.at) : null;
    } else {
      streakStart = null;
    }
  }

  if (streakStart) return streakStart;
  if (order.updatedAt) return new Date(order.updatedAt);
  if (order.createdAt) return new Date(order.createdAt);
  return null;
}

export function shouldSendPendingVerificationEmail(
  order: IOrder,
  now: Date = new Date()
): boolean {
  if (!isPlainPendingStatus(order.providerStatus)) return false;
  if (String(order.network || '').toUpperCase() !== 'MTN') return false;
  // Overnight (9pm–7am Ghana): leave pending; do not mark submitted for verification.
  if (!isGhanaVerificationDaytime(now)) return false;
  const started = getSdhPendingStartedAt(order);
  if (!started) return false;
  return now.getTime() - started.getTime() >= PENDING_VERIFICATION_EMAIL_DELAY_MS;
}

export function normalizeBeneficiaryPhone(phone: string): string {
  try {
    return normalizeGhanaPhone(phone);
  } catch {
    return String(phone || '').replace(/\D/g, '').slice(-10);
  }
}

export function isBeneficiaryVerificationTriggerStatus(raw?: string | null): boolean {
  if (!raw?.trim()) return false;
  return VERIFICATION_TRIGGER_STATUSES.has(raw.toLowerCase().replace(/\s+/g, '_'));
}

export function shouldPreserveSubmittedForVerification(
  currentProviderStatus?: string | null,
  incomingRawStatus?: string | null
): boolean {
  if (currentProviderStatus !== SUBMITTED_FOR_VERIFICATION) return false;
  const incoming = String(incomingRawStatus || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  return ![
    'delivered',
    'completed',
    'success',
    'successful',
    'failed',
    'error',
    'rejected',
    'cancelled',
    'canceled',
    'refunded',
    'verified',
  ].includes(incoming);
}

export async function isBeneficiaryVerified(
  phone: string,
  network: string
): Promise<boolean> {
  const normalized = normalizeBeneficiaryPhone(phone);
  const record = await BeneficiaryVerification.findOne({ phone: normalized, network });
  return record?.status === 'verified';
}

export async function resolveStoreOwnerEmail(order: IOrder): Promise<string | undefined> {
  if (!order.resellerId) return undefined;
  const reseller = await User.findById(order.resellerId)
    .select('email resellerStore.supportEmail')
    .lean();
  if (!reseller) return undefined;
  const accountEmail = String(reseller.email || '').trim().toLowerCase();
  const supportEmail = String(reseller.resellerStore?.supportEmail || '').trim().toLowerCase();
  return accountEmail || supportEmail || undefined;
}

export async function resolveAgentEmail(order: IOrder): Promise<string | undefined> {
  if (!order.agentId) return undefined;
  const agent = await User.findById(order.agentId).select('email').lean();
  if (!agent) return undefined;
  const email = String(agent.email || '').trim().toLowerCase();
  return email || undefined;
}

export async function markBeneficiarySubmittedForVerification(input: {
  phone: string;
  network: string;
  orderId: string;
  customerEmail?: string;
  storeOwnerEmail?: string;
  agentEmail?: string;
  sendEmail?: boolean;
  /** Admin manual update — send even if an email was already sent for this number. */
  forceEmail?: boolean;
}): Promise<{ status: BeneficiaryVerificationStatus; emailSent: boolean; smsSent: boolean }> {
  const phone = normalizeBeneficiaryPhone(input.phone);
  const notifyEmails = [...new Set(
    [input.customerEmail, input.storeOwnerEmail, input.agentEmail]
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean)
  )];

  const existing = await BeneficiaryVerification.findOne({ phone, network: input.network });
  if (existing?.status === 'verified') {
    let emailSent = false;
    let smsSent = false;
    if (input.forceEmail && input.sendEmail !== false && notifyEmails.length > 0) {
      try {
        await sendMtnNumberVerificationEmail(notifyEmails, {
          phone,
          orderId: input.orderId,
        });
        existing.verificationEmailSentAt = new Date();
        existing.lastOrderId = input.orderId;
        await existing.save();
        emailSent = true;
      } catch (err) {
        console.error(
          '[MTN verification email failed]',
          notifyEmails.join(', '),
          err instanceof Error ? err.message : err
        );
      }
    }
    if (input.forceEmail && input.sendEmail !== false) {
      try {
        await sendMtnVerificationSms(phone);
        smsSent = true;
      } catch (err) {
        console.error('[MTN verification SMS failed]', phone, err instanceof Error ? err.message : err);
      }
    }
    return { status: 'verified', emailSent, smsSent };
  }

  const now = new Date();
  const record =
    existing ||
    new BeneficiaryVerification({
      phone,
      network: input.network,
      status: 'submitted_for_verification',
      submittedAt: now,
    });

  if (!existing) {
    record.submittedAt = now;
  }
  record.status = 'submitted_for_verification';
  record.lastOrderId = input.orderId;

  let emailSent = false;
  let smsSent = false;
  const shouldNotify =
    input.sendEmail !== false &&
    (input.forceEmail === true || !record.verificationEmailSentAt);

  if (shouldNotify && notifyEmails.length > 0) {
    try {
      await sendMtnNumberVerificationEmail(notifyEmails, {
        phone,
        orderId: input.orderId,
      });
      record.verificationEmailSentAt = now;
      emailSent = true;
    } catch (err) {
      console.error(
        '[MTN verification email failed]',
        notifyEmails.join(', '),
        err instanceof Error ? err.message : err
      );
    }
  }

  if (shouldNotify) {
    try {
      await sendMtnVerificationSms(phone);
      if (!record.verificationEmailSentAt) {
        record.verificationEmailSentAt = now;
      }
      smsSent = true;
    } catch (err) {
      console.error('[MTN verification SMS failed]', phone, err instanceof Error ? err.message : err);
    }
  }

  await record.save();
  return { status: 'submitted_for_verification', emailSent, smsSent };
}

export async function markBeneficiaryVerified(
  phone: string,
  network: string,
  orderId?: string
): Promise<void> {
  const normalized = normalizeBeneficiaryPhone(phone);
  const now = new Date();
  await BeneficiaryVerification.findOneAndUpdate(
    { phone: normalized, network },
    {
      $set: {
        status: 'verified',
        verifiedAt: now,
        ...(orderId ? { lastOrderId: orderId } : {}),
      },
      $setOnInsert: {
        phone: normalized,
        network,
        submittedAt: now,
      },
    },
    { upsert: true }
  );
}

/** Auto-mark numbers submitted ≥ 7 days ago as verified (phone registry only). */
export async function autoVerifyAgedBeneficiaries(limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - BENEFICIARY_VERIFICATION_DAYS * 24 * 60 * 60 * 1000);
  const pending = await BeneficiaryVerification.find({
    status: 'submitted_for_verification',
    submittedAt: { $lte: cutoff },
  })
    .sort({ submittedAt: 1 })
    .limit(limit);

  let updated = 0;
  for (const record of pending) {
    record.status = 'verified';
    record.verifiedAt = new Date();
    await record.save();
    updated++;
  }

  return updated;
}

/** When an order entered submitted-for-verification (for the 1-week auto-deliver clock). */
export function getVerificationStartedAt(order: IOrder): Date | null {
  const history = [...(order.statusHistory || [])].reverse();
  for (const entry of history) {
    const step = String(entry.step || '').toLowerCase().replace(/\s+/g, '_');
    const label = String(entry.label || '').toLowerCase();
    if (
      step === SUBMITTED_FOR_VERIFICATION ||
      step === 'exported' ||
      step === 'extracted' ||
      label.includes('submitted for verification')
    ) {
      return entry.at ? new Date(entry.at) : null;
    }
  }
  return null;
}

export async function getVerificationCutoffDate(): Promise<Date> {
  return new Date(Date.now() - BENEFICIARY_VERIFICATION_DAYS * 24 * 60 * 60 * 1000);
}

export async function resolveVerificationStartDate(order: IOrder): Promise<Date | null> {
  const fromHistory = getVerificationStartedAt(order);
  if (fromHistory) return fromHistory;

  const phone = normalizeBeneficiaryPhone(order.recipientPhone);
  const record = await BeneficiaryVerification.findOne({
    phone,
    network: order.network,
  }).select('submittedAt');
  if (record?.submittedAt) return new Date(record.submittedAt);

  // Last resort: order update time while already in verification state
  if (order.providerStatus === SUBMITTED_FOR_VERIFICATION) {
    return order.updatedAt ? new Date(order.updatedAt) : order.createdAt ? new Date(order.createdAt) : null;
  }
  return null;
}

/**
 * Apply MTN verification state when Smart Data Hub reports the number as exported.
 * The buyer email is sent only for the exported status (once per number).
 */
export async function applySmartDataHubVerificationOnExported(order: IOrder): Promise<{
  providerStatus: string;
  stepLabel: string;
  stepMessage: string;
  emailSent: boolean;
}> {
  const isMtn = String(order.network).toUpperCase() === 'MTN';
  if (!isMtn) {
    return {
      providerStatus: SUBMITTED_FOR_VERIFICATION,
      stepLabel: 'Submitted for Verification',
      stepMessage: 'Number submitted for network verification.',
      emailSent: false,
    };
  }

  const alreadyVerified = await isBeneficiaryVerified(order.recipientPhone, order.network);
  if (alreadyVerified) {
    return {
      providerStatus: VERIFIED_PROVIDER_STATUS,
      stepLabel: 'Number Verified',
      stepMessage: 'Number already verified — order processing normally.',
      emailSent: false,
    };
  }

  const [storeOwnerEmail, agentEmail] = await Promise.all([
    resolveStoreOwnerEmail(order),
    resolveAgentEmail(order),
  ]);

  const result = await markBeneficiarySubmittedForVerification({
    phone: order.recipientPhone,
    network: order.network,
    orderId: order.orderId,
    customerEmail: order.customerEmail,
    storeOwnerEmail,
    agentEmail,
    sendEmail: true,
  });

  return {
    providerStatus: SUBMITTED_FOR_VERIFICATION,
    stepLabel: 'Submitted for Verification',
    stepMessage:
      'This number is not verified on our system. It has been submitted to MTN for verification (24–144 hours). Subsequent orders will come faster after verification.',
    emailSent: result.emailSent,
  };
}

/** Admin manually marks an order as submitted for verification and emails the buyer. */
export async function applyManualVerificationToOrder(order: IOrder): Promise<{
  providerStatus: string;
  stepLabel: string;
  stepMessage: string;
  emailSent: boolean;
}> {
  const [storeOwnerEmail, agentEmail] = await Promise.all([
    resolveStoreOwnerEmail(order),
    resolveAgentEmail(order),
  ]);

  const result = await markBeneficiarySubmittedForVerification({
    phone: order.recipientPhone,
    network: order.network,
    orderId: order.orderId,
    customerEmail: order.customerEmail,
    storeOwnerEmail,
    agentEmail,
    sendEmail: true,
    forceEmail: true,
  });

  return {
    providerStatus: SUBMITTED_FOR_VERIFICATION,
    stepLabel: 'Submitted for Verification',
    stepMessage:
      'Admin marked this number for MTN verification (24–144 hours). The buyer, store owner, and agent have been notified by email when available.',
    emailSent: result.emailSent,
  };
}
