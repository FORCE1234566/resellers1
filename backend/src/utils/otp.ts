import crypto from 'crypto';
import { Otp } from '../models/Otp';
import { EmailDeliveryError, sendOtpEmail } from './email';
import { sendOtpSms } from '../services/smsService';
import { AppError } from '../middleware/errorHandler';

export const generateOtpCode = (): string => {
  return crypto.randomInt(100000, 1000000).toString();
};

export type OtpDeliveryResult = {
  emailSent: boolean;
  smsSent: boolean;
};

type OtpSendOptions = {
  /** Wait for email/SMS delivery (use on login/resend so failures surface to the user). */
  waitForDelivery?: boolean;
  /** Account phone — used as SMS backup when email is slow or blocked. */
  phone?: string | null;
};

function normalizePhone(phone?: string | null): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? String(phone).trim() : null;
}

export function normalizeOtpCode(code: unknown): string {
  return String(code ?? '').replace(/\D/g, '').slice(0, 6);
}

async function deliverOtp(
  email: string,
  code: string,
  phone: string | null
): Promise<OtpDeliveryResult> {
  const result: OtpDeliveryResult = { emailSent: false, smsSent: false };
  const errors: string[] = [];

  try {
    await sendOtpEmail(email, code);
    result.emailSent = true;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Email failed');
    console.error('[OTP email failed]', email, err instanceof Error ? err.message : err);
  }

  if (phone) {
    try {
      await sendOtpSms(phone, code);
      result.smsSent = true;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'SMS failed');
      console.error('[OTP SMS failed]', phone, err instanceof Error ? err.message : err);
    }
  }

  if (!result.emailSent && !result.smsSent) {
    throw new EmailDeliveryError(
      phone
        ? 'Could not send verification code by email or SMS. Please try again in a moment.'
        : 'Could not send verification email. Please try again in a moment.'
    );
  }

  if (errors.length) {
    console.warn('[OTP partial delivery]', email, result, errors.join(' | '));
  }

  return result;
}

async function persistOtp(email: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await Otp.findOneAndUpdate(
    { email },
    { $set: { code, expiresAt, attempts: 0 } },
    { upsert: true }
  );
}

/**
 * Deliver OTP first, then persist — so a failed send never overwrites a previously
 * delivered code the user may still be holding.
 */
export const createAndSendOtp = async (
  email: string,
  options: OtpSendOptions = {}
): Promise<OtpDeliveryResult> => {
  const code = generateOtpCode();
  const normalized = email.toLowerCase();
  const phone = normalizePhone(options.phone);

  if (options.waitForDelivery) {
    const result = await deliverOtp(normalized, code, phone);
    await persistOtp(normalized, code);
    return result;
  }

  // Background path: only persist after at least one channel succeeds.
  void (async () => {
    try {
      await deliverOtp(normalized, code, phone);
      await persistOtp(normalized, code);
    } catch (err) {
      console.error('[OTP delivery failed]', normalized, err instanceof Error ? err.message : err);
    }
  })();

  return { emailSent: false, smsSent: false };
};

/** Registration/login paths that must confirm delivery before telling the user an OTP was sent. */
export const sendAuthOtpOrFail = async (
  email: string,
  options: { phone?: string | null } = {}
): Promise<OtpDeliveryResult> => {
  try {
    return await createAndSendOtp(email, {
      waitForDelivery: true,
      phone: options.phone,
    });
  } catch (err) {
    if (err instanceof EmailDeliveryError) throw err;
    console.error('[OTP delivery failed]', email.toLowerCase(), err instanceof Error ? err.message : err);
    throw new EmailDeliveryError();
  }
};

export const verifyOtp = async (email: string, code: string): Promise<boolean> => {
  const normalizedCode = normalizeOtpCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) return false;

  const otp = await Otp.findOne({ email: email.toLowerCase(), code: normalizedCode });
  if (!otp) return false;
  if (otp.expiresAt < new Date()) {
    await Otp.deleteOne({ _id: otp._id });
    return false;
  }
  if (otp.attempts >= 5) {
    await Otp.deleteOne({ _id: otp._id });
    return false;
  }

  await Otp.deleteOne({ _id: otp._id });
  return true;
};

/** Verify with distinct errors so the UI can tell wrong vs expired vs locked. */
export const verifyOtpOrThrow = async (email: string, code: string): Promise<void> => {
  const normalizedEmail = email.toLowerCase();
  const normalizedCode = normalizeOtpCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new AppError('Enter the 6-digit code from your email or SMS');
  }

  const otp = await Otp.findOne({ email: normalizedEmail });
  if (!otp) {
    throw new AppError('Invalid or expired OTP. Request a new code and try again.');
  }

  if (otp.expiresAt < new Date()) {
    await Otp.deleteOne({ _id: otp._id });
    throw new AppError('This code has expired. Tap Resend OTP for a new one.');
  }

  if (otp.attempts >= 5) {
    await Otp.deleteOne({ _id: otp._id });
    throw new AppError('Too many wrong attempts. Tap Resend OTP for a new code.');
  }

  if (otp.code !== normalizedCode) {
    await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    const left = Math.max(0, 4 - otp.attempts);
    throw new AppError(
      left > 0
        ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left before you need a new OTP.`
        : 'Wrong code. Tap Resend OTP for a new one.'
    );
  }

  await Otp.deleteOne({ _id: otp._id });
};

export const incrementOtpAttempts = async (email: string): Promise<void> => {
  await Otp.updateOne({ email: email.toLowerCase() }, { $inc: { attempts: 1 } });
};
