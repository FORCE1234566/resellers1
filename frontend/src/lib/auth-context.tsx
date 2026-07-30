import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';
import { api, setAuthToken, setRefreshToken, setStoredUser } from './api';
import { clearSessionActivity, isSessionExpired, touchSessionActivity } from './session';
import {
  clearAuthStorage,
  getStoredRefreshToken,
  getStoredToken,
  setStoredRefreshToken,
} from './secure-storage';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export interface UserPerformance {
  rank: number | null;
  rankLabel: string | null;
  orderCount: number;
  totalRanked?: number;
  message?: string;
}

export interface User {
  id: string;
  fullName: string;
  firstName?: string;
  email: string;
  phone: string;
  role: 'admin' | 'agent' | 'reseller';
  status: string;
  performance?: UserPerformance | null;
  resellerStore?: {
    storeName: string;
    slug: string;
  };
}

interface LoginResult {
  requiresOtp: boolean;
  requiresTotp?: boolean;
  emailOtpBackup?: boolean;
  otpEmailSent?: boolean;
  otpSmsSent?: boolean;
  mfaRecommended?: boolean;
  email?: string;
  role?: string;
  token?: string;
  refreshToken?: string;
  user?: User;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role?: string) => Promise<LoginResult>;
  verifyOtp: (email: string, otp: string) => Promise<void>;
  verifyTotp: (email: string, totp: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const clearSession = () => {
  clearAuthStorage();
  clearSessionActivity();
};

const persistAuth = (token: string, refresh: string | undefined, user: User) => {
  setAuthToken(token);
  if (refresh) setRefreshToken(refresh);
  setStoredUser(user);
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const syncSessionFromStorage = async () => {
      const token = getStoredToken();
      if (!token) {
        setUserState(null);
        return;
      }
      try {
        const res = await api.get('/auth/me');
        setStoredUser(res.data.data);
        setUserState(res.data.data);
        touchSessionActivity();
      } catch {
        clearSession();
        setUserState(null);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'token' || event.key === 'user' || event.key === 'refreshToken') {
        void syncSessionFromStorage();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      if (isSessionExpired()) {
        clearSession();
        setUserState(null);
        setLoading(false);
        return;
      }

      let token = getStoredToken();
      if (!token) {
        try {
          const refresh = getStoredRefreshToken();
          const { data } = await axios.post(
            `${API_URL}/auth/refresh`,
            refresh ? { refreshToken: refresh } : {},
            { withCredentials: true }
          );
          token = data.data?.token ?? null;
          if (token) setAuthToken(token);
          if (data.data?.refreshToken) setStoredRefreshToken(data.data.refreshToken);
        } catch {
          clearSession();
          setUserState(null);
          setLoading(false);
          return;
        }
      }

      if (!token) {
        clearSession();
        setUserState(null);
        setLoading(false);
        return;
      }

      try {
        const res = await api.get('/auth/me');
        setStoredUser(res.data.data);
        setUserState(res.data.data);
        touchSessionActivity();
      } catch {
        clearSession();
        setUserState(null);
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, []);

  const login = async (email: string, password: string, role?: string) => {
    const { data } = await api.post('/auth/login', { email, password, role });
    const result = data.data as LoginResult;
    if (!result.requiresOtp && !result.requiresTotp && result.token && result.user) {
      persistAuth(result.token, result.refreshToken, result.user);
      setUserState(result.user);
      touchSessionActivity();
    }
    return result;
  };

  const verifyOtp = async (email: string, otp: string) => {
    const { data } = await api.post('/auth/verify-otp', { email, otp });
    persistAuth(data.data.token, data.data.refreshToken, data.data.user);
    setUserState(data.data.user);
    touchSessionActivity();
  };

  const verifyTotp = async (email: string, totp: string) => {
    const { data } = await api.post('/auth/verify-totp', { email, totp });
    persistAuth(data.data.token, data.data.refreshToken, data.data.user);
    setUserState(data.data.user);
    touchSessionActivity();
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Clear local session even if server logout fails
    }
    clearSession();
    setUserState(null);
  };

  const setUser = (u: User | null) => {
    setStoredUser(u);
    setUserState(u);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyOtp, verifyTotp, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
