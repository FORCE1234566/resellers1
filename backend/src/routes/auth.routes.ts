import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '../models/User';
import { PasswordReset } from '../models/PasswordReset';
import { Wallet } from '../models/Wallet';
import { AuthRequest, authenticate } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  authLimiter,
  loginLimiter,
  otpLimiter,
  registerLimiter,
  totpLimiter,
} from '../middleware/rateLimiter';
import {
  assertTotpCode,
  enableTotpForUser,
  generateTotpSecret,
  getTotpUri,
  roleRequiresMfa,
  verifyTotpCode,
} from '../services/totpService';
import { sendAuthOtpOrFail, verifyOtp, incrementOtpAttempts } from '../utils/otp';
import { signAccessToken } from '../utils/jwt';
import { EmailDeliveryError, sendPasswordResetEmail } from '../utils/email';
import { getCanonicalFrontendUrl } from '../config/urls';
import { env } from '../config/env';
import { logSecurityEvent } from '../services/securityAuditService';
import {
  createRefreshToken,
  invalidateUserSessions,
  refreshTokenCookieOptions,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/refreshTokenService';
import {
  generateReferralCode,
  isValidGhanaPhone,
  slugify,
} from '../utils/helpers';
import { buildAuthUserProfile } from '../services/performanceService';
import { validatePasswordStrength } from '../utils/password';
import { activateResellerStore } from '../services/resellerOnboardingService';
import { createResellerAccount } from '../services/resellerAccountService';
import { isRoleEmailOtpEnabled, shouldSkipEmailOtpForUser } from '../services/settingsService';
import {
  findUserForAuthLogin,
  matchesLoginPortal,
  normalizeAuthEmail,
  prefersTotpLogin,
  repairLegacyAgentAccount,
} from '../services/authLoginService';
import { rejectFields } from '../middleware/rejectFields';
import { canAcceptSubResellerSignup } from '../services/resellerStoreReadinessService';
import {
  copySubResellerTemplateToChild,
  generateUniqueResellerSlug,
  validateStoreSlugInput,
} from '../services/subResellerPricingService';
import { isValidStoreSlug } from '../utils/helpers';

const blockSubResellerPrivilegeFields = rejectFields(
  'referredBy',
  'parentAssignedPrices',
  'parentAssignedMaxPrices',
  'subResellerDefaultFloors',
  'subResellerDefaultMaxes',
  'role',
  'status',
  'customPrices',
  'isActive',
  'isVerified'
);

const router = Router();

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

const issueAuthSession = async (user: InstanceType<typeof User>) => {
  const token = signAccessToken({
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
  });
  const refreshToken = await createRefreshToken(user._id);
  const profile = await buildAuthUserProfile({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    resellerStore: user.resellerStore,
    agentApi: user.agentApi
      ? {
          approvalStatus: user.agentApi.approvalStatus ?? 'none',
          isActive: user.agentApi.isActive,
        }
      : undefined,
  });
  return { token, refreshToken, user: profile };
};

const isLoginLocked = (user: InstanceType<typeof User>) =>
  user.loginLockedUntil != null && user.loginLockedUntil > new Date();

/** Pending signup: resend OTP or auto-activate when OTP is disabled. Active account: ask user to log in. */
async function handleExistingRegistrationEmail(
  existing: InstanceType<typeof User>,
  email: string
): Promise<'otp_sent' | 'activated'> {
  if (existing.status === 'pending') {
    if (await shouldSkipEmailOtpForUser(existing)) {
      activateResellerStore(existing);
      await existing.save();
      return 'activated';
    }
    await sendAuthOtpOrFail(email);
    return 'otp_sent';
  }
  throw new AppError(
    'An account with this email already exists. Please log in or use Forgot Password.',
    409
  );
}

const recordFailedLogin = async (user: InstanceType<typeof User> | null, email: string, ip?: string) => {
  if (!user) {
    await logSecurityEvent({
      action: 'login_failed',
      entity: 'auth',
      details: { email: email.toLowerCase(), reason: 'unknown_account' },
      ip,
      success: false,
    });
    return;
  }

  user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
  if (user.failedLoginAttempts >= LOCKOUT_THRESHOLD) {
    user.loginLockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    user.failedLoginAttempts = 0;
  }
  await user.save();

  await logSecurityEvent({
    userId: user._id,
    action: 'login_failed',
    entity: 'auth',
    details: { email: user.email, attempts: user.failedLoginAttempts },
    ip,
    success: false,
  });
};

// Reseller registration
router.post(
  '/register/reseller',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const { fullName, email, phone, password, confirmPassword } = req.body;

    if (!fullName || !email || !phone || !password || !confirmPassword) {
      throw new AppError('All fields are required');
    }
    if (password !== confirmPassword) {
      throw new AppError('Passwords do not match');
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) throw new AppError(passwordError);
    if (!isValidGhanaPhone(phone)) {
      throw new AppError('Phone must be 10 digits starting with 0');
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      const outcome = await handleExistingRegistrationEmail(existing, email);
      if (outcome === 'activated') {
        const result = await issueAuthSession(existing);
        res.status(201).json({
          success: true,
          message: 'Account activated. You are now signed in.',
          data: { ...result, requiresOtp: false },
        });
        return;
      }
      res.status(201).json({
        success: true,
        message: 'Verification code sent. Please check your email (and spam folder).',
        data: { email: email.toLowerCase(), requiresOtp: true },
      });
      return;
    }

    const skipOtp = env.devSkipOtp || !(await isRoleEmailOtpEnabled('reseller'));

    const user = await createResellerAccount({
      fullName,
      email,
      phone,
      password,
      activateImmediately: skipOtp,
    });

    if (skipOtp) {
      const result = await issueAuthSession(user);
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: { ...result, requiresOtp: false },
      });
      return;
    }

    await sendAuthOtpOrFail(email);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify OTP sent to your email.',
      data: { email: user.email, requiresOtp: true },
    });
  })
);

