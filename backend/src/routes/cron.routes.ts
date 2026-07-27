import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { runFulfillmentBackgroundSync } from '../services/fulfillmentProviderService';
import { secureCompare } from '../utils/secureCompare';

const router = Router();

function assertCronAuthorized(req: Request): void {
  // Vercel Cron sets this header on scheduled invocations.
  if (req.headers['x-vercel-cron'] === '1') return;

  const expected = env.cronSecret;
  if (!expected) {
    if (env.nodeEnv === 'production') {
      console.warn('[cron] CRON_SECRET not set — allowing request without shared secret');
      return;
    }
    return;
  }

  const header = String(req.headers.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  const provided = bearer || querySecret || String(req.headers['x-cron-secret'] || '');

  if (!provided || !secureCompare(provided, expected)) {
    throw new AppError('Unauthorized cron request', 401);
  }
}

/**
 * Vercel Cron (and manual ops) hit this to keep order statuses in sync with
 * Smart Data Hub / Datamax and auto-verify aged MTN beneficiary numbers.
 */
router.post(
  '/fulfillment-sync',
  asyncHandler(async (req: Request, res: Response) => {
    assertCronAuthorized(req);
    const result = await runFulfillmentBackgroundSync(80);
    res.json({ success: true, message: 'Fulfillment sync complete', data: result });
  })
);

router.get(
  '/fulfillment-sync',
  asyncHandler(async (req: Request, res: Response) => {
    assertCronAuthorized(req);
    const result = await runFulfillmentBackgroundSync(80);
    res.json({ success: true, message: 'Fulfillment sync complete', data: result });
  })
);

export default router;
