import { useState } from 'react';
import { api } from '@/lib/api';
import PasswordInput from '@/components/ui/PasswordInput';
import { getPasswordStrength } from '@/lib/password-strength';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { runValidators, v } from '@/lib/form-validation';
import AuthLayout from '@/components/layout/AuthLayout';
import { useNavigate, useSearchParams } from 'react-router';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = runValidators(
      { password, confirmPassword },
      {
        password: [v.required('Password')],
        confirmPassword: [v.required('Confirm password'), v.match(password, 'Passwords')],
      }
    );
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const strength = getPasswordStrength(password);
    if (strength.level === 'weak' || strength.level === 'fair') {
      setError('Choose a stronger password with uppercase, lowercase, numbers, and symbols.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password, confirmPassword });
      navigate('/login/reseller');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Reset Password" subtitle="Create a new password for your account">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <PasswordInput
          label="New Password"
          value={password}
          error={fieldErrors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: '' }));
          }}
          showStrength
        />
        <PasswordInput
          label="Confirm Password"
          value={confirmPassword}
          error={fieldErrors.confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            if (fieldErrors.confirmPassword) setFieldErrors((prev) => ({ ...prev, confirmPassword: '' }));
          }}
        />
        <FormAlert message={error} />
        <Button type="submit" className="w-full" loading={loading}>Reset Password</Button>
      </form>
    </AuthLayout>
  );
}
