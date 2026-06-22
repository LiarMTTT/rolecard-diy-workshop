import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const env = process.env;
const GATEWAY_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(env.PORT || 8787);
const PUBLIC_BASE_URL = env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const COOKIE_SECURE = PUBLIC_BASE_URL.startsWith('https://');
const COOKIE_SAME_SITE = env.COOKIE_SAME_SITE || (COOKIE_SECURE ? 'None' : 'Lax');
const LOGIN_SUCCESS_REDIRECT = env.LOGIN_SUCCESS_REDIRECT || '/';
const SESSION_SECRET = env.SESSION_SECRET || 'dev-session-secret';
const HASH_SECRET = env.HASH_SECRET || 'dev-hash-secret';
const ADMIN_TOKEN = env.ADMIN_TOKEN || '';
const DEV_LOGIN_ENABLED = env.DEV_LOGIN_ENABLED === 'true';
const PACKAGE_STORE_DIR = env.PACKAGE_STORE_DIR || './data/packages';
const INDEX_FILE = env.INDEX_FILE || './data/index.json';
const PUBLISHER_FILE = env.PUBLISHER_FILE || './data/publishers.json';
const AUDIT_LOG_FILE = env.AUDIT_LOG_FILE || './data/audit-log.jsonl';
const REQUIRE_REVIEW = env.REQUIRE_REVIEW !== 'false';
const PACKAGE_PUBLIC_BASE_URL = String(env.PACKAGE_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const CORS_ORIGIN = env.CORS_ORIGIN || '*';
const SUPPORTED_TYPES = new Set(['character', 'user_identity', 'world_factor', 'shop_item', 'blueprint', 'recipe', 'skill', 'function']);
const BLOCKED_TYPES = new Set(['opening_pack', 'prompt_patch', 'ui_theme']);
const REVIEW_STATES = new Set(['pending', 'approved', 'rejected', 'withdrawn']);
const ADMIN_PAGE_FILE = path.join(GATEWAY_ROOT, 'public', 'admin.html');
const sessions = new Map();

function corsHeaders(req, headers = {}) {
  const requestOrigin = String(req?.headers?.origin || '');
  const configured = String(CORS_ORIGIN || '*').split(',').map(item => item.trim()).filter(Boolean);
  let allowOrigin = configured[0] || '*';
  if (configured.includes('*')) allowOrigin = requestOrigin || '*';
  else if (requestOrigin && configured.includes(requestOrigin)) allowOrigin = requestOrigin;
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,if-match,x-package-revision',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    vary: 'Origin',
    ...headers,
  };
}

function json(req, res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(req, headers),
  });
  res.end(text);
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

async function file(res, status, filePath, contentType) {
  const body = await fs.readFile(filePath);
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function statusForError(message) {
  if (message === 'request-too-large') return 413;
  if (message === 'package-conflict') return 409;
  if (message === 'admin-required') return 403;
  if (message === 'admin-token-not-configured') return 503;
  if (message === 'not-package-owner') return 403;
  if (message === 'discord guild membership required') return 403;
  if (message.includes('invalid revision')) return 400;
  if (message.includes('invalid package') || message.includes('unsupported package') || message.includes('blocked package')) return 400;
  if (message.includes('ENOENT')) return 404;
  return 500;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
}

function hashDiscordUserId(id) {
  return crypto.createHmac('sha256', HASH_SECRET).update(String(id)).digest('hex');
}

function signSession(sessionId) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('base64url');
  return `${sessionId}.${sig}`;
}

