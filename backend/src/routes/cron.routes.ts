import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { runFulfillmentBackgroundSync } from '../services/fulfillmentProviderService';
import { secureCompare } from '../utils/secureCompare';
import { normalizeCheckerType } from '../config/checker';
import { ResultChecker } from '../models/ResultChecker';
import { setCheckerStock } from '../services/checkerStockService';

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

/**
 * Ops: bulk-import result checker serials/PINs (serial then pin).
 * Body: { type: "wassce"|"bece", rows: [{ serial, pin }, ...] }
 * Auth: CRON_SECRET (Bearer / x-cron-secret / ?secret=)
 */
router.post(
  '/import-checkers',
  asyncHandler(async (req: Request, res: Response) => {
    assertCronAuthorized(req);

    let type;
    try {
      type = normalizeCheckerType(String(req.body?.type || ''));
    } catch {
      throw new AppError('type must be bece or wassce', 400);
    }

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) throw new AppError('rows array is required', 400);
    if (rows.length > 5000) throw new AppError('Maximum 5000 rows per request', 400);

    const uploadBatchId = `CHK-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const cleaned: Array<{ serial: string; pin: string }> = [];
    let skippedInvalid = 0;

    for (const row of rows) {
      const serial = String(row?.serial ?? '').trim();
      const pin = String(row?.pin ?? '').trim();
      if (!serial || !pin) {
        skippedInvalid++;
        continue;
      }
      cleaned.push({ serial, pin });
    }

    if (cleaned.length === 0) throw new AppError('No valid serial/pin rows', 400);

    const existing = new Set(
      (
        await ResultChecker.find({
          type,
          serial: { $in: cleaned.map((r) => r.serial) },
        }).select('serial')
      ).map((d) => d.serial)
    );

    const seen = new Set<string>();
    const toInsert: Array<{
      type: typeof type;
      serial: string;
      pin: string;
      uploadBatchId: string;
      status: 'available';
    }> = [];
    let skippedDuplicates = 0;

    for (const row of cleaned) {
      if (seen.has(row.serial) || existing.has(row.serial)) {
        skippedDuplicates++;
        continue;
      }
      seen.add(row.serial);
      toInsert.push({
        type,
        serial: row.serial,
        pin: row.pin,
        uploadBatchId,
        status: 'available',
      });
    }

    let imported = 0;
    if (toInsert.length > 0) {
      try {
        const inserted = await ResultChecker.insertMany(toInsert, { ordered: false });
        imported = inserted.length;
      } catch (err) {
        const bulkErr = err as {
          insertedDocs?: unknown[];
          writeErrors?: unknown[];
          result?: { nInserted?: number };
        };
        if (Array.isArray(bulkErr.insertedDocs)) {
          imported = bulkErr.insertedDocs.length;
          skippedDuplicates += bulkErr.writeErrors?.length ?? 0;
        } else if (typeof bulkErr.result?.nInserted === 'number') {
          imported = bulkErr.result.nInserted;
          skippedDuplicates += bulkErr.writeErrors?.length ?? 0;
        } else {
          throw err;
        }
      }
    }

    if (imported > 0) {
      await setCheckerStock(type, true);
    }

    const available = await ResultChecker.countDocuments({ type, status: 'available' });
    res.json({
      success: true,
      data: {
        imported,
        skippedDuplicates,
        skippedInvalid,
        uploadBatchId,
        available,
      },
      message: `Imported ${imported} ${type} checker(s)`,
    });
  })
);

/**
 * Ops: verify SMS + email config (and optionally send a non-inventory test checker message).
 * Body optional: { email?: string, phone?: string }
 */
router.post(
  '/test-checker-delivery',
  asyncHandler(async (req: Request, res: Response) => {
    assertCronAuthorized(req);

    const { isSmsConfigured, sendCheckerSms } = await import('../services/smsService');
    const { isEmailTransportConfigured, sendCheckerDeliveryEmail } = await import('../utils/email');
    const { WAEC_RESULTS_URL } = await import('../config/checker');

    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const phone = String(req.body?.phone || '').trim();

    const config = {
      smsConfigured: isSmsConfigured(),
      emailConfigured: isEmailTransportConfigured(),
      resultsUrl: WAEC_RESULTS_URL,
    };

    const delivery: { emailSent: boolean; smsSent: boolean; errors: string[] } = {
      emailSent: false,
      smsSent: false,
      errors: [],
    };

    const sample = {
      type: 'WASSCE',
      serial: 'TEST-SERIAL',
      pin: '000000000000',
      orderId: 'TEST-CHECKER-DELIVERY',
    };

    if (email) {
      try {
        await sendCheckerDeliveryEmail(email, sample);
        delivery.emailSent = true;
      } catch (err) {
        delivery.errors.push(err instanceof Error ? err.message : 'Email failed');
      }
    }

    if (phone) {
      try {
        await sendCheckerSms(phone, sample);
        delivery.smsSent = true;
      } catch (err) {
        delivery.errors.push(err instanceof Error ? err.message : 'SMS failed');
      }
    }

    res.json({
      success: true,
      data: { config, delivery },
      message:
        email || phone
          ? 'Checker delivery test completed'
          : 'Config only — pass email and/or phone to send a test message',
    });
  })
);

export default router;
