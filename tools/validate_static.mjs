import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredJson = [
  'workshop-index.json',
  'cards/xingyue/index.json',
  'shared/tags.json',
  'schemas/workshop-package.schema.json',
  'examples/character.example.json',
  'examples/user_identity.example.json',
  'examples/world_factor.example.json',
  'examples/xingyue-opening-v1.example.json',
];

function readJson(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8').then(text => JSON.parse(text));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const relativePath of requiredJson) {
  await readJson(relativePath);
  console.log(`[json] ${relativePath}`);
}

const workshopIndex = await readJson('workshop-index.json');
assert(Array.isArray(workshopIndex.cards) && workshopIndex.cards.length > 0, 'workshop-index cards must not be empty');
const runtimeManifests = [];
for (const card of workshopIndex.cards) {
  assert(card.cardScope, 'cardScope is required');
  assert(card.indexUrl, `${card.cardScope} indexUrl is required`);
  assert(card.runtimeManifestUrl, `${card.cardScope} runtimeManifestUrl is required`);
  await readJson(card.indexUrl);
  runtimeManifests.push({
    relativePath: card.runtimeManifestUrl,
    manifest: await readJson(card.runtimeManifestUrl),
  });
}
const discoveredRuntimeRoot = path.join(root, 'runtime', 'xingyue');
const knownManifestPaths = new Set(runtimeManifests.map(item => item.relativePath.replace(/\\/g, '/')));
for (const entry of await fs.readdir(discoveredRuntimeRoot, { withFileTypes:true })) {
  if (!entry.isDirectory()) continue;
  const relativePath = path.posix.join('runtime', 'xingyue', entry.name, 'manifest.json');
  try {
    const manifest = await readJson(relativePath);
    if (!knownManifestPaths.has(relativePath)) runtimeManifests.push({ relativePath, manifest });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const packageSchema = await readJson('schemas/workshop-package.schema.json');
const allowedTypes = new Set(packageSchema.properties?.type?.enum || []);
assert(allowedTypes.size > 0, 'schema type enum is empty');

for (const example of ['examples/character.example.json', 'examples/user_identity.example.json', 'examples/world_factor.example.json', 'examples/xingyue-opening-v1.example.json']) {
  const pkg = await readJson(example);
  assert(allowedTypes.has(pkg.type), `${example} has unsupported type ${pkg.type}`);
  for (const key of packageSchema.required || []) {
    assert(pkg[key] !== undefined, `${example} missing required field ${key}`);
  }
}

for (const { relativePath, manifest } of runtimeManifests) {
  const runtimeDir = path.dirname(relativePath);
  for (const mod of manifest.modules || []) {
    if (!mod.url || !mod.sha256) continue;
    const filename = decodeURIComponent(new URL(String(mod.url), 'https://workshop.invalid/').pathname.split('/').pop() || '');
    assert(filename && filename !== '.' && filename !== '..', `${mod.id} has invalid module url`);
    const filePath = path.join(root, runtimeDir, filename);
    const content = await fs.readFile(filePath);
    assert(Number.isInteger(mod.bytes) && mod.bytes >= 0, `${mod.id} bytes must be a non-negative integer`);
    assert(content.byteLength === mod.bytes, `${mod.id} bytes mismatch: ${content.byteLength} !== ${mod.bytes}`);
    const actual = sha256(content);
    assert(actual === mod.sha256, `${mod.id} sha256 mismatch: ${actual} !== ${mod.sha256}`);
    console.log(`[sha256] ${mod.id}`);
  }
}

const activeRuntime = await fs.readFile(path.join(root, 'runtime', 'xingyue', '3.9.6', 'control-center.js'), 'utf8');
assert(activeRuntime.includes("const DEFAULT_GATEWAY_URL = 'https://198-23-196-145.sslip.io';"), '3.9.6 runtime must use the RackNerd Gateway');
assert(activeRuntime.includes('if (isLegacyGatewayUrl(merged.gatewayUrl)) merged.gatewayUrl = DEFAULT_GATEWAY_URL;'), '3.9.6 runtime must migrate the retired official Gateway setting');
assert(!activeRuntime.includes('43-132-171-157.sslip.io'), '3.9.6 runtime must not ship the retired Gateway hostname as a request target');

const workshopStudio = await fs.readFile(path.join(root, 'gateway', 'public', 'workshop-studio.html'), 'utf8');
assert(workshopStudio.includes('const GATEWAY_BASE = location.origin;'), 'workshop studio must use its serving Gateway origin');
assert(!workshopStudio.includes('43-132-171-157.sslip.io'), 'workshop studio must not use the retired Gateway hostname');

const deployGateway = await fs.readFile(path.join(root, 'tools', 'deploy_gateway_docker.mjs'), 'utf8');
assert(deployGateway.includes('https://198-23-196-145.sslip.io/api/workshop/health'), 'Gateway deployment fallback must target RackNerd');
assert(!deployGateway.includes('43-132-171-157.sslip.io'), 'Gateway deployment fallback must not target Tencent');

const opsTakeover = await fs.readFile(path.join(root, 'tools', 'ops_takeover.mjs'), 'utf8');
assert(opsTakeover.includes("gatewayUrl: 'https://198-23-196-145.sslip.io'"), 'operations Gateway default must target RackNerd');
assert(opsTakeover.includes("vpsHost: '198.23.196.145'"), 'operations VPS default must target RackNerd');
assert(!opsTakeover.includes('43-132-171-157.sslip.io') && !opsTakeover.includes('43.132.171.157'), 'operations defaults must not target Tencent');
console.log('[cutover] active runtime and workshop studio target RackNerd');

console.log('[ok] static workshop contract validated');
