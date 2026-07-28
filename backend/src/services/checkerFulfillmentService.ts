import mongoose from 'mongoose';
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
      throw new AppError(
        `${checkerTypeLabel(type)} checkers are out of stock. Payment received — contact support for a refund.`,
        503
      );
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

export async function deliverCheckerNotifications(
  order: IOrder,
  checker: { type: 'bece' | 'wassce'; serial: string; pin: string }
): Promise<void> {
  const label = checkerTypeLabel(checker.type);
  const tasks: Promise<void>[] = [];

  if (order.customerEmail) {
    tasks.push(
      sendCheckerDeliveryEmail(order.customerEmail, {
        type: label,
        serial: checker.serial,
        pin: checker.pin,
        orderId: order.orderId,
      }).catch((err) => {
        console.error('[Checker email failed]', err);
      })
    );
  }

  if (order.recipientPhone) {
    tasks.push(
      sendCheckerSms(order.recipientPhone, {
        type: label,
        serial: checker.serial,
        pin: checker.pin,
      }).catch((err) => {
        console.error('[Checker SMS failed]', err);
      })
    );
  }

  await Promise.all(tasks);
}

export async function fulfillCheckerOrder(order: IOrder) {
  const checker = await assignCheckerToOrder(order);
  await deliverCheckerNotifications(order, checker);
  return { order, checker };
}
