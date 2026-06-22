#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageStoreDir = env.PACKAGE_STORE_DIR || './data/packages';
const indexFile = env.INDEX_FILE || './data/index.json';
const publisherFile = env.PUBLISHER_FILE || './data/publishers.json';
const auditLogFile = env.AUDIT_LOG_FILE || './data/audit-log.jsonl';
const publicPackageDir = env.PUBLIC_PACKAGE_DIR || '';
const publicSyncReportFile = env.PUBLIC_SYNC_REPORT_FILE || './data/public-sync-report.json';
const packagePublicBaseUrl = env.PACKAGE_PUBLIC_BASE_URL || '';
const baseUrl = String(env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/+$/, '');
const results = [];

function record(level, name, detail, fix = '') {
  results.push({ level, name, detail, fix });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function countJsonFiles(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  return names.filter(name => name.endsWith('.json')).length;
}

async function checkEnv() {
  const envFile = path.join(gatewayRoot, '.env');
  if (await exists(envFile)) record('ok', 'env file', envFile);
  else record('fail', 'env file', '.env missing', 'Copy .env.production.example to .env and fill secrets.');

  for (const key of ['PUBLIC_BASE_URL', 'SESSION_SECRET', 'HASH_SECRET', 'ADMIN_TOKEN']) {
    if (env[key] && !String(env[key]).includes('replace-with') && !String(env[key]).includes('change-me')) record('ok', key, 'configured');
    else record('fail', key, 'missing or placeholder value');
  }

  if (baseUrl.startsWith('https://')) record('ok', 'PUBLIC_BASE_URL https', baseUrl);
  else record('warn', 'PUBLIC_BASE_URL https', `${baseUrl} is not HTTPS`);

  if (env.DEV_LOGIN_ENABLED === 'true') record('warn', 'DEV_LOGIN_ENABLED', 'true on this deployment', 'Set DEV_LOGIN_ENABLED=false before public use.');
  else record('ok', 'DEV_LOGIN_ENABLED', 'not true');

  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) record('ok', 'Discord OAuth', 'client id and secret configured');
  else record('warn', 'Discord OAuth', 'credentials incomplete', 'Configure Discord application credentials and callback URL.');

  if (env.DISCORD_GUILD_ID) record('ok', 'Discord guild gate', env.DISCORD_GUILD_ID);
  else record('warn', 'Discord guild gate', 'disabled', 'Set DISCORD_GUILD_ID before public publishing.');

  if (env.CORS_ORIGIN && env.CORS_ORIGIN !== '*') record('ok', 'CORS_ORIGIN', env.CORS_ORIGIN);
  else record('warn', 'CORS_ORIGIN', env.CORS_ORIGIN || '(empty)', 'Use exact SillyTavern/front-end origin for cookie login.');
}

async function checkStorage() {
  await fs.mkdir(packageStoreDir, { recursive: true });
  const packageCount = await countJsonFiles(packageStoreDir);
  record('ok', 'PACKAGE_STORE_DIR', `${path.resolve(packageStoreDir)} (${packageCount} package json files)`);

  const index = await readJson(indexFile, null);
  if (index && Array.isArray(index.packages)) record('ok', 'INDEX_FILE', `${index.packages.length} public packages`);
  else record('warn', 'INDEX_FILE', 'missing or invalid', 'Start the gateway once or run a rebuild through package save/review.');

  const publishers = await readJson(publisherFile, null);
  if (publishers && Array.isArray(publishers.publishers)) {
    const leaks = JSON.stringify(publishers).match(/email|avatar|username|global_name|discriminator|rawDiscord|discordUserId/i);
    if (leaks) record('fail', 'publisher privacy', `possible raw profile key: ${leaks[0]}`);
    else record('ok', 'publisher privacy', `${publishers.publishers.length} hashed publisher records`);
  } else {
    record('warn', 'publisher registry', 'missing or invalid');
  }

  if (await exists(auditLogFile)) {
    const text = await fs.readFile(auditLogFile, 'utf8');
    const leaks = text.match(/email|avatar|username|global_name|discriminator|rawDiscord|discordUserId/i);
    if (leaks) record('fail', 'audit privacy', `possible raw profile key: ${leaks[0]}`);
    else record('ok', 'audit privacy', `${text.split(/\r?\n/).filter(Boolean).length} audit rows`);
  } else {
    record('warn', 'audit log', 'missing; it will be created on first action');
  }
}

async function checkPublicSync() {
  if (!publicPackageDir) {
    record('warn', 'PUBLIC_PACKAGE_DIR', 'empty; Cloudreve/public-folder sync disabled', 'Map a Cloudreve public JSON folder and set PUBLIC_PACKAGE_DIR.');
    return;
  }
  try {
    await fs.mkdir(publicPackageDir, { recursive: true });
    const probe = path.join(publicPackageDir, `.takeover-${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    record('ok', 'PUBLIC_PACKAGE_DIR', `${path.resolve(publicPackageDir)} writable`);
  } catch (error) {
    record('fail', 'PUBLIC_PACKAGE_DIR', error.message);
  }

  if (packagePublicBaseUrl) {
    record('ok', 'PACKAGE_PUBLIC_BASE_URL', packagePublicBaseUrl);
  } else {
    record('warn', 'PACKAGE_PUBLIC_BASE_URL', 'empty; metadata points back to gateway');
  }

  const report = await readJson(publicSyncReportFile, null);
  if (report) record('ok', 'public sync report', `last synced ${report.syncedAt || 'unknown'}, copied ${report.copied?.length || 0}`);
  else record('warn', 'public sync report', 'missing; run npm run sync:public after approving packages');
}

async function checkHttp() {
  for (const suffix of ['/api/workshop/health', '/api/workshop/packages', '/api/workshop/me']) {
    try {
      const res = await fetch(`${baseUrl}${suffix}`);
      if (suffix === '/api/workshop/me' && res.status === 401) record('ok', suffix, 'HTTP 401 loggedIn=false');
      else if (res.ok) record('ok', suffix, `HTTP ${res.status}`);
      else record('fail', suffix, `HTTP ${res.status}`);
    } catch (error) {
      record('fail', suffix, error.message);
    }
  }
}

function printResults() {
  for (const item of results) {
    const mark = item.level === 'ok' ? 'OK' : item.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${mark}] ${item.name}: ${item.detail}`);
    if (item.fix) console.log(`      fix: ${item.fix}`);
  }
  const summary = {
    ok: results.filter(item => item.level === 'ok').length,
    warnings: results.filter(item => item.level === 'warn').length,
    failures: results.filter(item => item.level === 'fail').length,
    baseUrl,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures) process.exitCode = 1;
}

console.log('[takeover] gateway server takeover check');
console.log(`[takeover] gateway root: ${gatewayRoot}`);
await checkEnv();
await checkStorage();
await checkPublicSync();
await checkHttp();
printResults();
