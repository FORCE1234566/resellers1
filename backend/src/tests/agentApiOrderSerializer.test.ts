import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNetworkApiMeta,
  getPurchasedNetwork,
  serializeAgentApiOrder,
} from '../services/agentApiOrderSerializer.js';
import { IOrder } from '../models/Order.js';

test('getNetworkApiMeta distinguishes MTN and MTN Express', () => {
  const mtn = getNetworkApiMeta('MTN');
  const express = getNetworkApiMeta('MTN Express');
  assert.equal(mtn?.code, 'mtn');
  assert.equal(mtn?.label, 'MTN (normal)');
  assert.equal(express?.code, 'mtn_express');
  assert.equal(express?.label, 'MTN Express');
  assert.notEqual(mtn?.code, express?.code);
});

test('getPurchasedNetwork keeps Express after fallback', () => {
  assert.equal(
    getPurchasedNetwork({ network: 'MTN', originalNetwork: 'MTN Express' }),
    'MTN Express'
  );
  assert.equal(getPurchasedNetwork({ network: 'MTN', originalNetwork: undefined }), 'MTN');
});

test('serializeAgentApiOrder exposes Express vs MTN fields after fallback', () => {
  const order = {
    orderId: 'ORD-TEST',
    network: 'MTN',
    originalNetwork: 'MTN Express',
    expressFallbackToMtn: true,
    productType: 'data',
    bundleSize: '1GB',
    recipientPhone: '0595399834',
    sellingPrice: 4.6,
    totalAmount: 4.6,
    status: 'processing',
    source: 'agent_api',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:01:00.000Z'),
  } as unknown as IOrder;

  const data = serializeAgentApiOrder(order);
  assert.equal(data.network, 'MTN');
  assert.equal(data.networkCode, 'mtn');
  assert.equal(data.purchasedNetwork, 'MTN Express');
  assert.equal(data.purchasedNetworkCode, 'mtn_express');
  assert.equal(data.expressFallbackToMtn, true);
  assert.equal(data.originalNetwork, 'MTN Express');
});
