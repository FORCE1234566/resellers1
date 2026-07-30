import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { secureCompare } from './secureCompare';
import { getCanonicalFrontendUrl, paystackPlatformMetadata } from '../config/urls';

const paystackApi = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${env.paystack.secretKey}`,
    'Content-Type': 'application/json',
  },
});

export interface PaystackInitResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

function paystackFailureMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export const initializePayment = async (
  email: string,
  amountInPesewas: number,
  metadata: Record<string, unknown>
): Promise<PaystackInitResponse> => {
  if (!env.paystack.secretKey) {
    throw new AppError('Paystack is not configured. Contact support.', 503);
  }

  try {
    const payload: Record<string, unknown> = {
      email,
      amount: amountInPesewas,
      currency: 'GHS',
      callback_url: `${getCanonicalFrontendUrl()}/payment/callback`,
      metadata: paystackPlatformMetadata(metadata),
    };
    if (typeof metadata.reference === 'string' && metadata.reference.trim()) {
      payload.reference = metadata.reference.trim();
    }

    const { data } = await paystackApi.post('/transaction/initialize', payload);

    if (!data?.status || !data?.data?.authorization_url) {
      throw new AppError(data?.message || 'Paystack could not start this payment', 502);
    }

    return data.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(paystackFailureMessage(err, 'Paystack payment could not be started'), 502);
  }
};

export const verifyPayment = async (reference: string) => {
  try {
    const { data } = await paystackApi.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!data?.status || !data?.data) {
      throw new AppError(data?.message || 'Could not verify payment with Paystack', 502);
    }
    return data.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(paystackFailureMessage(err, 'Could not verify payment with Paystack'), 502);
  }
};

export const verifyWebhookSignature = (payload: string, signature: string): boolean => {
  if (!env.paystack.secretKey || !signature) return false;
  const hash = crypto
    .createHmac('sha512', env.paystack.secretKey)
    .update(payload)
    .digest('hex');
  return secureCompare(hash, signature);
};

const PAYSTACK_HOSTS = new Set(['checkout.paystack.com', 'paystack.com', 'standard.paystack.com']);

export function assertPaystackCheckoutUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('Invalid payment redirect URL', 502);
  }
  if (parsed.protocol !== 'https:' || !PAYSTACK_HOSTS.has(parsed.hostname)) {
    throw new AppError('Untrusted payment redirect URL', 502);
  }
}

export const calculatePaystackCharge = (amount: number, chargePercent: number): number => {
  return Math.round(amount * (chargePercent / 100) * 100) / 100;
};

/** Ghana MoMo provider codes for Paystack transfer recipients */
export const MOBILE_MONEY_BANK_CODES: Record<string, string> = {
  MTN: 'MTN',
  Telecel: 'VOD',
  AirtelTigo: 'TGL',
};

export const ghsToPesewas = (amount: number): number => Math.round(amount * 100);

export const pesewasToGhs = (amount: number): number => amount / 100;

export const createTransferRecipient = async (input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}) => {
  const { data } = await paystackApi.post('/transferrecipient', {
    type: 'mobile_money',
    name: input.name,
    account_number: input.accountNumber,
    bank_code: input.bankCode,
    currency: 'GHS',
  });
  return data.data as { recipient_code: string };
};

export const initiateTransfer = async (input: {
  amountInPesewas: number;
  recipientCode: string;
  reason: string;
  reference: string;
}) => {
  const { data } = await paystackApi.post('/transfer', {
    source: 'balance',
    amount: input.amountInPesewas,
    recipient: input.recipientCode,
    reason: input.reason,
    reference: input.reference,
    currency: 'GHS',
  });
  return data.data as { transfer_code: string; status: string; reference: string };
};

export const verifyTransfer = async (reference: string) => {
  const { data } = await paystackApi.get(`/transfer/verify/${reference}`);
  return data.data;
};

/** Full or partial refund for a successful Paystack charge (by transaction reference). */
export const refundTransaction = async (
  reference: string,
  amountInPesewas?: number
): Promise<{ id?: number; status?: string; amount?: number }> => {
  if (!env.paystack.secretKey) {
    throw new AppError('Paystack is not configured. Contact support.', 503);
  }
  try {
    const payload: Record<string, unknown> = { transaction: reference };
    if (typeof amountInPesewas === 'number' && amountInPesewas > 0) {
      payload.amount = amountInPesewas;
    }
    const { data } = await paystackApi.post('/refund', payload);
    if (!data?.status) {
      throw new AppError(data?.message || 'Paystack refund failed', 502);
    }
    return (data.data || {}) as { id?: number; status?: string; amount?: number };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(paystackFailureMessage(err, 'Paystack refund could not be started'), 502);
  }
};
