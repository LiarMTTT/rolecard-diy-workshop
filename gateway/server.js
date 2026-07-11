import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import workshopPackageContract from './shared/workshop-package-contract.js';

const env = process.env;
const GATEWAY_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(env.PORT || 8787);
const PUBLIC_BASE_URL = env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const COOKIE_SECURE = PUBLIC_BASE_URL.startsWith('https://');
const COOKIE_SAME_SITE = env.COOKIE_SAME_SITE || (COOKIE_SECURE ? 'None' : 'Lax');
const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME || 'rc_workshop_session';
const LOGIN_SUCCESS_REDIRECT = env.LOGIN_SUCCESS_REDIRECT || '/api/workshop/login-success';
const SESSION_SECRET = env.SESSION_SECRET || 'dev-session-secret';
const HASH_SECRET = env.HASH_SECRET || 'dev-hash-secret';
const ADMIN_TOKEN = env.ADMIN_TOKEN || '';
const DEV_LOGIN_ENABLED = env.DEV_LOGIN_ENABLED === 'true';
const PACKAGE_STORE_DIR = env.PACKAGE_STORE_DIR || './data/packages';
const INDEX_FILE = env.INDEX_FILE || './data/index.json';
const PUBLISHER_FILE = env.PUBLISHER_FILE || './data/publishers.json';
const VOTES_FILE = env.VOTES_FILE || './data/votes.json';
const AUDIT_LOG_FILE = env.AUDIT_LOG_FILE || './data/audit-log.jsonl';
const REQUIRE_REVIEW = env.REQUIRE_REVIEW !== 'false';
const PACKAGE_PUBLIC_BASE_URL = String(env.PACKAGE_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const PUBLIC_PACKAGE_DIR = env.PUBLIC_PACKAGE_DIR || '';
const PUBLIC_SYNC_REPORT_FILE = env.PUBLIC_SYNC_REPORT_FILE || './data/public-sync-report.json';
const CORS_ORIGIN = env.CORS_ORIGIN || '*';
const REVIEW_STATES = new Set(['pending', 'approved', 'rejected', 'withdrawn']);
const ADMIN_PAGE_FILE = path.join(GATEWAY_ROOT, 'public', 'admin.html');
const LOGIN_SUCCESS_PAGE_FILE = path.join(GATEWAY_ROOT, 'public', 'login-success.html');
const SESSION_TTL_MS = Number(env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 会话 token 有效期，默认 30 天
const LOGIN_HANDOFF_TTL_MS = Math.max(60_000, Math.min(Number(env.LOGIN_HANDOFF_TTL_MS) || 3 * 60 * 1000, 10 * 60 * 1000));
const LOGIN_HANDOFF_ID_RE = /^xyh_[A-Za-z0-9_-]{24,120}$/;
const LOGIN_HANDOFF_CHALLENGE_RE = /^[a-f0-9]{64}$/;
const LOGIN_HANDOFF_MAX = Math.max(128, Math.min(Number(env.LOGIN_HANDOFF_MAX) || 4096, 16_384));
const loginHandoffs = new Map(); // OAuth 一次性交接，仅驻留进程内存；领取或超时即删除

function corsHeaders(req, headers = {}) {
  const requestOrigin = String(req?.headers?.origin || '');
  const configured = String(CORS_ORIGIN || '*').split(',').map(item => item.trim()).filter(Boolean);
  let allowOrigin = configured[0] || '*';
  if (configured.includes('*')) allowOrigin = '*';
  else if (requestOrigin && configured.includes(requestOrigin)) allowOrigin = requestOrigin;
  const result = {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'authorization,content-type,if-match,x-package-revision',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    vary: 'Origin',
    ...headers,
  };
  if (allowOrigin !== '*') result['access-control-allow-credentials'] = 'true';
  return result;
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
  if (message === 'package-exists') return 409;
  if (message === 'revision-required') return 428;
  if (message === 'not-found') return 404;
  if (message === 'package-not-public') return 400;
  if (message === 'admin-required') return 403;
  if (message === 'admin-token-not-configured') return 503;
  if (message === 'not-package-owner') return 403;
  if (message === 'discord guild membership required') return 403;
  if (message.includes('invalid revision')) return 400;
  if (message.includes('invalid') || message.includes('unsupported') || message.includes('blocked') || message.includes('required') || message.includes('mismatch') || message.includes('must-have') || message.includes('unknown-') || message.includes('embedded-')) return 400;
  if (message.includes('ENOENT')) return 404;
  return 500;
}

// Egress sanitization: never leak raw internal error text (e.g. ENOENT filesystem
// paths) to clients. Deliberately-thrown known codes (validation / conflict / auth
// / config) keep their status-specific message; a 404 collapses to a generic
// not-found, and the unexpected-500 bucket is masked to internal-error.
function clientErrorMessage(message, status) {
  if (status === 404) return 'not-found';
  if (status === 500) return 'internal-error';
  return message;
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

// —— 无状态会话 Token（HMAC 签名，载荷含 publisherId + 过期）——
// 取代旧的「内存 Map + 签名 sessionId」：容器重启/部署不再登出所有人；
// 卡片可存 localStorage 走 Authorization: Bearer，绕开第三方 Cookie 淘汰。
function issueToken(publisher) {
  const payload = { pid: publisher.publisherId, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(value) {
  const [body, sig] = String(value || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || !payload.pid || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return { publisherId: payload.pid };
}

function normalizeLoginHandoffId(value) {
  const id = String(value || '').trim();
  return LOGIN_HANDOFF_ID_RE.test(id) ? id : '';
}

function cleanupLoginHandoffs(now = Date.now()) {
  for (const [id, item] of loginHandoffs) {
    if (!item || now > item.expiresAt) loginHandoffs.delete(id);
  }
}

function registerLoginHandoff(value, challengeValue) {
  cleanupLoginHandoffs();
  const id = normalizeLoginHandoffId(value);
  const challenge = String(challengeValue || '').trim().toLowerCase();
  if (!id || !LOGIN_HANDOFF_CHALLENGE_RE.test(challenge) || loginHandoffs.has(id)) return '';
  while (loginHandoffs.size >= LOGIN_HANDOFF_MAX) {
    const oldest = loginHandoffs.keys().next().value;
    if (!oldest) break;
    loginHandoffs.delete(oldest);
  }
  loginHandoffs.set(id, { status:'pending', challenge, expiresAt:Date.now() + LOGIN_HANDOFF_TTL_MS });
  return id;
}

function launchLoginHandoff(value) {
  cleanupLoginHandoffs();
  const id = normalizeLoginHandoffId(value);
  const item = id ? loginHandoffs.get(id) : null;
  if (!item || item.status !== 'pending') return '';
  item.status = 'launched';
  return id;
}

function loginHandoffSecretMatches(item, secretValue) {
  if (!item?.challenge) return false;
  const actual = crypto.createHash('sha256').update(String(secretValue || ''), 'utf8').digest('hex');
  return Buffer.byteLength(actual) === Buffer.byteLength(item.challenge)
    && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(item.challenge));
}

function normalizeWorkshopReturn(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return local && (url.protocol === 'http:' || url.protocol === 'https:') && raw === url.origin ? url.origin : '';
  } catch (_) { return ''; }
}

function completeLoginHandoff(value, sessionToken, identity) {
  cleanupLoginHandoffs();
  const id = normalizeLoginHandoffId(value);
  const pending = id ? loginHandoffs.get(id) : null;
  if (!pending || pending.status !== 'launched') return false;
  loginHandoffs.set(id, {
    status: 'ready',
    challenge: pending.challenge,
    token: String(sessionToken || ''),
    name: String(identity?.name || '').slice(0, 64),
    avatar: String(identity?.avatar || '').slice(0, 600),
    expiresAt: Date.now() + LOGIN_HANDOFF_TTL_MS,
  });
  return true;
}

function issueDiscordState(returnUrl, handoffId) {
  const payload = { r: normalizeWorkshopReturn(returnUrl), h: normalizeLoginHandoffId(handoffId), exp: Date.now() + LOGIN_HANDOFF_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update('oauth-state:' + body).digest('base64url');
  return body + '.' + sig;
}

function parseDiscordState(value) {
  const raw = String(value || '');
  const [body, sig] = raw.split('.');
  if (body && sig) {
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update('oauth-state:' + body).digest('base64url');
    if (Buffer.byteLength(sig) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload && typeof payload.exp === 'number' && Date.now() <= payload.exp) {
          return { returnUrl: String(payload.r || ''), handoffId: normalizeLoginHandoffId(payload.h) };
        }
      } catch (_) {}
    }
  }
  return null;
}

function sessionFromRequest(req) {
  // 优先 Authorization: Bearer（卡片 / Web 工作台跨域用），回退 Cookie（admin 同源页兼容）
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (bearer) { const viaHeader = verifyToken(bearer[1].trim()); if (viaHeader) return viaHeader; }
  const requestOrigin = String(req.headers.origin || '').trim();
  let gatewayOrigin = '';
  try { gatewayOrigin = new URL(PUBLIC_BASE_URL).origin; } catch (_) {}
  if (requestOrigin && requestOrigin !== gatewayOrigin) return null;
  const cookies = parseCookies(req);
  return verifyToken(cookies[SESSION_COOKIE_NAME] || cookies.xy_workshop_session);
}

// 登录成功：种 token cookie（admin 同源兼容）+ 跳转登录成功交接页；token 放 URL 片段（不上送服务器/不进日志），交接页用 postMessage 回传卡片
function finishLogin(res, sessionToken, publicBaseUrl, returnUrl, identity, handoffId) {
  const handoffReady = completeLoginHandoff(handoffId, sessionToken, identity);
  const secureAttr = COOKIE_SECURE ? ' Secure;' : '';
  const dest = new URL(LOGIN_SUCCESS_REDIRECT, publicBaseUrl || PUBLIC_BASE_URL);
  let frag = handoffReady ? ('handoff=' + encodeURIComponent(handoffId)) : ('token=' + encodeURIComponent(sessionToken));
  const safeReturn = normalizeWorkshopReturn(returnUrl);
  if (safeReturn) frag += '&return=' + encodeURIComponent(safeReturn);
  // 新版 handoff 的 token/身份只通过私密 claim 领取；旧客户端仅向精确本地 origin 兼容回传。
  if (!handoffReady && identity && identity.name) frag += '&name=' + encodeURIComponent(identity.name);
  if (!handoffReady && identity && identity.avatar) frag += '&avatar=' + encodeURIComponent(identity.avatar);
  dest.hash = frag;
  res.writeHead(302, {
    'set-cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; HttpOnly;${secureAttr} SameSite=${COOKIE_SAME_SITE}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    location: dest.toString(),
  });
  return res.end();
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
  const pkg = workshopPackageContract.normalizePackage(input, { allowLegacyFactors: false });
  return {
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
    createdAt: pkg.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewStatus: REQUIRE_REVIEW ? 'pending' : 'approved',
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

function requiredExpectedRevision(req, input) {
  const revision = expectedRevisionFromRequest(req, input);
  if (revision === null) throw new Error('revision-required');
  return revision;
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

let voteMutationTail = Promise.resolve();

function withVoteMutationLock(task) {
  const run = voteMutationTail.then(task, task);
  voteMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

async function readVotesUnlocked() {
  await ensureStore();
  try {
    const data = JSON.parse(await fs.readFile(VOTES_FILE, 'utf8'));
    const sourceVotes = data.votes && typeof data.votes === 'object' && !Array.isArray(data.votes) ? data.votes : {};
    const votes = Object.create(null);
    let migratedLegacyPublisherKeys = false;
    for (const [id, entry] of Object.entries(sourceVotes)) {
      if (['__proto__', 'prototype', 'constructor'].includes(id)) continue;
      const sourceVoters = entry?.voters && typeof entry.voters === 'object' && !Array.isArray(entry.voters) ? entry.voters : {};
      const voters = Object.assign(Object.create(null), sourceVoters);
      for (const [key, vote] of Object.entries(sourceVoters)) {
        if (!/^pub_[A-Za-z0-9_-]+$/.test(key)) continue;
        const hashed = voterKey(id, key);
        if (!Object.hasOwn(voters, hashed)) voters[hashed] = vote;
        delete voters[key];
        migratedLegacyPublisherKeys = true;
      }
      votes[id] = { voters };
    }
    data.votes = votes;
    if (migratedLegacyPublisherKeys) await writeVotes(data);
    return data;
  } catch (_error) {
    return { votes: {}, updatedAt: '' };
  }
}

async function readVotes() {
  return withVoteMutationLock(() => readVotesUnlocked());
}

async function writeVotes(data) {
  data.updatedAt = new Date().toISOString();
  const tempFile = `${VOTES_FILE}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, VOTES_FILE);
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

function voteTally(data, id) {
  const entry = data.votes && Object.hasOwn(data.votes, id) ? data.votes[id] : { voters: {} };
  let up = 0;
  let down = 0;
  for (const v of Object.values(entry.voters || {})) {
    if (v === 'up') up += 1;
    else if (v === 'down') down += 1;
  }
  return { up, down };
}

function myVoteOf(data, id, publisherId) {
  if (!publisherId) return 'none';
  const entry = data.votes && Object.hasOwn(data.votes, id) ? data.votes[id] : { voters: {} };
  const key = voterKey(id, publisherId);
  return (entry.voters && entry.voters[key]) || 'none';
}

function voterKey(id, publisherId) {
  return crypto.createHmac('sha256', HASH_SECRET).update(`${id}\0${publisherId}`).digest('base64url');
}

async function setVote(id, publisherId, vote) {
  assertPackageId(id);
  const pkg = await getPackage(id);
  if (!isPublicPackage(pkg)) throw new Error('package-not-public');
  return withVoteMutationLock(async () => {
    const data = await readVotesUnlocked();
    if (['__proto__', 'prototype', 'constructor'].includes(id)) throw new Error('invalid package id');
    if (!Object.hasOwn(data.votes, id)) data.votes[id] = { voters: Object.create(null) };
    const voters = data.votes[id].voters || (data.votes[id].voters = {});
    const key = voterKey(id, publisherId);
    if (vote === 'up' || vote === 'down') voters[key] = vote;
    else delete voters[key];
    await writeVotes(data);
    return { ...voteTally(data, id), myVote: voters[key] || 'none' };
  });
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

async function syncApprovedPackagesToPublicDir() {
  if (!PUBLIC_PACKAGE_DIR) return null;
  await fs.mkdir(PUBLIC_PACKAGE_DIR, { recursive: true });
  await fs.mkdir(path.dirname(PUBLIC_SYNC_REPORT_FILE), { recursive: true });

  const packages = await allStoredPackages();
  const approved = packages.filter(pkg => isPublicPackage(pkg));
  const approvedIds = new Set(approved.map(pkg => pkg.id));
  const copied = [];
  const removed = [];

  for (const pkg of approved) {
    const publicPkg = { ...pkg };
    delete publicPkg.ownerPublisherId;
    await fs.writeFile(
      path.join(PUBLIC_PACKAGE_DIR, `${assertPackageId(pkg.id)}.json`),
      `${JSON.stringify(publicPkg, null, 2)}\n`,
      'utf8',
    );
    copied.push(pkg.id);
  }

  for (const name of await fs.readdir(PUBLIC_PACKAGE_DIR).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    if (!approvedIds.has(id)) {
      await fs.rm(path.join(PUBLIC_PACKAGE_DIR, name), { force: true });
      removed.push(id);
    }
  }

  const report = {
    syncedAt: new Date().toISOString(),
    publicPackageDir: PUBLIC_PACKAGE_DIR,
    approved: approved.length,
    copied,
    removed,
  };
  await fs.writeFile(PUBLIC_SYNC_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function refreshPublicOutputs(baseUrl = PUBLIC_BASE_URL) {
  const index = await rebuildPublicIndex(baseUrl);
  await syncApprovedPackagesToPublicDir();
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
  if (options.createOnly && existing) throw new Error('package-exists');
  if (options.updateOnly && !existing) throw new Error('not-found');
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
  await refreshPublicOutputs(options.baseUrl);
  return ownerPackageMeta(stored, options.baseUrl);
}

async function deletePackage(id, publisherId, options = {}) {
  const existing = await getPackage(id);
  if (existing.ownerPublisherId !== publisherId) throw new Error('not-package-owner');
  assertRevisionMatch(existing, options.expectedRevision ?? null);
  const withdrawn = {
    ...existing,
    reviewStatus: 'withdrawn',
    withdrawnAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(packageFilePath(id), JSON.stringify(withdrawn, null, 2));
  await appendAuditLog({ action: 'package.withdrawn', packageId: id, publisherId, reviewStatus: 'withdrawn' });
  await refreshPublicOutputs(options.baseUrl);
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
  assertRevisionMatch(existing, options.expectedRevision ?? null);
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
  await refreshPublicOutputs(options.baseUrl);
  return ownerPackageMeta(next, options.baseUrl);
}

function discordAuthUrl(state) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID || '');
  url.searchParams.set('redirect_uri', env.DISCORD_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/discord/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.members.read');
  if (state) url.searchParams.set('state', state); // 服务端签名的 return + 一次性交接码，防止 OAuth state 被篡改
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
  const publisher = await getOrCreatePublisher(hashDiscordUserId(discordUserId));
  return { token: issueToken(publisher), publisher };
}

async function route(req, res) {
  const url = new URL(req.url, PUBLIC_BASE_URL);
  const publicBaseUrl = publicBaseFromRequest(req);
  if (req.method === 'OPTIONS') return json(req, res, 204, {});
  if ((url.pathname === '/admin' || url.pathname === '/admin/') && req.method === 'GET') return file(res, 200, ADMIN_PAGE_FILE, 'text/html; charset=utf-8');
  if (url.pathname === '/api/workshop/login-success' && req.method === 'GET') return file(res, 200, LOGIN_SUCCESS_PAGE_FILE, 'text/html; charset=utf-8');
  if (url.pathname === '/health' || url.pathname === '/api/workshop/health') return json(req, res, 200, { ok: true });
  if (url.pathname === '/api/workshop/packages' && req.method === 'GET') {
    const index = await readIndex();
    const votes = await readVotes();
    const session = sessionFromRequest(req);
    const packages = applyPackageFilters(index.packages || [], url.searchParams)
      .map(pkg => ({ ...publicPackageMeta(pkg, publicBaseUrl), votes: voteTally(votes, pkg.id), myVote: myVoteOf(votes, pkg.id, session?.publisherId) }));
    return json(req, res, 200, { ...index, packages });
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && !url.pathname.endsWith('/vote') && req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const pkg = await getPackage(id);
    const session = sessionFromRequest(req);
    if (!isPublicPackage(pkg) && (!session || session.publisherId !== pkg.ownerPublisherId)) return json(req, res, 404, { error: 'not-found' });
    const votes = await readVotes();
    return json(req, res, 200, { ...publicPackageDetail(pkg, publicBaseUrl), votes: voteTally(votes, id), myVote: myVoteOf(votes, id, session?.publisherId) });
  }
  if (url.pathname === '/api/workshop/login-handoff/start' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 4 * 1024) || '{}');
    const requestedId = normalizeLoginHandoffId(body.handoffId);
    if (requestedId && loginHandoffs.has(requestedId)) return json(req, res, 409, { error:'login-handoff-exists' }, { 'cache-control':'no-store' });
    const id = registerLoginHandoff(requestedId, body.challenge);
    if (!id) return json(req, res, 400, { error:'invalid-login-handoff' }, { 'cache-control':'no-store' });
    return json(req, res, 201, { status:'pending' }, { 'cache-control':'no-store' });
  }
  if (url.pathname === '/api/workshop/login-handoff' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 4 * 1024) || '{}');
    cleanupLoginHandoffs();
    const id = normalizeLoginHandoffId(body.handoffId);
    if (!id) return json(req, res, 400, { error:'invalid-login-handoff' }, { 'cache-control':'no-store' });
    const item = loginHandoffs.get(id);
    if (!item || !loginHandoffSecretMatches(item, body.secret)) return json(req, res, 404, { error:'login-handoff-not-found' }, { 'cache-control':'no-store' });
    if (item.status !== 'ready') return json(req, res, 202, { status:'pending' }, { 'cache-control':'no-store' });
    loginHandoffs.delete(id);
    return json(req, res, 200, { status:'ready', token:item.token, name:item.name, avatar:item.avatar }, { 'cache-control':'no-store' });
  }
  if (url.pathname === '/api/workshop/me') {
    const session = sessionFromRequest(req);
    return json(req, res, session ? 200 : 401, session ? { loggedIn: true, publisherId: session.publisherId } : { loggedIn: false });
  }
  if (url.pathname === '/api/workshop/logout' && req.method === 'POST') {
    // #5a：清会话 cookie（含旧名兼容），让 Bearer+Cookie 双通道都登出；无状态 Token 自身靠客户端丢弃即失效。
    const secureAttr = COOKIE_SECURE ? ' Secure;' : '';
    const clear = name => `${name}=; HttpOnly;${secureAttr} SameSite=${COOKIE_SAME_SITE}; Path=/; Max-Age=0`;
    return json(req, res, 200, { loggedIn: false }, { 'set-cookie': [clear(SESSION_COOKIE_NAME), clear('xy_workshop_session')] });
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
    const meta = await setPackageReviewStatus(id, String(body.status || ''), String(body.reason || ''), 'admin', { baseUrl: publicBaseUrl, expectedRevision: requiredExpectedRevision(req, body) });
    return json(req, res, 200, meta);
  }
  if (url.pathname === '/api/workshop/packages' && req.method === 'POST') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const input = JSON.parse(await readBody(req));
    const pkg = validatePackage(input);
    const meta = await savePackage(pkg, session.publisherId, { createOnly: true, baseUrl: publicBaseUrl });
    return json(req, res, 200, meta);
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'PUT') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const input = JSON.parse(await readBody(req));
    const pkg = validatePackage(input);
    if (pkg.id !== id) return json(req, res, 400, { error: 'package-id-mismatch' });
    const meta = await savePackage(pkg, session.publisherId, { updateOnly: true, expectedRevision: requiredExpectedRevision(req, input), baseUrl: publicBaseUrl });
    return json(req, res, 200, meta);
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'DELETE') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    await deletePackage(id, session.publisherId, { expectedRevision: requiredExpectedRevision(req), baseUrl: publicBaseUrl });
    return json(req, res, 200, { ok: true });
  }
  if (/^\/api\/workshop\/packages\/[^/]+\/vote$/.test(url.pathname) && req.method === 'POST') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/')[4] || '');
    const body = JSON.parse(await readBody(req, 4 * 1024) || '{}');
    const vote = ['up', 'down', 'none'].includes(body.vote) ? body.vote : 'none';
    const result = await setVote(id, session.publisherId, vote);
    return json(req, res, 200, result);
  }
  if (url.pathname === '/auth/discord/login') {
    const requestedReturn = url.searchParams.get('return') || '';
    const returnUrl = normalizeWorkshopReturn(requestedReturn);
    if (requestedReturn && !returnUrl) return json(req, res, 400, { error:'invalid-login-return' });
    const requestedHandoff = normalizeLoginHandoffId(url.searchParams.get('handoff'));
    const handoffId = requestedHandoff ? launchLoginHandoff(requestedHandoff) : '';
    if (requestedHandoff && !handoffId) return json(req, res, 409, { error:'login-handoff-already-launched' });
    const state = issueDiscordState(returnUrl, handoffId);
    res.writeHead(302, { location: discordAuthUrl(state) });
    return res.end();
  }
  if (url.pathname === '/auth/dev/login') {
    if (!DEV_LOGIN_ENABLED) return json(req, res, 404, { error: 'not-found' });
    const requestedHandoff = normalizeLoginHandoffId(url.searchParams.get('handoff'));
    const handoffId = requestedHandoff ? launchLoginHandoff(requestedHandoff) : '';
    if (requestedHandoff && !handoffId) return json(req, res, 409, { error:'login-handoff-already-launched' });
    const { token: sessionToken } = await createSessionForDiscordUser(`dev:${url.searchParams.get('id') || 'local'}`);
    const identity = { name: String(url.searchParams.get('name') || '').slice(0, 64), avatar: String(url.searchParams.get('avatar') || '').slice(0, 600) };
    return finishLogin(res, sessionToken, publicBaseUrl, url.searchParams.get('return') || '', identity, handoffId);
  }
  if (url.pathname === '/auth/discord/callback') {
    const code = url.searchParams.get('code');
    if (!code) return text(res, 400, 'missing code');
    const loginState = parseDiscordState(url.searchParams.get('state') || '');
    if (!loginState) return text(res, 400, 'invalid state');
    const discordTok = await discordToken(code);
    await assertGuildMember(discordTok.access_token);
    const me = await discordMe(discordTok.access_token);
    const { token: sessionToken } = await createSessionForDiscordUser(me.id);
    // B4：身份(昵称/头像)只透传给交接页(URL 片段)→postMessage 回卡片在内存展示；Gateway 不持久化、不种 cookie、不进日志（隐私铁律）
    const defaultAvatarIndex = me.discriminator && me.discriminator !== '0' ? Number(me.discriminator) % 5 : Number((BigInt(me.id) >> 22n) % 6n);
    const identity = {
      name: String(me.global_name || me.username || '').slice(0, 64),
      avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`,
    };
    return finishLogin(res, sessionToken, publicBaseUrl, loginState.returnUrl, identity, loginState.handoffId);
  }
  return json(req, res, 404, { error: 'not-found' });
}

// 启动期配置校验：所有数据文件路径所在目录必须可写（容器内须落 /data 可写卷）。
// 杜绝 VOTES_FILE 那类「默认 ./data → /app/data 只读 → 运行时 ENOENT」的静默故障，改为启动即 fail-fast。
async function assertDataPathsWritable() {
  const checks = [
    ['PACKAGE_STORE_DIR', PACKAGE_STORE_DIR],
    ['INDEX_FILE', path.dirname(INDEX_FILE)],
    ['PUBLISHER_FILE', path.dirname(PUBLISHER_FILE)],
    ['VOTES_FILE', path.dirname(VOTES_FILE)],
    ['AUDIT_LOG_FILE', path.dirname(AUDIT_LOG_FILE)],
    ['PUBLIC_SYNC_REPORT_FILE', path.dirname(PUBLIC_SYNC_REPORT_FILE)],
  ];
  for (const [name, dir] of checks) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.write-probe-${process.pid}`);
      await fs.writeFile(probe, 'ok');
      await fs.rm(probe, { force: true });
    } catch (error) {
      throw new Error(`[config] ${name} 指向不可写路径 ${dir} —— 数据文件必须落在可写卷（容器内 /data）。请在 .env 显式设置该路径。底层: ${error.message}`);
    }
  }
}

await assertDataPathsWritable();
await ensureStore();
http.createServer((req, res) => {
  route(req, res).catch(error => {
    const message = String(error && error.message || error);
    const status = statusForError(message);
    if (status >= 500) console.error('[gateway] unhandled error:', error);
    json(req, res, status, { error: clientErrorMessage(message, status) });
  });
}).listen(PORT, () => {
  console.log(`Workshop Gateway listening on ${PORT}`);
});