function verifySessionCookie(value) {
  const [sessionId, sig] = String(value || '').split('.');
  if (!sessionId || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('base64url');
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return sessions.get(sessionId) || null;
}

function sessionFromRequest(req) {
  return verifySessionCookie(parseCookies(req).xy_workshop_session);
}

function requireAdmin(req) {
  if (!ADMIN_TOKEN) throw new Error('admin-token-not-configured');
  const value = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (value !== ADMIN_TOKEN) throw new Error('admin-required');
  return true;
}

async function readBody(req, maxBytes = 512 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('request-too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validatePackage(input) {
  const pkg = input && typeof input === 'object' ? input : {};
  const type = String(pkg.type || '').trim();
  if (BLOCKED_TYPES.has(type)) throw new Error(`blocked package type: ${type}`);
  if (!SUPPORTED_TYPES.has(type)) throw new Error(`unsupported package type: ${type || 'empty'}`);
  const id = String(pkg.id || '').trim();
  const title = String(pkg.title || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(id)) throw new Error('invalid package id');
  if (!title || title.length > 120) throw new Error('invalid package title');
  return {
    packageVersion: String(pkg.packageVersion || pkg.version || '1.0.0'),
    id,
    type,
    cardScope: String(pkg.cardScope || 'xingyue').slice(0, 80),
    title,
    summary: String(pkg.summary || '').slice(0, 600),
    authorName: String(pkg.authorName || 'anonymous').slice(0, 80),
    rating: ['general', 'mature', 'restricted'].includes(pkg.rating) ? pkg.rating : 'general',
    language: String(pkg.language || 'zh-CN').slice(0, 20),
    tags: Array.isArray(pkg.tags) ? pkg.tags.map(tag => String(tag).slice(0, 40)).slice(0, 12) : [],
    createdAt: pkg.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewStatus: REVIEW_STATES.has(pkg.reviewStatus) ? pkg.reviewStatus : (REQUIRE_REVIEW ? 'pending' : 'approved'),
    rejectionReason: '',
    withdrawnAt: '',
    storage: pkg.storage && typeof pkg.storage === 'object'
      ? {
          provider: String(pkg.storage.provider || 'local').slice(0, 40),
          url: String(pkg.storage.url || '').slice(0, 600),
        }
      : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'local', url: '' },
    payload: pkg.payload && typeof pkg.payload === 'object' ? pkg.payload : {},
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function packageContentHash(pkg) {
  const content = {
    packageVersion: pkg.packageVersion,
    id: pkg.id,
    type: pkg.type,
    cardScope: pkg.cardScope,
    title: pkg.title,
    summary: pkg.summary,
    authorName: pkg.authorName,
    rating: pkg.rating,
    language: pkg.language,
    tags: pkg.tags,
    storage: pkg.storage,
    payload: pkg.payload,
  };
  return crypto.createHash('sha256').update(stableStringify(content)).digest('hex');
}

function normalizeRevision(value) {
  if (value === undefined || value === null || value === '') return null;
  const textValue = String(value).trim();
  const match = textValue.match(/\d+/);
  if (!match) throw new Error('invalid revision');
  const revision = Number(match[0]);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid revision');
  return revision;
}

function expectedRevisionFromRequest(req, input) {
  return normalizeRevision(req.headers['x-package-revision'] || req.headers['if-match'] || input?.expectedRevision || input?.revision);
}

function assertRevisionMatch(existing, expectedRevision) {
  if (expectedRevision === null) return;
  const currentRevision = Number(existing?.revision || 0);
  if (currentRevision !== expectedRevision) throw new Error('package-conflict');
}

function assertPackageId(id) {
  const text = String(id || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(text)) throw new Error('invalid package id');
  return text;
}

function publicBaseFromRequest(req) {
  const configured = PUBLIC_BASE_URL.replace(/\/+$/, '');
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!host) return configured;
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (configured.startsWith('https://') ? 'https' : 'http');
  return `${proto}://${host}`;
}

function packageFilePath(id) {
  return path.join(PACKAGE_STORE_DIR, `${assertPackageId(id)}.json`);
}

function packagePublicUrl(id) {
  if (!PACKAGE_PUBLIC_BASE_URL) return '';
  return `${PACKAGE_PUBLIC_BASE_URL}/${encodeURIComponent(assertPackageId(id))}.json`;
}

async function ensureStore() {
  await fs.mkdir(PACKAGE_STORE_DIR, { recursive: true });
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await fs.mkdir(path.dirname(PUBLISHER_FILE), { recursive: true });
  await fs.mkdir(path.dirname(AUDIT_LOG_FILE), { recursive: true });
  try {
    await fs.access(INDEX_FILE);
  } catch {
    await fs.writeFile(INDEX_FILE, JSON.stringify({ version: '1.0.0', updatedAt: new Date().toISOString(), packages: [] }, null, 2));
  }
  try {
    await fs.access(PUBLISHER_FILE);
  } catch {
    await fs.writeFile(PUBLISHER_FILE, JSON.stringify({ version: '1.0.0', updatedAt: new Date().toISOString(), publishers: [] }, null, 2));
  }
}

async function appendAuditLog(event) {
  await ensureStore();
  const safe = {
    at: new Date().toISOString(),
    action: String(event.action || ''),
    packageId: event.packageId ? assertPackageId(event.packageId) : '',
    publisherId: String(event.publisherId || ''),
    reviewStatus: event.reviewStatus ? String(event.reviewStatus) : undefined,
    reason: event.reason ? String(event.reason).slice(0, 600) : undefined,
  };
  await fs.appendFile(AUDIT_LOG_FILE, `${JSON.stringify(safe)}\n`, 'utf8');
}

async function readIndex() {
  await ensureStore();
  return JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
}

async function writeIndex(index) {
  index.updatedAt = new Date().toISOString();
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

async function readPublishers() {
  await ensureStore();
  const registry = JSON.parse(await fs.readFile(PUBLISHER_FILE, 'utf8'));
  registry.publishers = Array.isArray(registry.publishers) ? registry.publishers : [];
  return registry;
}

async function writePublishers(registry) {
  registry.updatedAt = new Date().toISOString();
  await fs.writeFile(PUBLISHER_FILE, JSON.stringify(registry, null, 2));
}

async function getOrCreatePublisher(discordUserHash) {
  const registry = await readPublishers();
  const now = new Date().toISOString();
  let publisher = registry.publishers.find(item => item?.provider === 'discord' && item?.discordUserHash === discordUserHash);
  if (!publisher) {
    publisher = {
      provider: 'discord',
      discordUserHash,
      publisherId: randomId('pub'),
      createdAt: now,
      lastLoginAt: now,
    };
    registry.publishers.push(publisher);
  } else {
    publisher.lastLoginAt = now;
  }
  await writePublishers(registry);
  return { ...publisher };
}

function publicPackageMeta(pkg, baseUrl = PUBLIC_BASE_URL) {
  const { payload, ownerPublisherId, ...meta } = pkg;
  return {
    ...meta,
    manifestUrl: `${baseUrl.replace(/\/+$/, '')}/api/workshop/packages/${encodeURIComponent(pkg.id)}`,
    storage: pkg.storage?.url ? pkg.storage : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
  };
}

function publicPackageDetail(pkg, baseUrl = PUBLIC_BASE_URL) {
  const { ownerPublisherId, ...publicPkg } = pkg;
  return {
    ...publicPkg,
    manifestUrl: `${baseUrl.replace(/\/+$/, '')}/api/workshop/packages/${encodeURIComponent(pkg.id)}`,
    storage: pkg.storage?.url ? pkg.storage : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
  };
}

function adminPackageMeta(pkg, baseUrl = PUBLIC_BASE_URL) {
  const { ownerPublisherId, ...meta } = pkg;
  return {
    ...meta,
    manifestUrl: `${baseUrl.replace(/\/+$/, '')}/api/workshop/packages/${encodeURIComponent(pkg.id)}`,
    storage: pkg.storage?.url ? pkg.storage : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
  };
}

function ownerPackageMeta(pkg, baseUrl = PUBLIC_BASE_URL) {
  const meta = publicPackageMeta(pkg, baseUrl);
  return {
    ...meta,
    ownerPublisherId: undefined,
    reviewStatus: pkg.reviewStatus || 'pending',
    rejectionReason: pkg.rejectionReason || '',
    withdrawnAt: pkg.withdrawnAt || '',
  };
}

function isPublicPackage(pkg) {
  return (pkg.reviewStatus || 'pending') === 'approved' && !pkg.withdrawnAt;
}

function applyPackageFilters(packages, searchParams) {
  const type = String(searchParams.get('type') || '').trim();
  const cardScope = String(searchParams.get('cardScope') || '').trim();
  const rating = String(searchParams.get('rating') || '').trim();
  const language = String(searchParams.get('language') || '').trim();
  const tag = String(searchParams.get('tag') || '').trim().toLowerCase();
  const q = String(searchParams.get('q') || '').trim().toLowerCase();
  return packages.filter(pkg => {
    if (type && pkg.type !== type) return false;
    if (cardScope && pkg.cardScope !== cardScope) return false;
    if (rating && pkg.rating !== rating) return false;
    if (language && pkg.language !== language) return false;
    const tags = Array.isArray(pkg.tags) ? pkg.tags.map(item => String(item).toLowerCase()) : [];
    if (tag && !tags.includes(tag)) return false;
    if (q) {
      const haystack = [
        pkg.id,
        pkg.title,
        pkg.summary,
        pkg.authorName,
        pkg.type,
        pkg.cardScope,
        ...tags,
      ].join('\n').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

async function allStoredPackages() {
  await ensureStore();
  const names = await fs.readdir(PACKAGE_STORE_DIR).catch(() => []);
  const packages = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      packages.push(JSON.parse(await fs.readFile(path.join(PACKAGE_STORE_DIR, name), 'utf8')));
    } catch {}
  }
  return packages;
}

async function rebuildPublicIndex(baseUrl = PUBLIC_BASE_URL) {
  const packages = await allStoredPackages();
  const index = await readIndex();
  index.version = index.version || '1.0.0';
  index.packages = packages
    .filter(pkg => (pkg.reviewStatus || 'pending') === 'approved' && !pkg.withdrawnAt)
    .map(pkg => publicPackageMeta(pkg, baseUrl))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  await writeIndex(index);
  return index;
}

async function getPackage(id) {
  const file = packageFilePath(id);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function reviewStatusForSave(existing, pkg, contentChanged) {
  if (!existing) return pkg.reviewStatus;
  if ((existing.reviewStatus || 'pending') === 'withdrawn') return REQUIRE_REVIEW ? 'pending' : 'approved';
  if (contentChanged && REQUIRE_REVIEW) return 'pending';
  if (contentChanged && !REQUIRE_REVIEW) return 'approved';
  return existing.reviewStatus || pkg.reviewStatus;
}

async function savePackage(pkg, publisherId, options = {}) {
  await ensureStore();
  const file = packageFilePath(pkg.id);
  let existing = null;
  try { existing = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  assertRevisionMatch(existing, options.expectedRevision ?? null);
  if (existing && existing.ownerPublisherId !== publisherId) throw new Error('not-package-owner');
  const contentHash = packageContentHash(pkg);
  const previousRevision = Number(existing?.revision || 0);
  const contentChanged = !existing || existing.contentHash !== contentHash;
  const stored = {
    ...pkg,
    createdAt: existing?.createdAt || pkg.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: existing ? (contentChanged ? previousRevision + 1 : previousRevision) : 1,
    contentHash,
    reviewStatus: reviewStatusForSave(existing, pkg, contentChanged),
    rejectionReason: contentChanged ? '' : (existing?.rejectionReason || ''),
    withdrawnAt: '',
    storage: pkg.storage?.url
      ? pkg.storage
      : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
    ownerPublisherId: publisherId,
  };
  await fs.writeFile(file, JSON.stringify(stored, null, 2));
  await appendAuditLog({
    action: existing ? 'package.updated' : 'package.created',
    packageId: stored.id,
    publisherId,
    reviewStatus: stored.reviewStatus,
  });
  await rebuildPublicIndex(options.baseUrl);
  return ownerPackageMeta(stored, options.baseUrl);
}

async function deletePackage(id, publisherId, options = {}) {
  const existing = await getPackage(id);
  if (existing.ownerPublisherId !== publisherId) throw new Error('not-package-owner');
  const withdrawn = {
    ...existing,
    reviewStatus: 'withdrawn',
    withdrawnAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(packageFilePath(id), JSON.stringify(withdrawn, null, 2));
  await appendAuditLog({ action: 'package.withdrawn', packageId: id, publisherId, reviewStatus: 'withdrawn' });
  await rebuildPublicIndex(options.baseUrl);
}

async function listPackagesForPublisher(publisherId, baseUrl = PUBLIC_BASE_URL) {
  await ensureStore();
  const names = await fs.readdir(PACKAGE_STORE_DIR).catch(() => []);
  const packages = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(PACKAGE_STORE_DIR, name), 'utf8'));
      if (pkg.ownerPublisherId === publisherId) packages.push(ownerPackageMeta(pkg, baseUrl));
    } catch {}
  }
  return packages.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function listPackagesForReview(status = 'pending', baseUrl = PUBLIC_BASE_URL) {
  const packages = await allStoredPackages();
  const target = String(status || 'pending');
  return packages
    .filter(pkg => target === 'all' || (pkg.reviewStatus || 'pending') === target)
    .map(pkg => adminPackageMeta(pkg, baseUrl))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function setPackageReviewStatus(id, status, reason = '', reviewer = 'admin', options = {}) {
  if (!REVIEW_STATES.has(status) || status === 'withdrawn') throw new Error('invalid review status');
  const existing = await getPackage(id);
  const next = {
    ...existing,
    reviewStatus: status,
    rejectionReason: status === 'rejected' ? String(reason || '').slice(0, 600) : '',
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(packageFilePath(id), JSON.stringify(next, null, 2));
  await appendAuditLog({
    action: `package.${status}`,
    packageId: id,
    publisherId: existing.ownerPublisherId,
    reviewStatus: status,
    reason: reviewer === 'admin' ? reason : '',
  });
  await rebuildPublicIndex(options.baseUrl);
  return ownerPackageMeta(next, options.baseUrl);
}

function discordAuthUrl() {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID || '');
  url.searchParams.set('redirect_uri', env.DISCORD_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/discord/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.members.read');
  return url.toString();
}

async function discordToken(code) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID || '',
    client_secret: env.DISCORD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.DISCORD_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/discord/callback`,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`discord token failed: ${res.status}`);
  return res.json();
}

async function discordMe(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`discord me failed: ${res.status}`);
  return res.json();
}

async function assertGuildMember(accessToken) {
  if (!env.DISCORD_GUILD_ID) return true;
  const res = await fetch(`https://discord.com/api/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('discord guild membership required');
  return true;
}

async function createSessionForDiscordUser(discordUserId) {
  const sessionId = randomId('sess');
  const session = await getOrCreatePublisher(hashDiscordUserId(discordUserId));
  sessions.set(sessionId, session);
  return { sessionId, session: sessions.get(sessionId) };
}

async function route(req, res) {
  const url = new URL(req.url, PUBLIC_BASE_URL);
  const publicBaseUrl = publicBaseFromRequest(req);
  if (req.method === 'OPTIONS') return json(req, res, 204, {});
  if ((url.pathname === '/admin' || url.pathname === '/admin/') && req.method === 'GET') return file(res, 200, ADMIN_PAGE_FILE, 'text/html; charset=utf-8');
  if (url.pathname === '/health' || url.pathname === '/api/workshop/health') return json(req, res, 200, { ok: true });
  if (url.pathname === '/api/workshop/packages' && req.method === 'GET') {
    const index = await readIndex();
    const packages = applyPackageFilters(index.packages || [], url.searchParams)
      .map(pkg => publicPackageMeta(pkg, publicBaseUrl));
    return json(req, res, 200, { ...index, packages });
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const pkg = await getPackage(id);
    const session = sessionFromRequest(req);
    if (!isPublicPackage(pkg) && (!session || session.publisherId !== pkg.ownerPublisherId)) return json(req, res, 404, { error: 'not-found' });
    return json(req, res, 200, publicPackageDetail(pkg, publicBaseUrl));
  }
  if (url.pathname === '/api/workshop/me') {
    const session = sessionFromRequest(req);
    return json(req, res, session ? 200 : 401, session ? { loggedIn: true, publisherId: session.publisherId } : { loggedIn: false });
  }
  if (url.pathname === '/api/workshop/me/packages' && req.method === 'GET') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    return json(req, res, 200, { packages: await listPackagesForPublisher(session.publisherId, publicBaseUrl) });
  }
  if (url.pathname === '/api/admin/review/packages' && req.method === 'GET') {
    requireAdmin(req);
    const packages = await listPackagesForReview(url.searchParams.get('status') || 'pending', publicBaseUrl);
    return json(req, res, 200, { packages: applyPackageFilters(packages, url.searchParams) });
  }
  if (url.pathname.startsWith('/api/admin/review/packages/') && req.method === 'GET') {
    requireAdmin(req);
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    return json(req, res, 200, adminPackageMeta(await getPackage(id), publicBaseUrl));
  }
  if (url.pathname.startsWith('/api/admin/review/packages/') && req.method === 'POST') {
    requireAdmin(req);
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const body = JSON.parse(await readBody(req, 32 * 1024) || '{}');
    const meta = await setPackageReviewStatus(id, String(body.status || ''), String(body.reason || ''), 'admin', { baseUrl: publicBaseUrl });
    return json(req, res, 200, meta);
  }
  if (url.pathname === '/api/workshop/packages' && req.method === 'POST') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const input = JSON.parse(await readBody(req));
    const pkg = validatePackage(input);
    const meta = await savePackage(pkg, session.publisherId, { expectedRevision: expectedRevisionFromRequest(req, input), baseUrl: publicBaseUrl });
    return json(req, res, 200, meta);
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'PUT') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const input = JSON.parse(await readBody(req));
    const pkg = validatePackage(input);
    if (pkg.id !== id) return json(req, res, 400, { error: 'package-id-mismatch' });
    const meta = await savePackage(pkg, session.publisherId, { expectedRevision: expectedRevisionFromRequest(req, input), baseUrl: publicBaseUrl });
    return json(req, res, 200, meta);
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'DELETE') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    await deletePackage(id, session.publisherId, { baseUrl: publicBaseUrl });
    return json(req, res, 200, { ok: true });
  }
  if (url.pathname === '/auth/discord/login') {
    res.writeHead(302, { location: discordAuthUrl() });
    return res.end();
  }
  if (url.pathname === '/auth/dev/login') {
    if (!DEV_LOGIN_ENABLED) return json(req, res, 404, { error: 'not-found' });
    const { sessionId } = await createSessionForDiscordUser(`dev:${url.searchParams.get('id') || 'local'}`);
    const secureAttr = COOKIE_SECURE ? ' Secure;' : '';
    res.writeHead(302, {
      'set-cookie': `xy_workshop_session=${encodeURIComponent(signSession(sessionId))}; HttpOnly;${secureAttr} SameSite=${COOKIE_SAME_SITE}; Path=/; Max-Age=2592000`,
      location: LOGIN_SUCCESS_REDIRECT,
    });
    return res.end();
  }
  if (url.pathname === '/auth/discord/callback') {
    const code = url.searchParams.get('code');
    if (!code) return text(res, 400, 'missing code');
    const token = await discordToken(code);
    await assertGuildMember(token.access_token);
    const me = await discordMe(token.access_token);
    const { sessionId } = await createSessionForDiscordUser(me.id);
    const secureAttr = COOKIE_SECURE ? ' Secure;' : '';
    res.writeHead(302, {
      'set-cookie': `xy_workshop_session=${encodeURIComponent(signSession(sessionId))}; HttpOnly;${secureAttr} SameSite=${COOKIE_SAME_SITE}; Path=/; Max-Age=2592000`,
      location: LOGIN_SUCCESS_REDIRECT,
    });
    return res.end();
  }
  return json(req, res, 404, { error: 'not-found' });
}

await ensureStore();
http.createServer((req, res) => {
  route(req, res).catch(error => {
    const message = String(error && error.message || error);
    json(req, res, statusForError(message), { error: message });
  });
}).listen(PORT, () => {
  console.log(`Workshop Gateway listening on ${PORT}`);
});
