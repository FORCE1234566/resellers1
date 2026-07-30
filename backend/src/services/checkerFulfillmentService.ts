import { AppError } from '../middleware/errorHandler';
import { checkerTypeFromBundle, checkerTypeLabel } from '../config/checker';
import { IOrder } from '../models/Order';
import { ResultChecker } from '../models/ResultChecker';
import { applyOrderStatusUpdate } from './fulfillmentProviderService';
import {
  assertCheckerInStock,
  syncCheckerStockAfterAssignment,
} from './checkerStockService';
import { sendCheckerDeliveryEmail } from '../utils/email';
import { sendCheckerSms } from './smsService';
import { sessionOpts, withMongoTransaction } from '../utils/mongoTransaction';

export type CheckerDeliveryResult = {
  emailSent: boolean;
  smsSent: boolean;
};

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(
        `[${label} attempt ${i + 1}/${attempts}]`,
        err instanceof Error ? err.message : err
      );
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function assignCheckerToOrder(
  order: IOrder
): Promise<{ serial: string; pin: string; type: 'bece' | 'wassce' }> {
  // Idempotent: never assign a second unused pin to the same order.
  if (order.checkerDetails?.serial && order.checkerDetails?.pin && order.checkerDetails?.type) {
    return {
      type: order.checkerDetails.type,
      serial: order.checkerDetails.serial,
      pin: order.checkerDetails.pin,
    };
  }

  const type = checkerTypeFromBundle(order.bundleSize);
  if (!type) {
    throw new AppError('Invalid checker order type');
  }

  await assertCheckerInStock(type);

  const assigned = await withMongoTransaction(async (session) => {
    // Only unused (available) inventory can be sold — assigned/used pins are never selected.
    const checker = await ResultChecker.findOneAndUpdate(
      {
        type,
        status: 'available',
        $or: [{ orderId: { $exists: false } }, { orderId: null }],
      },
      {
        $set: {
          status: 'assigned',
          orderId: order._id,
          assignedAt: new Date(),
        },
      },
      { sort: { createdAt: 1 }, new: true, ...sessionOpts(session) }
    );

    if (!checker) {
      throw new AppError(`${checkerTypeLabel(type)} checkers are out of stock.`, 503);
    }

    order.checkerDetails = {
      type,
      serial: checker.serial,
      pin: checker.pin,
    };
    order.markModified('checkerDetails');
    await order.save(sessionOpts(session));

    return {
      type,
      serial: checker.serial,
      pin: checker.pin,
    };
  });

  await applyOrderStatusUpdate(order, {
    status: 'delivered',
    providerStatus: 'delivered',
    stepLabel: 'Checker Delivered',
    stepMessage: `Your ${checkerTypeLabel(assigned.type)} checker has been assigned`,
  });

  await syncCheckerStockAfterAssignment(type);

  return assigned;
}

/**
 * Send serial+PIN straight to the buying customer (email + SMS).
 * Retries each channel; succeeds if at least one channel delivers.
 */
export async function deliverCheckerNotifications(
  order: IOrder,
  checker: { type: 'bece' | 'wassce'; serial: string; pin: string }
): Promise<CheckerDeliveryResult> {
  const label = checkerTypeLabel(checker.type);
  const email = String(order.customerEmail || '')
    .trim()
    .toLowerCase();
  const phone = String(order.recipientPhone || '').trim();

  if (!email && !phone) {
    throw new AppError('Customer email or phone is required to deliver the checker', 400);
  }

  const result: CheckerDeliveryResult = { emailSent: false, smsSent: false };
  const errors: string[] = [];

  if (email) {
    try {
      await withRetry('Checker email', () =>
        sendCheckerDeliveryEmail(email, {
          type: label,
          serial: checker.serial,
          pin: checker.pin,
          orderId: order.orderId,
        })
      );
      result.emailSent = true;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Email failed');
      console.error('[Checker email failed]', order.orderId, email, err);
    }
  }

  if (phone) {
    try {
      await withRetry('Checker SMS', () =>
        sendCheckerSms(phone, {
          type: label,
          serial: checker.serial,
          pin: checker.pin,
        })
      );
      result.smsSent = true;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'SMS failed');
      console.error('[Checker SMS failed]', order.orderId, phone, err);
    }
  }

  if (!result.emailSent && !result.smsSent) {
    throw new AppError(
      `Checker assigned but delivery failed (${errors.join('; ') || 'no channel'}). Serial is reserved — contact support.`,
      502
    );
  }

  const channels = [
    result.emailSent ? `email (${email})` : null,
    result.smsSent ? `SMS (${phone})` : null,
  ]
    .filter(Boolean)
    .join(' + ');

  await applyOrderStatusUpdate(order, {
    status: 'delivered',
    providerStatus: 'delivered',
    stepLabel: 'Checker Delivered',
    stepMessage: `${label} serial sent to customer via ${channels}`,
  });

  if (errors.length) {
    console.warn('[Checker partial delivery]', order.orderId, result, errors.join(' | '));
  }

  return result;
}

export async function fulfillCheckerOrder(order: IOrder) {
  const checker = await assignCheckerToOrder(order);
  const delivery = await deliverCheckerNotifications(order, checker);
  return { order, checker, delivery };
}
