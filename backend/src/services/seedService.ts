import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { Otp } from '../models/Otp';
import { Package } from '../models/Package';
import { Faq } from '../models/Faq';
import { Setting } from '../models/Setting';
import { Wallet } from '../models/Wallet';
import { env } from '../config/env';
import { generateReferralCode } from '../utils/helpers';
import { migrateAgentSecretIfNeeded } from './agentSecretService';
import { migrateDealerToAgent } from './agentRoleMigrationService';
import { migrateAgentApiApproval, provisionApprovedAgentApi } from './agentApiApprovalService';
import { migrateFulfillmentSettings } from './settingsService';
import { reconcileLegacyPendingWithdrawals } from './withdrawalService';
import { migrateOrderNumbers } from './orderMigrationService';
import { ensureAfaPackage } from './afaPackageService';
import { ensureCheckerPackages } from './checkerPackageService';
import {
  backfillPackageProductTypes,
  dataPackageFilter,
  ensurePackageIndexes,
} from './packageMigrationService';
import { safeStartupStep } from './startupService';
import {
  getSmartDataHubMtnCost,
  getSmartDataHubMtnExpressCost,
  getSmartDataHubTelecelCost,
  getSmartDataHubAirtelTigoCost,
  getDatamaxTelecelCost,
  DATAMAX_TELECEL_COSTS,
  SMART_DATA_HUB_MTN_EXPRESS_BUNDLES,
} from '../config/datamaxPrices';

const networks = ['MTN', 'MTN Express', 'Telecel', 'AirtelTigo'] as const;
const bundles = [
  '1GB',
  '2GB',
  '3GB',
  '4GB',
  '5GB',
  '6GB',
  '7GB',
  '8GB',
  '9GB',
  '10GB',
  '15GB',
  '20GB',
  '25GB',
  '30GB',
  '35GB',
  '40GB',
  '45GB',
  '50GB',
  '100GB',
  '150GB',
];

/** Telecel catalog currently offered by Datamax — only these stay enabled. */
const TELECEL_AVAILABLE_BUNDLES = new Set(Object.keys(DATAMAX_TELECEL_COSTS));
const MTN_EXPRESS_AVAILABLE_BUNDLES = new Set<string>(SMART_DATA_HUB_MTN_EXPRESS_BUNDLES);

const bundlePrices: Record<string, number> = {
  '1GB': 4.5,
  '2GB': 9.0,
  '3GB': 13.0,
  '4GB': 17.0,
  '5GB': 21.0,
  '6GB': 25.0,
  '8GB': 33.0,
  '10GB': 40.0,
  '15GB': 58.0,
  '20GB': 75.0,
  '25GB': 92.0,
  '30GB': 108.0,
  '40GB': 140.0,
  '50GB': 175.0,
};

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Prefer live API costs for the editable package costPrice. Telecel uses Datamax. */
function apiCostFor(network: string, bundle: string): number | null {
  if (network === 'MTN') {
    return getSmartDataHubMtnCost(bundle) ?? bundlePrices[bundle] ?? null;
  }
  if (network === 'MTN Express') {
    return getSmartDataHubMtnExpressCost(bundle);
  }
  if (network === 'Telecel') {
    return getDatamaxTelecelCost(bundle) ?? getSmartDataHubTelecelCost(bundle) ?? null;
  }
  if (network === 'AirtelTigo') {
    return getSmartDataHubAirtelTigoCost(bundle) ?? null;
  }
  return bundlePrices[bundle] ?? null;
}

async function migrateAgentApiSecrets(): Promise<void> {
  const agents = await User.find({
    role: 'agent',
    'agentApi.secretKey': { $exists: true, $ne: null },
    'agentApi.secretKeyHash': { $exists: false },
  }).select('+agentApi.secretKey +agentApi.secretKeyHash');

  let migrated = 0;
  for (const agent of agents) {
    try {
      await migrateAgentSecretIfNeeded(agent);
      migrated++;
    } catch {
      // leave for manual fix
    }
  }
  if (migrated > 0) {
    console.log(`Security: migrated ${migrated} agent API secret(s) to bcrypt hashes`);
  }
}

