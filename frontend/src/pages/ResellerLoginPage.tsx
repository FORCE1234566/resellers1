import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { validateLoginFields } from '@/lib/form-validation';
import AuthLayout from '@/components/layout/AuthLayout';
import { Link, useNavigate } from 'react-router';
import { dashboardRouteForRole } from '@/lib/dashboard-routes';
import DevLoginHint from '@/components/ui/DevLoginHint';

export default function ResellerLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = validateLoginFields(email, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      const result = await login(email, password, 'reseller');
      if (result.requiresOtp) {
        sessionStorage.setItem('otpEmail', result.email || email);
        sessionStorage.setItem('otpRole', 'reseller');
        sessionStorage.setItem('mfaMode', 'email');
        sessionStorage.setItem('otpEmailSent', result.otpEmailSent ? '1' : '0');
        sessionStorage.setItem('otpSmsSent', result.otpSmsSent ? '1' : '0');
        sessionStorage.removeItem(`otpAutoResent:${(result.email || email).toLowerCase()}`);
        navigate('/verify-otp');
      } else {
        navigate(dashboardRouteForRole(result.user?.role || 'reseller'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Reseller Login" subtitle="Sign in to your reseller account">
      <DevLoginHint email="reseller@databundle.test" password="Reseller@12345" />
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
        <FormAlert message={error} />
        <Button type="submit" className="w-full" loading={loading}>Continue</Button>
      </form>
      <div className="mt-4 text-center text-sm">
        <Link to="/forgot-password" className="text-gold-dark font-medium hover:underline text-amber-700">Forgot password?</Link>
      </div>
      <p className="mt-4 text-center text-sm text-gray-500">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="text-amber-700 font-medium hover:underline">Become A Reseller</Link>
      </p>
    </AuthLayout>
  );
}
