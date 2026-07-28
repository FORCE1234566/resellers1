import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { PLATFORM_NAME } from '../config/brand';
import { AppError } from '../middleware/errorHandler';

function smtpPort(): number {
  if (process.env.SMTP_PORT) return env.smtp.port;
  // Gmail STARTTLS (587) often times out on serverless hosts — SSL (465) is reliable.
  if (env.smtp.host.includes('gmail')) return 465;
  return env.smtp.port || 587;
}

const port = smtpPort();
const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port,
  secure: port === 465,
  requireTLS: port !== 465,
  ...(process.env.VERCEL ? {} : { pool: true, maxConnections: 3 }),
  connectionTimeout: 20_000,
  greetingTimeout: 15_000,
  socketTimeout: 25_000,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
} as nodemailer.TransportOptions);

let warmPromise: Promise<void> | null = null;

export function warmEmailTransport(): Promise<void> {
  if (!env.smtp.user && !env.resendApiKey) return Promise.resolve();
  if (!warmPromise) {
    warmPromise = (async () => {
      if (env.resendApiKey) return;
      if (!env.smtp.user) return;
      await transporter.verify();
    })().catch((err) => {
      warmPromise = null;
      console.warn('[Email warm-up failed]', err instanceof Error ? err.message : err);
    });
  }
  return warmPromise;
}

type MailPayload = { to: string; subject: string; text: string; html: string };

function resendFromAddress(): string {
  if (env.resendFrom) return env.resendFrom;
  const from = env.smtp.from;
  if (from && !from.includes('@gmail.com') && !from.includes('@googlemail.com')) {
    return from;
  }
  if (env.nodeEnv === 'production') {
    throw new Error(
      'RESEND_FROM must be a verified domain sender (e.g. TopDealsGH <noreply@topdealsgh.com>)'
    );
  }
  return `${PLATFORM_NAME} <onboarding@resend.dev>`;
}

async function sendViaResend({ to, subject, text, html }: MailPayload): Promise<void> {
  const apiKey = env.resendApiKey;
  if (!apiKey) throw new Error('Resend not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFromAddress(),
      to: [to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendViaSmtp({ to, subject, text, html }: MailPayload): Promise<void> {
  if (!env.smtp.user) {
    console.log(`[Email Dev] To: ${to} | Subject: ${subject}`);
    console.log(text);
    return;
  }

  await warmEmailTransport();

  await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject,
    text,
    html,
    priority: 'high',
    headers: {
      'X-Priority': '1',
      Importance: 'high',
    },
  });
}

async function dispatchPriorityEmail(payload: MailPayload): Promise<void> {
  if (env.resendApiKey) {
    await sendViaResend(payload);
    return;
  }
  if (process.env.VERCEL && env.smtp.host.includes('gmail')) {
    console.warn(
      '[Email] Gmail SMTP on Vercel is unreliable for OTP delivery — set RESEND_API_KEY + RESEND_FROM in production.'
    );
  }
  await sendViaSmtp(payload);
}

async function sendWithOtpRetry(label: string, to: string, send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (firstErr) {
    console.warn(`[${label} retry]`, to, firstErr instanceof Error ? firstErr.message : firstErr);
    warmPromise = null;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await send();
  }
}

export class EmailDeliveryError extends AppError {
  constructor(message = 'Could not send verification email. Please try again in a moment.') {
    super(message, 503);
    this.name = 'EmailDeliveryError';
  }
}

export const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
  if (!env.smtp.user && !env.resendApiKey) {
    console.log(`[Email Dev] To: ${to} | Subject: ${subject}`);
    console.log(html);
    return;
  }

  if (env.resendApiKey) {
    await sendViaResend({ to, subject, text: subject, html });
    return;
  }

  await transporter.sendMail({ from: env.smtp.from, to, subject, html });
};

