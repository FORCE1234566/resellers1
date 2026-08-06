import { useState } from 'react';

import { api, setAuthToken, setStoredUser } from '@/lib/api';

import { useAuth } from '@/lib/auth-context';

import { dashboardRouteForRole } from '@/lib/dashboard-routes';

import Input from '@/components/ui/Input';

import PasswordInput from '@/components/ui/PasswordInput';

import { getPasswordStrength } from '@/lib/password-strength';

import Button from '@/components/ui/Button';

import FormAlert from '@/components/ui/FormAlert';

import { validateRegisterFields } from '@/lib/form-validation';

import AuthLayout from '@/components/layout/AuthLayout';

import { Link, useNavigate } from 'react-router';



export default function RegisterPage() {

  const [form, setForm] = useState({

    fullName: '', email: '', phone: '', password: '', confirmPassword: '',

  });

  const [error, setError] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const { setUser } = useAuth();



  const update = (field: string, value: string) => {

    setForm((f) => ({ ...f, [field]: value }));

    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: '' }));

  };



  const handleSubmit = async (e: React.FormEvent) => {

    e.preventDefault();

    setError('');

    const errors = validateRegisterFields(form);

    setFieldErrors(errors);

    if (Object.keys(errors).length) return;



    const strength = getPasswordStrength(form.password);

    if (strength.level === 'weak' || strength.level === 'fair') {

      setError('Choose a stronger password with uppercase, lowercase, numbers, and symbols.');

      return;

    }

    setLoading(true);

    try {

      const { data } = await api.post('/auth/register/reseller', form);

      const result = data.data;

      if (result.requiresOtp) {

        sessionStorage.setItem('otpEmail', form.email);

        sessionStorage.setItem('otpRole', 'reseller');

        sessionStorage.setItem('otpEmailSent', result.otpEmailSent ? '1' : '1');

        sessionStorage.setItem('otpSmsSent', result.otpSmsSent ? '1' : '0');

        sessionStorage.removeItem(`otpAutoResent:${form.email}`);

        navigate('/verify-otp');

      } else if (result.token && result.user) {

        setAuthToken(result.token);

        setStoredUser(result.user);

        setUser(result.user);

        navigate(dashboardRouteForRole(result.user.role));

      }

    } catch (err) {

      setError(err instanceof Error ? err.message : 'Registration failed');

    } finally {

      setLoading(false);

    }

  };



  return (

    <AuthLayout title="Become A Reseller" subtitle="Create your reseller account">

      <form noValidate onSubmit={handleSubmit} className="space-y-4">

        <Input label="Full Name" value={form.fullName} error={fieldErrors.fullName} onChange={(e) => update('fullName', e.target.value)} />

        <Input label="Email Address" type="email" value={form.email} error={fieldErrors.email} onChange={(e) => update('email', e.target.value)} />

        <Input label="Phone Number" value={form.phone} error={fieldErrors.phone} onChange={(e) => update('phone', e.target.value)} placeholder="0XXXXXXXXX" />

        <PasswordInput

          label="Password"

          value={form.password}

          error={fieldErrors.password}

          onChange={(e) => update('password', e.target.value)}

          showStrength

        />

        <PasswordInput

          label="Confirm Password"

          value={form.confirmPassword}

          error={fieldErrors.confirmPassword}

          onChange={(e) => update('confirmPassword', e.target.value)}

        />

        <FormAlert message={error} />

        <Button type="submit" className="w-full" loading={loading}>Create Account</Button>

      </form>

      <p className="mt-4 text-center text-sm text-gray-500">

        Already have an account?{' '}

        <Link to="/login/reseller" className="text-amber-700 font-medium hover:underline">Reseller Login</Link>

      </p>

    </AuthLayout>

  );

}


