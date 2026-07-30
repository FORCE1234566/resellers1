import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { validateLoginFields } from '@/lib/form-validation';
import AuthLayout from '@/components/layout/AuthLayout';
import { useNavigate } from 'react-router';
import { dashboardRouteForRole } from '@/lib/dashboard-routes';
import DevLoginHint from '@/components/ui/DevLoginHint';

export default function AgentLoginPage() {
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
      const result = await login(email, password, 'agent');
      if (result.requiresTotp || result.requiresOtp) {
        sessionStorage.setItem('otpEmail', result.email || email);
        sessionStorage.setItem('otpRole', 'agent');
        sessionStorage.setItem('mfaMode', result.requiresTotp ? 'totp' : 'email');
        sessionStorage.setItem('otpEmailSent', result.otpEmailSent ? '1' : '0');
        sessionStorage.setItem('otpSmsSent', result.otpSmsSent ? '1' : '0');
        sessionStorage.removeItem(`otpAutoResent:${(result.email || email).toLowerCase()}`);
        navigate('/verify-otp');
      } else {
        navigate(dashboardRouteForRole(result.user?.role || 'agent'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Agent Login" subtitle="Sign in with your Agent credentials">
      <DevLoginHint email="agent@databundle.test" password="Agent@12345" />
      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
        Agent accounts are created by the admin. Contact your administrator if you need access.
      </div>
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
        <Button type="submit" className="w-full" loading={loading}>Login</Button>
      </form>
    </AuthLayout>
  );
}