export const sendOtpEmail = async (email: string, code: string): Promise<void> => {
  const subject = `${code} is your ${PLATFORM_NAME} verification code`;
  const text = [
    `${PLATFORM_NAME} verification code`,
    '',
    code,
    '',
    'Enter this 6-digit code to complete sign-in. It expires in 10 minutes.',
    'If you did not request this, ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:16px;">
      <p style="margin:0 0 12px;color:#374151;font-size:15px;">Your ${PLATFORM_NAME} verification code:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0a1120;">${code}</p>
      <p style="margin:0;color:#6b7280;font-size:13px;">Expires in 10 minutes. Do not share this code.</p>
    </div>
  `;

  try {
    await sendWithOtpRetry('OTP email', email, () =>
      dispatchPriorityEmail({ to: email, subject, text, html })
    );
  } catch (err) {
    console.error('[OTP email failed]', email, err instanceof Error ? err.message : err);
    throw new EmailDeliveryError();
  }
};

export const sendAdminActionOtpEmail = async (email: string, code: string): Promise<void> => {
  const subject = `${code} — confirm your admin action`;
  const text = [
    `${PLATFORM_NAME} admin verification code`,
    '',
    code,
    '',
    'Enter this 6-digit code to confirm a sensitive admin action (withdrawals, pool funding, settings, etc.).',
    'It expires in 10 minutes.',
    'If you did not start this action, secure your account immediately.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:16px;">
      <p style="margin:0 0 8px;color:#374151;font-size:15px;">Confirm your admin action</p>
      <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">Enter this code in the admin dashboard to proceed:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0a1120;">${code}</p>
      <p style="margin:0;color:#6b7280;font-size:13px;">Expires in 10 minutes. Do not share this code.</p>
    </div>
  `;

  try {
    await sendWithOtpRetry('Admin action OTP email', email, () =>
      dispatchPriorityEmail({ to: email, subject, text, html })
    );
  } catch (err) {
    console.error('[Admin action OTP email failed]', email, err instanceof Error ? err.message : err);
    throw new EmailDeliveryError();
  }
};

export const sendPasswordResetEmail = async (email: string, resetLink: string): Promise<void> => {
  const subject = `Reset Your Password - ${PLATFORM_NAME}`;
  const text = [
    `${PLATFORM_NAME} password reset`,
    '',
    'Click the link below to reset your password. This link expires in 15 minutes.',
    '',
    resetLink,
    '',
    'If you did not request this, ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 16px;">
      <h2 style="color: #1e40af; margin: 0 0 12px;">Password Reset</h2>
      <p style="color: #374151;">Click the button below to reset your password. This link expires in 15 minutes.</p>
      <a href="${resetLink}" style="display: inline-block; background: #1e40af; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
        Reset Password
      </a>
      <p style="color: #6b7280; font-size: 13px;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="color: #6b7280; font-size: 13px; word-break: break-all;">${resetLink}</p>
      <p style="color: #6b7280; font-size: 13px;">If you did not request this, ignore this email.</p>
    </div>
  `;

  try {
    await sendWithOtpRetry('Password reset email', email, () =>
      dispatchPriorityEmail({ to: email, subject, text, html })
    );
  } catch (err) {
    console.error('[Password reset email failed]', email, err instanceof Error ? err.message : err);
    throw new EmailDeliveryError('Could not send reset email. Please try again in a moment.');
  }
};

export const sendOrderHistoryOtpEmail = async (
  email: string,
  code: string,
  storeName: string
): Promise<void> => {
  const subject = `${code} — verify order history (${storeName})`;
  const text = [
    `${storeName} order history verification`,
    '',
    code,
    '',
    'Enter this 6-digit code on the store page. It expires in 10 minutes.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:16px;">
      <p style="margin:0 0 8px;color:#374151;font-size:14px;">${storeName} — order history code</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0a1120;">${code}</p>
      <p style="margin:0;color:#6b7280;font-size:13px;">Expires in 10 minutes. Do not share this code.</p>
    </div>
  `;

  try {
    await sendWithOtpRetry('Order history OTP', email, () =>
      dispatchPriorityEmail({ to: email, subject, text, html })
    );
  } catch (err) {
    console.error('[Order history OTP email failed]', email, err instanceof Error ? err.message : err);
    throw new EmailDeliveryError();
  }
};

export const sendNotificationEmail = async (
  email: string,
  title: string,
  message: string
): Promise<void> => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1e40af;">${title}</h2>
      <p>${message}</p>
    </div>
  `;
  await sendEmail(email, `${title} - ${PLATFORM_NAME}`, html);
};

export const sendCheckerDeliveryEmail = async (
  email: string,
  input: { type: string; serial: string; pin: string; orderId: string }
): Promise<void> => {
  const subject = `Your ${input.type} WAEC result checker — ${PLATFORM_NAME}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;">
      <h2 style="color:#1e40af;margin:0 0 12px;">${input.type} Result Checker</h2>
      <p style="color:#374151;">Order <strong>${input.orderId}</strong></p>
      <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px;"><strong>Serial:</strong> ${input.serial}</p>
        <p style="margin:0;"><strong>PIN:</strong> ${input.pin}</p>
      </div>
      <p style="color:#6b7280;font-size:13px;">Use these details on the WAEC results portal. Keep them private.</p>
    </div>
  `;
  await sendEmail(email, subject, html);
};

export const sendMtnNumberVerificationEmail = async (
  email: string,
  input: { phone: string; orderId: string }
): Promise<void> => {
  const subject = `MTN number verification in progress — ${PLATFORM_NAME}`;
  const text = [
    `${PLATFORM_NAME} — MTN number verification`,
    '',
    `Order: ${input.orderId}`,
    `Number: ${input.phone}`,
    '',
    'This number is not verified on our system, so it has been submitted to MTN for verification.',
    'Verification usually takes 24–144 hours.',
    'After verification, subsequent orders for this number will come faster.',
    '',
    'During this verification period, kindly have patience — your money is safe and your order is already processed in the system.',
    '',
    'Thank you for your patience.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;">
      <h2 style="color:#1e40af;margin:0 0 12px;">MTN number verification</h2>
      <p style="color:#374151;margin:0 0 12px;">
        This number (<strong>${input.phone}</strong>) is not verified on our system, so it has been
        submitted to MTN for verification.
      </p>
      <p style="color:#374151;margin:0 0 12px;">
        Verification will take <strong>24–144 hours</strong>. After verification, subsequent orders
        for this number will come fast.
      </p>
      <p style="color:#374151;margin:0 0 12px;">
        During this verification period, kindly have patience — your money is safe and your order is
        already processed in the system.
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0;">Order reference: <strong>${input.orderId}</strong></p>
    </div>
  `;

  await dispatchPriorityEmail({ to: email, subject, text, html });
};
