#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import contract from '../shared/workshop-package-contract.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const example = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples', 'xingyue-opening-v1.example.json'), 'utf8'));
const oldRuntime = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.3.8', 'control-center.js'), 'utf8');
const currentRuntime = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.4.0', 'control-center.js'), 'utf8');
const loader = await fs.readFile(path.join(workspaceRoot, '星月', '星月 3.4.0', 'components', 'control_center.js'), 'utf8');
const preview = await fs.readFile(path.join(workspaceRoot, '星月', '星月 3.4.0', 'components', '_preview.html'), 'utf8');
const openingPage = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.4.0', 'opening-page.html'), 'utf8');
const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'schemas', 'workshop-package.schema.json'), 'utf8'));

let passed = 0;
function ok(condition, name) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`[ok] ${name}`);
}
function rejects(mutator, code, name, options = {}) {
  const input = structuredClone(example);
  mutator(input);
  assert.throws(() => contract.normalizePackage(input, { runtimeVersion: '3.4.0', ...options }), error => error?.code === code);
  passed += 1;
  console.log(`[ok] ${name}`);
}

const normalized = contract.normalizePackage(example, { runtimeVersion: '3.4.0' });
ok(normalized.cardScope === 'xingyue-opening-v1', 'opening scope accepted by 3.4 contract');
ok(normalized.payload.worldFactors.length === 1, 'opening package has exactly one canonical world factor');
ok(!Object.hasOwn(normalized.payload, 'factors'), 'canonical publish shape has no legacy factors');
ok(normalized.payload.worldFactors[0].title === normalized.title, 'outer and inner titles match');
ok(normalized.payload.gradeScope.join(',') === 'middle,high', 'grade scope preserved');

const legacy = structuredClone(example);
legacy.payload.factors = legacy.payload.worldFactors;
delete legacy.payload.worldFactors;
const migrated = contract.normalizePackage(legacy, { runtimeVersion: '3.4.0' });
ok(Array.isArray(migrated.payload.worldFactors) && !Object.hasOwn(migrated.payload, 'factors'), 'legacy factors migrate on client read');
assert.throws(() => contract.normalizePackage(legacy, { allowLegacyFactors: false }), error => error?.code === 'legacy-opening-factors-not-publishable');
passed += 1;
console.log('[ok] Gateway publish shape rejects legacy factors');
const dualFactors = structuredClone(example);
dualFactors.payload.factors = structuredClone(dualFactors.payload.worldFactors);
assert.throws(() => contract.normalizePackage(dualFactors, { allowLegacyFactors: false }), error => error?.code === 'legacy-opening-factors-not-publishable');
passed += 1;
console.log('[ok] Gateway publish shape rejects worldFactors plus legacy factors');

const legacyString = structuredClone(example);
legacyString.payload.factors = [legacyString.payload.worldFactors[0].content];
delete legacyString.payload.worldFactors;
const migratedString = contract.normalizePackage(legacyString, { runtimeVersion: '3.4.0' });
ok(migratedString.payload.worldFactors[0].title === legacyString.title, 'legacy string opening factor migrates with outer title');

rejects(pkg => { pkg.cardScope = 'xingyue'; }, 'opening-scope-target-mismatch', 'ordinary scope cannot disguise opening target');
rejects(pkg => { delete pkg.payload.target; }, 'opening-scope-target-mismatch', 'opening scope requires opening target');
rejects(pkg => { pkg.payload.worldFactors.push(structuredClone(pkg.payload.worldFactors[0])); }, 'opening-world-factors-must-have-one-item', 'multiple opening bodies rejected');
rejects(pkg => { pkg.payload.worldFactors[0].title = 'different'; }, 'opening-title-mismatch', 'title mismatch rejected');
rejects(pkg => { pkg.payload.gradeScope = ['all', 'middle']; }, 'opening-all-grade-band-must-be-alone', 'all grade band must be alone');
rejects(pkg => { pkg.payload.gradeScope = ['middle', 'middle']; }, 'duplicate-opening-grade-band', 'duplicate grade band rejected');
rejects(pkg => { pkg.payload.compatibility.minRuntimeVersion = '3.5.0'; }, 'runtime-too-old', '3.4 runtime rejects newer minimum runtime');
rejects(pkg => { pkg.payload.worldFactors[0].content = '{{evil}}'; }, 'opening-body-contains-unsupported-macro', 'unsupported macro rejected');
rejects(pkg => { pkg.payload.worldFactors[0].content = 'x'.repeat(16385); }, 'invalid-world-factor-content', 'oversized opening body rejected');
rejects(pkg => { pkg.payload.fullDraft = { identity: 'private' }; }, 'unknown-opening-payload-field', 'opening payload rejects private sidecars');
rejects(pkg => { pkg.payload.compatibility.channel = 'private'; }, 'unknown-opening-compatibility-field', 'opening compatibility rejects sidecars');
rejects(pkg => { pkg.payload.worldFactors[0].script = '<script>sidecar</script>'; }, 'unknown-opening-world-factor-field', 'opening factor rejects executable sidecars');

