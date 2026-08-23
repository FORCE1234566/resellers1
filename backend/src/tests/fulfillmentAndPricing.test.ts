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
  getSmartDataHubMtnExpressCost,
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
    'MTN Express': 'smartdatahub',
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
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'Telecel'), 'datamax');
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
  assert.equal(settings.networkRouting.Telecel, 'datamax');
  assert.equal(settings.networkRouting.AirtelTigo, 'smartdatahub');
  assert.equal(settings.defaultProvider, 'smartdatahub');
  assert.equal(settings.afaRouting, 'datamax');
});

test('migrateFulfillmentSettings forces Telecel onto Datamax', () => {
  const { settings, dirty } = migrateFulfillmentSettings({
    enabled: true,
    defaultProvider: 'smartdatahub',
    networkRouting: {
      MTN: 'smartdatahub',
      'MTN Express': 'smartdatahub',
      Telecel: 'off',
      AirtelTigo: 'off',
    },
    afaRouting: 'datamax',
  });

  assert.equal(dirty, true);
  assert.equal(settings.networkRouting.Telecel, 'datamax');
});

test('resolveAfaFulfillmentProviderFromSettings always routes to Datamax', () => {
  const settings = baseSettings();
  assert.equal(resolveAfaFulfillmentProviderFromSettings(settings), 'datamax');

  settings.afaRouting = 'off';
  assert.equal(resolveAfaFulfillmentProviderFromSettings(settings), 'datamax');

  settings.afaRouting = 'default';
  settings.enabled = false;
  assert.equal(resolveAfaFulfillmentProviderFromSettings(settings), 'datamax');
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
  assert.equal(mapNetworkToProviderCode('MTN Express'), 'mtn_express');
  assert.equal(mapNetworkToProviderCode('Telecel'), 'vodafone');
  assert.equal(mapNetworkToProviderCode('AirtelTigo'), 'at');
});

test('resolveFulfillmentProviderFromSettings forces MTN Express onto Smart Data Hub', () => {
  const settings = baseSettings();
  settings.networkRouting['MTN Express'] = 'off';
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'MTN Express'), 'smartdatahub');
  settings.enabled = false;
  assert.equal(resolveFulfillmentProviderFromSettings(settings, 'MTN Express'), null);
});

test('getSmartDataHubTelecelCost / getDatamaxTelecelCost return current Telecel API prices', () => {
  assert.equal(getSmartDataHubTelecelCost('10GB'), 37.0);
  assert.equal(getSmartDataHubTelecelCost('15GB'), 53.0);
  assert.equal(getSmartDataHubTelecelCost('20GB'), 73.0);
  assert.equal(getSmartDataHubTelecelCost('30GB'), 107.0);
  assert.equal(getSmartDataHubTelecelCost('40GB'), 142.0);
  assert.equal(getSmartDataHubTelecelCost('50GB'), 177.0);
  assert.equal(getSmartDataHubTelecelCost('35GB'), null);
  assert.equal(getSmartDataHubTelecelCost('100GB'), null);
  assert.equal(getSmartDataHubTelecelCost('1GB'), null);
});

test('resolveOrderApiCost uses Datamax Telecel costs when Telecel is routed to Datamax', () => {
  assert.equal(
    resolveOrderApiCost({
      network: 'Telecel',
      bundleSize: '10GB',
      costPrice: 1,
      fulfillmentProvider: 'datamax',
      isAfa: false,
    }),
    37.0
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'Telecel',
      bundleSize: '50GB',
      costPrice: 1,
      fulfillmentProvider: 'datamax',
      isAfa: false,
    }),
    177.0
  );
});

test('resolveOrderApiCost uses Smart Data Hub Telecel costs when routed to SDH', () => {
  assert.equal(
    resolveOrderApiCost({
      network: 'Telecel',
      bundleSize: '20GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    73.0
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

test('getSmartDataHubMtnExpressCost returns SDH Express API prices', () => {
  assert.equal(getSmartDataHubMtnExpressCost('1GB'), 4.1);
  assert.equal(getSmartDataHubMtnExpressCost('10GB'), 41.0);
  assert.equal(getSmartDataHubMtnExpressCost('15GB'), 59.0);
  assert.equal(getSmartDataHubMtnExpressCost('40GB'), 158.2);
  assert.equal(getSmartDataHubMtnExpressCost('50GB'), 200.0);
  assert.equal(getSmartDataHubMtnExpressCost('100GB'), 400.0);
  assert.equal(getSmartDataHubMtnExpressCost('99GB'), null);
});

test('resolveOrderApiCost uses SDH Express costs for MTN Express', () => {
  assert.equal(
    resolveOrderApiCost({
      network: 'MTN Express',
      bundleSize: '100GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    400.0
  );
  assert.equal(
    resolveOrderApiCost({
      network: 'MTN Express',
      bundleSize: '20GB',
      costPrice: 1,
      fulfillmentProvider: 'smartdatahub',
      isAfa: false,
    }),
    79.6
  );
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
    14
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
