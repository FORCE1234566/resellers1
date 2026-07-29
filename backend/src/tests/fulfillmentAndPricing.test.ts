import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFulfillmentProviderFromSettings,
  resolveAfaFulfillmentProviderFromSettings,
  normalizeNetworkRoute,
  normalizeAfaRoute,
  migrateFulfillmentSettings,
} from '../services/settingsService.js';
import { IFulfillmentSettings } from '../models/Setting.js';
import {
  mapNetworkToDatamaxCode,
  mapDatamaxVolume,
} from '../services/datamaxClient.js';
import { mapNetworkToProviderCode } from '../services/smartDataHubClient.js';
import {
  getDatamaxMtnExpressCost,
  getSmartDataHubMtnCost,
  getSmartDataHubTelecelCost,
  getSmartDataHubAirtelTigoCost,
  resolveOrderApiCost,
} from '../config/datamaxPrices.js';
import { mapProviderStatus } from '../services/fulfillmentProviderService.js';
import { validateAgentCustomPrice } from '../services/agentPricingService.js';
import { AppError } from '../middleware/errorHandler.js';

const baseSettings = (): IFulfillmentSettings => ({
  enabled: true,
  defaultProvider: 'smartdatahub',
  networkRouting: {
    MTN: 'default',
    Telecel: 'default',
    AirtelTigo: 'default',
  },
  afaRouting: 'datamax',
});

test('normalizeNetworkRoute migrates legacy booleans', () => {
  assert.equal(normalizeNetworkRoute(true), 'smartdatahub');
  assert.equal(normalizeNetworkRoute(false), 'off');
  assert.equal(normalizeNetworkRoute('datamax'), 'datamax');
});

test('resolveFulfillmentProviderFromSettings uses default provider', () => {
  const settings = baseSettings();
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'MTN'), 'smartdatahub');

  settings.defaultProvider = 'datamax';
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'MTN'), 'datamax');
});

test('resolveFulfillmentProviderFromSettings respects network overrides', () => {
  const settings = baseSettings();
  settings.defaultProvider = 'datamax';
  settings.networkRouting.MTN = 'smartdatahub';
  settings.networkRouting.Telecel = 'off';

  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'MTN'), 'smartdatahub');
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'Telecel'), null);
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'AirtelTigo'), 'datamax');
});

test('resolveFulfillmentProviderFromSettings returns null when master switch off', () => {
  const settings = baseSettings();
  settings.enabled = false;
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'MTN'), null);
});

test('migrateFulfillmentSettings converts boolean routing', () => {
  const { settings, dirty } = migrateFulfillmentSettings({
    enabled: true,
    networkRouting: {
      MTN: true,
      Telecel: false,
      AirtelTigo: true,
    },
  } as unknown as IFulfillmentSettings);

  assert.equal(dirty, true);
  assert.equal(settings.networkRouting.MTN, 'smartdatahub');
  assert.equal(settings.networkRouting.Telecel, 'smartdatahub');
  assert.equal(settings.networkRouting.AirtelTigo, 'smartdatahub');
  assert.equal(settings.defaultProvider, 'smartdatahub');
  assert.equal(settings.afaRouting, 'datamax');
});

test('migrateFulfillmentSettings forces Telecel off onto Smart Data Hub', () => {
  const { settings, dirty } = migrateFulfillmentSettings({
    enabled: true,
    defaultProvider: 'smartdatahub',
    networkRouting: {
      MTN: 'smartdatahub',
      Telecel: 'off',
      AirtelTigo: 'off',
    },
    afaRouting: 'datamax',
  });

  assert.equal(dirty, true);
  assert.equal(settings.networkRouting.Telecel, 'smartdatahub');
});

test('resolveAfaFulfillmentProviderFromSettings routes to Datamax or off', () => {
  const settings = baseSettings();
  assert.equal(resolveAfaFulfillmentProviderFromSettings(settings), 'datamax');

  settings.afaRouting = 'off';
  assert.equal(resolveAfaFulfillmentProviderFromSettings(settings), null);

  settings.afaRouting = 'default';
  settings.enabled = false;
  assert.equal(resolveAfaFulfillmentProviderFromSettings(settings), null);
});

test('normalizeAfaRoute defaults unknown values to datamax', () => {
  assert.equal(normalizeAfaRoute('datamax'), 'datamax');
  assert.equal(normalizeAfaRoute('off'), 'off');
  assert.equal(normalizeAfaRoute(false), 'off');
  assert.equal(normalizeAfaRoute('invalid'), 'datamax');
});

test('mapNetworkToDatamaxCode maps Ghana networks', () => {
  assert.equal(mapNetworkToDatamaxCode('MTN'), 'express');
  assert.equal(mapNetworkToDatamaxCode('Telecel'), 'telecel');
  assert.equal(mapNetworkToDatamaxCode('AirtelTigo'), 'airteltigo');
});