// Sub-reseller registration (under an existing parent store)
router.post(
  '/register/sub-reseller',
  registerLimiter,
  blockSubResellerPrivilegeFields,
  asyncHandler(async (req, res) => {
    const {
      parentStoreSlug,
      fullName,
      email,
      phone,
      password,
      confirmPassword,
      storeName,
      slug,
      storeDescription,
    } = req.body;

    if (
      !parentStoreSlug ||
      !fullName ||
      !email ||
      !phone ||
      !password ||
      !confirmPassword ||
      !storeName ||
      !slug
    ) {
      throw new AppError('All required fields must be provided');
    }
    if (password !== confirmPassword) {
      throw new AppError('Passwords do not match');
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) throw new AppError(passwordError);
    if (!isValidGhanaPhone(phone)) {
      throw new AppError('Phone must be 10 digits starting with 0');
    }
    if (storeName.trim().length < 2) {
      throw new AppError('Store name must be at least 2 characters');
    }

    validateStoreSlugInput(slug);
    const normalizedSlug = slugify(slug);
    if (!isValidStoreSlug(normalizedSlug)) {
      throw new AppError('Invalid store URL slug');
    }

    const parent = await User.findOne({
      'resellerStore.slug': String(parentStoreSlug).toLowerCase().trim(),
      role: 'reseller',
    });
    if (!parent?.resellerStore) {
      throw new AppError('Parent store not found', 404);
    }
    if (!parent.resellerStore.isActive || parent.status !== 'active') {
      throw new AppError('This store is not accepting new resellers right now', 403);
    }

    const signupStatus = await canAcceptSubResellerSignup(parent);
    if (!signupStatus.signupOpen) {
      throw new AppError(signupStatus.reason || 'Sub-reseller signup is not available yet', 403);
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      const outcome = await handleExistingRegistrationEmail(existing, email);
      if (outcome === 'activated') {
        const result = await issueAuthSession(existing);
        res.status(201).json({
          success: true,
          message: 'Account activated. You are now signed in.',
          data: { ...result, requiresOtp: false },
        });
        return;
      }
      res.status(201).json({
        success: true,
        message: 'Verification code sent. Please check your email (and spam folder).',
        data: { email: email.toLowerCase(), requiresOtp: true },
      });
      return;
    }

    const slugTaken = await User.findOne({ 'resellerStore.slug': normalizedSlug });
    if (slugTaken) {
      throw new AppError('This store URL is already taken. Choose another slug.');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const uniqueSlug = await generateUniqueResellerSlug(normalizedSlug);

    const user = await User.create({
      fullName: fullName.trim(),
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: 'reseller',
      status: 'pending',
      resellerStore: {
        storeName: storeName.trim(),
        slug: uniqueSlug,
        phone,
        whatsapp: phone,
        supportEmail: email.toLowerCase(),
        isActive: true,
        isVerified: false,
        referralCode: generateReferralCode(),
        referredBy: parent._id,
        parentAssignedPrices: {},
        parentAssignedMaxPrices: {},
        storeDescription: storeDescription?.trim() || '',
        customPrices: {},
      },
    });

    copySubResellerTemplateToChild(parent, user);
    user.markModified('resellerStore.parentAssignedPrices');
    user.markModified('resellerStore.parentAssignedMaxPrices');
    await user.save();

    await Wallet.create({ userId: user._id });

    const skipOtp = env.devSkipOtp || !(await isRoleEmailOtpEnabled('reseller'));

    if (skipOtp) {
      user.status = 'active';
      activateResellerStore(user);
      await user.save();
      const result = await issueAuthSession(user);
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: { ...result, requiresOtp: false },
      });
      return;
    }

    await sendAuthOtpOrFail(email);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify OTP sent to your email.',
      data: { email: user.email, requiresOtp: true },
    });
  })
);

