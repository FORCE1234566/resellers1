import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import path from 'path';
import { env } from './config/env';
import { corsOriginCallback } from './config/cors';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimiter';
import { sanitizeQuery } from './middleware/sanitizeQuery';
import { validateProductionEnv } from './config/validateEnv';
import { blockUnsafeHttpMethods, requireJsonContentType } from './middleware/httpSecurity';
import { cloudflareProxyPrep } from './middleware/cloudflare';

import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import agentRoutes from './routes/agent.routes';
import resellerRoutes from './routes/reseller.routes';
import storeRoutes from './routes/store.routes';
import agentApiRoutes from './routes/agentApi.routes';
import webhookRoutes, {
  paystackWebhookMiddleware,
  fulfillmentWebhookMiddleware,
} from './routes/webhook.routes';
import supportRoutes from './routes/support.routes';
import publicRoutes from './routes/public.routes';
import cronRoutes from './routes/cron.routes';

validateProductionEnv();

const app = express();

let dbReady: Promise<void> | null = null;

async function ensureDbReady(): Promise<void> {
  if (!dbReady) {
    dbReady = (async () => {
      const { connectDB } = await import('./config/db');
      const { seedDatabase } = await import('./services/seedService');
      const { warmEmailTransport } = await import('./utils/email');
      await connectDB();
      try {
        await seedDatabase();
      } catch (err) {
        console.error('Startup seed failed (API will still serve connected requests):', err);
      }
      void warmEmailTransport();
    })().catch((err) => {
      dbReady = null;
      throw err;
    });
  }
  return dbReady;
}

if (process.env.VERCEL) {
  app.set('trust proxy', 1);
  app.use(async (req, _res, next) => {
    if (req.path === '/api/health' || req.method === 'OPTIONS') return next();
    try {
      await ensureDbReady();
      next();
    } catch (err) {
      next(err);
    }
  });
}

app.use(blockUnsafeHttpMethods);
app.use(cloudflareProxyPrep);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: env.nodeEnv === 'production' ? undefined : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hsts: env.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  })
);
app.disable('x-powered-by');

app.use(
  cors({
    origin: corsOriginCallback,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-api-secret'],
  })
);

// Webhook signature verification requires the raw request body (before JSON parsing).
app.post('/api/webhooks/paystack', ...paystackWebhookMiddleware);
app.post('/api/webhooks/fulfillment', ...fulfillmentWebhookMiddleware);
app.post('/api/webhooks/smartdatahub', ...fulfillmentWebhookMiddleware);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(requireJsonContentType);

app.use((req, _res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  next();
});
app.use(hpp());
app.use(sanitizeQuery);
app.use(generalLimiter);

app.use('/uploads', express.static(path.join(process.cwd(), env.uploadDir)));

app.get('/api/health', async (_req, res) => {
  try {
    const mongoose = await import('mongoose');
    const dbState = mongoose.connection.readyState;
    res.json({
      success: true,
      message: 'topdealsgh API is running',
      db: dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected',
    });
  } catch {
    res.json({ success: true, message: 'topdealsgh API is running' });
  }
});

app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/dealer', agentRoutes);
app.use('/api/reseller', resellerRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/v1/agent', agentApiRoutes);
app.use('/api/v1/dealer', agentApiRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/cron', cronRoutes);

app.use(errorHandler);

export default app;
