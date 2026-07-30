import { PLATFORM_NAME } from '../config/brand';
import { env } from '../config/env';
import { WAEC_RESULTS_URL } from '../config/checker';
import { normalizeGhanaPhone } from '../utils/phone';

export type CheckerSmsPayload = {
  type: string;
  serial: string;
  pin: string;
};

const ARKESEL_SEND_URL = 'https://sms.arkesel.com/api/v2/sms/send';

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMS_API_KEY?.trim());
}

export function buildCheckerMessage(payload: CheckerSmsPayload): string {
  return [
    `Serial: ${payload.serial}`,
    `PIN: ${payload.pin}`,
    `Check your results using this link ${WAEC_RESULTS_URL}`,
    'Thank you for your purchase!',
  ].join('\n');
}

/** Ghana local 0XXXXXXXXX → E.164-style 233XXXXXXXXX (no leading +). */
function toArkeselRecipient(to: string): string {
  const local = normalizeGhanaPhone(to);
  return local.replace(/^0/, '233');
}

/**
 * Send SMS via Arkesel (https://sms.arkesel.com/api/v2/sms/send).
 * Configure with SMS_API_KEY and SMS_SENDER_ID (default TDGH).
 * Optional SMS_API_URL overrides the Arkesel endpoint.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  const apiKey = process.env.SMS_API_KEY?.trim();
  const senderId = process.env.SMS_SENDER_ID?.trim() || 'TDGH';
  const apiUrl = process.env.SMS_API_URL?.trim() || ARKESEL_SEND_URL;

  if (!apiKey) {
    console.warn('[SMS] SMS_API_KEY not set — message not sent to', to);
    if (env.nodeEnv !== 'production' && !process.env.VERCEL) {
      console.log(`[SMS Dev] To: ${to} | Sender: ${senderId} | ${message}`);
    }
    return;
  }

  const recipient = toArkeselRecipient(to);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: senderId,
      message,
      recipients: [recipient],
    }),
  });

  const bodyText = await res.text();
  type ArkeselResponse = { status?: string; message?: string; code?: string | number };
  let parsed: ArkeselResponse | null = null;
  try {
    parsed = JSON.parse(bodyText) as ArkeselResponse;
  } catch {
    parsed = null;
  }

  const okHttp = res.ok;
  const okBody =
    !parsed ||
    String(parsed.status || '').toLowerCase() === 'success' ||
    String(parsed.code || '') === 'ok';

  if (!okHttp || !okBody) {
    throw new Error(
      `Arkesel SMS ${res.status}: ${(parsed?.message || bodyText).slice(0, 200)}`
    );
  }
}

export async function sendCheckerSms(to: string, payload: CheckerSmsPayload): Promise<void> {
  await sendSms(to, buildCheckerMessage(payload));
}

export async function sendOtpSms(to: string, code: string): Promise<void> {
  if (!isSmsConfigured()) {
    throw new Error('SMS is not configured. Set SMS_API_KEY and SMS_SENDER_ID.');
  }
  const message = `${PLATFORM_NAME} code: ${code}. Valid 10 minutes. Do not share.`;
  await sendSms(to, message);
}
