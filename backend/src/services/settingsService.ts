import {
  Setting,
  IFulfillmentSettings,
  FulfillmentNetworkRoute,
  FulfillmentProvider,
  AfaFulfillmentRoute,
  IAuthSettings,
} from '../models/Setting';
import { Network } from '../models/Package';
import { User } from '../models/User';
import { Complaint } from '../models/Complaint';
import { AppError } from '../middleware/errorHandler';
import { roundMoney } from '../utils/helpers';

const COMPLAINT_MIN_HOURS = 2;
const COMPLAINT_MAX_HOURS = 24;

export interface ComplaintOrderContext {
  orderId: string;
  network: string;
  status: string;
  createdAt: Date;
}

const NETWORKS: Network[] = ['MTN', 'MTN Express', 'Telecel', 'AirtelTigo'];

const defaultFulfillmentSettings = (): IFulfillmentSettings => ({
  enabled: true,
  defaultProvider: 'smartdatahub',
  networkRouting: {
    MTN: 'off',
    'MTN Express': 'smartdatahub',
    Telecel: 'datamax',
    AirtelTigo: 'off',
  },
  afaRouting: 'datamax',
});

const defaultComplaintSettings = () => ({
  globalEnabled: true,
  networkSettings: {
    MTN: true,
    'MTN Express': true,
    Telecel: true,
    AirtelTigo: true,
  },
  userOverrides: new Map<string, boolean>(),
  noticeOverridesComplaints: false,
});

const defaultAuthSettings = (): IAuthSettings => ({
  resellerEmailOtpEnabled: false,
  agentEmailOtpEnabled: false,
});

export async function isRoleEmailOtpEnabled(role: 'reseller' | 'agent'): Promise<boolean> {
  const settings = await getSettings();
  if (role === 'reseller') {
    return settings.authSettings?.resellerEmailOtpEnabled === true;
  }
  return settings.authSettings?.agentEmailOtpEnabled === true;
}

export async function shouldSkipEmailOtpForUser(user: {
  role: string;
  emailOtpEnabled?: boolean | null;
}): Promise<boolean> {
  if (process.env.DEV_SKIP_OTP === 'true') return true;
  // Login OTP email is unreliable for many inboxes on production SMTP.
  // Agents and resellers sign in with password; admin OTP is unchanged.
  if (user.role === 'reseller' || user.role === 'agent' || user.role === 'dealer') {
    return true;
  }
  return false;
}

export function normalizeNetworkRoute(value: unknown): FulfillmentNetworkRoute {
  if (value === true) return 'smartdatahub';
  if (value === false) return 'off';
  if (value === 'default' || value === 'smartdatahub' || value === 'datamax' || value === 'off') {
    return value;
  }
  return 'off';
}

export function normalizeAfaRoute(value: unknown): AfaFulfillmentRoute {
  if (value === false) return 'off';
  if (value === 'default' || value === 'datamax' || value === 'off') return value;
  return 'datamax';
}

export function migrateFulfillmentSettings(
  fulfillment: Partial<IFulfillmentSettings> | undefined
): { settings: IFulfillmentSettings; dirty: boolean } {
  const base = defaultFulfillmentSettings();
  const current = fulfillment || {};
  let dirty = false;

  const settings: IFulfillmentSettings = {
    enabled: current.enabled ?? base.enabled,
    defaultProvider: current.defaultProvider === 'datamax' ? 'datamax' : 'smartdatahub',
    networkRouting: { ...base.networkRouting },
    // MTN AFA registration always routes to Datamax (never SDH / never off by migration).
    afaRouting: 'datamax',
  };

  if (!current.defaultProvider) dirty = true;
  if (current.afaRouting !== 'datamax') dirty = true;

  const routing = current.networkRouting as Record<string, unknown> | undefined;
  for (const network of NETWORKS) {
    const raw = routing?.[network];
    let normalized = normalizeNetworkRoute(raw);
    // Telecel data always goes through Datamax; AFA is handled separately.
    if (network === 'Telecel' && normalized !== 'datamax') {
      normalized = 'datamax';
      dirty = true;
    }
    // MTN Express always fulfills via Smart Data Hub.
    if (network === 'MTN Express' && normalized !== 'smartdatahub') {
      normalized = 'smartdatahub';
      dirty = true;
    }
    settings.networkRouting[network] = normalized;
    if (raw !== normalized) dirty = true;
  }

  return { settings, dirty };
}

