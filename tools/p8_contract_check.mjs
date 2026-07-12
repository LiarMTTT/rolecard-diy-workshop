#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import contract from '../shared/workshop-package-contract.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(repoRoot, '..');
async function readOptional(filePath) {
  try { return await fs.readFile(filePath, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}
const example = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples', 'xingyue-opening-v1.example.json'), 'utf8'));
const oldRuntime = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.3.8', 'control-center.js'), 'utf8');
const currentRuntime = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.4.0', 'control-center.js'), 'utf8');
const runtime341 = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.4.1', 'control-center.js'), 'utf8');
const loader = await readOptional(path.join(workspaceRoot, '星月', '星月 3.4.0', 'components', 'control_center.js'));
const preview = await readOptional(path.join(workspaceRoot, '星月', '星月 3.4.0', 'components', '_preview.html'));
const openingPage = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.4.0', 'opening-page.html'), 'utf8');
const openingPage341 = await fs.readFile(path.join(repoRoot, 'runtime', 'xingyue', '3.4.1', 'opening-page.html'), 'utf8');
const gatewayServer = await fs.readFile(path.join(repoRoot, 'gateway', 'server.js'), 'utf8');
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

const character = {
  packageVersion:'1.0.0', id:'character-contract-check', type:'character', cardScope:'xingyue', title:'Character',
  payload:{
    name:'Character', profile:{ 身份:'student' }, appearance:{ 描述:'appearance' }, personality:'steady', dialogueStyle:'brief',
    behavior:{ 行事风格:'observe first', 行为应对:'keep distance' },
    relationships:[{ target:'{{user}}', type:'classmate', note:'new acquaintance' }],
    media:{ avatar:'https://example.invalid/avatar.png', portraits:{ normal:'https://example.invalid/normal.png' } },
  },
};
ok(contract.normalizePackage(character, { portableMediaOnly:true }).payload.media.portraits.normal.startsWith('https://'), 'canonical portable character contract accepted');
const legacyCharacter = { ...character, payload:{ name:'Legacy', role:'senior', relationship:'guide', mediaRefs:{ normal:'media://legacy/normal' } } };
const migratedCharacter = contract.normalizePackage(legacyCharacter);
ok(migratedCharacter.payload.profile['身份'] === 'senior' && migratedCharacter.payload.media.portraits.normal === 'media://legacy/normal', 'legacy character aliases migrate on client read');
assert.throws(() => contract.normalizePackage(legacyCharacter, { allowLegacyCharacterAliases:false }), error => error?.code === 'unknown-character-field');
passed += 1;
console.log('[ok] Gateway character shape rejects legacy aliases');
assert.throws(() => contract.normalizePackage({ ...character, payload:{ ...character.payload, media:{ avatar:'media://local/avatar' } } }, { portableMediaOnly:true }), error => error?.code === 'invalid-character-avatar');
passed += 1;
console.log('[ok] Gateway character shape rejects non-portable media keys');
assert.throws(() => contract.normalizePackage({ ...character, payload:{ ...character.payload, script:'sidecar' } }), error => error?.code === 'unknown-character-field');
passed += 1;
console.log('[ok] character payload rejects unknown sidecars');

const ordinaryWorldFactor = {
  packageVersion:'1.0.0', id:'ordinary-factor-check', type:'world_factor', cardScope:'shared', title:'Factor',
  payload:{ worldFactors:[{ title:'Factor', content:'Safe content.' }] },
};
ok(contract.normalizePackage(ordinaryWorldFactor).payload.worldFactors.length === 1, 'ordinary world factor canonical shape accepted');
assert.throws(() => contract.normalizePackage({ ...ordinaryWorldFactor, payload:{ worldFactors:[{ title:'Factor', content:'Safe', script:'sidecar' }] } }), error => error?.code === 'unknown-world-factor-field');
passed += 1;
console.log('[ok] ordinary world factor rejects item sidecars');
assert.throws(() => contract.normalizePackage({ ...ordinaryWorldFactor, payload:{ ...ordinaryWorldFactor.payload, rogue:'sidecar' } }), error => error?.code === 'unknown-world-factor-payload-field');
passed += 1;
console.log('[ok] ordinary world factor rejects payload root sidecars');
assert.throws(() => contract.normalizePackage({ ...ordinaryWorldFactor, payload:{ ...ordinaryWorldFactor.payload, factors:ordinaryWorldFactor.payload.worldFactors } }, { allowLegacyFactors:false }), error => error?.code === 'legacy-world-factors-not-publishable');
passed += 1;
console.log('[ok] Gateway ordinary world factor rejects dual canonical and legacy roots');

const extension = {
  packageVersion:'1.0.0', id:'extension-contract-check', type:'skill', cardScope:'xingyue', title:'Extension',
  payload:{ schemaVersion:1, worldbook:{ title:'Extension', content:'Narrative worldbook setting.' } },
};
ok(contract.normalizePackage(extension, { allowLegacyExtensions:false }).payload.schemaVersion === 1, 'canonical generic extension contract accepted');
const migratedExtension = contract.normalizePackage({ ...extension, payload:{ level:1, effect:'legacy' } });
ok(migratedExtension.payload.schemaVersion === 1 && migratedExtension.payload.worldbook.content.includes('legacy'), 'legacy extension migrates on client read');
assert.throws(() => contract.normalizePackage({ ...extension, payload:{ level:1 } }, { allowLegacyExtensions:false }), error => error?.code === 'extension-worldbook-contract-required');
passed += 1;
console.log('[ok] Gateway extension shape requires generic worldbook contract');

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
ok(currentRuntime.includes('refreshWorkshop: fetchWorkshopCatalog'), 'network catalog API is not shadowed by panel refresh');
ok(currentRuntime.includes('if (!sharedContract?.normalizePackage) throw new Error'), 'missing shared contract disables workshop mutations');
if (loader) {
  assert.doesNotThrow(() => new Function(loader));
  passed += 1;
  console.log('[ok] 3.4 loader parses as executable script');
  ok(loader.includes('shared/workshop-package-contract.js'), '3.4 loader loads shared browser contract');
  ok(loader.includes('MIN_RUNTIME_REVISION = 27'), '3.4 loader requires runtime r27');
  ok(loader.includes('@90facdc030ffb59902506f1f8737685487f52496/runtime/xingyue/3.4.0/control-center.js'), '3.4 loader pins verified r27 release commit');
} else {
  console.log('[skip] external Xingyue card loader is outside standalone workshop checkout');
}
ok(currentRuntime.includes("GIT_RUNTIME_REVISION = '3.4.0-stability-r27-20260711'"), '3.4 runtime exposes r27 revision');
ok(currentRuntime.includes('/api/workshop/login-handoff') && currentRuntime.includes('beginWorkshopLogin'), 'runtime has one-time OAuth handoff fallback');
ok(currentRuntime.includes('/api/workshop/login-handoff/start') && currentRuntime.includes('workshopHandoffChallenge') && currentRuntime.includes('JSON.stringify({ handoffId, secret })'), 'runtime handoff uses private secret challenge');
ok(currentRuntime.includes("data.type !== 'xy-workshop-handoff-ready'") && !currentRuntime.includes("data.type !== 'xy-workshop-token'"), 'postMessage only wakes the matching secret claim');
ok(currentRuntime.includes('renderCharacterPackageMedia') && openingPage.includes('data-xy-package-media'), 'character package detail exposes avatar and portrait media preview');
ok(currentRuntime.includes('state.workshopAuth.loggedIn && cc.myPackages'), 'login refresh always reloads owned package catalog');
ok(currentRuntime.includes('Promise.allSettled(refreshes.map(refresh => refresh()))'), 'login refresh updates every mounted opening page');
ok(currentRuntime.includes('角色包包含仅本机可见的媒体库 key'), 'character publish blocks non-portable local media keys');
ok(currentRuntime.includes('dataset.xyDiscordAvatar'), 'Discord avatar is rendered from memory-only identity');
ok(runtime341.includes('deadlineAt') && runtime341.includes('expiresInMs') && runtime341.includes('cancelWorkshopLogin'), '3.4.1 OAuth consumes server deadline and exposes cancel');
ok(runtime341.includes('publishSelection') && runtime341.includes('state.publishSelection = clone(pkg)'), '3.4.1 publish object is explicit for owner updates and opening drafts');
ok(runtime341.includes('refreshPackageInspections') && openingPage341.includes('data-xy-package-inspection'), '3.4.1 exposes installed revision and dirty inspection status');
ok(openingPage341.includes('data-xy-login-cancel') && openingPage341.includes('data-xy-workshop-error'), '3.4.1 workshop has cancel and persistent error feedback');
ok(!runtime341.includes('WORKSHOP_SAMPLE_PACKAGES') && !runtime341.includes('show-sample-package') && !runtime341.includes('本地示例'), '3.4.1 workshop no longer injects local sample packages');
ok(!openingPage341.includes('本地示例'), '3.4.1 opening page no longer advertises removed local samples');
ok(runtime341.includes('data-xy-opening-action="login-discord" data-xy-login-button')
  && runtime341.includes('grid.innerHTML = renderEmptyWorkshopState(source.length);\n      updateWorkshopStatusPills();')
  && openingPage341.includes('data-xy-opening-action="login-discord" data-xy-login-button'), '3.4.1 workshop login controls share and immediately refresh the unified three-state selector');
const hudTopAnchorBlock341 = runtime341.slice(runtime341.indexOf('function measureTopChromeBottom()'), runtime341.indexOf('function ensureStatusDrawerStyle'));
ok(hudTopAnchorBlock341.includes("['#top-settings-holder', '#top-settings', '#navbar', '#sheld_header']")
  && !hudTopAnchorBlock341.includes("'#top-bar'")
  && !hudTopAnchorBlock341.includes('doc.body?.children'), '3.4.1 HUD top drawer anchors only to explicit top chrome');
ok(runtime341.includes('--xy-hud-drawer-y:0px;--xy-hud-drawer-max:100dvh')
  && runtime341.includes("drawer.style.setProperty('--xy-hud-drawer-y', anchor + 'px')")
  && !runtime341.includes('--xy-hud-drawer-bottom'), '3.4.1 HUD top and bottom placements share visual-viewport top coordinates');
ok(runtime341.includes("const selectors = ['#form_sheld', '#send_form', '#send_textarea', '.send_form']")
  && runtime341.includes('const observer = new RO(onChange)')
  && runtime341.includes("observer.observe(node)"), '3.4.1 HUD follows canonical input anchors with ResizeObserver');
ok(openingPage341.includes('data-xy-opening-action="toggle-focus-mode"')
  && runtime341.includes("dialog.setAttribute('data-xy-opening-focus-dialog', '')")
  && runtime341.includes('dialog.showModal()')
  && runtime341.includes('exitOpeningFocusMode({ restoreFocus:false })'), '3.4.1 opening page focus mode uses a reversible top-layer portal');
ok(openingPage341.includes('.xy-opening-page[data-xy-focus-mode="1"] .xy-view[data-xy-view="wizard"] .xy-pane')
  && openingPage341.includes('overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain')
  && openingPage341.includes('.xy-opening-page[data-xy-focus-mode="1"][data-xy-opening-view="workshop"]{overflow:hidden!important}')
  && openingPage341.includes('.xy-opening-page[data-xy-focus-mode="1"]{')
  && openingPage341.includes('data-xy-opening-story-editor'), '3.4.1 focus mode keeps the collapsed story editor reachable under one root scroll owner');
ok(runtime341.includes('parent.__xyOpeningPortalRoot = root')
  && runtime341.includes('portaledPage?.isConnected')
  && runtime341.includes('delete mount.__xyOpeningPortalRoot'), '3.4.1 remote scanner recognizes a focus-portaled opening page and cannot inject a duplicate');
ok(openingPage341.includes('.xy-opening-page .xy-view[data-xy-view="workshop"]{position:absolute!important')
  && !openingPage341.includes('.xy-opening-page .xy-view[data-xy-view="workshop"]{position:fixed!important')
  && runtime341.includes("if (nextView === 'workshop' && !openingFocusActive()) state.workshopFocusOwned = enterOpeningFocusMode()")
  && runtime341.includes('if (leavingOwnedWorkshop) { state.workshopFocusOwned = false; exitOpeningFocusMode(); }'), '3.4.1 workshop overlay uses the stable focus portal and restores its original message position');
ok(runtime341.includes("'/api/workshop/uploads/character'")
  && runtime341.includes('async function uploadCharacterPackage(input)')
  && runtime341.includes('resolveCharacterUploadMedia')
  && !runtime341.includes('角色包包含仅本机可见的媒体库 key；发布前请把头像与立绘替换为 http(s) URL'), '3.4.1 character publish uploads local media instead of rejecting it');
ok(runtime341.includes("{ kind:'portrait-nude', label:'赤裸立绘'")
  && runtime341.includes('pkg.previewMedia?.avatar')
  && openingPage341.includes('xy-package-preview-avatar'), '3.4.1 workshop exposes character avatar and both portrait previews');
ok(gatewayServer.includes('createCharacterUpload(input, publisherId)')
  && gatewayServer.includes('character-upload-owner-mismatch')
  && gatewayServer.includes('invalid-character-image-magic')
  && gatewayServer.includes('syncApprovedCharacterAssets()'), 'Gateway owns staged character uploads, validation, promotion and public cleanup');
ok(gatewayServer.includes("storage: { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) }")
  && !gatewayServer.includes("provider: String(pkg.storage.provider"), 'Gateway generates package storage metadata instead of trusting client storage');
const strippedPackage = structuredClone(example);
strippedPackage.storage = { provider:'client', url:'https://evil.invalid/package.json' };
strippedPackage.rogue = true;
const strippedNormalized = contract.normalizePackage(strippedPackage, { runtimeVersion:'3.4.0' });
ok(!Object.hasOwn(strippedNormalized, 'storage') && !Object.hasOwn(strippedNormalized, 'rogue'), 'shared contract strips unknown top-level sidecars');
ok(schema.additionalProperties === false, 'schema rejects unknown top-level package fields');
const openingSchema = schema.allOf.find(rule => rule?.if?.properties?.cardScope?.const === 'xingyue-opening-v1')?.then?.properties?.payload;
ok(openingSchema?.additionalProperties === false, 'schema rejects unknown opening payload fields');
ok(openingSchema?.properties?.compatibility?.additionalProperties === false, 'schema rejects unknown compatibility fields');
ok(openingSchema?.properties?.worldFactors?.items?.additionalProperties === false, 'schema rejects unknown opening factor fields');
ok(schema.allOf.some(rule => rule?.if?.properties?.payload?.properties?.target?.const === 'xingyue.opening_day_body'), 'schema has reverse opening target-to-scope gate');
ok(openingSchema?.properties?.gradeScope?.allOf?.[0]?.then?.maxItems === 1, 'schema requires all grade scope to stand alone');
if (preview) {
  ok(preview.includes('role="dialog"') && preview.includes('aria-modal="true"'), 'preview modal exposes dialog semantics');
  ok(preview.includes("document.activeElement===dialog||!dialog.contains(document.activeElement)"), 'preview traps focus from dialog container');
} else {
  console.log('[skip] external Xingyue card preview is outside standalone workshop checkout');
}

console.log(JSON.stringify({ ok: true, passed }, null, 2));
