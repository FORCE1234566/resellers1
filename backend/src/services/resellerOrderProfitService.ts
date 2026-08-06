import { IOrder } from '../models/Order';
import { creditWallet, reverseProfitCredit } from './walletService';

/** Credit leaf + upline reseller profit as soon as the store order is received. Idempotent by reference. */
export async function creditOrderResellerProfits(order: IOrder): Promise<void> {
  if (order.source !== 'reseller_store' || !order.resellerId) return;

  if (order.profit > 0) {
    await creditWallet(
      order.resellerId,
      order.profit,
      'profit_credit',
      `Profit from order ${order.orderId}`,
      order.orderId
    );
  }

  if (order.uplineProfits?.length) {
    for (const entry of order.uplineProfits) {
      if (entry.profit > 0) {
        await creditWallet(
          entry.resellerId,
          entry.profit,
          'profit_credit',
          `Upline profit from order ${order.orderId}`,
          `${order.orderId}-upline-${entry.resellerId.toString()}`
        );
      }
    }
  }
}

/** Claw back reseller profits if the order fails / is cancelled / refunded after credit. */
export async function reverseOrderResellerProfits(order: IOrder): Promise<void> {
  if (order.source !== 'reseller_store' || !order.resellerId) return;

  if (order.profit > 0) {
    await reverseProfitCredit(
      order.resellerId,
      order.profit,
      `Profit reversed for order ${order.orderId}`,
      `${order.orderId}-profit-reverse`
    );
  }

  if (order.uplineProfits?.length) {
    for (const entry of order.uplineProfits) {
      if (entry.profit > 0) {
        const id = entry.resellerId.toString();
        await reverseProfitCredit(
          entry.resellerId,
          entry.profit,
          `Upline profit reversed for order ${order.orderId}`,
          `${order.orderId}-upline-${id}-profit-reverse`
        );
      }
    }
  }
}
