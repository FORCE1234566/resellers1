import dotenv from 'dotenv';
import { PLATFORM_NAME } from './brand';

dotenv.config();

export const env = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  platformName: process.env.PLATFORM_NAME || PLATFORM_NAME,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/data-bundle-reseller',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || 'dev-refresh-secret',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  redisUrl: process.env.REDIS_URL || '',
  trustCloudflare: process.env.TRUST_CLOUDFLARE === 'true',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:5000',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_FROM || `${PLATFORM_NAME} <noreply@localhost>`,
  },
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFrom: process.env.RESEND_FROM || '',
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
    webhookIps: (process.env.PAYSTACK_WEBHOOK_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  devSkipOtp: process.env.DEV_SKIP_OTP === 'true',
  devAutoDeliver: process.env.DEV_AUTO_DELIVER === 'true',
  fulfillment: {
    enabled: process.env.FULFILLMENT_API_ENABLED === 'true',
    apiUrl: process.env.FULFILLMENT_API_URL || '',
    apiKey: process.env.FULFILLMENT_API_KEY || '',
    apiSecret: process.env.FULFILLMENT_API_SECRET || '',
    webhookSecret: process.env.FULFILLMENT_WEBHOOK_SECRET || '',
  },
  datamax: {
    enabled: process.env.DATAMAX_API_ENABLED === 'true',
    apiUrl: process.env.DATAMAX_API_URL || 'https://datamax.site/wp-json/api/v1',
    apiKey: process.env.DATAMAX_API_KEY || '',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@localhost.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
    name: process.env.ADMIN_NAME || 'Platform Admin',
  },
  demo: {
    agentEmail:
      process.env.DEMO_AGENT_EMAIL ||
      process.env.DEMO_DEALER_EMAIL ||
      'agent@databundle.test',
    agentPassword:
      process.env.DEMO_AGENT_PASSWORD ||
      process.env.DEMO_DEALER_PASSWORD ||
      'Agent@12345',
    resellerEmail: process.env.DEMO_RESELLER_EMAIL || 'reseller@databundle.test',
    resellerPassword: process.env.DEMO_RESELLER_PASSWORD || 'Reseller@12345',
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10),
  cronSecret: process.env.CRON_SECRET || '',
};