export const seedDatabase = async (): Promise<void> => {
  await safeStartupStep('migrateDealerToAgent', migrateDealerToAgent, { critical: true });
  await safeStartupStep('migrateAgentApiSecrets', migrateAgentApiSecrets);
  await safeStartupStep('migrateAgentApiApproval', migrateAgentApiApproval);
  await safeStartupStep('cleanupPackages', async () => {
    await Package.deleteMany({ network: { $nin: networks } });
  });

  const networkImageMap: Record<string, string> = {
    MTN: '/images/mtn.jpg',
    'MTN Express': '/images/mtn.jpg',
    Telecel: '/images/telecel.jpg',
    AirtelTigo: '/images/airteltigo.jpg',
  };

  await safeStartupStep('settingsMigration', async () => {
    const existingSettings = await Setting.findOne();
    if (!existingSettings) return;

    const migratedFulfillment = migrateFulfillmentSettings(existingSettings.fulfillmentSettings);
    if (migratedFulfillment.dirty) {
      existingSettings.fulfillmentSettings = migratedFulfillment.settings;
      existingSettings.markModified('fulfillmentSettings');
    }

    if (!existingSettings.afaSettings) {
      existingSettings.afaSettings = { inStock: true, imageUrl: '/images/afa.jpg' };
      existingSettings.markModified('afaSettings');
    }

    existingSettings.serviceImages = existingSettings.serviceImages
      .filter((img) => networks.includes(img.network as (typeof networks)[number]))
      .map((img) => ({
        ...img,
        imageUrl: networkImageMap[img.network] || img.imageUrl,
      }));
    existingSettings.markModified('complaintSettings.networkSettings');
    await existingSettings.save();
  });

  await safeStartupStep('backfillPackageProductTypes', backfillPackageProductTypes);
  await safeStartupStep('ensurePackageIndexes', ensurePackageIndexes);

  const adminEmail = env.admin.email.toLowerCase();
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    const hashedPassword = await bcrypt.hash(env.admin.password, 12);
    admin = await User.create({
      fullName: env.admin.name,
      email: adminEmail,
      phone: '0200000000',
      password: hashedPassword,
      role: 'admin',
      status: 'active',
    });
    console.log('Admin user seeded');
  } else {
    let adminUpdated = false;
    if (admin.email !== adminEmail) {
      await Otp.deleteMany({ email: admin.email });
      admin.email = adminEmail;
      adminUpdated = true;
    }
    if (admin.fullName !== env.admin.name) {
      admin.fullName = env.admin.name;
      adminUpdated = true;
    }
    const passwordMatches = await bcrypt.compare(env.admin.password, admin.password);
    if (!passwordMatches) {
      admin.password = await bcrypt.hash(env.admin.password, 12);
      adminUpdated = true;
    }
    if (adminUpdated) {
      await admin.save();
      console.log(`Admin user synced to ${adminEmail}`);
    }
  }

  const demoAgentEmail = env.demo.agentEmail.toLowerCase();
  const existingDemoAgent = await User.findOne({ email: demoAgentEmail });
  if (!existingDemoAgent) {
    const demoAgent = await createAgentWithWallet({
      fullName: 'Demo Agent',
      email: demoAgentEmail,
      phone: '0240000001',
      password: env.demo.agentPassword,
    });
    await provisionApprovedAgentApi(demoAgent);
    console.log(`Demo agent seeded: ${demoAgentEmail}`);
  } else if (existingDemoAgent.role !== 'agent') {
    existingDemoAgent.role = 'agent';
    await existingDemoAgent.save();
    console.log(`Demo account upgraded to agent role: ${demoAgentEmail}`);
  }

  const resellerExists = await User.findOne({ role: 'reseller', email: env.demo.resellerEmail });
  if (!resellerExists) {
    await createResellerWithStore({
      fullName: 'Demo Reseller',
      email: env.demo.resellerEmail,
      phone: '0240000002',
      password: env.demo.resellerPassword,
      storeName: 'FastData GH',
      whatsapp: '0240000002',
      supportEmail: env.demo.resellerEmail,
      slug: 'fastdata-gh',
    });
    console.log(`Demo reseller seeded: ${env.demo.resellerEmail}`);
  }

  await safeStartupStep('ensureNetworkPackages', ensureNetworkPackages);
  await safeStartupStep('ensureAfaPackage', ensureAfaPackage);
  await safeStartupStep('ensureCheckerPackages', ensureCheckerPackages);
  await safeStartupStep('reconcileLegacyPendingWithdrawals', reconcileLegacyPendingWithdrawals);
  await safeStartupStep('migrateOrderNumbers', migrateOrderNumbers);

  const faqCount = await Faq.countDocuments();
  if (faqCount === 0) {
    await Faq.insertMany([
      { question: 'How long does delivery take?', answer: 'Most orders are delivered within 1-5 minutes. During peak hours, delivery may take up to 30 minutes.', sortOrder: 1 },
      { question: 'How do I fund my wallet?', answer: 'Agents can fund their wallet via Paystack using Mobile Money or Bank Card from the agent dashboard.', sortOrder: 2 },
      { question: 'How do I become a reseller?', answer: 'Click "Become A Reseller" on the homepage, complete registration, and set up your store profile.', sortOrder: 3 },
      { question: 'Can I buy in bulk?', answer: 'Yes! Agents can use the bulk purchase feature to buy data for multiple numbers at once.', sortOrder: 4 },
    ]);
    console.log('FAQs seeded');
  }

  const settingsExist = await Setting.findOne();
  if (!settingsExist) {
    await Setting.create({
      fulfillmentSettings: migrateFulfillmentSettings(undefined).settings,
      serviceImages: [
        { network: 'MTN', imageUrl: '/images/mtn.jpg', isAvailable: true },
        { network: 'MTN Express', imageUrl: '/images/mtn.jpg', isAvailable: true },
        { network: 'Telecel', imageUrl: '/images/telecel.jpg', isAvailable: true },
        { network: 'AirtelTigo', imageUrl: '/images/airteltigo.jpg', isAvailable: true },
      ],
    });
    console.log('Settings seeded');
  }
};

