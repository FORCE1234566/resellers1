import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import { Network } from '../models/Package';

export class SmartDataHubError extends Error {
  statusCode: number;
  errorCode?: string;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function signingPath(relativePath: string): string {
  const baseUrl = env.fulfillment.apiUrl.replace(/\/$/, '');
  try {
    const parsed = new URL(baseUrl);
    const prefix = parsed.pathname.replace(/\/$/, '');
    const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    return `${prefix}${path}`;
  } catch {
    return relativePath.startsWith('/api/') ? relativePath : `/api/v1${relativePath}`;
  }
}

function buildSignature(method: string, endpoint: string, body: string, timestamp: number): string {
  const signatureString = `${timestamp}${method}${endpoint}${body}`;
  return crypto
    .createHmac('sha256', env.fulfillment.apiSecret)
    .update(signatureString)
    .digest('hex');
}

export function mapNetworkToProviderCode(network: Network | string): string {
  // Smart Data Hub expects "vodafone" for Telecel (former Vodafone Ghana).
  const map: Record<string, string> = {
    MTN: 'mtn',
    'MTN Express': 'mtn_express',
    Telecel: 'vodafone',
    AirtelTigo: 'at',
  };
  return map[network] || String(network).toLowerCase().replace(/\s+/g, '_');
}

export function parseBundleDataSizeGb(bundleSize: string): number {
  const match = bundleSize.trim().match(/^(\d+(?:\.\d+)?)\s*GB$/i);
  if (match) return parseFloat(match[1]);
  const digits = bundleSize.replace(/\D/g, '');
  if (digits) return parseInt(digits, 10);
  throw new Error(`Invalid bundle size: ${bundleSize}`);
}

export function isSmartDataHubConfigured(): boolean {
  return Boolean(
    env.fulfillment.enabled &&
      env.fulfillment.apiUrl &&
      env.fulfillment.apiKey &&
      env.fulfillment.apiSecret
  );
}

export async function smartDataHubRequest<T>(
  method: 'GET' | 'POST',
  relativePath: string,
  options?: { body?: unknown; idempotencyKey?: string }
): Promise<T> {
  if (!env.fulfillment.apiKey || !env.fulfillment.apiSecret) {
    throw new SmartDataHubError('Smart Data Hub API credentials not configured', 0);
  }

  const endpoint = signingPath(relativePath);
  const bodyStr = method === 'GET' || options?.body === undefined ? '' : JSON.stringify(options.body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildSignature(method, endpoint, bodyStr, timestamp);

  const baseUrl = env.fulfillment.apiUrl.replace(/\/$/, '');
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-KEY': env.fulfillment.apiKey,
    'X-Timestamp': String(timestamp),
    'X-Signature': signature,
  };
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey.slice(0, 500);
  }

  const res = await axios.request({
    method,
    url,
    headers,
    data: bodyStr || undefined,
    transformRequest: [(data) => data],
    timeout: 25000,
    validateStatus: () => true,
  });

  if (res.status >= 200 && res.status < 300) {
    return res.data as T;
  }

  const errBody = res.data as { message?: string; error_code?: string };
  throw new SmartDataHubError(
    errBody.message || `Smart Data Hub API error (${res.status})`,
    res.status,
    errBody.error_code
  );
}

export async function testSmartDataHubConnection(): Promise<{ message: string; timestamp?: string }> {
  const res = await smartDataHubRequest<{
    success: boolean;
    data: { message: string; timestamp?: string };
  }>('GET', '/test');
  return res.data;
}

export interface SmartDataHubCreateResponse {
  success: boolean;
  data: {
    batch_id: string;
    order_number: string;
    message: string;
    count: number;
  };
}

export interface SmartDataHubBulkOrder {
  id?: string;
  order_number?: string;
  phone_number?: string;
  beneficiary_number?: string;
  _beneficiary_number?: string;
  phone?: string;
  status?: string;
  order_api_reference?: string;
  fulfilled_at?: string;
}

export interface SmartDataHubBulkResponse {
  success: boolean;
  data: {
    batch_id?: string;
    order_number?: string;
    status?: string;
    orders?: SmartDataHubBulkOrder[];
  };
}

export async function createSmartDataHubOrder(input: {
  orderId: string;
  recipientPhone: string;
  network: Network | string;
  bundleSize: string;
}): Promise<SmartDataHubCreateResponse> {
  const payload = {
    order_number: input.orderId,
    orders: [
      {
        _beneficiary_number: input.recipientPhone,
        network: mapNetworkToProviderCode(input.network),
        _data_size: parseBundleDataSizeGb(input.bundleSize),
      },
    ],
  };

  return smartDataHubRequest<SmartDataHubCreateResponse>('POST', '/orders/create', {
    body: payload,
    idempotencyKey: input.orderId,
  });
}

export type SmartDataHubVerifyResult = {
  verified: boolean;
  raw?: unknown;
  message?: string;
  /** True when SDH verify API failed (auth/outage), not a number rejection. */
  unavailable?: boolean;
};