// Login step 1 - credentials
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password) throw new AppError('Email and password required');

    const normalizedEmail = normalizeAuthEmail(email);
    const user = await findUserForAuthLogin(normalizedEmail);
    if (!user) {
      await recordFailedLogin(null, normalizedEmail, req.ip);
      throw new AppError('Invalid credentials');
    }

    await repairLegacyAgentAccount(user);

    if (isLoginLocked(user)) {
      throw new AppError('Too many failed attempts. Try again later.');
    }

    if (!role) throw new AppError('Login portal is required');
    if (!matchesLoginPortal(user, role)) {
      await recordFailedLogin(user, normalizedEmail, req.ip);
      throw new AppError('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await recordFailedLogin(user, normalizedEmail, req.ip);
      throw new AppError('Invalid credentials');
    }

    if (user.status === 'suspended') {
      throw new AppError('Your account has been suspended');
    }

    user.failedLoginAttempts = 0;
    user.loginLockedUntil = undefined;
    await user.save();

    // Re-read OTP flag from DB so a just-re-enabled agent toggle is never stale.
    const otpFlags = await User.findById(user._id).select('emailOtpEnabled role').lean();
    const otpUser = {
      role: otpFlags?.role || user.role,
      emailOtpEnabled: otpFlags?.emailOtpEnabled,
    };

    // Skip email OTP when dev flag or role OTP is disabled in admin settings
    if (await shouldSkipEmailOtpForUser(otpUser)) {
      user.lastLogin = new Date();
      if (user.status === 'pending' && user.role === 'reseller') {
        user.status = 'active';
        activateResellerStore(user);
      }
      await user.save();
      const result = await issueAuthSession(user);
      res.cookie('refreshToken', result.refreshToken, refreshTokenCookieOptions);
      res.json({
        success: true,
        message: 'Login successful',
        data: { ...result, requiresOtp: false },
      });
      return;
    }

    const prefersTotp = prefersTotpLogin(user);
    if (!prefersTotp) {
      await sendAuthOtpOrFail(normalizedEmail);
    } else if (roleRequiresMfa(user.role)) {
      // Still try email backup so agent/reseller can use inbox OTP if authenticator fails.
      try {
        await sendAuthOtpOrFail(normalizedEmail);
      } catch (err) {
        console.error(
          '[Login backup OTP email failed]',
          normalizedEmail,
          err instanceof Error ? err.message : err
        );
      }
    }

    res.json({
      success: true,
      message: prefersTotp
        ? 'Enter your authenticator code, or use the email OTP backup'
        : 'OTP sent to your email',
      data: {
        email: user.email,
        role: user.role,
        requiresOtp: !prefersTotp,
        requiresTotp: prefersTotp,
        emailOtpBackup: true,
        otpEmailSent: !prefersTotp,
        mfaRecommended: roleRequiresMfa(user.role) && !user.totpEnabled,
      },
    });
  })
);

