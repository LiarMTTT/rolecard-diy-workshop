import fs from 'node:fs/promises';
import path from 'node:path';

const env = process.env;
const baseUrl = String(env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/+$/, '');
const adminToken = env.ADMIN_TOKEN || '';
const packageStoreDir = env.PACKAGE_STORE_DIR || './data/packages';
const publicPackageDir = env.PUBLIC_PACKAGE_DIR || '';
const characterUploadDir = env.CHARACTER_UPLOAD_DIR || path.join(path.dirname(packageStoreDir), 'character-uploads');
const characterAssetStoreDir = env.CHARACTER_ASSET_STORE_DIR || path.join(path.dirname(packageStoreDir), 'character-assets');
const publicAssetDir = env.PUBLIC_ASSET_DIR || (publicPackageDir ? path.join(publicPackageDir, 'assets') : './data/public/assets');
const corsOrigin = env.CORS_ORIGIN || '*';

const results = [];

function record(level, name, detail) {
  results.push({ level, name, detail });
}

async function checkUrl(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch {}
  return { res, body, text };
}

async function checkHealth() {
  try {
    const { res, body } = await checkUrl('/api/workshop/health');
    if (res.ok && body.ok) record('ok', 'health', `${baseUrl}/api/workshop/health responded ok`);
    else record('fail', 'health', `unexpected health response: ${res.status}`);
  } catch (error) {
    record('fail', 'health', `cannot reach ${baseUrl}/api/workshop/health: ${error.message}`);
  }
}

async function checkAdmin() {
  if (!adminToken) {
    record('fail', 'admin token', 'ADMIN_TOKEN is empty');
    return;
  }
  try {
    const { res } = await checkUrl('/api/admin/review/packages?status=pending', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (res.ok) record('ok', 'admin api', 'admin review API accepts ADMIN_TOKEN');
    else record('fail', 'admin api', `admin review API returned ${res.status}`);
  } catch (error) {
    record('fail', 'admin api', error.message);
  }
}

async function checkStorage() {
  try {
    await fs.mkdir(packageStoreDir, { recursive: true });
    await fs.access(packageStoreDir);
    record('ok', 'package store', `PACKAGE_STORE_DIR accessible: ${path.resolve(packageStoreDir)}`);
  } catch (error) {
    record('fail', 'package store', error.message);
  }
  for (const [name, dir] of [['character upload dir', characterUploadDir], ['character asset store', characterAssetStoreDir], ['public asset dir', publicAssetDir]]) {
    try {
      await fs.mkdir(dir, { recursive:true });
      const testFile = path.join(dir, `.self-check-${Date.now()}.tmp`);
      await fs.writeFile(testFile, 'ok');
      await fs.unlink(testFile);
      record('ok', name, `${name} is writable: ${path.resolve(dir)}`);
    } catch (error) {
      record('fail', name, error.message);
    }
  }
  if (!publicPackageDir) {
    record('warn', 'public package dir', 'PUBLIC_PACKAGE_DIR is empty; Cloudreve sync will be skipped');
    return;
  }
  try {
    await fs.mkdir(publicPackageDir, { recursive: true });
    const testFile = path.join(publicPackageDir, `.self-check-${Date.now()}.tmp`);
    await fs.writeFile(testFile, 'ok');
    await fs.unlink(testFile);
    record('ok', 'public package dir', `PUBLIC_PACKAGE_DIR is writable: ${path.resolve(publicPackageDir)}`);
  } catch (error) {
    record('fail', 'public package dir', error.message);
  }
}

function checkConfig() {
  if (env.DEV_LOGIN_ENABLED === 'true') {
    record('warn', 'dev login', 'DEV_LOGIN_ENABLED=true; keep this false on public deployments');
  } else {
    record('ok', 'dev login', 'DEV_LOGIN_ENABLED is not true');
  }
  if (baseUrl.startsWith('https://')) {
    record('ok', 'public base url', `PUBLIC_BASE_URL uses HTTPS: ${baseUrl}`);
  } else {
    record('warn', 'public base url', `PUBLIC_BASE_URL is not HTTPS: ${baseUrl}`);
  }
  if (corsOrigin === '*') {
    record('warn', 'cors', 'CORS_ORIGIN=*; set exact origins when cookie login is public');
  } else {
    record('ok', 'cors', `CORS_ORIGIN=${corsOrigin}`);
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    record('warn', 'discord oauth', 'Discord OAuth credentials are incomplete');
  } else {
    record('ok', 'discord oauth', 'Discord OAuth credentials are present');
  }
  if (!env.DISCORD_GUILD_ID) {
    record('warn', 'discord guild', 'DISCORD_GUILD_ID is empty; guild membership gate is disabled');
  } else {
    record('ok', 'discord guild', 'Discord guild membership gate is configured');
  }
  if (!env.PACKAGE_PUBLIC_BASE_URL) {
    record('warn', 'package public url', 'PACKAGE_PUBLIC_BASE_URL is empty; public metadata will point back to the gateway');
  } else {
    record('ok', 'package public url', `PACKAGE_PUBLIC_BASE_URL=${env.PACKAGE_PUBLIC_BASE_URL}`);
  }
}

checkConfig();
await checkStorage();
await checkHealth();
await checkAdmin();

for (const result of results) {
  const mark = result.level === 'ok' ? 'OK' : result.level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${mark}] ${result.name}: ${result.detail}`);
}

const failed = results.filter(item => item.level === 'fail');
const warned = results.filter(item => item.level === 'warn');
console.log(JSON.stringify({
  ok: failed.length === 0,
  failures: failed.length,
  warnings: warned.length,
}, null, 2));

if (failed.length) process.exit(1);