export function resolveFulfillmentProviderFromSettings(
  settings: IFulfillmentSettings,
  network: Network
): FulfillmentProvider | null {
  // Telecel data always uses Datamax (independent of legacy SDH routing).
  if (network === 'Telecel') {
    return settings.enabled === false ? null : 'datamax';
  }

  // MTN Express always uses Smart Data Hub.
  if (network === 'MTN Express') {
    return settings.enabled === false ? null : 'smartdatahub';
  }

  if (!settings.enabled) return null;

  const route = normalizeNetworkRoute(settings.networkRouting?.[network]);
  if (route === 'off') return null;
  if (route === 'smartdatahub' || route === 'datamax') return route;
  return settings.defaultProvider || 'smartdatahub';
}

/** AFA registration is always fulfilled via Datamax (independent of MTN data routing). */
export function resolveAfaFulfillmentProviderFromSettings(
  _settings: IFulfillmentSettings
): FulfillmentProvider | null {
  return 'datamax';
}

export const resolveAfaFulfillmentProvider = async (): Promise<FulfillmentProvider | null> => {
  const settings = await getSettings();
  return resolveAfaFulfillmentProviderFromSettings(settings.fulfillmentSettings);
};

export const getSettings = async () => {
  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({
      fulfillmentSettings: defaultFulfillmentSettings(),
      complaintSettings: defaultComplaintSettings(),
      serviceImages: [
        { network: 'MTN', imageUrl: '/images/mtn.jpg', isAvailable: true },
        { network: 'MTN Express', imageUrl: '/images/mtn-express.png', isAvailable: false },
        { network: 'Telecel', imageUrl: '/images/telecel.jpg', isAvailable: true },
        { network: 'AirtelTigo', imageUrl: '/images/airteltigo.jpg', isAvailable: true },
      ],
    });
    return settings;
  }

  let dirty = false;
  const migrated = migrateFulfillmentSettings(settings.fulfillmentSettings);
  if (migrated.dirty || !settings.fulfillmentSettings?.networkRouting) {
    settings.fulfillmentSettings = migrated.settings;
    dirty = true;
  }
  if (!settings.complaintSettings) {
    settings.complaintSettings = defaultComplaintSettings() as typeof settings.complaintSettings;
    dirty = true;
  } else if (!settings.complaintSettings.userOverrides) {
    settings.complaintSettings.userOverrides = new Map();
    dirty = true;
  }
  if (!settings.complaintSettings.networkSettings?.['MTN Express']) {
    settings.complaintSettings.networkSettings = {
      ...defaultComplaintSettings().networkSettings,
      ...settings.complaintSettings.networkSettings,
      'MTN Express': settings.complaintSettings.networkSettings?.['MTN Express'] ?? true,
    };
    settings.markModified('complaintSettings');
    dirty = true;
  }
  if (!settings.authSettings) {
    settings.authSettings = defaultAuthSettings();
    dirty = true;
  } else if (
    settings.authSettings.resellerEmailOtpEnabled !== false ||
    settings.authSettings.agentEmailOtpEnabled !== false
  ) {
    settings.authSettings.resellerEmailOtpEnabled = false;
    settings.authSettings.agentEmailOtpEnabled = false;
    settings.markModified('authSettings');
    dirty = true;
  }

  const imageNetworks = new Set(settings.serviceImages.map((s) => s.network));
  for (const network of NETWORKS) {
    if (!imageNetworks.has(network)) {
      settings.serviceImages.push({
        network,
        imageUrl:
          network === 'Telecel'
            ? '/images/telecel.jpg'
            : network === 'AirtelTigo'
              ? '/images/airteltigo.jpg'
              : network === 'MTN Express'
                ? '/images/mtn-express.png'
                : '/images/mtn.jpg',
        // MTN Express stays out of stock until admin enables it.
        isAvailable: network !== 'MTN Express',
      });
      dirty = true;
    }
  }

  if (dirty) {
    settings.markModified('serviceImages');
    try {
      await settings.save();
    } catch (err: unknown) {
      // Concurrent getSettings migrations — reload and continue.
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
      if (name !== 'VersionError') throw err;
      const fresh = await Setting.findOne();
      if (fresh) settings = fresh;
    }
  }

  // One-shot atomic: MTN Express OOS until admin enables (safe under concurrent reads).
  const MTN_EXPRESS_OOS_BOOTSTRAP = 'mtn-express-default-oos-v1';
  const MTN_EXPRESS_IMAGE = '/images/mtn-express.png';
  const MTN_EXPRESS_IMAGE_BOOTSTRAP = 'mtn-express-image-v1';
  let inbox = settings.fulfillmentWebhookInbox || [];
  const alreadyBootstrapped = inbox.some((row) => row.note === MTN_EXPRESS_OOS_BOOTSTRAP);
  if (!alreadyBootstrapped) {
    const bootstrapEntry = {
      at: new Date().toISOString(),
      matched: false,
      refs: [] as string[],
      phones: [] as string[],
      keys: [] as string[],
      preview: 'MTN Express defaulted to out of stock until admin enables it',
      note: MTN_EXPRESS_OOS_BOOTSTRAP,
    };
    const notYetBootstrapped = {
      _id: settings._id,
      fulfillmentWebhookInbox: { $not: { $elemMatch: { note: MTN_EXPRESS_OOS_BOOTSTRAP } } },
    };
    const hasExpress = settings.serviceImages.some((s) => s.network === 'MTN Express');
    if (hasExpress) {
      await Setting.updateOne(
        notYetBootstrapped,
        {
          $set: {
            'serviceImages.$[ex].isAvailable': false,
            'serviceImages.$[ex].imageUrl': MTN_EXPRESS_IMAGE,
          },
          $push: { fulfillmentWebhookInbox: { $each: [bootstrapEntry], $slice: -50 } },
        },
        { arrayFilters: [{ 'ex.network': 'MTN Express' }] }
      );
    } else {
      await Setting.updateOne(notYetBootstrapped, {
        $push: {
          serviceImages: {
            network: 'MTN Express',
            imageUrl: MTN_EXPRESS_IMAGE,
            isAvailable: false,
          },
          fulfillmentWebhookInbox: { $each: [bootstrapEntry], $slice: -50 },
        },
      });
    }
    const reloaded = await Setting.findById(settings._id);
    if (reloaded) {
      settings = reloaded;
      inbox = settings.fulfillmentWebhookInbox || [];
    }
  }

  // One-shot: set MTN Express branding image (does not change stock).
  if (!inbox.some((row) => row.note === MTN_EXPRESS_IMAGE_BOOTSTRAP)) {
    const imageEntry = {
      at: new Date().toISOString(),
      matched: false,
      refs: [] as string[],
      phones: [] as string[],
      keys: [] as string[],
      preview: 'MTN Express service image set to mtn-express.png',
      note: MTN_EXPRESS_IMAGE_BOOTSTRAP,
    };
    const notYetImaged = {
      _id: settings._id,
      fulfillmentWebhookInbox: { $not: { $elemMatch: { note: MTN_EXPRESS_IMAGE_BOOTSTRAP } } },
    };
    const hasExpress = settings.serviceImages.some((s) => s.network === 'MTN Express');
    if (hasExpress) {
      await Setting.updateOne(
        notYetImaged,
        {
          $set: { 'serviceImages.$[ex].imageUrl': MTN_EXPRESS_IMAGE },
          $push: { fulfillmentWebhookInbox: { $each: [imageEntry], $slice: -50 } },
        },
        { arrayFilters: [{ 'ex.network': 'MTN Express' }] }
      );
    } else {
      await Setting.updateOne(notYetImaged, {
        $push: {
          serviceImages: {
            network: 'MTN Express',
            imageUrl: MTN_EXPRESS_IMAGE,
            isAvailable: false,
          },
          fulfillmentWebhookInbox: { $each: [imageEntry], $slice: -50 },
        },
      });
    }
    const reloaded = await Setting.findById(settings._id);
    if (reloaded) settings = reloaded;
  }

  return settings;
};

