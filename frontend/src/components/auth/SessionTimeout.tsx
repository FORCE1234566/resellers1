import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth-context';
import {
  isSessionExpired,
  SESSION_TIMEOUT_MS,
  touchSessionActivity,
} from '@/lib/session';

const loginRoutes: Record<string, string> = {
  admin: '/login/admin',
  agent: '/login/agent',
  reseller: '/login/reseller',
};

const idleHours = SESSION_TIMEOUT_MS / (60 * 60 * 1000);
const expiryMessage = `Your session expired after ${idleHours} hours of inactivity. Please sign in again.`;

export default function SessionTimeout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    if (isSessionExpired()) {
      const role = user.role;
      void logout().then(() => {
        navigate(loginRoutes[role] || '/login', {
          state: { message: expiryMessage },
        });
      });
      return;
    }

    touchSessionActivity();

    const onActivity = () => touchSessionActivity();
    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));

    const timer = window.setInterval(() => {
      if (isSessionExpired()) {
        const role = user.role;
        void logout().then(() => {
          navigate(loginRoutes[role] || '/login', {
            state: { message: expiryMessage },
          });
        });
      }
    }, 60_000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, onActivity));
      window.clearInterval(timer);
    };
  }, [user, logout, navigate]);

  return null;
}

export { SESSION_TIMEOUT_MS };