export const ensureNetworkPackages = async () => {
  const latest = await Package.findOne().sort({ sortOrder: -1 }).select('sortOrder');
  let sortOrder = (latest?.sortOrder ?? -1) + 1;
  let created = 0;
  let updated = 0;

  for (const network of networks) {
    for (const bundle of bundles) {
      const base = apiCostFor(network, bundle);
      if (base == null) continue;

      const exists = await Package.findOne(dataPackageFilter(network, bundle));
      if (exists) {
        let changed = false;
        if (!exists.productType || exists.productType === 'data') {
          if (exists.productType !== 'data') {
            exists.productType = 'data';
            changed = true;
          }
        }
        if (exists.costPrice !== base) {
          exists.costPrice = base;
          changed = true;
        }
        if (network === 'Telecel') {
          const shouldEnable = TELECEL_AVAILABLE_BUNDLES.has(bundle);
          if (exists.isEnabled !== shouldEnable) {
            exists.isEnabled = shouldEnable;
            changed = true;
          }
        }
        if (network === 'MTN Express') {
          const shouldEnable = MTN_EXPRESS_AVAILABLE_BUNDLES.has(bundle);
          if (exists.isEnabled !== shouldEnable) {
            exists.isEnabled = shouldEnable;
            changed = true;
          }
        }
        if (changed) {
          await exists.save();
          updated++;
        }
        continue;
      }

      await Package.create({
        network,
        productType: 'data',
        bundleSize: bundle,
        costPrice: base,
        agentPrice: round(base * 1.05),
        resellerBasePrice: round(base * 1.1),
        maxSellingPrice: round(base * 1.22),
        isEnabled:
          network === 'Telecel'
            ? TELECEL_AVAILABLE_BUNDLES.has(bundle)
            : network === 'MTN Express'
              ? MTN_EXPRESS_AVAILABLE_BUNDLES.has(bundle)
              : true,
        sortOrder: sortOrder++,
      });
      created++;
    }
  }

  // Disable any leftover Telecel data packages not in the current Datamax catalog.
  const disabledTelecel = await Package.updateMany(
    {
      network: 'Telecel',
      productType: { $ne: 'afa' },
      bundleSize: { $nin: [...TELECEL_AVAILABLE_BUNDLES] },
      isEnabled: true,
    },
    { $set: { isEnabled: false } }
  );
  if (disabledTelecel.modifiedCount > 0) {
    updated += disabledTelecel.modifiedCount;
  }

  const disabledExpress = await Package.updateMany(
    {
      network: 'MTN Express',
      productType: { $ne: 'afa' },
      bundleSize: { $nin: [...MTN_EXPRESS_AVAILABLE_BUNDLES] },
      isEnabled: true,
    },
    { $set: { isEnabled: false } }
  );
  if (disabledExpress.modifiedCount > 0) {
    updated += disabledExpress.modifiedCount;
  }

  if (created > 0 || updated > 0) {
    console.log(
      `Packages synced from API costs: ${created} created, ${updated} cost/availability updates`
    );
  }
};

export const createAgentWithWallet = async (data: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}) => {
  const hashedPassword = await bcrypt.hash(data.password, 12);

  const agent = await User.create({
    ...data,
    email: data.email.toLowerCase().trim(),
    password: hashedPassword,
    role: 'agent',
    status: 'active',
  });
  await Wallet.create({ userId: agent._id });
  return agent;
};

export const createResellerWithStore = async (data: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  storeName: string;
  whatsapp: string;
  supportEmail: string;
  slug: string;
}) => {
  const hashedPassword = await bcrypt.hash(data.password, 12);
  const reseller = await User.create({
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    password: hashedPassword,
    role: 'reseller',
    status: 'active',
    resellerStore: {
      storeName: data.storeName,
      slug: data.slug,
      phone: data.phone,
      whatsapp: data.whatsapp,
      supportEmail: data.supportEmail,
      isActive: true,
      isVerified: true,
      referralCode: generateReferralCode(),
      customPrices: {},
    },
  });
  await Wallet.create({ userId: reseller._id });

  return reseller;
};
