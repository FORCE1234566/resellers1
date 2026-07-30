import { useState } from 'react';
import { api } from '@/lib/api';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { runValidators, v } from '@/lib/form-validation';
import AuthLayout from '@/components/layout/AuthLayout';
import { Link } from 'react-router';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = runValidators({ email }, { email: [v.required('Email'), v.email] });
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email, role: 'reseller' });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Reset Password" subtitle="Reseller accounts only — we'll send a reset link to your email">
      {sent ? (
        <div className="text-center">
          <p className="text-emerald-700 mb-2">If an account exists, a reset link has been sent.</p>
          <p className="text-gray-600 text-sm mb-4">Check your inbox and spam folder. The link expires in 15 minutes.</p>
          <Link to="/login/reseller" className="text-amber-700 hover:underline text-sm">Back to Reseller Login</Link>
        </div>
      ) : (
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
          <FormAlert message={error} />
          <Button type="submit" className="w-full" loading={loading}>Send Reset Link</Button>
          <Link to="/login/reseller" className="block text-center text-sm text-amber-700 hover:underline">Back to Reseller Login</Link>
        </form>
      )}
    </AuthLayout>
  );
}
