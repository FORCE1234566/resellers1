import mongoose from 'mongoose';
import { Wallet } from '../models/Wallet';
import { WalletTransaction, TransactionType } from '../models/WalletTransaction';
import { AppError } from '../middleware/errorHandler';
import { roundMoney } from '../utils/helpers';
import { isMongoDuplicateKeyError } from '../utils/mongoErrors';
import { sessionOpts } from '../utils/mongoTransaction';

export const getOrCreateWallet = async (userId: mongoose.Types.ObjectId | string) => {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = await Wallet.create({ userId });
  }
  return wallet;
};

async function findIdempotentWalletTx(
  userId: mongoose.Types.ObjectId | string,
  reference: string | undefined,
  type: TransactionType
) {
  if (!reference) return null;
  const tx = await WalletTransaction.findOne({ userId, reference, type });
  if (!tx || tx.description === '__reserved__' || tx.amount === 0) return null;
  return tx;
}

/**
 * Reserve an idempotency slot using the unique (userId, reference, type) index
 * so concurrent webhook/purchase handlers cannot double-credit or double-debit.
 */
async function reserveWalletTxSlot(
  userId: mongoose.Types.ObjectId | string,
  reference: string,
  type: TransactionType,
  session?: mongoose.ClientSession | null
): Promise<'reserved' | 'duplicate'> {
  try {
    await WalletTransaction.create([{
      userId,
      type,
      amount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      reference,
      description: '__reserved__',
      metadata: { reserved: true },
    }], sessionOpts(session));
    return 'reserved';
  } catch (err) {
    if (isMongoDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

export const creditWallet = async (
  userId: mongoose.Types.ObjectId | string,
  amount: number,
  type: TransactionType,
  description: string,
  reference?: string,
  metadata?: Record<string, unknown>,
  session?: mongoose.ClientSession | null
) => {
  const roundedAmount = roundMoney(amount);
  if (roundedAmount <= 0) {
    throw new AppError('Credit amount must be positive');
  }

  const duplicate = await findIdempotentWalletTx(userId, reference, type);
  if (duplicate) {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) throw new AppError('Wallet not found');
    return wallet;
  }

  if (reference) {
    const slot = await reserveWalletTxSlot(userId, reference, type, session);
    if (slot === 'duplicate') {
      const pending = await WalletTransaction.findOne({ userId, reference, type }).session(
        session ?? null
      );
      if (!pending || pending.description !== '__reserved__') {
        const wallet = await Wallet.findOne({ userId }).session(session ?? null);
        if (!wallet) throw new AppError('Wallet not found');
        return wallet;
      }
    }
  }

  await getOrCreateWallet(userId);

  const inc: Record<string, number> = { balance: roundedAmount };
  if (type === 'deposit') inc.totalDeposits = roundedAmount;
  if (type === 'profit_credit') inc.profitBalance = roundedAmount;
  if (type === 'referral_credit') inc.referralEarnings = roundedAmount;

  const walletBefore = await Wallet.findOne({ userId }).session(session ?? null);
  const balanceBefore = walletBefore?.balance ?? 0;

  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    { $inc: inc },
    { new: true, ...sessionOpts(session) }
  );
  if (!wallet) throw new AppError('Wallet not found');

  if (reference) {
    await WalletTransaction.findOneAndUpdate(
      { userId, reference, type },
      {
        $set: {
          amount: roundedAmount,
          balanceBefore,
          balanceAfter: wallet.balance,
          description,
          metadata: metadata ?? {},
        },
      },
      sessionOpts(session)
    );
  } else {
    await WalletTransaction.create([{
      userId,
      type,
      amount: roundedAmount,
      balanceBefore,
      balanceAfter: wallet.balance,
      reference,
      description,
      metadata,
    }], sessionOpts(session));
  }

  return wallet;
};

export const debitWallet = async (
  userId: mongoose.Types.ObjectId | string,
  amount: number,
  type: TransactionType,
  description: string,
  reference?: string,
  metadata?: Record<string, unknown>,
  session?: mongoose.ClientSession | null
) => {
  const roundedAmount = roundMoney(amount);
  if (roundedAmount <= 0) {
    throw new AppError('Debit amount must be positive');
  }

  const duplicate = await findIdempotentWalletTx(userId, reference, type);
  if (duplicate) {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) throw new AppError('Wallet not found');
    return wallet;
  }

  if (reference) {
    const slot = await reserveWalletTxSlot(userId, reference, type, session);
    if (slot === 'duplicate') {
      const pending = await WalletTransaction.findOne({ userId, reference, type }).session(
        session ?? null
      );
      if (!pending || pending.description !== '__reserved__') {
        const wallet = await Wallet.findOne({ userId }).session(session ?? null);
        if (!wallet) throw new AppError('Wallet not found');
        return wallet;
      }
    }
  }

  await getOrCreateWallet(userId);

  const walletBefore = await Wallet.findOne({ userId }).session(session ?? null);
  const balanceBefore = walletBefore?.balance ?? 0;

  const wallet = await Wallet.findOneAndUpdate(
    { userId, balance: { $gte: roundedAmount } },
    { $inc: { balance: -roundedAmount } },
    { new: true, ...sessionOpts(session) }
  );

  if (!wallet) {
    if (reference) {
      await WalletTransaction.deleteOne(
        { userId, reference, type, description: '__reserved__' },
        sessionOpts(session)
      );
    }
    throw new AppError('Insufficient wallet balance');
  }

  if (wallet.balance < 0) {
    throw new AppError('Wallet balance cannot be negative');
  }

  if (reference) {
    await WalletTransaction.findOneAndUpdate(
      { userId, reference, type },
      {
        $set: {
          amount: -roundedAmount,
          balanceBefore,
          balanceAfter: wallet.balance,
          description,
          metadata: metadata ?? {},
        },
      },
      sessionOpts(session)
    );
  } else {
    await WalletTransaction.create([{
      userId,
      type,
      amount: -roundedAmount,
      balanceBefore,
      balanceAfter: wallet.balance,
      reference,
      description,
      metadata,
    }], sessionOpts(session));
  }

  return wallet;
};

