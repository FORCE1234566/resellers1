import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { formatCurrency } from '@/lib/utils';
import { useNavigate, useSearchParams } from 'react-router';
import { redirectToPaystack } from '@/lib/paystack';
import { Loader2, Wallet, Settings, RefreshCw, PlugZap, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import AdminPasswordConfirm from '@/components/admin/AdminPasswordConfirm';
import { getApiHostname } from '@/lib/deploy';

type FulfillmentNetwork = 'MTN' | 'Telecel' | 'AirtelTigo';
type FulfillmentProvider = 'smartdatahub' | 'datamax';
type FulfillmentNetworkRoute = 'default' | FulfillmentProvider | 'off';
type AfaFulfillmentRoute = 'default' | 'datamax' | 'off';

type FulfillmentSettings = {
  enabled: boolean;
  defaultProvider: FulfillmentProvider;
  networkRouting: Record<FulfillmentNetwork, FulfillmentNetworkRoute>;
  afaRouting: AfaFulfillmentRoute;
  providers: {
    smartdatahub: { configured: boolean; apiUrl: string };
    datamax: { configured: boolean; apiUrl: string };
  };
  webhookUrl: string;
};

const FULFILLMENT_NETWORKS: { id: FulfillmentNetwork; label: string }[] = [
  { id: 'MTN', label: 'MTN' },
  { id: 'Telecel', label: 'Telecel' },
  { id: 'AirtelTigo', label: 'AirtelTigo' },
];

const NETWORK_ROUTE_OPTIONS: { value: FulfillmentNetworkRoute; label: string }[] = [
  { value: 'default', label: 'Use default' },
  { value: 'smartdatahub', label: 'Smart Data Hub' },
  { value: 'datamax', label: 'Datamax' },
  { value: 'off', label: 'Off' },
];

type SettingsData = {
  paystackChargePercent: number;
  minWithdrawal: number;
  withdrawalPoolBalance: number;
  totalPoolDeposits: number;
  pendingWithdrawalTotal: number;
  totalResellerProfit: number;
  totalResellerProfitOwed: number;
  totalOwed: number;
  poolShortfall: number;
  recommendedPoolTopUp: number;
  resellerEmailOtpEnabled: boolean;
  agentEmailOtpEnabled: boolean;
};

const defaultSettings: SettingsData = {
  paystackChargePercent: 2,
  minWithdrawal: 30,
  withdrawalPoolBalance: 0,
  totalPoolDeposits: 0,
  pendingWithdrawalTotal: 0,
  totalResellerProfit: 0,
  totalResellerProfitOwed: 0,
  totalOwed: 0,
  poolShortfall: 0,
  recommendedPoolTopUp: 0,
  resellerEmailOtpEnabled: true,
  agentEmailOtpEnabled: true,
};

const AFA_ROUTE_OPTIONS: { value: AfaFulfillmentRoute; label: string }[] = [
  { value: 'default', label: 'Use default (Datamax)' },
  { value: 'datamax', label: 'Datamax' },
  { value: 'off', label: 'Off' },
];

const defaultFulfillment: FulfillmentSettings = {
  enabled: false,
  defaultProvider: 'smartdatahub',
  networkRouting: { MTN: 'off', Telecel: 'off', AirtelTigo: 'off' },
  afaRouting: 'datamax',
  providers: {
    smartdatahub: { configured: false, apiUrl: 'https://smartdatahubgh.com/api/v1' },
    datamax: { configured: false, apiUrl: 'https://datamax.site/wp-json/api/v1' },
  },
  webhookUrl: '',
};

function normalizeNetworkRoute(value: unknown): FulfillmentNetworkRoute {
  if (value === true) return 'smartdatahub';
  if (value === false) return 'off';
  if (value === 'default' || value === 'smartdatahub' || value === 'datamax' || value === 'off') {
    return value;
  }
  return 'off';
}

type SettingsApiData = Partial<SettingsData> & {
  /** @deprecated Legacy field from before Paystack charge was unified */
  processingFeePercent?: number;
};

function normalizeSettings(data: SettingsApiData): SettingsData {
  return {
    paystackChargePercent: Number(data.paystackChargePercent ?? data.processingFeePercent) || 2,
    minWithdrawal: Number(data.minWithdrawal) || 30,
    withdrawalPoolBalance: Number(data.withdrawalPoolBalance) || 0,
    totalPoolDeposits: Number(data.totalPoolDeposits) || 0,
    pendingWithdrawalTotal: Number(data.pendingWithdrawalTotal) || 0,
    totalResellerProfit: Number(data.totalResellerProfit ?? data.totalResellerProfitOwed) || 0,
    totalResellerProfitOwed: Number(data.totalResellerProfitOwed ?? data.totalResellerProfit) || 0,
    totalOwed: Number(data.totalOwed) || 0,
    poolShortfall: Number(data.poolShortfall) || 0,
    recommendedPoolTopUp: Number(data.recommendedPoolTopUp) || 0,
    resellerEmailOtpEnabled: data.resellerEmailOtpEnabled !== false,
    agentEmailOtpEnabled: data.agentEmailOtpEnabled !== false,
  };
}

function normalizeAfaRoute(value: unknown): AfaFulfillmentRoute {
  if (value === false) return 'off';
  if (value === 'default' || value === 'datamax' || value === 'off') return value;
  return 'datamax';
}

function normalizeFulfillment(data: Partial<FulfillmentSettings> & Record<string, unknown> | null): FulfillmentSettings {
  if (!data) return defaultFulfillment;
  const legacyApiConfigured = Boolean(data.apiConfigured);
  const providers = data.providers as FulfillmentSettings['providers'] | undefined;
  return {
    enabled: Boolean(data.enabled),
    defaultProvider: data.defaultProvider === 'datamax' ? 'datamax' : 'smartdatahub',
    webhookUrl: String(data.webhookUrl || ''),
    providers: {
      smartdatahub: {
        configured: Boolean(providers?.smartdatahub?.configured ?? legacyApiConfigured),
        apiUrl: providers?.smartdatahub?.apiUrl || 'https://smartdatahubgh.com/api/v1',
      },
      datamax: {
        configured: Boolean(providers?.datamax?.configured),
        apiUrl: providers?.datamax?.apiUrl || 'https://datamax.site/wp-json/api/v1',
      },
    },
    networkRouting: {
      MTN: normalizeNetworkRoute(data.networkRouting?.MTN),
      Telecel: normalizeNetworkRoute(data.networkRouting?.Telecel),
      AirtelTigo: normalizeNetworkRoute(data.networkRouting?.AirtelTigo),
    },
    afaRouting: normalizeAfaRoute(data.afaRouting),
  };
}

export default function AdminSettingsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const poolFunded = searchParams.get('poolFunded') === '1';
  const topUpParam = searchParams.get('topUp');
  const [settings, setSettings] = useState<SettingsData>(defaultSettings);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [paystackFunding, setPaystackFunding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    paystackChargePercent: '2',
    minWithdrawal: '30',
    resellerEmailOtpEnabled: true,
    agentEmailOtpEnabled: true,
  });
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [adminOtp, setAdminOtp] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetConfirmPhrase, setResetConfirmPhrase] = useState('');
  const [removeNonAdminUsers, setRemoveNonAdminUsers] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSummary, setResetSummary] = useState<Record<string, number> | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentSettings | null>(null);
  const [fulfillmentSaving, setFulfillmentSaving] = useState<
    FulfillmentNetwork | 'master' | 'defaultProvider' | 'afa' | null
  >(null);
  const [testingApi, setTestingApi] = useState<'smartdatahub' | 'datamax' | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [retryingQueued, setRetryingQueued] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/login/admin');
  }, [user, loading, navigate]);

  const load = useCallback(async () => {
    setPageLoading(true);
    setLoadError('');
    const errors: string[] = [];

    const [settingsResult, fulfillmentResult] = await Promise.allSettled([
      api.get('/admin/settings'),
      api.get('/admin/settings/fulfillment'),
    ]);

    if (settingsResult.status === 'fulfilled') {
      const data = normalizeSettings(settingsResult.value.data.data as SettingsApiData);
      setSettings(data);
      setForm({
        paystackChargePercent: String(data.paystackChargePercent),
        minWithdrawal: String(data.minWithdrawal),
        resellerEmailOtpEnabled: data.resellerEmailOtpEnabled,
        agentEmailOtpEnabled: data.agentEmailOtpEnabled,
      });
    } else {
      errors.push(
        settingsResult.reason instanceof Error
          ? settingsResult.reason.message
          : 'Failed to load platform settings'
      );
    }

    if (fulfillmentResult.status === 'fulfilled') {
      setFulfillment(
        normalizeFulfillment(fulfillmentResult.value.data.data as Partial<FulfillmentSettings>)
      );
    } else {
      setFulfillment(defaultFulfillment);
      errors.push(
        fulfillmentResult.reason instanceof Error
          ? fulfillmentResult.reason.message
          : 'Failed to load API routing settings'
      );
    }

    if (errors.length === 2) {
      setLoadError(errors[0]);
    } else if (errors.length === 1) {
      setLoadError(`${errors[0]} (other sections loaded)`);
    }

    setPageLoading(false);
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user, load]);

  useEffect(() => {
    if (!topUpParam) return;
    const amount = Number(topUpParam);
    if (Number.isFinite(amount) && amount > 0) {
      setDepositAmount(String(amount));
    }
  }, [topUpParam]);

  const runPlatformReset = async () => {
    if (resetConfirmPhrase !== 'RESET PLATFORM') {
      setError('Type RESET PLATFORM exactly to confirm');
      return;
    }
    if (!/^\d{6}$/.test(resetOtp)) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }
    const confirmed = window.confirm(
      removeNonAdminUsers
        ? 'This will delete ALL orders, complaints, withdrawals, wallet history, and remove every agent and reseller account. Admin accounts are kept. Continue?'
        : 'This will delete ALL orders, complaints, withdrawals, and reset every wallet balance and profit to zero. User accounts are kept. Continue?'
    );
    if (!confirmed) return;

    setResetting(true);
    setError('');
    setMessage('');
    setResetSummary(null);
    try {
      const res = await api.post('/admin/production-reset', {
        confirmPhrase: resetConfirmPhrase,
        removeNonAdminUsers,
        adminOtp: resetOtp,
      });
      setResetSummary(res.data.data);
      setMessage(res.data.message || 'Platform reset complete.');
      setResetConfirmPhrase('');
      setResetOtp('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Platform reset failed');
    } finally {
      setResetting(false);
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(adminOtp)) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.put('/admin/settings', {
        paystackChargePercent: parseFloat(form.paystackChargePercent),
        minWithdrawal: parseFloat(form.minWithdrawal),
        resellerEmailOtpEnabled: form.resellerEmailOtpEnabled,
        agentEmailOtpEnabled: form.agentEmailOtpEnabled,
        adminOtp,
      });
      setMessage('Platform settings saved.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const fundPoolViaPaystack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(adminOtp)) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }
    setPaystackFunding(true);
    setError('');
    setMessage('');
    try {
      const res = await api.post('/admin/settings/withdrawal-pool/fund', {
        amount: parseFloat(depositAmount),
        note: depositNote || undefined,
        adminOtp,
      });
      redirectToPaystack(res.data.data.authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Paystack payment');
      setPaystackFunding(false);
    }
  };

  const addPoolFundsManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(adminOtp)) {
      setError('Enter the 6-digit verification code from your email');
      return;
    }
    setDepositing(true);
    setError('');
    setMessage('');
    try {
      const res = await api.post('/admin/settings/withdrawal-pool/deposit', {
        amount: parseFloat(depositAmount),
        note: depositNote || undefined,
        adminOtp,
      });
      setMessage(res.data.message || 'Funds recorded in withdrawal pool.');
      setDepositAmount('');
      setDepositNote('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add funds');
    } finally {
      setDepositing(false);
    }
  };

  const saveFulfillment = async (
    patch: {
      enabled?: boolean;
      defaultProvider?: FulfillmentProvider;
      networkRouting?: Partial<Record<FulfillmentNetwork, FulfillmentNetworkRoute>>;
      afaRouting?: AfaFulfillmentRoute;
    },
    savingKey: FulfillmentNetwork | 'master' | 'defaultProvider' | 'afa'
  ) => {
    if (!fulfillment) return;
    setFulfillmentSaving(savingKey);
    setError('');
    setMessage('');
    try {
      const res = await api.put('/admin/settings/fulfillment', {
        enabled: patch.enabled ?? fulfillment.enabled,
        defaultProvider: patch.defaultProvider ?? fulfillment.defaultProvider,
        afaRouting: patch.afaRouting ?? fulfillment.afaRouting,
        networkRouting: {
          ...fulfillment.networkRouting,
          ...patch.networkRouting,
        },
      });
      setFulfillment(normalizeFulfillment(res.data.data as Partial<FulfillmentSettings>));
      setMessage('External API routing updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update API routing');
    } finally {
      setFulfillmentSaving(null);
    }
  };

  const testFulfillmentApi = async (provider: FulfillmentProvider) => {
    setTestingApi(provider);
    setError('');
    setMessage('');
    try {
      const res = await api.post(`/admin/settings/fulfillment/test?provider=${provider}`);
      const balance =
        provider === 'datamax' && res.data.data?.balance != null
          ? ` Balance: GHS ${Number(res.data.data.balance).toFixed(2)}.`
          : '';
      setMessage((res.data.data?.message || `${provider} connection successful.`) + balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'API connection test failed');
    } finally {
      setTestingApi(null);
    }
  };

  const checkDatamaxBalance = async () => {
    setCheckingBalance(true);
    setError('');
    setMessage('');
    try {
      const res = await api.post('/admin/settings/fulfillment/check-balance?provider=datamax');
      const balance = res.data.data?.balance;
      setMessage(
        balance != null
          ? `Datamax wallet balance: GHS ${Number(balance).toFixed(2)}`
          : res.data.data?.message || 'Balance retrieved.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check Datamax balance');
    } finally {
      setCheckingBalance(false);
    }
  };

  const retryQueuedOrders = async () => {
    setRetryingQueued(true);
    setError('');
    setMessage('');
    try {
      const res = await api.post('/admin/settings/fulfillment/retry-queued');
      const count = res.data.data?.retried ?? 0;
      setMessage(
        count > 0
          ? `Resubmitted ${count} queued order(s) to fulfillment providers.`
          : 'No queued orders needed resubmission.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry queued orders');
    } finally {
      setRetryingQueued(false);
    }
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout role="admin">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Settings</h1>
          <p className="text-sm text-gray-400">Platform fees, withdrawal rules, and payout pool funding.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={pageLoading}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {loadError && (
        <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {poolFunded && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg mb-4">
          Withdrawal pool funded via Paystack. Balance updated.
        </p>
      )}
      {message && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg mb-4">{message}</p>
      )}
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">{error}</p>
      )}

      {pageLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading settings...
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <PlugZap className="w-5 h-5 text-sky-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Fulfillment API routing
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Route orders to Smart Data Hub or Datamax per network. If a provider wallet is empty,
              orders queue and resubmit when funded — no duplicates (idempotency per order ID).
            </p>

            {fulfillment && !fulfillment.providers.smartdatahub.configured && !fulfillment.providers.datamax.configured && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                Configure at least one provider on the server:
                <br />
                Smart Data Hub: <code className="text-xs">FULFILLMENT_API_ENABLED</code>,{' '}
                <code className="text-xs">FULFILLMENT_API_KEY</code>,{' '}
                <code className="text-xs">FULFILLMENT_API_SECRET</code>
                <br />
                Datamax: <code className="text-xs">DATAMAX_API_ENABLED</code>,{' '}
                <code className="text-xs">DATAMAX_API_KEY</code>
                <br />
                Whitelist <code className="text-xs">{getApiHostname()}</code> where required.
              </p>
            )}

            {fulfillment && (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <Button
                    type="button"
                    size="sm"
                    variant={fulfillment.enabled ? 'primary' : 'outline'}
                    disabled={fulfillmentSaving !== null}
                    onClick={() => saveFulfillment({ enabled: !fulfillment.enabled }, 'master')}
                  >
                    {fulfillmentSaving === 'master'
                      ? 'Saving...'
                      : fulfillment.enabled
                        ? 'API forwarding: ON'
                        : 'API forwarding: OFF'}
                  </Button>
                  <span className="text-xs text-gray-500">
                    Master switch — turns off all networks at once
                  </span>
                </div>

                <div className="mb-5">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default provider
                  </label>
                  <select
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 min-w-[220px] disabled:opacity-50"
                    disabled={fulfillmentSaving !== null || !fulfillment.enabled}
                    value={fulfillment.defaultProvider}
                    onChange={(e) =>
                      saveFulfillment(
                        { defaultProvider: e.target.value as FulfillmentProvider },
                        'defaultProvider'
                      )
                    }
                  >
                    <option value="smartdatahub">Smart Data Hub</option>
                    <option value="datamax">Datamax</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Used for networks set to &quot;Use default&quot;
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  {FULFILLMENT_NETWORKS.map((network) => {
                    const route = fulfillment.networkRouting[network.id];
                    const routeLabel =
                      NETWORK_ROUTE_OPTIONS.find((o) => o.value === route)?.label || route;
                    return (
                      <div
                        key={network.id}
                        className={cn(
                          'rounded-xl border-2 p-4 text-left',
                          fulfillment.enabled && route !== 'off'
                            ? 'border-sky-500 bg-sky-50'
                            : 'border-gray-200 bg-gray-50',
                          !fulfillment.enabled && 'opacity-50'
                        )}
                      >
                        <p className="font-semibold text-gray-900">{network.label}</p>
                        <select
                          className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:opacity-50"
                          disabled={fulfillmentSaving !== null || !fulfillment.enabled}
                          value={route}
                          onChange={(e) =>
                            saveFulfillment(
                              {
                                networkRouting: {
                                  [network.id]: e.target.value as FulfillmentNetworkRoute,
                                },
                              },
                              network.id
                            )
                          }
                        >
                          {NETWORK_ROUTE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs mt-2 text-gray-600">
                          {fulfillmentSaving === network.id ? 'Saving...' : routeLabel}
                        </p>
                      </div>
                    );
                  })}
                  <div
                    className={cn(
                      'rounded-xl border-2 p-4 text-left',
                      fulfillment.enabled && fulfillment.afaRouting !== 'off'
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-gray-200 bg-gray-50',
                      !fulfillment.enabled && 'opacity-50'
                    )}
                  >
                    <p className="font-semibold text-gray-900">AFA Registration</p>
                    <p className="text-xs text-gray-500 mt-0.5">MTN farmer registration via Datamax</p>
                    <select
                      className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:opacity-50"
                      disabled={fulfillmentSaving !== null || !fulfillment.enabled}
                      value={fulfillment.afaRouting}
                      onChange={(e) =>
                        saveFulfillment(
                          { afaRouting: e.target.value as AfaFulfillmentRoute },
                          'afa'
                        )
                      }
                    >
                      {AFA_ROUTE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs mt-2 text-gray-600">
                      {fulfillmentSaving === 'afa'
                        ? 'Saving...'
                        : AFA_ROUTE_OPTIONS.find((o) => o.value === fulfillment.afaRouting)?.label ||
                          fulfillment.afaRouting}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={testingApi !== null || !fulfillment.providers.smartdatahub.configured}
                    onClick={() => testFulfillmentApi('smartdatahub')}
                  >
                    {testingApi === 'smartdatahub' ? 'Testing...' : 'Test Smart Data Hub'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={testingApi !== null || !fulfillment.providers.datamax.configured}
                    onClick={() => testFulfillmentApi('datamax')}
                  >
                    {testingApi === 'datamax' ? 'Testing...' : 'Test Datamax'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={checkingBalance || !fulfillment.providers.datamax.configured}
                    onClick={checkDatamaxBalance}
                  >
                    {checkingBalance ? 'Checking...' : 'Datamax balance'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      retryingQueued ||
                      (!fulfillment.providers.smartdatahub.configured &&
                        !fulfillment.providers.datamax.configured)
                    }
                    onClick={retryQueuedOrders}
                  >
                    {retryingQueued ? 'Retrying...' : 'Retry queued orders'}
                  </Button>
                </div>

                <div className="text-xs text-gray-500 space-y-1 break-all">
                  <p>
                    Smart Data Hub: {fulfillment.providers.smartdatahub.apiUrl}
                    {fulfillment.providers.smartdatahub.configured ? ' (configured)' : ' (not configured)'}
                  </p>
                  <p>
                    Datamax: {fulfillment.providers.datamax.apiUrl}
                    {fulfillment.providers.datamax.configured ? ' (configured)' : ' (not configured)'}
                  </p>
                  <p>Webhook: {fulfillment.webhookUrl}</p>
                </div>
              </>
            )}
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <Wallet className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-semibold text-gray-900">Reseller withdrawal pool</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <strong>Admin profit</strong> per delivered order is <strong>reseller/agent base price − Smart Data API cost</strong>. Reseller profit per sale is <strong>their selling price − reseller base price</strong>. When orders deliver, reseller profit is credited — fund the pool to cover withdrawals.
            </p>

            {settings.poolShortfall > 0 && (
              <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm font-semibold text-red-800">Pool shortfall: {formatCurrency(settings.poolShortfall)}</p>
                <p className="text-xs text-red-700 mt-1">
                  Owed to resellers ({formatCurrency(settings.totalResellerProfitOwed)}) plus pending withdrawals ({formatCurrency(settings.pendingWithdrawalTotal)}) exceeds the pool balance. Add at least {formatCurrency(settings.recommendedPoolTopUp)}.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  onClick={() => setDepositAmount(String(settings.recommendedPoolTopUp))}
                >
                  Use recommended amount
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <p className="text-xs text-gray-500">Pool balance</p>
                <p className="text-xl font-bold text-emerald-800">{formatCurrency(settings.withdrawalPoolBalance)}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-xs text-gray-500">Total deposited</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(settings.totalPoolDeposits)}</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                <p className="text-xs text-gray-500">Pending requests</p>
                <p className="text-xl font-bold text-amber-800">{formatCurrency(settings.pendingWithdrawalTotal)}</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                <p className="text-xs text-gray-500">Reseller earnings owed</p>
                <p className="text-xl font-bold text-blue-800">{formatCurrency(settings.totalResellerProfitOwed || settings.totalResellerProfit)}</p>
              </div>
              <div className="p-3 rounded-lg bg-violet-50 border border-violet-100 col-span-2">
                <p className="text-xs text-gray-500">Total liability (owed + pending withdrawals)</p>
                <p className="text-xl font-bold text-violet-800">{formatCurrency(settings.totalOwed)}</p>
              </div>
            </div>

            <form noValidate className="space-y-4">
              <Input
                label="Amount to add (GHS)"
                type="number"
                step="0.01"
                min="1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 500"
              />
              <Input
                label="Note (optional)"
                value={depositNote}
                onChange={(e) => setDepositNote(e.target.value)}
                placeholder="MoMo ref, bank transfer, etc."
              />
              <AdminPasswordConfirm value={adminOtp} onChange={setAdminOtp} />
              <p className="text-xs text-gray-500 -mt-2">
                This code confirms withdrawal pool funding on this page.
              </p>
              <Button
                type="button"
                className="w-full"
                disabled={paystackFunding || !depositAmount}
                onClick={fundPoolViaPaystack}
              >
                {paystackFunding ? 'Opening Paystack...' : 'Fund pool via Paystack (MoMo / Card)'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={depositing || !depositAmount}
                onClick={addPoolFundsManual}
              >
                {depositing ? 'Recording...' : 'Record manual deposit (cash / bank already received)'}
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <Settings className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Platform settings</h2>
            </div>

            <form noValidate onSubmit={saveSettings} className="space-y-4">
              <Input
                label="Paystack charge (%) — all card/MoMo payments"
                type="number"
                step="0.1"
                value={form.paystackChargePercent}
                onChange={(e) => setForm((f) => ({ ...f, paystackChargePercent: e.target.value }))}
              />
              <p className="text-xs text-gray-500 -mt-2">
                Applies to customer store orders, agent wallet top-ups, and reseller wallet top-ups (e.g. GHS 5.00 → GHS 5.10 at 2%).
              </p>
              <Input
                label="Minimum reseller withdrawal (GHS)"
                type="number"
                step="1"
                value={form.minWithdrawal}
                onChange={(e) => setForm((f) => ({ ...f, minWithdrawal: e.target.value }))}
              />

              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Email OTP (login &amp; signup)</h3>
                <p className="text-xs text-gray-500">
                  When off, resellers or agents sign in with password only — no email verification code.
                  Individual overrides are available on the Resellers and Agents pages.
                </p>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700 cursor-pointer">
                  <span>Require reseller email OTP</span>
                  <input
                    type="checkbox"
                    checked={form.resellerEmailOtpEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, resellerEmailOtpEnabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-gray-700 cursor-pointer">
                  <span>Require agent email OTP</span>
                  <input
                    type="checkbox"
                    checked={form.agentEmailOtpEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, agentEmailOtpEnabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </label>
              </div>

              <AdminPasswordConfirm value={adminOtp} onChange={setAdminOtp} />
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save settings'}
              </Button>
            </form>
          </Card>

          <Card className="p-6 border-red-200">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h2 className="text-lg font-semibold text-gray-900">Reset platform data</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Permanently clears all orders, complaints, withdrawals, wallet transactions, audit logs, and
              notification history. All wallet balances, profit, referral earnings, and the withdrawal pool
              return to zero. Packages and user accounts stay unless you choose to remove agents and resellers.
            </p>

            <label className="flex items-start gap-2 mb-4 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={removeNonAdminUsers}
                onChange={(e) => setRemoveNonAdminUsers(e.target.checked)}
              />
              <span>
                Also delete all agent and reseller accounts (admin logins are kept). Use only when starting
                completely fresh.
              </span>
            </label>

            <div className="space-y-4">
              <Input
                label='Type "RESET PLATFORM" to confirm'
                value={resetConfirmPhrase}
                onChange={(e) => setResetConfirmPhrase(e.target.value)}
                placeholder="RESET PLATFORM"
                autoComplete="off"
              />
              <AdminPasswordConfirm value={resetOtp} onChange={setResetOtp} />
              <Button
                type="button"
                variant="outline"
                className="w-full border-red-300 text-red-700 hover:bg-red-50"
                disabled={resetting}
                onClick={runPlatformReset}
              >
                {resetting ? 'Resetting platform...' : 'Reset all platform data'}
              </Button>
            </div>

            {resetSummary && (
              <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-700 space-y-1">
                <p>Orders deleted: {resetSummary.ordersDeleted}</p>
                <p>Complaints deleted: {resetSummary.complaintsDeleted}</p>
                <p>Withdrawals deleted: {resetSummary.withdrawalsDeleted}</p>
                <p>Wallet transactions deleted: {resetSummary.walletTransactionsDeleted}</p>
                <p>Wallets reset: {resetSummary.walletsReset}</p>
                {resetSummary.usersRemoved > 0 && <p>Users removed: {resetSummary.usersRemoved}</p>}
              </div>
            )}
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
