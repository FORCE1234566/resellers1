import test from 'node:test';
import assert from 'node:assert/strict';
import { isRoleEmailOtpEnabled, shouldSkipEmailOtpForUser } from '../services/settingsService.js';
import { createResellerAccount } from '../services/resellerAccountService.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongo: MongoMemoryServer;
let priorDevSkipOtp: string | undefined;

test.before(async () => {
  priorDevSkipOtp = process.env.DEV_SKIP_OTP;
  process.env.DEV_SKIP_OTP = 'false';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  if (priorDevSkipOtp === undefined) delete process.env.DEV_SKIP_OTP;
  else process.env.DEV_SKIP_OTP = priorDevSkipOtp;
});

test.beforeEach(async () => {
  await Setting.deleteMany({});
  await User.deleteMany({});
});

test('isRoleEmailOtpEnabled defaults to false when authSettings missing', async () => {
  await Setting.create({ complaintSettings: { globalEnabled: true, networkSettings: {}, userOverrides: {} } });
  assert.equal(await isRoleEmailOtpEnabled('reseller'), false);
  assert.equal(await isRoleEmailOtpEnabled('agent'), false);
});

test('isRoleEmailOtpEnabled turns off stored agent/reseller login OTP', async () => {
  await Setting.create({
    authSettings: { resellerEmailOtpEnabled: false, agentEmailOtpEnabled: true },
    complaintSettings: { globalEnabled: true, networkSettings: {}, userOverrides: {} },
  });
  assert.equal(await isRoleEmailOtpEnabled('reseller'), false);
  assert.equal(await isRoleEmailOtpEnabled('agent'), false);
});

test('shouldSkipEmailOtpForUser always skips agent and reseller login OTP', async () => {
  await Setting.create({
    authSettings: { resellerEmailOtpEnabled: true, agentEmailOtpEnabled: true },
    complaintSettings: { globalEnabled: true, networkSettings: {}, userOverrides: {} },
  });
  assert.equal(await shouldSkipEmailOtpForUser({ role: 'reseller' }), true);
  assert.equal(await shouldSkipEmailOtpForUser({ role: 'agent' }), true);
  assert.equal(await shouldSkipEmailOtpForUser({ role: 'reseller', emailOtpEnabled: true }), true);
  assert.equal(await shouldSkipEmailOtpForUser({ role: 'agent', emailOtpEnabled: true }), true);
  assert.equal(await shouldSkipEmailOtpForUser({ role: 'admin' }), false);
});

test('createResellerAccount creates active reseller with store and wallet', async () => {
  const user = await createResellerAccount({
    fullName: 'Test Reseller',
    email: 'new-reseller@test.com',
    phone: '0241234567',
    password: 'SecurePass@123',
    activateImmediately: true,
  });

  assert.equal(user.status, 'active');
  assert.equal(user.role, 'reseller');
  assert.ok(user.resellerStore?.slug);
  assert.equal(user.resellerStore?.isVerified, true);

  const stored = await User.findById(user._id);
  assert.equal(stored?.status, 'active');
});