function parseVerifiedFlag(payload: unknown): boolean | null {
  if (payload == null) return null;
  if (typeof payload === 'boolean') return payload;
  if (typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  const candidates = [
    obj.verified,
    obj.is_verified,
    obj.isVerified,
    obj.eligible,
    obj.can_buy,
    obj.canBuy,
    obj.status,
    data?.verified,
    data?.is_verified,
    data?.isVerified,
    data?.eligible,
    data?.can_buy,
    data?.canBuy,
    data?.status,
  ];
  for (const value of candidates) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['verified', 'active', 'eligible', 'ok', 'success', 'true', 'approved', 'yes'].includes(normalized)) {
        return true;
      }
      if (
        ['unverified', 'not_verified', 'not-verified', 'inactive', 'ineligible', 'rejected', 'false', 'no'].includes(
          normalized
        )
      ) {
        return false;
      }
    }
  }
  return null;
}

function verifyPathCandidates(): string[] {
  const fromEnv = (process.env.FULFILLMENT_VERIFY_PATH || '').trim();
  const paths = [
    fromEnv,
    '/verify-number',
    '/orders/verify-number',
    '/numbers/verify',
    '/beneficiary/verify',
    '/beneficiaries/verify',
    '/mtn-express/verify',
    '/mtn_express/verify',
    '/express/verify-number',
    '/verify/mtn-express',
  ].filter(Boolean) as string[];
  return [...new Set(paths)];
}

function isConfiguredVerifyPath(relativePath: string): boolean {
  const fromEnv = (process.env.FULFILLMENT_VERIFY_PATH || '').trim();
  return Boolean(fromEnv) && relativePath === fromEnv;
}

type VerifyAttempt =
  | { kind: 'verified'; raw: unknown }
  | { kind: 'rejected'; message: string; raw?: unknown }
  | { kind: 'missing'; statusCode: number }
  | { kind: 'unavailable'; message: string; statusCode: number };

async function attemptVerifyPath(relativePath: string, body: Record<string, string>): Promise<VerifyAttempt> {
  try {
    const res = await smartDataHubRequest<unknown>('POST', relativePath, { body });
    const verified = parseVerifiedFlag(res);
    if (verified === true) {
      return { kind: 'verified', raw: res };
    }
    return {
      kind: 'rejected',
      message: 'This number is not verified to buy MTN Express.',
      raw: res,
    };
  } catch (err) {
    if (err instanceof SmartDataHubError) {
      if (err.statusCode === 404 || err.statusCode === 405) {
        return { kind: 'missing', statusCode: err.statusCode };
      }
      // Wrong path often returns 401/403 on SDH — keep probing fallback paths.
      if ((err.statusCode === 401 || err.statusCode === 403) && !isConfiguredVerifyPath(relativePath)) {
        return { kind: 'missing', statusCode: err.statusCode };
      }
      if (err.statusCode === 400 || err.statusCode === 422) {
        return {
          kind: 'rejected',
          message: err.message || 'This number is not verified to buy MTN Express.',
        };
      }
      console.error(
        `[SDH] MTN Express verify failed on ${relativePath}: ${err.statusCode} ${err.message}`
      );
      return {
        kind: 'unavailable',
        statusCode: err.statusCode,
        message: 'MTN Express verification is temporarily unavailable. Please try again shortly.',
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[SDH] MTN Express verify error on ${relativePath}: ${message}`);
    return {
      kind: 'unavailable',
      statusCode: 0,
      message: 'MTN Express verification is temporarily unavailable. Please try again shortly.',
    };
  }
}

/**
 * Pre-purchase check for MTN Express numbers on Smart Data Hub.
 * Never throws — callers always get a structured result.
 * Path override: FULFILLMENT_VERIFY_PATH (falls back through common SDH verify paths).
 */
export async function verifySmartDataHubMtnExpressNumber(
  phone: string
): Promise<SmartDataHubVerifyResult> {
  const normalizedPhone = phone.replace(/\D/g, '');
  const body = {
    phone: normalizedPhone,
    phone_number: normalizedPhone,
    beneficiary_number: normalizedPhone,
    _beneficiary_number: normalizedPhone,
    network: mapNetworkToProviderCode('MTN Express'),
  };

  let lastRejected: VerifyAttempt | null = null;

  for (const relativePath of verifyPathCandidates()) {
    const attempt = await attemptVerifyPath(relativePath, body);
    if (attempt.kind === 'verified') {
      return { verified: true, raw: attempt.raw };
    }
    if (attempt.kind === 'unavailable') {
      return {
        verified: false,
        unavailable: true,
        message: attempt.message,
      };
    }
    if (attempt.kind === 'missing') {
      continue;
    }
    if (attempt.kind === 'rejected') {
      lastRejected = attempt;
      break;
    }
  }

  if (lastRejected?.kind === 'rejected') {
    return {
      verified: false,
      message: lastRejected.message,
      raw: lastRejected.raw,
    };
  }

  return {
    verified: false,
    unavailable: true,
    message:
      'MTN Express verification is temporarily unavailable. Please confirm FULFILLMENT_VERIFY_PATH with Smart Data Hub.',
  };
}

export async function fetchSmartDataHubBulkStatus(
  reference: string
): Promise<SmartDataHubBulkResponse> {
  return smartDataHubRequest<SmartDataHubBulkResponse>(
    'GET',
    `/orders/bulk/${encodeURIComponent(reference)}`
  );
}