export const resolveFulfillmentProvider = async (
  network: string
): Promise<FulfillmentProvider | null> => {
  const settings = await getSettings();
  return resolveFulfillmentProviderFromSettings(settings.fulfillmentSettings, network as Network);
};

export const isFulfillmentRoutingEnabledForNetwork = async (network: string): Promise<boolean> => {
  return (await resolveFulfillmentProvider(network)) !== null;
};

export const isComplaintsEnabledForUser = async (userId: string): Promise<boolean> => {
  const settings = await getSettings();
  const user = await User.findById(userId);
  if (!settings.complaintSettings.globalEnabled) return false;
  if (user?.complaintEnabled === false) return false;
  const userOverride = settings.complaintSettings.userOverrides.get(userId);
  if (userOverride === false) return false;
  return true;
};

export const canSubmitComplaint = async (
  userId: string,
  order: ComplaintOrderContext
): Promise<{ allowed: boolean; reason?: string; hoursSinceOrder?: number }> => {
  const settings = await getSettings();
  const user = await User.findById(userId);
  const hoursSinceOrder = (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60);

  if (!settings.complaintSettings.globalEnabled) {
    return { allowed: false, reason: 'Complaints are currently disabled by admin', hoursSinceOrder };
  }

  if (user?.complaintEnabled === false) {
    return { allowed: false, reason: 'Complaints disabled for your account', hoursSinceOrder };
  }

  const userOverride = settings.complaintSettings.userOverrides.get(userId);
  if (userOverride === false) {
    return { allowed: false, reason: 'Complaints disabled for your account', hoursSinceOrder };
  }

  if (['refunded', 'cancelled'].includes(order.status)) {
    return { allowed: false, reason: 'This order is closed', hoursSinceOrder };
  }

  if (hoursSinceOrder < COMPLAINT_MIN_HOURS) {
    const waitMins = Math.ceil((COMPLAINT_MIN_HOURS - hoursSinceOrder) * 60);
    return {
      allowed: false,
      reason: `Wait ${waitMins} more minute${waitMins === 1 ? '' : 's'} — complaints open 2 hours after order`,
      hoursSinceOrder,
    };
  }

  if (hoursSinceOrder > COMPLAINT_MAX_HOURS) {
    return { allowed: false, reason: 'Complaint window expired (24 hours)', hoursSinceOrder };
  }

  const networkEnabled =
    settings.complaintSettings.networkSettings[order.network as Network] !== false;
  if (!networkEnabled) {
    return { allowed: false, reason: `Complaints disabled for ${order.network}`, hoursSinceOrder };
  }

  const existing = await Complaint.findOne({ orderId: order.orderId });
  if (existing) {
    return { allowed: false, reason: 'Complaint already submitted', hoursSinceOrder };
  }

  return { allowed: true, hoursSinceOrder };
};

