import { User, IUser, IAgentApi, AgentApiApprovalStatus } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { generateApiKey, generateSecretKey } from '../utils/helpers';
import { setInitialAgentApiSecret } from './agentSecretService';
import { createNotification } from './notificationService';

export function getAgentApiApprovalStatus(agent: IUser): AgentApiApprovalStatus {
  return agent.agentApi?.approvalStatus ?? 'none';
}

export function isAgentApiApproved(agent: IUser): boolean {
  // Do not require secretKeyHash here — it is select:false and often absent on
  // dashboard User queries. External API auth still verifies the hash separately.
  return (
    agent.agentApi?.approvalStatus === 'approved' &&
    agent.agentApi.isActive === true &&
    Boolean(agent.agentApi.apiKey)
  );
}

function emptyAgentApiStub(): IAgentApi {
  return {
    ipWhitelist: [],
    isActive: false,
    approvalStatus: 'pending',
    customPrices: new Map(),
  };
}

export async function requestAgentApiAccess(
  agentId: string,
  message?: string
): Promise<{ approvalStatus: AgentApiApprovalStatus; requestedAt?: Date }> {
  const agent = await User.findOne({ _id: agentId, role: 'agent' });
  if (!agent) throw new AppError('Agent not found', 404);
  if (agent.status === 'suspended') throw new AppError('Your account is suspended');

  const status = getAgentApiApprovalStatus(agent);
  if (status === 'pending') {
    throw new AppError('Your API request is already pending admin approval');
  }
  if (isAgentApiApproved(agent)) {
    throw new AppError('API access is already approved');
  }

  if (!agent.agentApi) {
    agent.agentApi = emptyAgentApiStub();
  } else {
    agent.agentApi.approvalStatus = 'pending';
    agent.agentApi.isActive = false;
  }

  agent.agentApi.requestMessage = message?.trim() || undefined;
  agent.agentApi.requestedAt = new Date();
  agent.agentApi.rejectionReason = undefined;
  agent.markModified('agentApi');
  await agent.save();

  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id');
  await Promise.all(
    admins.map((admin) =>
      createNotification(
        admin._id,
        'agent_api_request',
        'Agent API request',
        `${agent.fullName} requested Developer API access.`
      )
    )
  );

  return {
    approvalStatus: agent.agentApi.approvalStatus ?? 'pending',
    requestedAt: agent.agentApi.requestedAt,
  };
}

export async function approveAgentApiAccess(
  agentId: string
): Promise<{ apiKey: string; secretKey: string }> {
  const agent = await User.findOne({ _id: agentId, role: 'agent' });
  if (!agent) throw new AppError('Agent not found', 404);

  if (isAgentApiApproved(agent)) {
    throw new AppError('API access is already approved for this agent');
  }

  const status = getAgentApiApprovalStatus(agent);
  if (status !== 'pending') {
    throw new AppError('This agent has no pending API request', 400);
  }

  if (!agent.agentApi) {
    agent.agentApi = emptyAgentApiStub();
  }

  const plaintextSecret = generateSecretKey();
  agent.agentApi.apiKey = generateApiKey();
  await setInitialAgentApiSecret(agent.agentApi, plaintextSecret);
  agent.agentApi.secretKey = plaintextSecret;
  agent.agentApi.approvalStatus = 'approved';
  agent.agentApi.isActive = true;
  agent.agentApi.reviewedAt = new Date();
  agent.agentApi.rejectionReason = undefined;
  agent.markModified('agentApi');
  await agent.save();

  await createNotification(
    agent._id,
    'agent_api_approved',
    'API access approved',
    'Your Developer API request was approved. You can now view your credentials.'
  );

  return { apiKey: agent.agentApi.apiKey!, secretKey: plaintextSecret };
}

export async function rejectAgentApiAccess(agentId: string, reason?: string): Promise<void> {
  const agent = await User.findOne({ _id: agentId, role: 'agent' });
  if (!agent) throw new AppError('Agent not found', 404);

  const status = getAgentApiApprovalStatus(agent);
  if (status !== 'pending') {
    throw new AppError('This agent has no pending API request', 400);
  }

  if (!agent.agentApi) {
    agent.agentApi = emptyAgentApiStub();
  }

  agent.agentApi.approvalStatus = 'rejected';
  agent.agentApi.isActive = false;
  agent.agentApi.reviewedAt = new Date();
  agent.agentApi.rejectionReason = reason?.trim() || 'Request declined by admin';
  agent.agentApi.apiKey = undefined;
  agent.agentApi.secretKey = undefined;
  agent.agentApi.secretKeyHash = undefined;
  agent.markModified('agentApi');
  await agent.save();

  await createNotification(
    agent._id,
    'agent_api_rejected',
    'API request declined',
    agent.agentApi.rejectionReason
  );
}

/** Auto-approve API for demo/dev agents without a pending request. */
export async function provisionApprovedAgentApi(agent: IUser): Promise<{ apiKey: string; secretKey: string }> {
  const plaintextSecret = generateSecretKey();
  const existingCustomPrices = agent.agentApi?.customPrices;
  agent.agentApi = {
    apiKey: generateApiKey(),
    ipWhitelist: agent.agentApi?.ipWhitelist ?? [],
    isActive: true,
    approvalStatus: 'approved',
    reviewedAt: new Date(),
    // Preserve per-agent package prices when (re)provisioning API credentials.
    customPrices:
      existingCustomPrices instanceof Map
        ? existingCustomPrices
        : existingCustomPrices
          ? new Map(Object.entries(existingCustomPrices as unknown as Record<string, number>))
          : new Map(),
  };
  await setInitialAgentApiSecret(agent.agentApi, plaintextSecret);
  agent.markModified('agentApi');
  await agent.save();
  return { apiKey: agent.agentApi.apiKey!, secretKey: plaintextSecret };
}

export async function migrateAgentApiApproval(): Promise<void> {
  const agents = await User.find({
    role: 'agent',
    agentApi: { $exists: true, $ne: null },
    $or: [{ 'agentApi.approvalStatus': { $exists: false } }, { 'agentApi.approvalStatus': null }],
  }).select('+agentApi.secretKey +agentApi.secretKeyHash');

  let migrated = 0;
  for (const agent of agents) {
    if (!agent.agentApi) continue;
    try {
      if (agent.agentApi.apiKey && (agent.agentApi.secretKeyHash || agent.agentApi.secretKey)) {
        agent.agentApi.approvalStatus = 'approved';
        agent.agentApi.isActive = true;
      } else {
        agent.agentApi.approvalStatus = 'none';
        agent.agentApi.isActive = false;
      }
      agent.markModified('agentApi');
      await agent.save();
      migrated++;
    } catch (err) {
      console.error(
        `Migration: skipped agent API approval for ${agent.email}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (migrated > 0) {
    console.log(`Migration: set agent API approval status on ${migrated} agent(s)`);
  }
}

export function serializeAgentApiStatus(agent: IUser) {
  const api = agent.agentApi;
  return {
    approvalStatus: getAgentApiApprovalStatus(agent),
    isActive: Boolean(api?.isActive),
    requestedAt: api?.requestedAt,
    reviewedAt: api?.reviewedAt,
    requestMessage: api?.requestMessage,
    rejectionReason: api?.rejectionReason,
    // secretKeyHash is select:false; treat issued apiKey + approved as having credentials.
    hasCredentials: Boolean(
      api?.apiKey && (api.secretKeyHash || api.approvalStatus === 'approved' || api.secretKey)
    ),
  };
}
