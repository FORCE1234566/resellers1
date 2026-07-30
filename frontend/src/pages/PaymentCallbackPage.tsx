import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useSearchParams, Link, useNavigate } from 'react-router';
import { buildStoreHomePath, buildStoreCheckerSuccessPath } from '@/lib/reseller-store-ref';

type Fulfillment =
  | { type: 'wallet_deposit'; alreadyProcessed?: boolean }
  | {
      type: 'customer_purchase';
      storeSlug?: string;
      orderId?: string;
      productType?: string;
      alreadyProcessed?: boolean;
    }
  | { type: 'pool_deposit'; alreadyProcessed?: boolean; amount?: number }
  | { type: 'unknown' };

function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const [status, setStatus] = useState<'loading' | 'success' | 'failed' | 'paid_pending'>('loading');
  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!reference) {
      setStatus('failed');
      setErrorMessage('No payment reference was returned from Paystack.');
      return;
    }

    api
      .get(`/webhooks/verify/${reference}`)
      .then((res) => {
        const payment = res.data.data;
        const ok = payment.status === 'success';
        setStatus(ok ? 'success' : 'failed');
        setFulfillment(payment.fulfillment || null);
        if (!ok) {
          setErrorMessage('Paystack reported this payment as unsuccessful or cancelled.');
        }

        if (ok && payment.fulfillment?.type === 'wallet_deposit') {
          setTimeout(() => navigate('/agent/wallet?funded=1'), 2500);
        }
        if (ok && payment.fulfillment?.type === 'pool_deposit') {
          setTimeout(() => navigate('/admin/settings?poolFunded=1'), 2500);
        }
        if (ok && payment.fulfillment?.type === 'customer_purchase' && payment.fulfillment.storeSlug) {
          const f = payment.fulfillment;
          if (f.productType === 'checker' && f.orderId) {
            const email = sessionStorage.getItem('checker_checkout_email') || '';
            setTimeout(
              () =>
                navigate(
                  buildStoreCheckerSuccessPath(f.storeSlug!, f.orderId!, email || undefined)
                ),
              2000
            );
          } else {
            setTimeout(
              () =>
                navigate(buildStoreHomePath(f.storeSlug!, { tab: 'history', paid: '1' })),
              2500
            );
          }
        }
      })
      .catch((err: Error) => {
        const message = err.message || 'Could not verify payment with the server.';
        if (message.includes('Cannot reach server')) {
          setErrorMessage(
            'Cannot reach the payment server. The site may be misconfigured — contact support.'
          );
        } else if (message.includes('Fulfillment') || message.includes('mismatch') || message.includes('Package')) {
          setStatus('paid_pending');
          setErrorMessage(
            `Payment was received but order setup failed: ${message}. Contact support with ref ${reference}.`
          );
        } else {
          setStatus('failed');
          setErrorMessage(message);
        }
      });
  }, [reference, navigate]);

  const storeSlug =
    fulfillment?.type === 'customer_purchase' ? fulfillment.storeSlug : undefined;
  const orderId =
    fulfillment?.type === 'customer_purchase' ? fulfillment.orderId : undefined;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
            <p className="text-gray-500">Verifying payment...</p>
          </div>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Payment Successful</h1>
            {fulfillment?.type === 'wallet_deposit' && (
              <p className="text-gray-500 mb-6">
                Your Agent wallet has been credited. Redirecting to wallet...
              </p>
            )}
            {fulfillment?.type === 'customer_purchase' && fulfillment.productType === 'checker' && (
              <p className="text-gray-500 mb-6">
                Your checker is ready. Redirecting to show your serial and PIN...
              </p>
            )}
            {fulfillment?.type === 'customer_purchase' && fulfillment.productType !== 'checker' && (
              <p className="text-gray-500 mb-6">
                Your data order{orderId ? ` (${orderId})` : ''} is being processed.
                {storeSlug && ' Redirecting to order history...'}
              </p>
            )}
            {fulfillment?.type === 'pool_deposit' && (
              <p className="text-gray-500 mb-6">
                GHS {fulfillment.amount ?? ''} added to the withdrawal pool. Redirecting to settings...
              </p>
            )}
            {!fulfillment || fulfillment.type === 'unknown' ? (
              <p className="text-gray-500 mb-6">Your payment was received successfully.</p>
            ) : null}
            {reference && (
              <p className="text-xs text-gray-400 font-mono mb-4">Ref: {reference}</p>
            )}
            <div className="flex flex-col gap-2">
              {fulfillment?.type === 'wallet_deposit' && (
                <Link to="/agent/wallet?funded=1">
                  <Button className="w-full">Go to wallet</Button>
                </Link>
              )}
              {fulfillment?.type === 'pool_deposit' && (
                <Link to="/admin/settings?poolFunded=1">
                  <Button className="w-full">Go to settings</Button>
                </Link>
              )}
              {storeSlug && (
                <Link to={buildStoreHomePath(storeSlug, { tab: 'history', paid: '1' })}>
                  <Button className="w-full">View order history</Button>
                </Link>
              )}
              {!storeSlug && fulfillment?.type !== 'wallet_deposit' && (
                <Link to="/">
                  <Button className="w-full">Go home</Button>
                </Link>
              )}
            </div>
          </>
        )}
        {status === 'paid_pending' && (
          <>
            <CheckCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Payment Received</h1>
            <p className="text-gray-500 mb-4">{errorMessage}</p>
            {reference && (
              <p className="text-xs text-gray-400 font-mono mb-6">Ref: {reference}</p>
            )}
            <Link to="/">
              <Button>Go Home</Button>
            </Link>
          </>
        )}
        {status === 'failed' && (
          <>
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
            <p className="text-gray-500 mb-4">{errorMessage || 'Something went wrong. Please try again.'}</p>
            {reference && (
              <p className="text-xs text-gray-400 font-mono mb-6">Ref: {reference}</p>
            )}
            <Link to="/">
              <Button>Go Home</Button>
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return <PaymentCallback />;
}
