import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import BrandLogo from '@/components/ui/BrandLogo';
import BackHomeLink from '@/components/ui/BackHomeLink';

export default function VerifyOtpPage() {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const { verifyOtp, verifyTotp } = useAuth();
  const [mfaMode, setMfaMode] = useState<'email' | 'totp'>('email');
  const navigate = useNavigate();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const submittingRef = useRef(false);

  const redirectToLogin = useCallback((role: string, message?: string) => {
    sessionStorage.removeItem('otpEmail');
    const loginRoutes: Record<string, string> = {
      admin: '/login/admin',
      agent: '/login/agent',
      reseller: '/login/reseller',
    };
    navigate(loginRoutes[role] || '/login/reseller', message ? { state: { message } } : undefined);
  }, [navigate]);

  useEffect(() => {
    const stored = sessionStorage.getItem('otpEmail');
    const role = sessionStorage.getItem('otpRole') || 'reseller';
    if (!stored) {
      redirectToLogin(role);
      return;
    }
    if (stored === 'admin@localhost.com') {
      redirectToLogin('admin', 'Please sign in again with wilberforceboanu2002@gmail.com');
      return;
    }
    setEmail(stored);
    const mode = sessionStorage.getItem('mfaMode');
    const resolvedMode = mode === 'totp' ? 'totp' : 'email';
    setMfaMode(resolvedMode);
    setTimeout(() => inputs.current[0]?.focus(), 100);

    // Re-send inbox OTP when landing on this page so agents always get a code
    // after admin re-enables email OTP (login send can race or be dropped).
    const autoKey = `otpAutoResent:${stored}`;
    if (resolvedMode === 'email' && !sessionStorage.getItem(autoKey)) {
      sessionStorage.setItem(autoKey, '1');
      void (async () => {
        try {
          await api.post('/auth/resend-otp', { email: stored });
          setResendMessage('A new code has been sent. Check your inbox and spam folder.');
          setResendCooldown(30);
        } catch (err) {
          console.error('Auto OTP resend failed', err);
        }
      })();
    }
  }, [navigate, redirectToLogin]);

  const submitOtp = useCallback(async (code: string) => {
    if (code.length !== 6 || submittingRef.current || !email) return;

    submittingRef.current = true;
    setError('');
    setLoading(true);

    try {
      if (mfaMode === 'totp') {
        await verifyTotp(email, code);
      } else {
        await verifyOtp(email, code);
      }
      const { getStoredUser } = await import('@/lib/api');
      const user = (getStoredUser() || {}) as { role?: string };
      const routes: Record<string, string> = { admin: '/admin', agent: '/agent', reseller: '/reseller' };
      sessionStorage.removeItem('otpEmail');
      sessionStorage.removeItem('otpRole');
      sessionStorage.removeItem('mfaMode');
      navigate(user.role ? routes[user.role] ?? '/' : '/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      if (message.toLowerCase().includes('user not found')) {
        redirectToLogin(sessionStorage.getItem('otpRole') || 'reseller', 'Session expired. Please sign in again.');
        return;
      }
      setError(message);
      setOtp(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
      submittingRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [email, mfaMode, verifyOtp, verifyTotp, navigate, redirectToLogin]);

  useEffect(() => {
    const code = otp.join('');
    if (code.length === 6 && email && !submittingRef.current) {
      submitOtp(code);
    }
  }, [otp, email, submitOtp]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) inputs.current[index + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newOtp = [...otp];
    for (let i = 0; i < 6; i++) {
      newOtp[i] = pasted[i] || '';
    }
    setOtp(newOtp);
    const focusIndex = Math.min(pasted.length, 5);
    inputs.current[focusIndex]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const resendOtp = async () => {
    if (resending || resendCooldown > 0 || !email) return;
    setResending(true);
    setResendMessage('');
    setError('');
    try {
      await api.post('/auth/resend-otp', { email });
      setResendMessage('A new code has been sent. Check your inbox and spam folder.');
      setResendCooldown(30);
      setOtp(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend';
      if (message.toLowerCase().includes('user not found')) {
        redirectToLogin(sessionStorage.getItem('otpRole') || 'reseller', 'Please sign in again with your current email.');
        return;
      }
      setError(message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy px-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-96 h-96 bg-gold/5 rounded-full blur-3xl" />
      <div className="w-full max-w-md text-center relative z-10">
        <div className="mb-8">
          <BrandLogo size="lg" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">
          {mfaMode === 'totp' ? 'Authenticator Code' : 'Verify Your Email'}
        </h1>
        <p className="text-gray-400 mb-2">
          {mfaMode === 'totp'
            ? 'Enter the 6-digit code from your authenticator app for'
            : 'Enter the 6-digit code sent to'}
        </p>
        <p className="text-white font-medium mb-8">{email}</p>

        <div className="bg-white rounded-xl border shadow-xl shadow-black/20 p-6">
          <div className="flex justify-center gap-1.5 min-[360px]:gap-2 sm:gap-3 mb-4 max-w-full" onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                disabled={loading}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className={`w-9 h-12 min-[360px]:w-10 min-[400px]:w-11 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold border-2 rounded-lg sm:rounded-xl focus:border-gold focus:outline-none text-gray-900 transition-colors ${
                  digit ? 'border-gold bg-amber-50' : 'border-gray-200'
                } ${loading ? 'opacity-60' : ''}`}
              />
            ))}
          </div>

          {loading && (
            <p className="text-sm text-amber-700 mb-4 flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Verifying...
            </p>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg mb-4">{error}</p>}
          {resendMessage && (
            <p className="text-sm text-emerald-700 bg-emerald-50 p-3 rounded-lg mb-4">{resendMessage}</p>
          )}

          {mfaMode === 'totp' ? (
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem('mfaMode', 'email');
                setMfaMode('email');
                setOtp(['', '', '', '', '', '']);
                void resendOtp();
              }}
              disabled={loading || resending}
              className="text-sm text-amber-700 hover:underline disabled:opacity-50"
            >
              {resending ? 'Sending email OTP...' : 'Use email OTP backup instead'}
            </button>
          ) : (
            <button
              type="button"
              onClick={resendOtp}
              disabled={loading || resending || resendCooldown > 0}
              className="text-sm text-amber-700 hover:underline disabled:opacity-50"
            >
              {resending
                ? 'Sending...'
                : resendCooldown > 0
                  ? `Resend OTP (${resendCooldown}s)`
                  : 'Resend OTP'}
            </button>
          )}
        </div>

        <div className="mt-5 text-center">
          <BackHomeLink />
        </div>
      </div>
    </div>
  );
}
