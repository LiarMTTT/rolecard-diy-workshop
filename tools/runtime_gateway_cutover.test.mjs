import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = path.join(root, 'runtime', 'xingyue', '3.9.6', 'control-center.js');
const source = await fs.readFile(runtimePath, 'utf8');

const defaultMatch = source.match(/const DEFAULT_GATEWAY_URL = '([^']+)';/);
const legacyMatch = source.match(/const LEGACY_GATEWAY_URL = ([^;]+);/);
assert(defaultMatch && legacyMatch, 'Gateway cutover constants must exist');

const newGateway = defaultMatch[1];
const oldGateway = vm.runInNewContext(`(${legacyMatch[1]})`);
assert.equal(newGateway, 'https://198-23-196-145.sslip.io');
assert.equal(oldGateway, 'https://43-132-171-157.sslip.io');

const snippetStart = source.indexOf('  function isLegacyGatewayUrl(value) {');
const snippetEnd = source.indexOf('  let settings = readSettings();', snippetStart);
assert(snippetStart >= 0 && snippetEnd > snippetStart, 'Gateway settings functions must be extractable');
const settingsFunctions = source.slice(snippetStart, snippetEnd);

function createHarness(rawStoredValue) {
  const writes = [];
  const context = {
    DEFAULT_GATEWAY_URL: newGateway,
    LEGACY_GATEWAY_URL: oldGateway,
    DEFAULT_SETTINGS: {
      gatewayUrl: newGateway,
      staticIndexUrl: 'https://example.invalid/index.json',
      statusHudEntryMode: 'auto',
      statusHudDrawerPlacement: 'auto',
    },
    STORAGE_KEY: 'cutover-settings-test',
    localStorage: {
      getItem: () => rawStoredValue,
      setItem: (key, value) => writes.push({ key, value }),
    },
    normalizeStatusHudEntryMode: value => value || 'auto',
    normalizeStatusHudDrawerPlacement: value => value || 'auto',
  };
  vm.createContext(context);
  vm.runInContext(`${settingsFunctions}\nglobalThis.cutoverApi = { isLegacyGatewayUrl, normalizeSettings, readSettings };`, context);
  return { api: context.cutoverApi, writes };
}

const direct = createHarness(null);
assert.equal(direct.api.normalizeSettings({ gatewayUrl: oldGateway }).gatewayUrl, newGateway);
assert.equal(direct.api.normalizeSettings({ gatewayUrl: `  ${oldGateway}/  ` }).gatewayUrl, newGateway);
assert.equal(direct.api.normalizeSettings({ gatewayUrl: newGateway }).gatewayUrl, newGateway);
assert.equal(direct.api.normalizeSettings({ gatewayUrl: 'https://gateway.example.test/custom' }).gatewayUrl, 'https://gateway.example.test/custom');

const storedLegacy = createHarness(JSON.stringify({ gatewayUrl: oldGateway, customMarker: 'keep' }));
const migrated = storedLegacy.api.readSettings();
assert.equal(migrated.gatewayUrl, newGateway);
assert.equal(migrated.customMarker, 'keep');
assert.equal(storedLegacy.writes.length, 1, 'legacy stored Gateway must be persisted once');
assert.equal(JSON.parse(storedLegacy.writes[0].value).gatewayUrl, newGateway);

const storedCustom = createHarness(JSON.stringify({ gatewayUrl: 'https://gateway.example.test/custom' }));
assert.equal(storedCustom.api.readSettings().gatewayUrl, 'https://gateway.example.test/custom');
assert.equal(storedCustom.writes.length, 0, 'custom Gateway must not be rewritten');

const corrupt = createHarness('{broken-json');
assert.doesNotThrow(() => corrupt.api.readSettings());
assert.equal(corrupt.api.readSettings().gatewayUrl, newGateway);
assert.equal(corrupt.writes.length, 0);

const storedNull = createHarness('null');
assert.equal(storedNull.api.readSettings().gatewayUrl, newGateway);
assert.equal(storedNull.writes.length, 0);

console.log('[ok] 3.9.6 Gateway cutover settings migration');
