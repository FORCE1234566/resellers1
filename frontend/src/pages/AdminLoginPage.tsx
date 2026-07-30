import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { validateLoginFields } from '@/lib/form-validation';
import AuthLayout from '@/components/layout/AuthLayout';
import { useLocation, useNavigate } from 'react-router-dom';
import { dashboardRouteForRole } from '@/lib/dashboard-routes';
import DevLoginHint from '@/components/ui/DevLoginHint';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionMessage = (location.state as { message?: string } | null)?.message;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = validateLoginFields(email, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      const result = await login(email, password, 'admin');
      if (result.requiresTotp || result.requiresOtp) {
        sessionStorage.setItem('otpEmail', result.email || email);
        sessionStorage.setItem('otpRole', 'admin');
        sessionStorage.setItem('mfaMode', result.requiresTotp ? 'totp' : 'email');
        sessionStorage.setItem('otpEmailSent', result.otpEmailSent ? '1' : '0');
        sessionStorage.setItem('otpSmsSent', result.otpSmsSent ? '1' : '0');
        sessionStorage.removeItem(`otpAutoResent:${(result.email || email).toLowerCase()}`);
        navigate('/verify-otp');
      } else {
        navigate(dashboardRouteForRole(result.user?.role || 'admin'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Admin Login" subtitle="Platform administrator access">
      <DevLoginHint
        email="wilberforceboanu2002@gmail.com"
        password="Admin@12345"
        label="Uses your seeded admin account from backend .env"
      />
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email Address"
          type="email"
          value={email}
          error={fieldErrors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
          }}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          error={fieldErrors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: '' }));
          }}
        />
        <FormAlert message={sessionMessage || error} />
        <Button type="submit" className="w-full" loading={loading}>Continue</Button>
      </form>
    </AuthLayout>
  );
}