router.post(
  '/verify-totp',
  totpLimiter,
  asyncHandler(async (req, res) => {
    const { email, totp } = req.body;
    if (!email || !totp) throw new AppError('Email and authenticator code required');

    const normalizedEmail = normalizeAuthEmail(email);
    const user = await User.findOne({ email: normalizedEmail }).select('+totpSecretEnc');
    if (!user) throw new AppError('Invalid credentials', 401);

    assertTotpCode(user, String(totp));

    user.lastLogin = new Date();
    if (user.role === 'reseller') {
      activateResellerStore(user);
    }
    await user.save();

    const result = await issueAuthSession(user);
    await logSecurityEvent({
      userId: user._id,
      action: 'login_success',
      entity: 'auth',
      details: { method: 'totp' },
      ip: req.ip,
      success: true,
    });
    res.cookie('refreshToken', result.refreshToken, refreshTokenCookieOptions);
    res.json({ success: true, message: 'Login successful', data: result });
  })
);

// Login step 2 - OTP verification
router.post(
  '/verify-otp',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) throw new AppError('Email and OTP required');

    const normalizedEmail = normalizeAuthEmail(email);
    const valid = await verifyOtp(normalizedEmail, otp);
    if (!valid) {
      await incrementOtpAttempts(normalizedEmail);
      throw new AppError('Invalid or expired OTP');
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) throw new AppError('User not found');

    user.lastLogin = new Date();
    if (user.role === 'reseller') {
      activateResellerStore(user);
    }
    await user.save();

    const result = await issueAuthSession(user);
    await logSecurityEvent({
      userId: user._id,
      action: 'login_success',
      entity: 'auth',
      details: { method: 'email_otp' },
      ip: req.ip,
      success: true,
    });
    res.cookie('refreshToken', result.refreshToken, refreshTokenCookieOptions);
    res.json({ success: true, message: 'Login successful', data: result });
  })
);

router.post(
  '/totp/enroll',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!roleRequiresMfa(req.user!.role) && req.user!.role !== 'admin') {
      throw new AppError('TOTP is available for admin and agent accounts');
    }

    const user = await User.findById(req.user!._id).select('+totpSecretEnc');
    if (!user) throw new AppError('User not found');

    const secret = generateTotpSecret();
    const uri = getTotpUri(user.email, secret);

    res.json({
      success: true,
      data: {
        otpauthUri: uri,
        secret,
        message: 'Scan with Google Authenticator, then confirm with /totp/activate',
      },
    });
  })
);

router.post(
  '/totp/activate',
  authenticate,
  totpLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { secret, code } = req.body;
    if (!secret || !code) throw new AppError('Secret and verification code required');
    if (!verifyTotpCode(String(secret), String(code))) {
      throw new AppError('Invalid authenticator code');
    }

    const user = await User.findById(req.user!._id);
    if (!user) throw new AppError('User not found');

    await enableTotpForUser(user, String(secret));
    await logSecurityEvent({
      userId: user._id,
      action: 'totp_enabled',
      entity: 'auth',
      ip: req.ip,
      success: true,
    });

    res.json({ success: true, message: 'Authenticator app enabled' });
  })
);