test('mapNetworkToProviderCode maps Telecel to vodafone for Smart Data Hub', () => {
  assert.equal(mapNetworkToProviderCode('MTN'), 'mtn');
  assert.equal(mapNetworkToProviderCode('Telecel'), 'vodafone');
  assert.equal(mapNetworkToProviderCode('AirtelTigo'), 'at');
});

test('getSmartDataHubTelecelCost returns SDH Telecel/Vodafone API prices', () => {
  assert.equal(getSmartDataHubTelecelCost('10GB'), 38.0);
  assert.equal(getSmartDataHubTelecelCost('35GB'), 134.0);
  assert.equal(getSmartDataHubTelecelCost('50GB'), 193.0);
  assert.equal(getSmartDataHubTelecelCost('100GB'), 355.0);
  assert.equal(getSmartDataHubTelecelCost('150GB'), 535.0);
  assert.equal(getSmartDataHubTelecelCost('1GB'), null);
});

test('resolveOrderApiCost uses Smart Data Hub Telecel costs', () => {
  assert.equal(
    resolveOrderApiCost({
      network: 'Telecel',
      bundleSize: '25GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    96.0
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'Telecel',
      bundleSize: '100GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    355.0
  );
});

test('getSmartDataHubAirtelTigoCost returns SDH Ishare API prices', () => {
  assert.equal(getSmartDataHubAirtelTigoCost('1GB'), 4.0);
  assert.equal(getSmartDataHubAirtelTigoCost('4GB'), 15.6);
  assert.equal(getSmartDataHubAirtelTigoCost('7GB'), 26.9);
  assert.equal(getSmartDataHubAirtelTigoCost('9GB'), 34.3);
  assert.equal(getSmartDataHubAirtelTigoCost('10GB'), 37.5);
  assert.equal(getSmartDataHubAirtelTigoCost('50GB'), null);
});

test('resolveOrderApiCost uses Smart Data Hub AirtelTigo costs', () => {
  assert.equal(
    resolveOrderApiCost({
      network: 'AirtelTigo',
      bundleSize: '5GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    19.5
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'AirtelTigo',
      bundleSize: '10GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    37.5
  );
});

test('getDatamaxMtnExpressCost returns MTN Express dealer prices', () => {
  assert.equal(getDatamaxMtnExpressCost('1GB'), 3.55);
  assert.equal(getDatamaxMtnExpressCost('5GB'), 17.78);
  assert.equal(getDatamaxMtnExpressCost('50GB'), 177.5);
  assert.equal(getDatamaxMtnExpressCost('99GB'), null);
});

test('getSmartDataHubMtnCost returns SDH MTN API prices', () => {
  assert.equal(getSmartDataHubMtnCost('1GB'), 4.1);
  assert.equal(getSmartDataHubMtnCost('5GB'), 20.5);
  assert.equal(getSmartDataHubMtnCost('10GB'), 38.5);
  assert.equal(getSmartDataHubMtnCost('40GB'), 154.0);
  assert.equal(getSmartDataHubMtnCost('50GB'), 192.5);
  assert.equal(getSmartDataHubMtnCost('99GB'), null);
});

test('resolveOrderApiCost uses Datamax MTN Express costs when routed to Datamax', () => {
  assert.equal(
    resolveOrderApiCost({
      network: 'MTN',
      bundleSize: '5GB',
      costPrice: 3.8,
      fulfillmentProvider: 'datamax',
      isAfa: false,
    }),
    17.78
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'MTN',
      bundleSize: '5GB',
      costPrice: 3.8,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    20.5
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'MTN',
      bundleSize: '10GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    38.5
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'Telecel',
      bundleSize: '5GB',
      costPrice: 20,
      fulfillmentProvider: 'datamax',
      isAfa: false,
    }),
    20
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'MTN',
      bundleSize: '5GB',
      costPrice: 15,
      fulfillmentProvider: 'datamax',
      isAfa: true,
    }),
    15
  );
});

test('mapDatamaxVolume parses bundle sizes', () => {
  assert.equal(mapDatamaxVolume('2GB'), '2');
  assert.equal(mapDatamaxVolume('1.5GB'), '1.5');
});

test('mapProviderStatus maps Datamax statuses', () => {
  assert.equal(mapProviderStatus('in-progress'), 'processing');
  assert.equal(mapProviderStatus('completed'), 'delivered');
});

test('validateAgentCustomPrice enforces price ladder', () => {
  const pkg = { costPrice: 4, maxSellingPrice: 10 };
  assert.doesNotThrow(() => validateAgentCustomPrice(5, pkg));

  assert.throws(
    () => validateAgentCustomPrice(3, pkg),
    (err: unknown) => err instanceof AppError
  );
  assert.throws(
    () => validateAgentCustomPrice(11, pkg),
    (err: unknown) => err instanceof AppError
  );
});
