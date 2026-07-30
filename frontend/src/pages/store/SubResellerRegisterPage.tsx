import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, setAuthToken, setStoredUser } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { dashboardRouteForRole } from '@/lib/dashboard-routes';
import Input from '@/components/ui/Input';
import PasswordInput from '@/components/ui/PasswordInput';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { validateRegisterFields } from '@/lib/form-validation';
import { getPasswordStrength } from '@/lib/password-strength';
import { buildResellerStoreUrl, buildStoreHomePath, slugify, normalizeStoreSlug } from '@/lib/reseller-store-ref';
import { fetchStore } from '@/lib/store-api';
import StoreLoadState from '@/components/store/StoreLoadState';
import { X } from 'lucide-react';

interface ParentInfo {
  storeName: string;
  storeId: string;
  slug: string;
  signupOpen: boolean;
  signupReason?: string;
}

export default function SubResellerRegisterPage() {
  const params = useParams();
  const slug = normalizeStoreSlug(params.slug as string || '');
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [parent, setParent] = useState<ParentInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadingParent, setLoadingParent] = useState(true);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    storeName: '',
    slug: '',
    storeDescription: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!slug) return;
    setLoadingParent(true);
    Promise.all([
      fetchStore<{ storeName: string; slug: string; resellerId: string; subResellerSignupOpen?: boolean }>(slug),
      api.get(`/store/${encodeURIComponent(slug)}/reseller-signup-info`).catch(() => null),
    ])
      .then(([storeData, signupRes]) => {
        const signupData = signupRes?.data?.data as {
          signupOpen?: boolean;
          signupReason?: string;
        } | undefined;
        const signupOpen =
          signupData?.signupOpen ??
          storeData.subResellerSignupOpen ??
          false;
        setParent({
          storeName: storeData.storeName,
          storeId: storeData.resellerId,
          slug: storeData.slug,
          signupOpen,
          signupReason: signupData?.signupReason,
        });
        if (!signupOpen) {
          setLoadError(
            signupData?.signupReason ||
              'This store is not accepting new resellers right now. Please check back later.'
          );
        } else {
          setLoadError('');
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Store not found'))
      .finally(() => setLoadingParent(false));
  }, [slug, retryKey]);

  const update = (field: string, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === 'storeName' && !f.slug) {
        next.slug = slugify(value);
      }
      return next;
    });
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const previewSlug = slugify(form.slug || form.storeName) || 'your-slug';
  const storePreviewUrl = buildResellerStoreUrl(previewSlug);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const errors = validateRegisterFields(form);
    if (!form.storeName.trim()) errors.storeName = 'Store name is required';
    if (!form.slug.trim()) errors.slug = 'Store URL slug is required';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const strength = getPasswordStrength(form.password);
    if (strength.level === 'weak' || strength.level === 'fair') {
      setError('Choose a stronger password with uppercase, lowercase, numbers, and symbols.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/register/sub-reseller', {
        parentStoreSlug: slug,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        confirmPassword: form.confirmPassword,
        storeName: form.storeName,
        slug: form.slug,
        storeDescription: form.storeDescription,
      });
      const result = data.data;

      if (result.requiresOtp) {
        sessionStorage.setItem('otpEmail', form.email);
        sessionStorage.setItem('otpRole', 'reseller');
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
      setSubmitting(false);
    }
  };

  if (!slug) {
    return <StoreLoadState loading={false} error="Invalid store link" />;
  }

  if (loadingParent || loadError) {
    return (
      <StoreLoadState
        loading={loadingParent}
        error={loadError}
        context="signup"
        onRetry={() => setRetryKey((key) => key + 1)}
      />
    );
  }

  if (!parent) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl relative overflow-hidden">
        <Link
          to={buildStoreHomePath(slug)}
          className="absolute top-4 right-4 p-2 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </Link>

        <div className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold italic text-gray-900 mb-6 pr-8">Become a Reseller</h1>

          <div className="rounded-2xl bg-violet-50 border border-violet-100 p-4 mb-6 text-sm text-gray-700">
            <p className="mb-3">
              Create your own store and set your prices on top of{' '}
              <span className="font-semibold">{parent.storeName}</span>&apos;s prices.
            </p>
            <div className="space-y-1 text-xs uppercase tracking-wide text-gray-500">
              <p>
                <span className="font-medium text-gray-600">Parent store</span>
              </p>
              <p className="normal-case text-sm font-semibold text-gray-900">{parent.storeName}</p>
              <p className="mt-2">
                <span className="font-medium text-gray-600">Store ID</span>
              </p>
              <p className="normal-case text-xs font-mono text-gray-800 break-all">{parent.storeId}</p>
            </div>
          </div>

          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Full Name *"
              value={form.fullName}
              error={fieldErrors.fullName}
              onChange={(e) => update('fullName', e.target.value)}
            />
            <Input
              label="Phone *"
              value={form.phone}
              error={fieldErrors.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="0XXXXXXXXX"
            />
            <Input
              label="Email *"
              type="email"
              value={form.email}
              error={fieldErrors.email}
              onChange={(e) => update('email', e.target.value)}
            />
            <PasswordInput
              label="Password *"
              value={form.password}
              error={fieldErrors.password}
              onChange={(e) => update('password', e.target.value)}
              showStrength
            />
            <PasswordInput
              label="Confirm Password *"
              value={form.confirmPassword}
              error={fieldErrors.confirmPassword}
              onChange={(e) => update('confirmPassword', e.target.value)}
            />
            <Input
              label="Store Name *"
              value={form.storeName}
              error={fieldErrors.storeName}
              onChange={(e) => update('storeName', e.target.value)}
            />
            <div>
              <Input
                label="Store URL Slug *"
                value={form.slug}
                error={fieldErrors.slug}
                onChange={(e) => update('slug', slugify(e.target.value))}
              />
              <p className="text-xs text-gray-500 mt-1.5">
                Your store will be available at:{' '}
                <span className="font-medium text-violet-700 break-all">{storePreviewUrl}</span>
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                Store Description (Optional)
              </label>
              <textarea
                value={form.storeDescription}
                onChange={(e) => update('storeDescription', e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none resize-none"
                placeholder="Tell customers about your store..."
              />
            </div>

            <FormAlert message={error} />

            <Button type="submit" className="w-full bg-violet-600 hover:bg-violet-700" loading={submitting}>
              Register
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Already a reseller?{' '}
            <Link to="/login/reseller" className="text-violet-700 font-medium hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