router.post(
  '/refresh',
  authLimiter,
  asyncHandler(async (req, res) => {
    const raw =
      (req.cookies?.refreshToken as string | undefined) ||
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);

    if (!raw) throw new AppError('Refresh token required', 401);

    const tokens = await rotateRefreshToken(raw);
    res.cookie('refreshToken', tokens.refreshToken, refreshTokenCookieOptions);
    res.json({
      success: true,
      data: { token: tokens.accessToken, refreshToken: tokens.refreshToken },
    });
  })
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const raw = req.cookies?.refreshToken as string | undefined;
    if (raw) await revokeRefreshToken(raw);

    if (req.user) {
      await invalidateUserSessions(req.user);
      await logSecurityEvent({
        userId: req.user._id,
        action: 'logout',
        entity: 'auth',
        ip: req.ip,
        success: true,
      });
    }

    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ success: true, message: 'Logged out' });
  })
);

// Resend OTP
router.post(
  '/resend-otp',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw new AppError('Email required');

    const normalizedEmail = normalizeAuthEmail(email);
    const user = await User.findOne({ email: normalizedEmail });
    if (user) {
      await sendAuthOtpOrFail(normalizedEmail);
    }
    res.json({ success: true, message: 'If an account exists, a new OTP has been sent.' });
  })
);

// Forgot password (resellers only — dealers are admin-managed)
router.post(
  '/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, role } = req.body;
    if (!email) throw new AppError('Email required');

    if (role && role !== 'reseller') {
      throw new AppError('Password reset is only available for reseller accounts');
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      role: 'reseller',
    });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await PasswordReset.deleteMany({ email: email.toLowerCase() });
      await PasswordReset.create({
        email: email.toLowerCase(),
        token,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      const resetLink = `${getCanonicalFrontendUrl()}/reset-password?token=${token}`;
      try {
        await sendPasswordResetEmail(email, resetLink);
      } catch (err) {
        console.error('[Password reset email failed]', email, err instanceof Error ? err.message : err);
        if (err instanceof EmailDeliveryError) throw err;
        throw new EmailDeliveryError('Could not send reset email. Please try again in a moment.');
      }
    }

    res.json({
      success: true,
      message: 'If an account exists, a reset link has been sent to your email.',
    });
  })
);

// Reset password
router.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token, password, confirmPassword } = req.body;
    if (!token || !password || !confirmPassword) {
      throw new AppError('All fields required');
    }
    if (password !== confirmPassword) throw new AppError('Passwords do not match');
    const passwordError = validatePasswordStrength(password);
    if (passwordError) throw new AppError(passwordError);

    const reset = await PasswordReset.findOne({ token, used: false });
    if (!reset || reset.expiresAt < new Date()) {
      throw new AppError('Invalid or expired reset link');
    }

    const user = await User.findOne({ email: reset.email, role: 'reseller' });
    if (!user) throw new AppError('User not found');

    user.password = await bcrypt.hash(password, 12);
    await invalidateUserSessions(user);

    reset.used = true;
    await reset.save();

    await logSecurityEvent({
      userId: user._id,
      action: 'password_reset',
      entity: 'auth',
      ip: req.ip,
      success: true,
    });

    res.json({ success: true, message: 'Password reset successful' });
  })
);

// Get current user
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const profile = await buildAuthUserProfile({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      resellerStore: user.resellerStore,
      agentApi: user.agentApi
        ? {
            approvalStatus: user.agentApi.approvalStatus ?? 'none',
            isActive: user.agentApi.isActive,
          }
        : undefined,
    });
    res.json({ success: true, data: profile });
  })
);

export default router;