export const depositWithdrawalPool = async (amount: number, note?: string) => {
  if (!amount || amount <= 0) throw new AppError('Amount must be greater than zero');
  const settings = await getSettings();
  const rounded = roundMoney(amount);
  settings.withdrawalPoolBalance = roundMoney((settings.withdrawalPoolBalance || 0) + rounded);
  settings.totalPoolDeposits = roundMoney((settings.totalPoolDeposits || 0) + rounded);
  await settings.save();
  return { settings, amount: rounded, note };
};

export const debitWithdrawalPool = async (amount: number) => {
  const settings = await getSettings();
  const rounded = roundMoney(amount);
  if ((settings.withdrawalPoolBalance || 0) < rounded) {
    throw new AppError('Insufficient withdrawal pool balance. Add funds in Settings first.');
  }
  settings.withdrawalPoolBalance = roundMoney(settings.withdrawalPoolBalance - rounded);
  await settings.save();
  return settings;
};

export const validatePackagePrices = (prices: {
  costPrice?: number;
  agentPrice?: number;
  resellerBasePrice?: number;
  maxSellingPrice?: number;
}) => {
  const { costPrice, agentPrice, resellerBasePrice, maxSellingPrice } = prices;
  const fields = [costPrice, agentPrice, resellerBasePrice, maxSellingPrice].filter((v) => v !== undefined);
  if (fields.some((v) => typeof v !== 'number' || v <= 0)) {
    throw new AppError('All prices must be positive numbers');
  }
  if (costPrice !== undefined && agentPrice !== undefined && agentPrice < costPrice) {
    throw new AppError('Dealer price cannot be below cost price');
  }
  if (agentPrice !== undefined && resellerBasePrice !== undefined && resellerBasePrice < agentPrice) {
    throw new AppError('Reseller base price must be at least the dealer price');
  }
  if (resellerBasePrice !== undefined && maxSellingPrice !== undefined && maxSellingPrice < resellerBasePrice) {
    throw new AppError('Max sell price must be at least the reseller base price');
  }
};