const identity = {
  packageVersion:'1.0.0', id:'identity-media-check', type:'user_identity', cardScope:'xingyue', title:'Identity',
  payload:{ identity:'student', media:{ avatar:'https://example.invalid/avatar.png' } },
};
ok(contract.normalizePackage(identity).payload.media.avatar.startsWith('https://'), 'portable identity media accepted');
assert.throws(() => contract.normalizePackage({ ...identity, payload:{ media:{ avatar:'data:image/png;base64,AAAA' } } }), error => error?.code === 'embedded-identity-image-data');
passed += 1;
console.log('[ok] embedded identity media rejected by shared contract');
assert.throws(() => contract.normalizePackage({ ...identity, payload:{ avatar:'javascript:alert(1)' } }), error => error?.code === 'invalid-identity-avatar');
passed += 1;
console.log('[ok] unsafe identity media scheme rejected by shared contract');

const legacyUserMacro = structuredClone(example);
legacyUserMacro.payload.worldFactors[0].content = 'Hello {{user}}';
const userMigrated = contract.normalizePackage(legacyUserMacro, { runtimeVersion: '3.4.0' });
ok(userMigrated.payload.worldFactors[0].content === 'Hello {{player}}', 'legacy user macro migrates to player token');

ok(oldRuntime.includes("const SUPPORTED_CARD_SCOPES = ['xingyue','shared'];"), '3.3.8 scope whitelist remains frozen');
ok(!oldRuntime.includes("'xingyue-opening-v1'"), '3.3.8 has no opening-v1 scope');
ok(currentRuntime.includes("'xingyue-opening-v1'"), '3.4 runtime declares opening-v1 scope');
ok(currentRuntime.includes('openingByScope !== openingByTarget'), '3.4 runtime has two-way scope/target gate');
assert.doesNotThrow(() => new Function(currentRuntime));
passed += 1;
console.log('[ok] 3.4 runtime parses as executable script');
assert.doesNotThrow(() => new Function(loader));
passed += 1;
console.log('[ok] 3.4 loader parses as executable script');
ok(currentRuntime.includes('refreshWorkshop: fetchWorkshopCatalog'), 'network catalog API is not shadowed by panel refresh');
ok(currentRuntime.includes('if (!sharedContract?.normalizePackage) throw new Error'), 'missing shared contract disables workshop mutations');
ok(loader.includes('shared/workshop-package-contract.js'), '3.4 loader loads shared browser contract');
ok(loader.includes('MIN_RUNTIME_REVISION = 27'), '3.4 loader requires runtime r27');
ok(currentRuntime.includes("GIT_RUNTIME_REVISION = '3.4.0-stability-r27-20260711'"), '3.4 runtime exposes r27 revision');
ok(currentRuntime.includes('/api/workshop/login-handoff') && currentRuntime.includes('beginWorkshopLogin'), 'runtime has one-time OAuth handoff fallback');
ok(currentRuntime.includes('/api/workshop/login-handoff/start') && currentRuntime.includes('workshopHandoffChallenge') && currentRuntime.includes('JSON.stringify({ handoffId, secret })'), 'runtime handoff uses private secret challenge');
ok(currentRuntime.includes("data.type !== 'xy-workshop-handoff-ready'") && !currentRuntime.includes("data.type !== 'xy-workshop-token'"), 'postMessage only wakes the matching secret claim');
ok(currentRuntime.includes('renderCharacterPackageMedia') && openingPage.includes('data-xy-package-media'), 'character package detail exposes avatar and portrait media preview');
ok(currentRuntime.includes('state.workshopAuth.loggedIn && cc.myPackages'), 'login refresh always reloads owned package catalog');
ok(currentRuntime.includes('Promise.allSettled(refreshes.map(refresh => refresh()))'), 'login refresh updates every mounted opening page');
ok(currentRuntime.includes('角色包包含仅本机可见的媒体库 key'), 'character publish blocks non-portable local media keys');
ok(currentRuntime.includes('dataset.xyDiscordAvatar'), 'Discord avatar is rendered from memory-only identity');
const openingSchema = schema.allOf.find(rule => rule?.if?.properties?.cardScope?.const === 'xingyue-opening-v1')?.then?.properties?.payload;
ok(openingSchema?.additionalProperties === false, 'schema rejects unknown opening payload fields');
ok(openingSchema?.properties?.compatibility?.additionalProperties === false, 'schema rejects unknown compatibility fields');
ok(openingSchema?.properties?.worldFactors?.items?.additionalProperties === false, 'schema rejects unknown opening factor fields');
ok(schema.allOf.some(rule => rule?.if?.properties?.payload?.properties?.target?.const === 'xingyue.opening_day_body'), 'schema has reverse opening target-to-scope gate');
ok(openingSchema?.properties?.gradeScope?.allOf?.[0]?.then?.maxItems === 1, 'schema requires all grade scope to stand alone');
ok(preview.includes('role="dialog"') && preview.includes('aria-modal="true"'), 'preview modal exposes dialog semantics');
ok(preview.includes("document.activeElement===dialog||!dialog.contains(document.activeElement)"), 'preview traps focus from dialog container');

console.log(JSON.stringify({ ok: true, passed }, null, 2));
