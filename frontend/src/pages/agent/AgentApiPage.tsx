import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Textarea from '@/components/ui/Textarea';
import { useNavigate } from 'react-router';
import { Copy, Check, BookOpen, Key, Shield, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

function getAgentApiBaseUrl() {
  const appUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${appUrl.replace(/\/$/, '')}/api/v1/agent`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
      aria-label="Copy"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-emerald-100 text-emerald-800',
    POST: 'bg-blue-100 text-blue-800',
    PUT: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-bold font-mono', colors[method] || 'bg-gray-100 text-gray-700')}>
      {method}
    </span>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative group">
      <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto font-mono leading-relaxed">{code}</pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function EndpointDoc({
  method,
  path,
  description,
  request,
  response,
}: {
  method: string;
  path: string;
  description: string;
  request?: string;
  response: string;
}) {
  const base = getAgentApiBaseUrl();
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <MethodBadge method={method} />
        <code className="text-sm font-mono text-gray-900">{path}</code>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-600">{description}</p>
        <p className="text-xs text-gray-500">
          Full URL: <code className="text-gray-800">{base}{path.split(' ')[0]}</code>
        </p>
        {request && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Request</p>
            <CodeBlock code={request} />
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Response</p>
          <CodeBlock code={response} />
        </div>
      </div>
    </div>
  );
}

type ApiAccessStatus = {
  approvalStatus: 'none' | 'pending' | 'approved' | 'rejected';
  isActive?: boolean;
  requestedAt?: string;
  rejectionReason?: string;
  requestMessage?: string;
  hasCredentials?: boolean;
};

export default function AgentApiPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [apiStatus, setApiStatus] = useState<ApiAccessStatus | null>(null);
  const [creds, setCreds] = useState<Record<string, unknown>>({});
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [stats, setStats] = useState<Array<Record<string, unknown>>>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [credsError, setCredsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const apiBase = getAgentApiBaseUrl();
  const isApproved = apiStatus?.approvalStatus === 'approved';

  useEffect(() => {
    if (!loading && (!user || user.role !== 'agent')) navigate('/login/agent');
  }, [user, loading, navigate]);

  const loadStatus = useCallback(() => {
    api.get('/agent/api/status').then((res) => setApiStatus(res.data.data)).catch(console.error);
  }, []);

  const loadCreds = useCallback(() => {
    setCredsError('');
    api
      .get('/agent/api/credentials')
      .then((res) => {
        const data = res.data.data;
        setCreds(data);
        setApiStatus((prev) => ({
          approvalStatus: data.approvalStatus ?? prev?.approvalStatus ?? 'approved',
          isActive: data.isActive,
          requestedAt: data.requestedAt,
          rejectionReason: data.rejectionReason,
          requestMessage: data.requestMessage,
          hasCredentials: data.hasCredentials,
        }));
        setWebhookUrl((data.webhookUrl as string) || '');
        setIpWhitelist(Array.isArray(data.ipWhitelist) ? (data.ipWhitelist as string[]).join('\n') : '');
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load credentials';
        setCredsError(message);
        console.error(err);
      });
  }, []);

  useEffect(() => {
    if (user?.role === 'agent') {
      loadStatus();
    }
  }, [user, loadStatus]);

  useEffect(() => {
    if (user?.role === 'agent' && isApproved) {
      loadCreds();
      api.get('/agent/api/logs').then((res) => setLogs(res.data.data)).catch(console.error);
      api.get('/agent/api/stats').then((res) => setStats(res.data.data)).catch(console.error);
    }
  }, [user, isApproved, loadCreds]);

  const submitRequest = async () => {
    setSubmittingRequest(true);
    setRequestError('');
    setSettingsMsg('');
    try {
      await api.post('/agent/api/request', { message: requestMessage.trim() || undefined });
      setSettingsMsg('Request submitted. An admin will review it shortly.');
      setRequestMessage('');
      loadStatus();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const regenerate = async () => {
    if (!confirm('Regenerating keys will invalidate your current API credentials. Continue?')) return;
    const res = await api.post('/agent/api/regenerate');
    setCreds((prev) => ({ ...prev, ...res.data.data }));
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg('');
    setSettingsError('');
    try {
      const ips = ipWhitelist
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api.put('/agent/api/settings', { ipWhitelist: ips, webhookUrl: webhookUrl || '' });
      setSettingsMsg('API settings saved.');
      loadCreds();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const exampleCurl = `curl -X POST "${apiBase}/purchase" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${creds.apiKey || 'YOUR_API_KEY'}" \\
  -H "x-secret-key: ${creds.secretKey || 'YOUR_SECRET_KEY'}" \\
  -d '{"packageId":"PACKAGE_ID","recipientPhone":"0241234567"}'`;

  if (loading || !user) return null;

  if (!isApproved) {
    const status = apiStatus?.approvalStatus ?? 'none';
    return (
      <DashboardLayout role="agent">
        <div className="mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Developer API</h1>
          <p className="text-sm text-gray-400">
            Request access to integrate data, AFA, and results checker purchases into your website.
          </p>
        </div>

        <Card className="max-w-xl">
          <CardBody className="space-y-4">
            {status === 'none' || status === 'rejected' ? (
              <>
                {status === 'rejected' && (
                  <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <XCircle className="w-5 h-5 shrink-0" />
                    <div>
                      <p className="font-medium">Previous request declined</p>
                      <p className="mt-1">{apiStatus?.rejectionReason || 'Contact admin for details.'}</p>
                    </div>
                  </div>
                )}
                <p className="text-sm text-gray-600">
                  Submit a request and an admin will approve your API access before keys are issued.
                </p>
                <Textarea
                  label="Message to admin (optional)"
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  placeholder="Briefly describe how you plan to use the API..."
                  rows={3}
                />
                {requestError && <p className="text-sm text-red-600">{requestError}</p>}
                {settingsMsg && <p className="text-sm text-emerald-700">{settingsMsg}</p>}
                <Button onClick={submitRequest} loading={submittingRequest} disabled={submittingRequest}>
                  Request API access
                </Button>
              </>
            ) : (
              <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <Clock className="w-5 h-5 shrink-0" />
                <div>
                  <p className="font-medium">Request pending approval</p>
                  <p className="mt-1">
                    Your API access request is waiting for admin review. You will be notified once approved.
                  </p>
                  {apiStatus?.requestMessage && (
                    <p className="mt-2 text-amber-800">Your note: {apiStatus.requestMessage}</p>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="agent">
      <div className="mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Developer API</h1>
        <p className="text-sm text-gray-400">
          Connect your website to buy data (including MTN Express with Smart Data Hub number
          verification), MTN AFA registration, and BECE/WASSCE results checkers using your Agent
          wallet balance.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-gold" />
              <h2 className="font-semibold text-gray-900">API Credentials</h2>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {credsError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                {credsError}
              </p>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-500 uppercase">API Key</p>
                <CopyButton text={String(creds.apiKey || '')} />
              </div>
              <code className="text-sm bg-gray-100 text-gray-900 p-3 rounded-lg block break-all min-h-[2.75rem]">
                {(creds.apiKey as string) || 'Loading…'}
              </code>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-500 uppercase">Secret Key</p>
                <CopyButton text={String(creds.secretKey || '')} />
              </div>
              <code className="text-sm bg-gray-100 text-gray-900 p-3 rounded-lg block break-all min-h-[2.75rem]">
                {(creds.secretKey as string) || 'Loading…'}
              </code>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
              Never share your secret key publicly or commit it to source control.
            </p>
            <Button size="sm" variant="outline" onClick={regenerate}>Regenerate keys</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">Security settings</h2>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <Textarea
              label="IP whitelist (one IP per line, optional)"
              value={ipWhitelist}
              onChange={(e) => setIpWhitelist(e.target.value)}
              placeholder="203.0.113.10&#10;203.0.113.11"
              rows={3}
            />
            <Textarea
              label="Webhook URLs (one URL per line — all connected sites get status updates)"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={'https://site-a.com/webhooks/topdeals\nhttps://site-b.com/api/status'}
              rows={3}
            />
            <p className="text-xs text-gray-500 -mt-2">
              When an order status changes, we POST JSON to every URL listed here (signed with your secret key).
            </p>
            {settingsMsg && <p className="text-sm text-emerald-700">{settingsMsg}</p>}
            {settingsError && <p className="text-sm text-red-600">{settingsError}</p>}
            <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? 'Saving...' : 'Save security settings'}
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-gray-700" />
            <h2 className="font-semibold text-gray-900">API reference</h2>
          </div>
        </CardHeader>
        <CardBody className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500 uppercase">Base URL</p>
              <code className="text-xs text-gray-900 break-all">{apiBase}</code>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500 uppercase">Auth headers</p>
              <p className="text-xs text-gray-900 font-mono">x-api-key<br />x-secret-key</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500 uppercase">Rate limit</p>
              <p className="text-gray-900">60 requests / minute</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500 uppercase">Phone format</p>
              <p className="text-gray-900">0XXXXXXXXX (10 digits)</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Authentication</h3>
            <p className="text-sm text-gray-600 mb-3">
              Send your API key and secret key on every request. If an IP whitelist is configured, only those server IPs are allowed.
            </p>
            <CodeBlock code={`GET ${apiBase}/wallet
Headers:
  x-api-key: ${creds.apiKey || 'YOUR_API_KEY'}
  x-secret-key: ${creds.secretKey || 'YOUR_SECRET_KEY'}`} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Quick start (cURL)</h3>
            <CodeBlock code={exampleCurl} />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Endpoints</h3>

            <EndpointDoc
              method="GET"
              path="/wallet"
              description="Returns your current Agent wallet balance in GHS. Purchases are debited from this balance."
              response={`{
  "success": true,
  "data": { "balance": 150.50 }
}`}
            />

            <EndpointDoc
              method="GET"
              path="/networks"
              description="Lists all enabled mobile networks available for purchase (includes MTN and MTN Express)."
              response={`{
  "success": true,
  "data": [
    { "network": "MTN", "inStock": true, "imageUrl": "/images/mtn.jpg" },
    { "network": "MTN Express", "inStock": true, "imageUrl": "/images/mtn-express.png" },
    { "network": "Telecel", "inStock": true, "imageUrl": "/images/telecel.jpg" },
    { "network": "AirtelTigo", "inStock": true, "imageUrl": "/images/airteltigo.jpg" }
  ]
}`}
            />

            <EndpointDoc
              method="GET"
              path="/packages?network=MTN%20Express"
              description="Lists enabled data bundles. Optional query parameter network filters by MTN, MTN Express, Telecel, or AirtelTigo. Prices shown are Agent prices (debited from your wallet)."
              response={`{
  "success": true,
  "data": [
    {
      "_id": "665abc...",
      "network": "MTN Express",
      "bundleSize": "1GB",
      "agentPrice": 4.31
    }
  ]
}`}
            />

            <EndpointDoc
              method="POST"
              path="/verify-express"
              description="Smart Data Hub pre-check for MTN Express. Only numbers that return verified: true may buy Express. Call this on your website before POST /purchase. If verified is false, show websiteMessage on your site and switch the customer to normal MTN using fallbackNetwork."
              request={`{
  "recipientPhone": "0241234567"
}`}
              response={`{
  "success": true,
  "data": {
    "verified": false,
    "phone": "0241234567",
    "message": "This number is not verified to buy MTN Express.",
    "code": "MTN_EXPRESS_NOT_VERIFIED",
    "fallbackNetwork": "MTN",
    "websiteMessage": "This number is not verified for MTN Express. Offer normal MTN data instead."
  }
}`}
            />

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
              <h4 className="text-sm font-semibold text-amber-950">Show reject on your website</h4>
              <p className="text-sm text-amber-900">
                When Smart Data Hub rejects a number, display the message and a button to buy normal MTN instead:
              </p>
              <CodeBlock
                code={`// After POST /verify-express
const check = await res.json();
if (!check.data.verified) {
  showBanner(check.data.websiteMessage || check.data.message);
  // Switch package picker to check.data.fallbackNetwork ("MTN")
  setNetwork(check.data.fallbackNetwork); // "MTN"
}

// If you skip verify and POST /purchase directly for MTN Express:
// HTTP 400 { "success": false, "message": "...", "code": "MTN_EXPRESS_NOT_VERIFIED" }
// Show that message the same way on your website.`}
              />
            </div>

            <EndpointDoc
              method="POST"
              path="/purchase"
              description="Buy a single data bundle. The packageId comes from GET /packages. recipientPhone must be a valid Ghana number (10 digits, starts with 0). For MTN Express, only Smart Data Hub–verified numbers can buy — unverified numbers get HTTP 400 with code MTN_EXPRESS_NOT_VERIFIED (show that on your website and offer normal MTN). Your wallet is debited the AgentPrice immediately."
              request={`{
  "packageId": "665abc123def456789012345",
  "recipientPhone": "0241234567"
}`}
              response={`// HTTP 201 success
{
  "success": true,
  "data": {
    "orderId": "ORD-M1ABC2-XY9Z",
    "network": "MTN Express",
    "bundleSize": "1GB",
    "recipientPhone": "0241234567",
    "sellingPrice": 4.73,
    "totalAmount": 4.73,
    "status": "pending",
    "source": "Agent_api",
    "createdAt": "2026-06-08T12:00:00.000Z"
  }
}

// HTTP 400 when Express number is rejected by Smart Data Hub
{
  "success": false,
  "message": "This number is not verified to buy MTN Express.",
  "code": "MTN_EXPRESS_NOT_VERIFIED"
}`}
            />

            <h4 className="text-sm font-semibold text-gray-800 pt-2">MTN AFA Registration</h4>

            <EndpointDoc
              method="GET"
              path="/afa"
              description="Returns MTN AFA registration availability, agent fee, and your wallet balance. Check inStock before submitting registrations."
              response={`{
  "success": true,
  "data": {
    "packageId": "665abc...",
    "bundleSize": "AFA",
    "fee": 25.00,
    "inStock": true,
    "processingHours": 48,
    "checkUssd": "*170#",
    "walletBalance": 150.50
  }
}`}
            />

            <EndpointDoc
              method="POST"
              path="/afa/register"
              description="Submit an MTN AFA registration. Your wallet is debited the agent fee. Requires beneficiary phone (10 digits starting with 0) and email."
              request={`{
  "phone": "0241234567",
  "email": "customer@example.com"
}`}
              response={`// HTTP 201
{
  "success": true,
  "data": {
    "orderId": "ORD-M1ABC2-XY9Z",
    "status": "processing",
    "message": "Registration submitted. Allow 48 hours, then dial *170# to check status."
  }
}`}
            />

            <h4 className="text-sm font-semibold text-gray-800 pt-2">Results Checker (BECE / WASSCE)</h4>
            <p className="text-xs text-gray-500">
              Use these endpoints on your website so customers can choose BECE or WASSCE, pay you
              (or use your wallet), and receive an unused Serial + PIN instantly by API response,
              email, and SMS. Only unused checkers are sold — assigned pins are never reused.
            </p>

            <EndpointDoc
              method="GET"
              path="/checker"
              description="Lists BECE and WASSCE result checker offers with agent fees, stock status, and available pin count. Call this to show customers which exam type is available."
              response={`{
  "success": true,
  "data": {
    "walletBalance": 150.50,
    "offers": [
      {
        "type": "bece",
        "label": "BECE",
        "packageId": "665abc...",
        "fee": 18.00,
        "inStock": true,
        "availableCount": 42
      },
      {
        "type": "wassce",
        "label": "WASSCE",
        "packageId": "665def...",
        "fee": 18.00,
        "inStock": true,
        "availableCount": 30
      }
    ]
  }
}`}
            />

            <EndpointDoc
              method="POST"
              path="/checker/purchase"
              description="Purchase one unused BECE or WASSCE checker for a customer. Set type to bece or wassce. Wallet is debited immediately. Serial and PIN are returned instantly (status delivered) and also emailed/SMS to the customer. Used checkers are never reassigned."
              request={`{
  "type": "wassce",
  "email": "customer@example.com",
  "phone": "0241234567"
}`}
              response={`// HTTP 201
{
  "success": true,
  "data": {
    "orderId": "ORD-M1ABC2-XY9Z",
    "status": "delivered",
    "type": "wassce",
    "bundleSize": "WASSCE",
    "serial": "WGC240640047",
    "pin": "319125067594",
    "message": "Checker delivered successfully."
  }
}`}
            />

            <EndpointDoc
              method="POST"
              path="/bulk-purchase"
              description="Buy multiple bundles in one request. Each line is phone + bundle size separated by a space. All lines must use the same network. Total cost is checked against wallet balance before processing."
              request={`{
  "network": "MTN",
  "lines": "0241234567 1GB\\n0559876543 2GB\\n0201112233 5GB"
}`}
              response={`// HTTP 201
{
  "success": true,
  "data": [
    { "orderId": "ORD-...", "recipientPhone": "0241234567", "status": "pending", ... },
    { "orderId": "ORD-...", "recipientPhone": "0559876543", "status": "pending", ... }
  ]
}`}
            />

            <EndpointDoc
              method="GET"
              path="/orders/:orderId"
              description="Check the status of an order you created. Only returns orders belonging to your Agent account. For results checkers, checkerDetails includes serial and pin when delivered."
              response={`{
  "success": true,
  "data": {
    "orderId": "ORD-M1ABC2-XY9Z",
    "network": "MTN",
    "productType": "checker",
    "bundleSize": "WASSCE",
    "recipientPhone": "0241234567",
    "customerEmail": "customer@example.com",
    "sellingPrice": 18.00,
    "status": "delivered",
    "source": "agent_api",
    "checkerDetails": {
      "type": "wassce",
      "serial": "WGC240640047",
      "pin": "319125067594"
    },
    "createdAt": "2026-06-08T12:00:00.000Z",
    "updatedAt": "2026-06-08T12:00:05.000Z"
  }
}`}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Order statuses</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              {['pending', 'processing', 'delivered', 'failed', 'refunded', 'cancelled'].map((s) => (
                <span key={s} className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-mono capitalize">{s}</span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Status webhooks</h3>
            <p className="text-sm text-gray-600 mb-3">
              Set one or more webhook URLs in Security settings. Whenever your order status updates
              (processing, submitted for verification, delivered, failed, etc.), we POST to every URL.
            </p>
            <CodeBlock
              code={`POST https://your-site.com/webhooks/topdeals
Headers:
  Content-Type: application/json
  X-TopDeals-Event: order.delivered
  X-TopDeals-Signature: sha256=<hmac_of_raw_body_using_your_secret_key>

{
  "event": "order.delivered",
  "orderId": "TD-ABC123",
  "status": "delivered",
  "providerStatus": "delivered",
  "recipientPhone": "0244123456",
  "network": "MTN",
  "bundleSize": "1GB",
  "sellingPrice": 4.5,
  "productType": "data",
  "source": "agent_api",
  "providerReference": "...",
  "updatedAt": "2026-07-29T09:00:00.000Z",
  "createdAt": "2026-07-29T08:55:00.000Z"
}`}
            />
            <p className="text-xs text-gray-500 mt-2">
              Verify <code className="font-mono">X-TopDeals-Signature</code> with HMAC-SHA256 of the
              raw request body using your secret key.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Error responses</h3>
            <p className="text-sm text-gray-600 mb-3">
              All errors return JSON with success: false and a message. Common HTTP status codes:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="py-2 pr-4 text-gray-500 font-medium">Code</th>
                    <th className="py-2 text-gray-500 font-medium">Meaning</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  <tr className="border-b border-gray-100"><td className="py-2 pr-4 font-mono">401</td><td>Missing or invalid API credentials</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 pr-4 font-mono">403</td><td>IP address not on whitelist</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 pr-4 font-mono">404</td><td>Order not found</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 pr-4 font-mono">400</td><td>Invalid input, insufficient balance, or disabled package</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 pr-4 font-mono">429</td><td>Rate limit exceeded (60 req/min)</td></tr>
                </tbody>
              </table>
            </div>
            <CodeBlock code={`{
  "success": false,
  "message": "Insufficient wallet balance"
}`} />
          </div>
        </CardBody>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><h2 className="font-semibold text-gray-900">Usage statistics</h2></CardHeader>
          <CardBody>
            {stats.length === 0 ? (
              <p className="text-sm text-gray-500">No API calls recorded yet.</p>
            ) : (
              stats.map((s, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:justify-between gap-1 py-2 border-b border-gray-100 text-sm last:border-0">
                  <span className="font-mono text-gray-800 break-all">{s._id as string}</span>
                  <span className="text-gray-500 shrink-0">{s.count as number} calls · avg {Math.round(s.avgResponseTime as number)}ms</span>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h2 className="font-semibold text-gray-900">Recent API logs</h2></CardHeader>
          <CardBody className="max-h-64 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-sm text-gray-500">No API logs yet.</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="text-xs py-2 border-b border-gray-100 last:border-0">
                  <span className={cn(
                    'font-mono font-bold',
                    (log.statusCode as number) < 400 ? 'text-emerald-700' : 'text-red-600'
                  )}>
                    {log.method as string}
                  </span>
                  <span className="text-gray-700"> {log.endpoint as string}</span>
                  <span className="text-gray-500"> — {log.statusCode as number} ({log.responseTime as number}ms)</span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </DashboardLayout>
  );
}
