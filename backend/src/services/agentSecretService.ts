import bcrypt from 'bcryptjs';
import { IUser } from '../models/User';
import { generateSecretKey } from '../utils/helpers';

const BCRYPT_ROUNDS = 12;

export async function hashAgentSecret(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyAgentSecret(
  plaintext: string,
  hash?: string,
  legacyPlain?: string
): Promise<boolean> {
  if (hash) {
    return bcrypt.compare(plaintext, hash);
  }
  if (legacyPlain) {
    return legacyPlain === plaintext;
  }
  return false;
}

/** Generate a new secret, store hash + plaintext for dashboard display, return plaintext. */
export async function rotateAgentApiSecret(agent: IUser): Promise<string> {
  if (!agent.agentApi) {
    throw new Error('Agent API not configured');
  }

  const plaintext = generateSecretKey();
  agent.agentApi.secretKeyHash = await hashAgentSecret(plaintext);
  agent.agentApi.secretKey = plaintext;
  agent.markModified('agentApi');
  await agent.save();

  return plaintext;
}

export async function setInitialAgentApiSecret(agentApi: IUser['agentApi'], plaintext: string) {
  if (!agentApi) return;
  agentApi.secretKeyHash = await hashAgentSecret(plaintext);
  agentApi.secretKey = plaintext;
}

/** Migrate legacy plaintext secret to bcrypt hash while keeping plaintext for the dashboard. */
export async function migrateAgentSecretIfNeeded(agent: IUser): Promise<void> {
  const api = agent.agentApi;
  if (!api || api.secretKeyHash || !api.secretKey) return;

  api.secretKeyHash = await hashAgentSecret(api.secretKey);
  agent.markModified('agentApi');
  await agent.save();
}
