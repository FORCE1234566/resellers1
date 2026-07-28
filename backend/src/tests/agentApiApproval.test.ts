import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentApiApproved,
  serializeAgentApiStatus,
} from '../services/agentApiApprovalService.js';
import { IUser } from '../models/User.js';

function agentStub(partial: Partial<IUser['agentApi']>): IUser {
  return {
    agentApi: {
      ipWhitelist: [],
      isActive: false,
      approvalStatus: 'none',
      customPrices: new Map(),
      ...partial,
    },
  } as IUser;
}

test('isAgentApiApproved does not require secretKeyHash on the loaded document', () => {
  const agent = agentStub({
    approvalStatus: 'approved',
    isActive: true,
    apiKey: 'dbk_test_key',
    // secretKeyHash intentionally omitted (select:false on dashboard queries)
  });
  assert.equal(isAgentApiApproved(agent), true);
});

test('isAgentApiApproved requires approved + active + apiKey', () => {
  assert.equal(
    isAgentApiApproved(
      agentStub({ approvalStatus: 'pending', isActive: false, apiKey: 'dbk_x' })
    ),
    false
  );
  assert.equal(
    isAgentApiApproved(
      agentStub({ approvalStatus: 'approved', isActive: false, apiKey: 'dbk_x' })
    ),
    false
  );
  assert.equal(
    isAgentApiApproved(
      agentStub({ approvalStatus: 'approved', isActive: true })
    ),
    false
  );
});

test('serializeAgentApiStatus reports hasCredentials when approved with apiKey', () => {
  const status = serializeAgentApiStatus(
    agentStub({
      approvalStatus: 'approved',
      isActive: true,
      apiKey: 'dbk_test_key',
    })
  );
  assert.equal(status.hasCredentials, true);
  assert.equal(status.approvalStatus, 'approved');
});
