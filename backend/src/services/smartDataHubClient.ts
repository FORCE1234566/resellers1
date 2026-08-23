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
};

function parseVerifiedFlag(payload: unknown): boolean | null {
  if (payload == null) return null;
  if (typeof payload === 'boolean') return payload;
  if (typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.verified,
    obj.is_verified,
    obj.isVerified,
    obj.eligible,
    obj.can_buy,
    obj.canBuy,
    obj.status,
    (obj.data as Record<string, unknown> | undefined)?.verified,
    (obj.data as Record<string, unknown> | undefined)?.is_verified,
    (obj.data as Record<string, unknown> | undefined)?.isVerified,
    (obj.data as Record<string, unknown> | undefined)?.eligible,
    (obj.data as Record<string, unknown> | undefined)?.status,
  ];
  for (const value of candidates) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['verified', 'active', 'eligible', 'ok', 'success', 'true', 'approved'].includes(normalized)) {
        return true;
      }
      if (
        ['unverified', 'not_verified', 'not-verified', 'inactive', 'ineligible', 'rejected', 'false'].includes(
          normalized
        )
      ) {
        return false;
      }
    }
  }
  if (typeof obj.success === 'boolean' && obj.data === undefined) return obj.success;
  return null;
}

/**
 * Pre-purchase check for MTN Express numbers on Smart Data Hub.
 * Path override: FULFILLMENT_VERIFY_PATH (default `/verify-number`).
 */
export async function verifySmartDataHubMtnExpressNumber(
  phone: string
): Promise<SmartDataHubVerifyResult> {
  const relativePath = (process.env.FULFILLMENT_VERIFY_PATH || '/verify-number').trim() || '/verify-number';
  const normalizedPhone = phone.replace(/\D/g, '');
  const body = {
    phone: normalizedPhone,
    phone_number: normalizedPhone,
    beneficiary_number: normalizedPhone,
    _beneficiary_number: normalizedPhone,
    network: mapNetworkToProviderCode('MTN Express'),
  };

  try {
    const res = await smartDataHubRequest<unknown>('POST', relativePath, { body });
    const verified = parseVerifiedFlag(res);
    if (verified === null) {
      // Successful HTTP with no explicit flag — treat as verified (SDH accepted the number).
      return { verified: true, raw: res };
    }
    return {
      verified,
      raw: res,
      message: verified
        ? undefined
        : 'This number is not verified to buy MTN Express.',
    };
  } catch (err) {
    if (err instanceof SmartDataHubError) {
      if (err.statusCode === 404 || err.statusCode === 422 || err.statusCode === 400) {
        return {
          verified: false,
          message: err.message || 'This number is not verified to buy MTN Express.',
        };
      }
      throw err;
    }
    throw err;
  }
}

export async function fetchSmartDataHubBulkStatus(
  reference: string
): Promise<SmartDataHubBulkResponse> {
  return smartDataHubRequest<SmartDataHubBulkResponse>(
    'GET',
    `/orders/bulk/${encodeURIComponent(reference)}`
  );
}
