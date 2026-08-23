import axios from 'axios';
import { touchSessionActivity } from './session';
import {
  clearAuthStorage,
  getStoredToken,
  getStoredRefreshToken,
  migrateLegacyLocalStorageAuth,
  setStoredRefreshToken,
  setStoredToken,
  setStoredUserJson,
  getStoredUserJson,
} from './secure-storage';

const API_URL = (() => {
  const raw = import.meta.env.VITE_API_URL?.trim();
  if (!raw) return '/api';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const base = raw.replace(/\/$/, '');
    return base.endsWith('/api') ? base : `${base}/api`;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
})();

migrateLegacyLocalStorageAuth();

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 25_000,
});

api.interceptors.request.use((config) => {
  const method = config.method?.toLowerCase();
  if (config.data instanceof FormData) {
    // Let the browser set multipart boundary — do not force application/json.
    if (config.headers) {
      delete config.headers['Content-Type'];
    }
  } else if (method && ['post', 'put', 'patch'].includes(method) && config.data === undefined) {
    config.data = {};
  }
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post(
      `${API_URL}/auth/refresh`,
      {},
      { withCredentials: true }
    );
    const next = data.data?.token as string | undefined;
    const nextRefresh = data.data?.refreshToken as string | undefined;
    if (next) setStoredToken(next);
    if (nextRefresh) setStoredRefreshToken(nextRefresh);
    return next ?? null;
  } catch {
    const legacyRefresh = getStoredRefreshToken();
    if (!legacyRefresh) return null;
    try {
      const { data } = await axios.post(
        `${API_URL}/auth/refresh`,
        { refreshToken: legacyRefresh },
        { withCredentials: true }
      );
      const next = data.data?.token as string | undefined;
      const nextRefresh = data.data?.refreshToken as string | undefined;
      if (next) setStoredToken(next);
      if (nextRefresh) setStoredRefreshToken(nextRefresh);
      return next ?? null;
    } catch {
      return null;
    }
  }
}

api.interceptors.response.use(
  (res) => {
    if (getStoredToken()) touchSessionActivity();
    return res;
  },
  async (error) => {
    const original = error.config as
      | { _retry?: boolean; headers?: Record<string, string>; url?: string }
      | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      refreshPromise = refreshPromise ?? refreshAccessToken();
      const token = await refreshPromise.finally(() => {
        refreshPromise = null;
      });
      if (token && original.headers) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
      clearAuthStorage();
    } else if (error.response?.status === 401) {
      clearAuthStorage();
    }

    let message =
      error.response?.data?.message ||
      (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED'
        ? 'Cannot reach server. Check your internet connection and try again in a moment.'
        : null) ||
      error.message ||
      'Something went wrong';

    if (
      error.response?.status === 403 &&
      message === 'Access denied' &&
      original?.url?.includes('/admin/')
    ) {
      message =
        'Your session is not signed in as admin. Sign out, then log in again at /login/admin and retry.';
    }

    const apiCode = error.response?.data?.code as string | undefined;
    const enriched = new Error(message) as Error & { code?: string };
    if (apiCode) enriched.code = apiCode;
    return Promise.reject(enriched);
  }
);

export const setAuthToken = (token: string | null) => {
  setStoredToken(token);
};

export const setRefreshToken = (token: string | null) => {
  setStoredRefreshToken(token);
};

export const getStoredUser = () => {
  const user = getStoredUserJson();
  return user ? JSON.parse(user) : null;
};

export const setStoredUser = (user: unknown | null) => {
  setStoredUserJson(user ? JSON.stringify(user) : null);
};

export type OrderExportNetwork = 'all' | 'MTN' | 'MTN Express' | 'Telecel' | 'AirtelTigo';

/** Download admin CSV report (orders, withdrawals, etc.) */
export async function downloadAdminReport(
  type: string,
  options?: { network?: OrderExportNetwork; filename?: string }
) {
  const token = getStoredToken();
  const params = new URLSearchParams();
  if (options?.network && options.network !== 'all') {
    params.set('network', options.network);
  }
  const query = params.toString();
  const res = await fetch(`${API_URL}/admin/reports/${type}${query ? `?${query}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || 'Export failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const networkSuffix =
    options?.network && options.network !== 'all' ? `-${options.network.toLowerCase()}` : '';
  a.download = options?.filename || `${type}-report${networkSuffix}-${dateStamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
