import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';

import { api } from '@/lib/api';

import DashboardLayout from '@/components/layout/DashboardLayout';

import { Card } from '@/components/ui/Card';

import Button from '@/components/ui/Button';

import Input from '@/components/ui/Input';

import { formatCurrency } from '@/lib/utils';

import { useNavigate, useSearchParams } from 'react-router';

import { redirectToPaystack } from '@/lib/paystack';

import { runValidators, v } from '@/lib/form-validation';

import WalletTransactionTable, { WalletTransactionRow } from '@/components/wallet/WalletTransactionTable';



const MAX_DEPOSIT = 10_000;



export default function AgentWalletPage() {

  const { user, loading } = useAuth();

  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  const funded = searchParams.get('funded') === '1';

  const [balance, setBalance] = useState(0);

  const [amount, setAmount] = useState('');

  const [fundInfo, setFundInfo] = useState<Record<string, number> | null>(null);

  const [fundError, setFundError] = useState('');

  const [amountError, setAmountError] = useState('');

  const [funding, setFunding] = useState(false);

  const [transactions, setTransactions] = useState<WalletTransactionRow[]>([]);

  const [txLoading, setTxLoading] = useState(true);

  const [txSearch, setTxSearch] = useState('');
  const [paystackRef, setPaystackRef] = useState('');
  const [verifyingRef, setVerifyingRef] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [verifyError, setVerifyError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'agent')) navigate('/login/agent');
  }, [user, loading, navigate]);



  const loadWallet = useCallback(async () => {

    const res = await api.get('/agent/wallet');

    setBalance(res.data.data.balance);

  }, []);



  const loadTransactions = useCallback(async () => {

    setTxLoading(true);

    try {

      const res = await api.get('/agent/wallet/transactions');

      setTransactions(res.data.data);

    } finally {

      setTxLoading(false);

    }

  }, []);



  const loadAll = useCallback(async () => {

    await Promise.all([loadWallet(), loadTransactions()]);

  }, [loadWallet, loadTransactions]);



  useEffect(() => {

    if (user?.role === 'agent') loadAll();

  }, [user, loadAll]);



  useEffect(() => {

    if (funded && user?.role === 'agent') loadAll();

  }, [funded, user, loadAll]);



  const handleFund = async () => {

    setFundError('');

    const errors = runValidators(

      { amount },

      {

        amount: [

          v.required('Deposit amount'),

          v.notPhoneNumber,

          v.minAmount(1, 'Deposit amount'),

          v.maxAmount(MAX_DEPOSIT, 'Deposit amount'),

        ],

      }

    );

    setAmountError(errors.amount || '');

    if (Object.keys(errors).length) return;



    setFunding(true);

    try {

      const res = await api.post('/agent/wallet/fund', { amount: parseFloat(amount) });

      setFundInfo(res.data.data);

      redirectToPaystack(res.data.data.authorizationUrl);

    } catch (err) {

      setFundError(err instanceof Error ? err.message : 'Could not start Paystack payment');

    } finally {

      setFunding(false);

    }

  };

  const handleVerifyPaystackRef = async () => {
    const ref = paystackRef.trim();
    if (!ref) {
      setVerifyError('Paste the Paystack reference from your payment receipt');
      return;
    }
    setVerifyError('');
    setVerifyMessage('');
    setVerifyingRef(true);
    try {
      const res = await api.get(`/webhooks/verify/${encodeURIComponent(ref)}`);
      const payment = res.data.data;
      if (payment.status !== 'success') {
        setVerifyError('Paystack reports this payment as unsuccessful or cancelled.');
        return;
      }
      if (payment.fulfillment?.type === 'wallet_deposit') {
        setVerifyMessage(
          payment.fulfillment.alreadyProcessed
            ? 'This payment was already credited to your wallet.'
            : 'Payment confirmed — your wallet has been credited.'
        );
        await loadAll();
      } else {
        setVerifyError('This reference is not an agent wallet deposit.');
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Could not verify this payment');
    } finally {
      setVerifyingRef(false);
    }
  };

  if (loading || !user) return null;



  return (

    <DashboardLayout role="agent">

      <h1 className="text-xl sm:text-2xl font-bold text-white mb-6">Wallet</h1>

      {funded && (

        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg mb-4">

          Wallet funded successfully. Your balance has been updated.

        </p>

      )}



      <div className="grid lg:grid-cols-2 gap-6 mb-8">

        <Card className="p-6 bg-gradient-to-br from-blue-600 to-blue-700 border-0 text-white">

          <p className="text-sm text-blue-100 uppercase tracking-wide font-medium">Agent Wallet</p>

          <p className="text-4xl font-bold mt-2">{formatCurrency(balance)}</p>

          <p className="text-xs text-blue-100 mt-2">Available balance for data purchases</p>

        </Card>



        <Card className="p-6">

          <h2 className="font-semibold mb-4">Fund Wallet via Paystack</h2>

          <p className="text-xs text-gray-500 mb-4">Supports MTN MoMo, Telecel Cash, AirtelTigo Money & Bank Card</p>

          <Input

            label="Deposit Amount (GHS)"

            type="number"

            value={amount}

            error={amountError}

            onChange={(e) => {

              setAmount(e.target.value);

              if (amountError) setAmountError('');

              if (fundError) setFundError('');

            }}

            min="1"

            max={MAX_DEPOSIT}

            step="0.01"

            placeholder="e.g. 50"

          />

          {fundInfo && (

            <div className="mt-3 text-sm bg-gray-50 p-3 rounded-lg space-y-1">

              <p>Deposit: {formatCurrency(fundInfo.depositAmount)}</p>

              <p>Paystack Charge: {formatCurrency(fundInfo.paystackCharge)}</p>

              <p className="font-bold">Total: {formatCurrency(fundInfo.total)}</p>

            </div>

          )}

          {fundError && <p className="text-sm text-red-600 mt-3">{fundError}</p>}

          <Button onClick={handleFund} className="w-full mt-4" disabled={!amount || funding}>

            {funding ? 'Opening Paystack...' : 'Pay with Paystack (MoMo / Card)'}

          </Button>

          <div className="mt-6 pt-4 border-t border-gray-100 space-y-3">
            <p className="text-xs font-medium text-gray-700">Paid but balance did not update?</p>
            <Input
              label="Paystack reference"
              value={paystackRef}
              onChange={(e) => {
                setPaystackRef(e.target.value);
                if (verifyError) setVerifyError('');
                if (verifyMessage) setVerifyMessage('');
              }}
              placeholder="Paste ref from Paystack receipt"
            />
            {verifyMessage && <p className="text-sm text-emerald-600">{verifyMessage}</p>}
            {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              loading={verifyingRef}
              disabled={verifyingRef || !paystackRef.trim()}
              onClick={handleVerifyPaystackRef}
            >
              Confirm payment from reference
            </Button>
          </div>

        </Card>

      </div>



      <WalletTransactionTable

        transactions={transactions}

        loading={txLoading}

        search={txSearch}

        onSearchChange={setTxSearch}

      />

    </DashboardLayout>

  );

}