export const debitProfitBalance = async (
  userId: mongoose.Types.ObjectId | string,
  amount: number
) => {
  const roundedAmount = roundMoney(amount);
  if (roundedAmount <= 0) {
    throw new AppError('Debit amount must be positive');
  }

  const wallet = await Wallet.findOneAndUpdate(
    { userId, profitBalance: { $gte: roundedAmount } },
    {
      $inc: {
        profitBalance: -roundedAmount,
        totalWithdrawals: roundedAmount,
      },
    },
    { new: true }
  );

  if (!wallet) {
    throw new AppError('Insufficient withdrawable profit');
  }

  return wallet;
};

/**
 * Reverse a prior profit_credit (reduces balance + profitBalance).
 * Floors at zero so a later withdrawal cannot block order status updates.
 * Idempotent via (userId, reference, type=adjustment).
 */
export const reverseProfitCredit = async (
  userId: mongoose.Types.ObjectId | string,
  amount: number,
  description: string,
  reference: string
) => {
  const roundedAmount = roundMoney(amount);
  if (roundedAmount <= 0) {
    throw new AppError('Reverse amount must be positive');
  }

  const duplicate = await findIdempotentWalletTx(userId, reference, 'adjustment');
  if (duplicate) {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) throw new AppError('Wallet not found');
    return wallet;
  }

  const slot = await reserveWalletTxSlot(userId, reference, 'adjustment');
  if (slot === 'duplicate') {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) throw new AppError('Wallet not found');
    return wallet;
  }

  await getOrCreateWallet(userId);
  const walletBefore = await Wallet.findOne({ userId });
  const balanceBefore = walletBefore?.balance ?? 0;

  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    [
      {
        $set: {
          balance: {
            $max: [0, { $subtract: ['$balance', roundedAmount] }],
          },
          profitBalance: {
            $max: [0, { $subtract: ['$profitBalance', roundedAmount] }],
          },
        },
      },
    ],
    { new: true }
  );

  if (!wallet) {
    await WalletTransaction.deleteOne({
      userId,
      reference,
      type: 'adjustment',
      description: '__reserved__',
    });
    throw new AppError('Wallet not found');
  }

  await WalletTransaction.findOneAndUpdate(
    { userId, reference, type: 'adjustment' },
    {
      $set: {
        amount: -roundedAmount,
        balanceBefore,
        balanceAfter: wallet.balance,
        description,
        metadata: { kind: 'profit_reverse' },
      },
    }
  );

  return wallet;
};
