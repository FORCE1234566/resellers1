import crypto from 'crypto';
import { Otp } from '../models/Otp';
import { EmailDeliveryError, sendOtpEmail } from './email';
import { sendOtpSms } from '../services/smsService';

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

/** Save OTP and dispatch email (and SMS when a phone is available). */
export const createAndSendOtp = async (
  email: string,
  options: OtpSendOptions = {}
): Promise<OtpDeliveryResult> => {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const normalized = email.toLowerCase();
  const phone = normalizePhone(options.phone);

  await Otp.findOneAndUpdate(
    { email: normalized },
    { $set: { code, expiresAt, attempts: 0 } },
    { upsert: true }
  );

  const deliver = async (): Promise<OtpDeliveryResult> => {
    const result: OtpDeliveryResult = { emailSent: false, smsSent: false };
    const errors: string[] = [];

    try {
      await sendOtpEmail(normalized, code);
      result.emailSent = true;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Email failed');
      console.error('[OTP email failed]', normalized, err instanceof Error ? err.message : err);
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
      console.warn('[OTP partial delivery]', normalized, result, errors.join(' | '));
    }

    return result;
  };

  if (options.waitForDelivery) {
    return deliver();
  }

  void deliver().catch((err) => {
    console.error('[OTP delivery failed]', normalized, err instanceof Error ? err.message : err);
  });

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
  const otp = await Otp.findOne({ email: email.toLowerCase(), code });

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

export const incrementOtpAttempts = async (email: string): Promise<void> => {
  await Otp.updateOne({ email: email.toLowerCase() }, { $inc: { attempts: 1 } });
};
