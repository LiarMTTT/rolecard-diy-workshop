#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayRoot = path.join(repoRoot, 'gateway');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rolecard-workshop-p2-'));
const packageStoreDir = path.join(tempRoot, 'packages');
const publicPackageDir = path.join(tempRoot, 'public-packages');
const indexFile = path.join(tempRoot, 'index.json');
const publisherFile = path.join(tempRoot, 'publishers.json');
const auditLogFile = path.join(tempRoot, 'audit-log.jsonl');
const publicSyncReportFile = path.join(tempRoot, 'public-sync-report.json');
const port = Number(args.port || (19000 + crypto.randomInt(1000)));
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = crypto.randomBytes(24).toString('base64url');
const packageId = `p2-smoke-${Date.now()}`;
const results = [];
let server = null;

try {
  server = await startGateway();
  await waitForHealth();
  await runFlow();
  printResults();
} catch (error) {
  record('fail', 'p2 flow', error.message || String(error));
  printResults();
  if (server?.stderrText) {
    console.error('[gateway stderr tail]');
    console.error(server.stderrText.split(/\r?\n/).slice(-20).join('\n'));
  }
  process.exitCode = 1;
} finally {
  if (server?.process && !server.process.killed) server.process.kill();
  if (server?.closed) await server.closed.catch(() => {});
  if (args.keepTemp) {
    console.log(`[p2] temp kept at ${tempRoot}`);
  } else {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function startGateway() {
  const child = spawn(process.execPath, [path.join(gatewayRoot, 'server.js')], {
    cwd: gatewayRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
      LOGIN_SUCCESS_REDIRECT: `${baseUrl}/workshop/admin/`,
      SESSION_COOKIE_NAME: 'rc_workshop_session',
      SESSION_SECRET: crypto.randomBytes(32).toString('base64url'),
      HASH_SECRET: crypto.randomBytes(32).toString('base64url'),
      ADMIN_TOKEN: adminToken,
      DEV_LOGIN_ENABLED: 'true',
      REQUIRE_REVIEW: 'true',
      COOKIE_SAME_SITE: 'Lax',
      CORS_ORIGIN: 'http://127.0.0.1:8000,http://localhost:8000',
      PACKAGE_STORE_DIR: packageStoreDir,
      INDEX_FILE: indexFile,
      PUBLISHER_FILE: publisherFile,
      AUDIT_LOG_FILE: auditLogFile,
      PUBLIC_PACKAGE_DIR: publicPackageDir,
      PUBLIC_SYNC_REPORT_FILE: publicSyncReportFile,
      PACKAGE_PUBLIC_BASE_URL: 'https://storage.example.invalid/workshop-json/shared',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const state = {
    process: child,
    stdoutText: '',
    stderrText: '',
    closed: new Promise(resolve => child.on('close', resolve)),
  };
  child.stdout.on('data', chunk => { state.stdoutText += chunk; });
  child.stderr.on('data', chunk => { state.stderrText += chunk; });
  child.on('error', error => { state.stderrText += String(error.message || error); });
  return state;
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/workshop/health`);
      if (res.ok) {
        record('ok', 'gateway health', `${baseUrl}/api/workshop/health`);
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`gateway did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function runFlow() {
  const blocked = await request('/api/workshop/packages', {
    method: 'POST',
    cookie: await devLoginCookie('blocked-type-probe'),
    body: basePackage({ id: `${packageId}-blocked`, type: 'opening_pack' }),
    expected: 400,
  });
  assert(String(blocked.body.error || '').includes('blocked package type'), 'blocked type rejected', blocked.body.error);

  const cookie = await devLoginCookie('owner');
  const me = await request('/api/workshop/me', { cookie, expected: 200 });
  assert(me.body.loggedIn === true && me.body.publisherId, 'owner login', 'dev ownership key accepted');

  const create = await request('/api/workshop/packages', {
    method: 'POST',
    cookie,
    body: basePackage({ id: packageId, summary: 'P2 smoke package before review.' }),
    expected: 200,
  });
  assert(create.body.reviewStatus === 'pending', 'publish creates pending package', `rev ${create.body.revision}`);
  assert(create.body.revision === 1, 'initial revision', 'revision 1');

  const pendingPublic = await request(`/api/workshop/packages/${encodeURIComponent(packageId)}`, { expected: 404 });
  assert(pendingPublic.status === 404, 'pending hidden from public detail', 'HTTP 404');
  await assertPublicIndex(false, 'pending hidden from public index');
  await assertPublicFile(false, 'pending not synced to public dir');

  const pendingList = await adminRequest('/api/admin/review/packages?status=pending');
  assert((pendingList.body.packages || []).some(pkg => pkg.id === packageId), 'admin pending list', packageId);

  const approved = await adminRequest(`/api/admin/review/packages/${encodeURIComponent(packageId)}`, {
    method: 'POST',
    body: { status: 'approved' },
  });
  assert(approved.body.reviewStatus === 'approved', 'admin approve', 'approved');
  await assertPublicIndex(true, 'approved appears in public index');

  const publicDetail = await request(`/api/workshop/packages/${encodeURIComponent(packageId)}`, { expected: 200 });
  assert(publicDetail.body.payload && !Object.hasOwn(publicDetail.body, 'ownerPublisherId'), 'public detail sanitized', 'payload present, owner hidden');
  await assertPublicFile(true, 'approved synced to public dir');

  const stale = await request(`/api/workshop/packages/${encodeURIComponent(packageId)}`, {
    method: 'PUT',
    cookie,
    headers: { 'x-package-revision': '0' },
    body: basePackage({ id: packageId, summary: 'This stale update must be rejected.' }),
    expected: 409,
  });
  assert(stale.body.error === 'package-conflict', 'stale update rejected', '409 package-conflict');

  const updated = await request(`/api/workshop/packages/${encodeURIComponent(packageId)}`, {
    method: 'PUT',
    cookie,
    headers: { 'x-package-revision': '1' },
    body: basePackage({ id: packageId, summary: 'P2 smoke package after owner update.' }),
    expected: 200,
  });
  assert(updated.body.revision === 2 && updated.body.reviewStatus === 'pending', 'owner update returns to review', `rev ${updated.body.revision}`);
  await assertPublicIndex(false, 'updated pending hidden from public index');
  await assertPublicFile(false, 'updated pending removed from public dir');

  await adminRequest(`/api/admin/review/packages/${encodeURIComponent(packageId)}`, {
    method: 'POST',
    body: { status: 'approved' },
  });
  await assertPublicIndex(true, 'reapproved update appears in public index');
  await assertPublicFile(true, 'reapproved update synced to public dir');

  const withdrawn = await request(`/api/workshop/packages/${encodeURIComponent(packageId)}`, {
    method: 'DELETE',
    cookie,
    expected: 200,
  });
  assert(withdrawn.body.ok === true, 'owner withdraw', 'ok');
  await assertPublicIndex(false, 'withdrawn removed from public index');
  await assertPublicFile(false, 'withdrawn removed from public dir');

  const mine = await request('/api/workshop/me/packages', { cookie, expected: 200 });
  assert((mine.body.packages || []).some(pkg => pkg.id === packageId && pkg.reviewStatus === 'withdrawn'), 'my packages shows withdrawn state', packageId);

  await assertPrivacyFiles();
}

async function devLoginCookie(id) {
  const res = await fetch(`${baseUrl}/auth/dev/login?id=${encodeURIComponent(id)}`, { redirect: 'manual' });
  assert(res.status === 302, `dev login ${id}`, 'HTTP 302');
  const cookie = getSetCookie(res).map(item => item.split(';')[0]).find(item => item.startsWith('rc_workshop_session='));
  if (!cookie) throw new Error('dev login did not return rc_workshop_session cookie');
  return cookie;
}

function basePackage(overrides = {}) {
  const type = overrides.type || 'user_identity';
  return {
    packageVersion: '1.0.0',
    id: overrides.id || packageId,
    type,
    cardScope: 'shared',
    title: 'P2 Workshop Smoke Package',
    summary: overrides.summary || 'Automated P2 smoke package.',
    authorName: 'ops-smoke',
    rating: 'general',
    language: 'zh-CN',
    tags: ['p2-smoke', 'ops'],
    payload: {
      installMode: 'worldbook-entry',
      worldbookEntries: [
        {
          key: '[Rolecard Workshop P2 Smoke]',
          content: 'This package verifies worldbook-entry workshop install flow and must not patch MVU variables.',
        },
      ],
    },
    ...overrides,
  };
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.cookie = options.cookie;
  let body = options.body;
  if (body !== undefined && typeof body !== 'string') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body,
    redirect: 'manual',
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch {}
  const expected = Array.isArray(options.expected) ? options.expected : [options.expected || 200];
  if (!expected.includes(res.status)) {
    throw new Error(`${pathname} returned HTTP ${res.status}: ${text}`);
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

async function adminRequest(pathname, options = {}) {
  return request(pathname, {
    ...options,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(options.headers || {}),
    },
  });
}

async function assertPublicIndex(shouldContain, name) {
  const index = await request('/api/workshop/packages');
  const found = (index.body.packages || []).some(pkg => pkg.id === packageId);
  assert(found === shouldContain, name, shouldContain ? 'found' : 'not found');
}

async function assertPublicFile(shouldExist, name) {
  const filePath = path.join(publicPackageDir, `${packageId}.json`);
  const exists = await fileExists(filePath);
  assert(exists === shouldExist, name, shouldExist ? 'file exists' : 'file absent');
  if (exists) {
    const body = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert(!Object.hasOwn(body, 'ownerPublisherId'), `${name} sanitized`, 'owner hidden');
  }
}

async function assertPrivacyFiles() {
  const publisherRegistry = JSON.parse(await fs.readFile(publisherFile, 'utf8'));
  const allowedPublisherKeys = new Set(['provider', 'discordUserHash', 'publisherId', 'createdAt', 'lastLoginAt']);
  const extraPublisherKeys = (publisherRegistry.publishers || []).flatMap(item => (
    Object.keys(item).filter(key => !allowedPublisherKeys.has(key))
  ));
  assert(extraPublisherKeys.length === 0, 'publisher privacy shape', 'only hashed ownership fields');

  const auditText = await fs.readFile(auditLogFile, 'utf8');
  const leak = auditText.match(/email|avatar|username|global_name|discriminator|rawDiscord|discordUserId/i);
  assert(!leak, 'audit privacy scan', 'no Discord profile fields');
}

function getSetCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const value = res.headers.get('set-cookie');
  return value ? [value] : [];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, name, detail) {
  if (!condition) throw new Error(`${name}: ${detail || 'assertion failed'}`);
  record('ok', name, detail || 'ok');
}

function record(level, name, detail) {
  results.push({ level, name, detail });
}

function printResults() {
  console.log('[p2] rolecard workshop publish/review/withdraw flow');
  for (const item of results) {
    const mark = item.level === 'ok' ? 'OK' : 'FAIL';
    console.log(`[${mark}] ${item.name}: ${item.detail}`);
  }
  const summary = {
    ok: results.filter(item => item.level === 'ok').length,
    failures: results.filter(item => item.level === 'fail').length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(items) {
  const out = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === '--keep-temp') out.keepTemp = true;
    else if (item === '--port') out.port = items[++index];
    else throw new Error(`Unknown argument: ${item}`);
  }
  return out;
}
