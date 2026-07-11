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

console.log('[ok] static workshop contract validated');
