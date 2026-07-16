import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import workshopPackageContract from './shared/workshop-package-contract.js';

const env = process.env;
const GATEWAY_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(env.PORT || 8787);
const HOST = String(env.HOST || '0.0.0.0').trim() || '0.0.0.0';
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
const CHARACTER_UPLOAD_DIR = path.resolve(env.CHARACTER_UPLOAD_DIR || path.join(path.dirname(PACKAGE_STORE_DIR), 'character-uploads'));
const CHARACTER_ASSET_STORE_DIR = path.resolve(env.CHARACTER_ASSET_STORE_DIR || path.join(path.dirname(PACKAGE_STORE_DIR), 'character-assets'));
const PUBLIC_ASSET_DIR = path.resolve(env.PUBLIC_ASSET_DIR || (PUBLIC_PACKAGE_DIR ? path.join(PUBLIC_PACKAGE_DIR, 'assets') : './data/public/assets'));
const ASSET_PUBLIC_BASE_URL = String(env.ASSET_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const CHARACTER_UPLOAD_TTL_MS = Math.max(5 * 60 * 1000, Math.min(Number(env.CHARACTER_UPLOAD_TTL_MS) || 30 * 60 * 1000, 24 * 60 * 60 * 1000));
const CHARACTER_UPLOAD_RATE_PER_MINUTE = Math.max(2, Math.min(Number(env.CHARACTER_UPLOAD_RATE_PER_MINUTE) || 12, 60));
const CHARACTER_UPLOAD_MAX_STAGED_PER_OWNER = Math.max(1, Math.min(Number(env.CHARACTER_UPLOAD_MAX_STAGED_PER_OWNER) || 3, 12));
const CHARACTER_UPLOAD_MAX_STAGED_GLOBAL = Math.max(16, Math.min(Number(env.CHARACTER_UPLOAD_MAX_STAGED_GLOBAL) || 128, 2048));
const CHARACTER_UPLOAD_MAX_STAGED_BYTES_PER_OWNER = Math.max(16 * 1024 * 1024, Math.min(Number(env.CHARACTER_UPLOAD_MAX_STAGED_BYTES_PER_OWNER) || 48 * 1024 * 1024, 256 * 1024 * 1024));
const CHARACTER_UPLOAD_MAX_STAGED_BYTES_GLOBAL = Math.max(128 * 1024 * 1024, Math.min(Number(env.CHARACTER_UPLOAD_MAX_STAGED_BYTES_GLOBAL) || 512 * 1024 * 1024, 4 * 1024 * 1024 * 1024));
const CHARACTER_UPLOAD_ID_RE = /^xyu_[A-Za-z0-9_-]{24,120}$/;
const CHARACTER_ASSET_SPECS = Object.freeze({
  avatar: { stem:'avatar', maxBytes:2 * 1024 * 1024, maxDimension:2048, maxPixels:4 * 1024 * 1024 },
  portraitNormal: { stem:'portrait-normal', maxBytes:8 * 1024 * 1024, maxDimension:4096, maxPixels:16 * 1024 * 1024 },
  portraitNude: { stem:'portrait-nude', maxBytes:8 * 1024 * 1024, maxDimension:4096, maxPixels:16 * 1024 * 1024 },
  portraitAftermath: { stem:'portrait-aftermath', maxBytes:8 * 1024 * 1024, maxDimension:4096, maxPixels:16 * 1024 * 1024 },
});
const characterUploadRateWindows = new Map();
const activeCharacterUploadOwners = new Set();
const CORS_ORIGIN = env.CORS_ORIGIN || '*';
const REVIEW_STATES = new Set(['pending', 'approved', 'rejected', 'withdrawn']);
const ADMIN_PAGE_FILE = path.join(GATEWAY_ROOT, 'public', 'admin.html');
const LOGIN_SUCCESS_PAGE_FILE = path.join(GATEWAY_ROOT, 'public', 'login-success.html');
const SESSION_TTL_MS = Number(env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 会话 token 有效期，默认 30 天
const LOGIN_HANDOFF_TTL_MS = Math.max(60_000, Math.min(Number(env.LOGIN_HANDOFF_TTL_MS) || 3 * 60 * 1000, 10 * 60 * 1000));
const LOGIN_HANDOFF_ID_RE = /^xyh_[A-Za-z0-9_-]{24,120}$/;
const LOGIN_HANDOFF_CHALLENGE_RE = /^[a-f0-9]{64}$/;
const LOGIN_HANDOFF_MAX = Math.max(128, Math.min(Number(env.LOGIN_HANDOFF_MAX) || 4096, 16_384));
const LOGIN_HANDOFF_RATE_PER_SEC = Math.max(0.1, Math.min(Number(env.LOGIN_HANDOFF_RATE_PER_SEC) || LOGIN_HANDOFF_MAX / (LOGIN_HANDOFF_TTL_MS / 1000) / 2, 100));
const LOGIN_HANDOFF_RATE_BURST = Math.max(4, Math.min(Number(env.LOGIN_HANDOFF_RATE_BURST) || LOGIN_HANDOFF_RATE_PER_SEC * 2, 200));
const loginHandoffs = new Map(); // OAuth 一次性交接，仅驻留进程内存；领取或超时即删除

let loginHandoffAdmissionTokens = LOGIN_HANDOFF_RATE_BURST;
let loginHandoffAdmissionUpdatedAt = Date.now();

function admitLoginHandoff() {
  const now = Date.now();
  const elapsed = Math.max(0, now - loginHandoffAdmissionUpdatedAt) / 1000;
  loginHandoffAdmissionUpdatedAt = now;
  loginHandoffAdmissionTokens = Math.min(LOGIN_HANDOFF_RATE_BURST, loginHandoffAdmissionTokens + elapsed * LOGIN_HANDOFF_RATE_PER_SEC);
  if (loginHandoffAdmissionTokens < 1) return false;
  loginHandoffAdmissionTokens -= 1;
  return true;
}

function loginHandoffRetryAfterSeconds() {
  const deficit = Math.max(0, 1 - loginHandoffAdmissionTokens);
  return Math.max(1, Math.ceil(deficit / LOGIN_HANDOFF_RATE_PER_SEC));
}

function corsHeaders(req, headers = {}, options = {}) {
  const requestOrigin = String(req?.headers?.origin || '');
  const hasRequestCredentials = Boolean(req?.headers?.authorization || req?.headers?.cookie);
  const publicAnonymousRead = options.publicRead && !hasRequestCredentials;
  const configured = String(CORS_ORIGIN || '*').split(',').map(item => item.trim()).filter(Boolean);
  let allowOrigin = '';
  if (publicAnonymousRead) allowOrigin = '*';
  else if (requestOrigin && configured.includes(requestOrigin)) allowOrigin = requestOrigin;
  const result = {
    'access-control-allow-headers': publicAnonymousRead ? 'accept' : 'authorization,content-type,if-match,x-package-revision',
    'access-control-allow-methods': publicAnonymousRead ? 'GET,OPTIONS' : 'GET,POST,PUT,DELETE,OPTIONS',
    vary: 'Origin',
    ...headers,
  };
  if (allowOrigin) result['access-control-allow-origin'] = allowOrigin;
  if (allowOrigin && allowOrigin !== '*') result['access-control-allow-credentials'] = 'true';
  return result;
}

function json(req, res, status, body, headers = {}, corsOptions = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(req, headers, corsOptions),
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

async function binary(req, res, filePath, contentType, headers = {}) {
  const body = await fs.readFile(filePath);
  res.writeHead(200, { 'content-type':contentType, 'content-length':body.length, ...corsHeaders(req, headers) });
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
  if (message === 'login-handoff-capacity') return 503;
  if (message === 'not-package-owner') return 403;
  if (message === 'character-upload-not-found') return 404;
  if (message === 'character-upload-expired') return 410;
  if (message === 'character-upload-owner-mismatch') return 403;
  if (message === 'character-upload-rate-limited' || message === 'character-upload-busy' || message === 'character-upload-quota') return 429;
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
  if (!id || !LOGIN_HANDOFF_CHALLENGE_RE.test(challenge) || loginHandoffs.has(id)) return null;
  if (loginHandoffs.size >= LOGIN_HANDOFF_MAX) throw new Error('login-handoff-capacity');
  const expiresAt = Date.now() + LOGIN_HANDOFF_TTL_MS;
  loginHandoffs.set(id, { status:'pending', challenge, expiresAt });
  return { id, expiresAt };
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
  const pkg = workshopPackageContract.normalizePackage(input, {
    allowLegacyFactors: false,
    allowLegacyExtensions: false,
    allowLegacyCharacterAliases: false,
    portableMediaOnly: true,
  });
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
    storage: { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
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

function assertUploadId(value) {
  const id = String(value || '').trim();
  if (!CHARACTER_UPLOAD_ID_RE.test(id)) throw new Error('invalid-character-upload-id');
  return id;
}

function safeChildPath(baseDir, child) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, String(child || ''));
  if (target === base || !target.startsWith(`${base}${path.sep}`)) throw new Error('invalid-storage-path');
  return target;
}

function characterUploadDir(uploadId) {
  return safeChildPath(CHARACTER_UPLOAD_DIR, assertUploadId(uploadId));
}

function characterBundleDir(packageId, uploadId) {
  return safeChildPath(safeChildPath(CHARACTER_ASSET_STORE_DIR, assertPackageId(packageId)), assertUploadId(uploadId));
}

function publicAssetPackageDir(packageId) {
  return safeChildPath(PUBLIC_ASSET_DIR, assertPackageId(packageId));
}

function publicAssetUrl(packageId, filename, baseUrl = PUBLIC_BASE_URL) {
  const base = ASSET_PUBLIC_BASE_URL || `${String(baseUrl || PUBLIC_BASE_URL).replace(/\/+$/, '')}/api/workshop/assets`;
  return `${base}/${encodeURIComponent(assertPackageId(packageId))}/${encodeURIComponent(filename)}`;
}

function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) {
    return { mime:'image/png', extension:'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime:'image/jpeg', extension:'jpg' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mime:'image/webp', extension:'webp' };
  }
  throw new Error('invalid-character-image-magic');
}

function assertCharacterImageDimensions(width, height, spec) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > spec.maxDimension || height > spec.maxDimension || width * height > spec.maxPixels) {
    throw new Error('invalid-character-image-dimensions');
  }
}

function sanitizePng(buffer, spec) {
  const signature = buffer.subarray(0, 8);
  const kept = [signature];
  const metadataChunks = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt', 'iCCP']);
  let offset = 8, width = 0, height = 0, sawHeader = false, sawData = false, sawEnd = false;
  while (offset + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (size > spec.maxBytes || end > buffer.length) throw new Error('invalid-character-image-structure');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!sawHeader && type !== 'IHDR') throw new Error('invalid-character-image-structure');
    if (type === 'IHDR') {
      if (sawHeader || size !== 13) throw new Error('invalid-character-image-structure');
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      sawHeader = true;
    }
    if (type === 'acTL') throw new Error('invalid-character-image-animation');
    if (type === 'IDAT') sawData = true;
    if (!metadataChunks.has(type)) kept.push(buffer.subarray(offset, end));
    offset = end;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== buffer.length) throw new Error('invalid-character-image-structure');
  assertCharacterImageDimensions(width, height, spec);
  return Buffer.concat(kept);
}

function sanitizeJpeg(buffer, spec) {
  const kept = [buffer.subarray(0, 2)];
  const sofMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset = 2, width = 0, height = 0, sawScan = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('invalid-character-image-structure');
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw new Error('invalid-character-image-structure');
    const size = buffer.readUInt16BE(offset);
    const start = offset - 2;
    const end = offset + size;
    if (size < 2 || end > buffer.length) throw new Error('invalid-character-image-structure');
    if (sofMarkers.has(marker)) {
      if (size < 8) throw new Error('invalid-character-image-structure');
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    }
    if (marker === 0xda) {
      const eoi = buffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi < end) throw new Error('invalid-character-image-structure');
      kept.push(buffer.subarray(start, eoi + 2));
      sawScan = true;
      offset = buffer.length;
      break;
    }
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) kept.push(buffer.subarray(start, end));
    offset = end;
  }
  if (!sawScan || !width || !height) throw new Error('invalid-character-image-structure');
  assertCharacterImageDimensions(width, height, spec);
  return Buffer.concat(kept);
}

function sanitizeWebp(buffer, spec) {
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('invalid-character-image-structure');
  const kept = [];
  const metadataChunks = new Set(['EXIF', 'XMP ', 'ICCP']);
  let offset = 12, width = 0, height = 0, sawImage = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const padded = size + (size % 2);
    const end = offset + 8 + padded;
    if (end > buffer.length) throw new Error('invalid-character-image-structure');
    const data = offset + 8;
    if (type === 'ANIM' || type === 'ANMF') throw new Error('invalid-character-image-animation');
    if (type === 'VP8X') {
      if (size < 10 || (buffer[data] & 0x02)) throw new Error('invalid-character-image-animation');
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    } else if (type === 'VP8 ') {
      if (size < 10 || buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) throw new Error('invalid-character-image-structure');
      width = buffer.readUInt16LE(data + 6) & 0x3fff;
      height = buffer.readUInt16LE(data + 8) & 0x3fff;
      sawImage = true;
    } else if (type === 'VP8L') {
      if (size < 5 || buffer[data] !== 0x2f) throw new Error('invalid-character-image-structure');
      width = 1 + buffer[data + 1] + ((buffer[data + 2] & 0x3f) << 8);
      height = 1 + (buffer[data + 2] >> 6) + (buffer[data + 3] << 2) + ((buffer[data + 4] & 0x0f) << 10);
      sawImage = true;
    }
    if (!metadataChunks.has(type)) kept.push(buffer.subarray(offset, end));
    offset = end;
  }
  if (offset !== buffer.length || !sawImage) throw new Error('invalid-character-image-structure');
  assertCharacterImageDimensions(width, height, spec);
  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

function decodeCharacterImage(dataUrl, spec) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error('invalid-character-image-data');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > spec.maxBytes) throw new Error('invalid-character-image-size');
  const detected = sniffImage(buffer);
  if (detected.mime !== match[1].toLowerCase()) throw new Error('invalid-character-image-mime');
  const sanitized = detected.mime === 'image/png' ? sanitizePng(buffer, spec)
    : detected.mime === 'image/jpeg' ? sanitizeJpeg(buffer, spec)
      : sanitizeWebp(buffer, spec);
  if (sanitized.length > spec.maxBytes) throw new Error('invalid-character-image-size');
  return { buffer:sanitized, ...detected, sha256:crypto.createHash('sha256').update(sanitized).digest('hex') };
}

function previewMediaFromPackage(pkg) {
  if (pkg?.type !== 'character') return undefined;
  const media = pkg.payload?.media || {};
  const preview = {
    avatar:String(media.avatar || ''),
    portraitNormal:String(media.portraits?.normal || ''),
    portraitNude:String(media.portraits?.nude || ''),
    portraitAftermath:String(media.portraits?.aftermath || ''),
  };
  return Object.values(preview).some(Boolean) ? preview : undefined;
}

async function cleanupExpiredCharacterUploads(now = Date.now()) {
  await fs.mkdir(CHARACTER_UPLOAD_DIR, { recursive:true });
  for (const name of await fs.readdir(CHARACTER_UPLOAD_DIR).catch(() => [])) {
    if (!CHARACTER_UPLOAD_ID_RE.test(name)) continue;
    const dir = characterUploadDir(name);
    try {
      const record = JSON.parse(await fs.readFile(path.join(dir, 'upload.json'), 'utf8'));
      if (!Number.isFinite(Number(record.expiresAt)) || now > Number(record.expiresAt)) await fs.rm(dir, { recursive:true, force:true });
    } catch (_) {
      await fs.rm(dir, { recursive:true, force:true });
    }
  }
}

function beginCharacterUploadAdmission(publisherId, now = Date.now()) {
  if (activeCharacterUploadOwners.has(publisherId)) throw new Error('character-upload-busy');
  const windowStart = now - 60_000;
  const recent = (characterUploadRateWindows.get(publisherId) || []).filter(value => value > windowStart);
  if (recent.length >= CHARACTER_UPLOAD_RATE_PER_MINUTE) throw new Error('character-upload-rate-limited');
  recent.push(now);
  characterUploadRateWindows.set(publisherId, recent);
  activeCharacterUploadOwners.add(publisherId);
  return () => activeCharacterUploadOwners.delete(publisherId);
}

async function assertCharacterUploadQuota(publisherId) {
  let globalCount = 0, globalBytes = 0, ownerCount = 0, ownerBytes = 0;
  for (const name of await fs.readdir(CHARACTER_UPLOAD_DIR).catch(() => [])) {
    if (!CHARACTER_UPLOAD_ID_RE.test(name)) continue;
    try {
      const record = JSON.parse(await fs.readFile(path.join(characterUploadDir(name), 'upload.json'), 'utf8'));
      const bytes = Object.values(record.files || {}).reduce((sum, item) => sum + Math.max(0, Number(item?.bytes) || 0), 0);
      globalCount += 1;
      globalBytes += bytes;
      if (record.ownerPublisherId === publisherId) { ownerCount += 1; ownerBytes += bytes; }
    } catch (_) {}
  }
  if (ownerCount >= CHARACTER_UPLOAD_MAX_STAGED_PER_OWNER
    || ownerBytes >= CHARACTER_UPLOAD_MAX_STAGED_BYTES_PER_OWNER
    || globalCount >= CHARACTER_UPLOAD_MAX_STAGED_GLOBAL
    || globalBytes >= CHARACTER_UPLOAD_MAX_STAGED_BYTES_GLOBAL) {
    throw new Error('character-upload-quota');
  }
}

async function createCharacterUpload(input, publisherId) {
  await cleanupExpiredCharacterUploads();
  await assertCharacterUploadQuota(publisherId);
  const rawPackage = input?.package && typeof input.package === 'object' ? structuredClone(input.package) : null;
  if (!rawPackage || rawPackage.type !== 'character') throw new Error('invalid-character-upload-package');
  const rawMedia = rawPackage.payload?.media && typeof rawPackage.payload.media === 'object' ? rawPackage.payload.media : {};
  rawPackage.payload = { ...rawPackage.payload, media:{ avatar:String(rawMedia.avatar || ''), portraits:{ normal:String(rawMedia.portraits?.normal || ''), nude:String(rawMedia.portraits?.nude || ''), aftermath:String(rawMedia.portraits?.aftermath || '') } } };
  const canonical = validatePackage(rawPackage);
  const uploadId = randomId('xyu');
  const dir = characterUploadDir(uploadId);
  await fs.mkdir(dir, { recursive:true });
  const files = {};
  try {
    for (const [slot, spec] of Object.entries(CHARACTER_ASSET_SPECS)) {
      const dataUrl = input?.assets?.[slot];
      if (!dataUrl) continue;
      const decoded = decodeCharacterImage(dataUrl, spec);
      const filename = `${spec.stem}-${decoded.sha256.slice(0, 16)}.${decoded.extension}`;
      await fs.writeFile(path.join(dir, filename), decoded.buffer, { flag:'wx' });
      files[slot] = { filename, mime:decoded.mime, bytes:decoded.buffer.length, sha256:decoded.sha256 };
    }
    const now = Date.now();
    const record = {
      uploadId,
      ownerPublisherId:publisherId,
      createdAt:now,
      expiresAt:now + CHARACTER_UPLOAD_TTL_MS,
      package:canonical,
      files,
    };
    await atomicWriteJson(path.join(dir, 'upload.json'), record);
    return {
      uploadId,
      expiresInMs:CHARACTER_UPLOAD_TTL_MS,
      packageId:canonical.id,
      assets:Object.fromEntries(Object.entries(files).map(([slot, item]) => [slot, { mime:item.mime, bytes:item.bytes, sha256:item.sha256 }])),
    };
  } catch (error) {
    await fs.rm(dir, { recursive:true, force:true });
    throw error;
  }
}

async function readCharacterUpload(uploadId, publisherId, packageId) {
  const id = assertUploadId(uploadId);
  const dir = characterUploadDir(id);
  let record;
  try { record = JSON.parse(await fs.readFile(path.join(dir, 'upload.json'), 'utf8')); }
  catch (_) { throw new Error('character-upload-not-found'); }
  if (record.ownerPublisherId !== publisherId) throw new Error('character-upload-owner-mismatch');
  if (Date.now() > Number(record.expiresAt || 0)) {
    await fs.rm(dir, { recursive:true, force:true });
    throw new Error('character-upload-expired');
  }
  if (String(record.package?.id || '') !== String(packageId || '')) throw new Error('character-upload-package-mismatch');
  return record;
}

function packageFromCharacterUpload(record, baseUrl = PUBLIC_BASE_URL) {
  const pkg = structuredClone(record.package);
  const media = pkg.payload?.media || {};
  const portraits = media.portraits || {};
  if (record.files?.avatar) media.avatar = publicAssetUrl(pkg.id, record.files.avatar.filename, baseUrl);
  if (record.files?.portraitNormal) portraits.normal = publicAssetUrl(pkg.id, record.files.portraitNormal.filename, baseUrl);
  if (record.files?.portraitNude) portraits.nude = publicAssetUrl(pkg.id, record.files.portraitNude.filename, baseUrl);
  if (record.files?.portraitAftermath) portraits.aftermath = publicAssetUrl(pkg.id, record.files.portraitAftermath.filename, baseUrl);
  media.portraits = portraits;
  pkg.payload.media = media;
  return pkg;
}

function characterMediaReference(pkg, slot) {
  const media = pkg?.payload?.media || {};
  if (slot === 'avatar') return String(media.avatar || '');
  if (slot === 'portraitNormal') return String(media.portraits?.normal || '');
  if (slot === 'portraitNude') return String(media.portraits?.nude || '');
  if (slot === 'portraitAftermath') return String(media.portraits?.aftermath || '');
  return '';
}

function referencesManagedCharacterAsset(reference, packageId, item) {
  if (!reference || !item?.filename) return false;
  try {
    const url = new URL(String(reference), PUBLIC_BASE_URL);
    const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    return parts.length >= 5
      && parts.at(-5) === 'api'
      && parts.at(-4) === 'workshop'
      && parts.at(-3) === 'assets'
      && parts.at(-2) === packageId
      && parts.at(-1) === item.filename;
  } catch (_) {
    return false;
  }
}

async function prepareCharacterAssetBundle(record, existing, pkg) {
  const target = characterBundleDir(record.package.id, record.uploadId);
  await fs.mkdir(target, { recursive:true });
  const files = {};
  try {
    for (const slot of Object.keys(CHARACTER_ASSET_SPECS)) {
      const uploaded = record.files?.[slot];
      if (uploaded) {
        await fs.copyFile(path.join(characterUploadDir(record.uploadId), uploaded.filename), path.join(target, uploaded.filename), fs.constants.COPYFILE_EXCL);
        files[slot] = uploaded;
        continue;
      }
      const retained = existing?.assetBundle?.files?.[slot];
      if (!referencesManagedCharacterAsset(characterMediaReference(pkg, slot), record.package.id, retained)) continue;
      await fs.copyFile(
        path.join(characterBundleDir(record.package.id, existing.assetBundle.uploadId), retained.filename),
        path.join(target, retained.filename),
        fs.constants.COPYFILE_EXCL,
      );
      files[slot] = retained;
    }
    if (!Object.keys(files).length) {
      await fs.rm(target, { recursive:true, force:true });
      return null;
    }
    return { uploadId:record.uploadId, files };
  } catch (error) {
    await fs.rm(target, { recursive:true, force:true });
    throw error;
  }
}

async function removeCharacterBundle(packageId, bundle) {
  if (!bundle?.uploadId) return;
  await fs.rm(characterBundleDir(packageId, bundle.uploadId), { recursive:true, force:true });
}

async function packageInputForPublish(input, publisherId) {
  const uploadId = String(input?.uploadId || '').trim();
  if (!uploadId) return { pkg:validatePackage(input), uploadRecord:null };
  const record = await readCharacterUpload(uploadId, publisherId, input?.id);
  const packageInput = packageFromCharacterUpload(record, PUBLIC_BASE_URL);
  return { pkg:validatePackage(packageInput), uploadRecord:record };
}

async function ensureStore() {
  await fs.mkdir(PACKAGE_STORE_DIR, { recursive: true });
  await fs.mkdir(CHARACTER_UPLOAD_DIR, { recursive:true });
  await fs.mkdir(CHARACTER_ASSET_STORE_DIR, { recursive:true });
  await fs.mkdir(PUBLIC_ASSET_DIR, { recursive:true });
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

async function atomicWriteFile(filePath, content) {
  const tempFile = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempFile, content);
    await fs.rename(tempFile, filePath);
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  await atomicWriteJson(INDEX_FILE, index);
}

async function readPublishers() {
  await ensureStore();
  const registry = JSON.parse(await fs.readFile(PUBLISHER_FILE, 'utf8'));
  registry.publishers = Array.isArray(registry.publishers) ? registry.publishers : [];
  return registry;
}

async function writePublishers(registry) {
  registry.updatedAt = new Date().toISOString();
  await atomicWriteJson(PUBLISHER_FILE, registry);
}

let voteMutationTail = Promise.resolve();
let publisherMutationTail = Promise.resolve();
let publicOutputTail = Promise.resolve();
const packageMutationTails = new Map();

function withPublisherMutationLock(task) {
  const run = publisherMutationTail.then(task, task);
  publisherMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

function withPublicOutputLock(task) {
  const run = publicOutputTail.then(task, task);
  publicOutputTail = run.then(() => undefined, () => undefined);
  return run;
}

function withPackageMutationLock(id, task) {
  const key = assertPackageId(id);
  const previous = packageMutationTails.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => undefined, () => undefined);
  packageMutationTails.set(key, settled);
  settled.finally(() => {
    if (packageMutationTails.get(key) === settled) packageMutationTails.delete(key);
  });
  return run;
}

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
  return withPublisherMutationLock(async () => {
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
  });
}

function publicPackageMeta(pkg, baseUrl = PUBLIC_BASE_URL) {
  const { payload, ownerPublisherId, assetBundle, ...meta } = pkg;
  return {
    ...meta,
    previewMedia:previewMediaFromPackage(pkg) || pkg.previewMedia,
    manifestUrl: `${baseUrl.replace(/\/+$/, '')}/api/workshop/packages/${encodeURIComponent(pkg.id)}`,
    storage: pkg.storage?.url ? pkg.storage : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
  };
}

function publicPackageDetail(pkg, baseUrl = PUBLIC_BASE_URL) {
  const { ownerPublisherId, assetBundle, ...publicPkg } = pkg;
  return {
    ...publicPkg,
    manifestUrl: `${baseUrl.replace(/\/+$/, '')}/api/workshop/packages/${encodeURIComponent(pkg.id)}`,
    storage: pkg.storage?.url ? pkg.storage : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
  };
}

function adminPackageMeta(pkg, baseUrl = PUBLIC_BASE_URL) {
  const { ownerPublisherId, assetBundle, ...meta } = pkg;
  return {
    ...meta,
    reviewAssets:assetBundle?.files ? Object.fromEntries(Object.keys(assetBundle.files).map(slot => [slot, `${baseUrl.replace(/\/+$/, '')}/api/admin/review/packages/${encodeURIComponent(pkg.id)}/assets/${encodeURIComponent(slot)}`])) : undefined,
    manifestUrl: `${baseUrl.replace(/\/+$/, '')}/api/workshop/packages/${encodeURIComponent(pkg.id)}`,
    storage: pkg.storage?.url ? pkg.storage : { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
  };
}

function ownerPackageMeta(pkg, baseUrl = PUBLIC_BASE_URL) {
  const meta = publicPackageDetail(pkg, baseUrl);
  const ownerPreview = { ...(previewMediaFromPackage(pkg) || {}) };
  for (const slot of Object.keys(pkg.assetBundle?.files || {})) {
    if (!(slot in CHARACTER_ASSET_SPECS)) continue;
    ownerPreview[slot] = `${baseUrl.replace(/\/+$/, '')}/api/workshop/me/packages/${encodeURIComponent(pkg.id)}/assets/${encodeURIComponent(slot)}`;
  }
  return {
    ...meta,
    previewMedia:Object.values(ownerPreview).some(Boolean) ? ownerPreview : undefined,
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
    delete publicPkg.assetBundle;
    await atomicWriteFile(
      path.join(PUBLIC_PACKAGE_DIR, `${assertPackageId(pkg.id)}.json`),
      `${JSON.stringify(publicPkg, null, 2)}\n`,
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
  await atomicWriteFile(PUBLIC_SYNC_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function syncApprovedCharacterAssets() {
  await fs.mkdir(PUBLIC_ASSET_DIR, { recursive:true });
  const approved = (await allStoredPackages()).filter(pkg => isPublicPackage(pkg) && pkg.assetBundle?.uploadId);
  const approvedIds = new Set(approved.map(pkg => pkg.id));
  for (const pkg of approved) {
    const source = characterBundleDir(pkg.id, pkg.assetBundle.uploadId);
    const target = publicAssetPackageDir(pkg.id);
    const staging = `${target}.staging-${randomId('swap')}`;
    const backup = `${target}.backup-${randomId('swap')}`;
    await fs.rm(staging, { recursive:true, force:true });
    await fs.mkdir(staging, { recursive:true });
    for (const item of Object.values(pkg.assetBundle.files || {})) {
      await fs.copyFile(path.join(source, item.filename), path.join(staging, item.filename));
    }
    let backedUp = false;
    try {
      try { await fs.rename(target, backup); backedUp = true; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await fs.rename(staging, target);
      if (backedUp) await fs.rm(backup, { recursive:true, force:true });
    } catch (error) {
      await fs.rm(staging, { recursive:true, force:true }).catch(() => {});
      if (backedUp) {
        await fs.rm(target, { recursive:true, force:true }).catch(() => {});
        await fs.rename(backup, target).catch(() => {});
      }
      throw error;
    }
  }
  for (const name of await fs.readdir(PUBLIC_ASSET_DIR).catch(() => [])) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(name) || approvedIds.has(name)) continue;
    await fs.rm(publicAssetPackageDir(name), { recursive:true, force:true });
  }
}

async function refreshPublicOutputs(baseUrl = PUBLIC_BASE_URL) {
  return withPublicOutputLock(async () => {
    await syncApprovedCharacterAssets();
    await syncApprovedPackagesToPublicDir();
    const index = await rebuildPublicIndex(baseUrl);
    return index;
  });
}

async function getPackage(id) {
  const file = packageFilePath(id);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function commitPackageMutation({ id, previous = null, next, audit, baseUrl = PUBLIC_BASE_URL }) {
  const file = packageFilePath(id);
  await atomicWriteJson(file, next);
  try {
    await appendAuditLog(audit);
    await refreshPublicOutputs(baseUrl);
    return next;
  } catch (cause) {
    let rollbackError = null;
    try {
      if (previous) await atomicWriteJson(file, previous);
      else await fs.rm(file, { force:true });
      await refreshPublicOutputs(baseUrl);
    } catch (error) {
      rollbackError = error;
    }
    await appendAuditLog({ action:'package.mutation_rolled_back', packageId:id, reason:String(cause?.message || cause).slice(0, 300) }).catch(() => {});
    if (rollbackError) throw new Error(`package-mutation-rollback-failed: ${cause?.message || cause}; rollback: ${rollbackError.message || rollbackError}`);
    throw new Error(`package-mutation-rolled-back: ${cause?.message || cause}`);
  }
}

function reviewStatusForSave(existing, pkg, contentChanged) {
  if (!existing) return pkg.reviewStatus;
  if ((existing.reviewStatus || 'pending') === 'withdrawn') return REQUIRE_REVIEW ? 'pending' : 'approved';
  if (contentChanged && REQUIRE_REVIEW) return 'pending';
  if (contentChanged && !REQUIRE_REVIEW) return 'approved';
  return existing.reviewStatus || pkg.reviewStatus;
}

async function savePackageUnlocked(pkg, publisherId, options = {}) {
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
  const nextReviewStatus = reviewStatusForSave(existing, pkg, contentChanged);
  const stateChanged = Boolean(existing) && (nextReviewStatus !== (existing.reviewStatus || 'pending') || Boolean(existing.withdrawnAt));
  const preparedBundle = options.uploadRecord ? await prepareCharacterAssetBundle(options.uploadRecord, existing, pkg) : null;
  const stored = {
    ...pkg,
    createdAt: existing?.createdAt || pkg.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: existing ? ((contentChanged || stateChanged) ? previousRevision + 1 : previousRevision) : 1,
    contentHash,
    reviewStatus: nextReviewStatus,
    rejectionReason: contentChanged ? '' : (existing?.rejectionReason || ''),
    withdrawnAt: '',
    storage: { provider: PACKAGE_PUBLIC_BASE_URL ? 'cloudreve-public-url' : 'gateway', url: packagePublicUrl(pkg.id) },
    assetBundle: options.uploadRecord ? preparedBundle : existing?.assetBundle,
    ownerPublisherId: publisherId,
  };
  try {
    await commitPackageMutation({ id:stored.id, previous:existing, next:stored, baseUrl:options.baseUrl, audit:{
      action: existing ? 'package.updated' : 'package.created',
      packageId: stored.id,
      publisherId,
      reviewStatus: stored.reviewStatus,
    } });
  } catch (error) {
    if (preparedBundle) await removeCharacterBundle(stored.id, preparedBundle).catch(() => {});
    throw error;
  }
  if (options.uploadRecord) {
    await fs.rm(characterUploadDir(options.uploadRecord.uploadId), { recursive:true, force:true }).catch(() => {});
    if (existing?.assetBundle?.uploadId && existing.assetBundle.uploadId !== preparedBundle?.uploadId) {
      await removeCharacterBundle(stored.id, existing.assetBundle).catch(() => {});
    }
  }
  return ownerPackageMeta(stored, options.baseUrl);
}

async function savePackage(pkg, publisherId, options = {}) {
  return withPackageMutationLock(pkg.id, () => savePackageUnlocked(pkg, publisherId, options));
}

async function deletePackageUnlocked(id, publisherId, options = {}) {
  const existing = await getPackage(id);
  if (existing.ownerPublisherId !== publisherId) throw new Error('not-package-owner');
  assertRevisionMatch(existing, options.expectedRevision ?? null);
  const withdrawn = {
    ...existing,
    revision: Number(existing.revision || 0) + 1,
    reviewStatus: 'withdrawn',
    withdrawnAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await commitPackageMutation({ id, previous:existing, next:withdrawn, baseUrl:options.baseUrl, audit:{ action:'package.withdrawn', packageId:id, publisherId, reviewStatus:'withdrawn' } });
  return ownerPackageMeta(withdrawn, options.baseUrl);
}

async function deletePackage(id, publisherId, options = {}) {
  return withPackageMutationLock(id, () => deletePackageUnlocked(id, publisherId, options));
}

// 3.6.0 #6：作者永久删除自己的包（区别于 delete=withdraw 仅打标记）。物理删除包 JSON + 角色资产 bundle + 投票记录，
// 再刷新公共输出把它从索引清掉。owner-only（比对 ownerPublisherId），隐私铁律不破（只碰 salted hash + publisherId）。
async function purgePackageUnlocked(id, publisherId, options = {}) {
  let existing;
  try { existing = await getPackage(id); } catch { throw new Error('not-found'); }
  if (existing.ownerPublisherId !== publisherId) throw new Error('not-package-owner');
  assertRevisionMatch(existing, options.expectedRevision ?? null);
  await fs.rm(packageFilePath(id), { force: true });
  if (existing.assetBundle) await removeCharacterBundle(id, existing.assetBundle).catch(() => {});
  await withVoteMutationLock(async () => {
    const data = await readVotesUnlocked();
    if (data.votes && Object.hasOwn(data.votes, id)) { delete data.votes[id]; await writeVotes(data); }
  });
  await appendAuditLog({ action: 'package.purged', packageId: id, publisherId }).catch(() => {});
  await refreshPublicOutputs(options.baseUrl);
  return { ok: true, id };
}

async function purgePackage(id, publisherId, options = {}) {
  return withPackageMutationLock(id, () => purgePackageUnlocked(id, publisherId, options));
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

async function setPackageReviewStatusUnlocked(id, status, reason = '', reviewer = 'admin', options = {}) {
  if (!REVIEW_STATES.has(status) || status === 'withdrawn') throw new Error('invalid review status');
  const existing = await getPackage(id);
  assertRevisionMatch(existing, options.expectedRevision ?? null);
  const next = {
    ...existing,
    revision: Number(existing.revision || 0) + 1,
    reviewStatus: status,
    rejectionReason: status === 'rejected' ? String(reason || '').slice(0, 600) : '',
    updatedAt: new Date().toISOString(),
  };
  await commitPackageMutation({ id, previous:existing, next, baseUrl:options.baseUrl, audit:{
    action: `package.${status}`,
    packageId: id,
    publisherId: existing.ownerPublisherId,
    reviewStatus: status,
    reason: reviewer === 'admin' ? reason : '',
  } });
  return ownerPackageMeta(next, options.baseUrl);
}

async function setPackageReviewStatus(id, status, reason = '', reviewer = 'admin', options = {}) {
  return withPackageMutationLock(id, () => setPackageReviewStatusUnlocked(id, status, reason, reviewer, options));
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
  if (/^\/api\/workshop\/assets\/[^/]+\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
    const parts = url.pathname.split('/');
    const id = decodeURIComponent(parts[4] || '');
    const filename = decodeURIComponent(parts[5] || '');
    if (!/^(?:avatar|portrait-normal|portrait-nude)-[a-f0-9]{16}\.(?:png|jpg|webp)$/.test(filename)) return json(req, res, 404, { error:'not-found' });
    const pkg = await getPackage(id);
    if (!isPublicPackage(pkg)) return json(req, res, 404, { error:'not-found' });
    const item = Object.values(pkg.assetBundle?.files || {}).find(candidate => candidate?.filename === filename);
    if (!item) return json(req, res, 404, { error:'not-found' });
    return binary(req, res, path.join(publicAssetPackageDir(id), filename), item.mime, { 'cache-control':'public, max-age=31536000, immutable', 'x-content-type-options':'nosniff' });
  }
  if (url.pathname === '/api/workshop/packages' && req.method === 'GET') {
    const index = await readIndex();
    const votes = await readVotes();
    const session = sessionFromRequest(req);
    const packages = applyPackageFilters(index.packages || [], url.searchParams)
      .map(pkg => ({ ...publicPackageMeta(pkg, publicBaseUrl), votes: voteTally(votes, pkg.id), myVote: myVoteOf(votes, pkg.id, session?.publisherId) }));
    return json(req, res, 200, { ...index, packages }, {}, { publicRead:true });
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && !url.pathname.endsWith('/vote') && req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    let pkg = null;
    try {
      pkg = await getPackage(id);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const session = sessionFromRequest(req);
    if (!pkg || (!isPublicPackage(pkg) && (!session || session.publisherId !== pkg.ownerPublisherId))) {
      return json(req, res, 404, { error: 'not-found' }, {}, { publicRead:true });
    }
    const votes = await readVotes();
    return json(req, res, 200, { ...publicPackageDetail(pkg, publicBaseUrl), votes: voteTally(votes, id), myVote: myVoteOf(votes, id, session?.publisherId) }, {}, { publicRead:true });
  }
  if (url.pathname === '/api/workshop/login-handoff/start' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req, 4 * 1024) || '{}');
    const requestedId = normalizeLoginHandoffId(body.handoffId);
    if (requestedId && loginHandoffs.has(requestedId)) return json(req, res, 409, { error:'login-handoff-exists' }, { 'cache-control':'no-store' });
    if (!admitLoginHandoff()) return json(req, res, 429, { error:'login-handoff-rate-limited' }, { 'cache-control':'no-store', 'retry-after':String(loginHandoffRetryAfterSeconds()) });
    const handoff = registerLoginHandoff(requestedId, body.challenge);
    if (!handoff) return json(req, res, 400, { error:'invalid-login-handoff' }, { 'cache-control':'no-store' });
    return json(req, res, 201, {
      status:'pending',
      expiresInMs: Math.max(0, handoff.expiresAt - Date.now()),
    }, { 'cache-control':'no-store' });
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
  if (/^\/api\/workshop\/me\/packages\/[^/]+\/assets\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error:'login-required' });
    const parts = url.pathname.split('/');
    const id = decodeURIComponent(parts[5] || '');
    const slot = decodeURIComponent(parts[7] || '');
    const pkg = await getPackage(id);
    if (pkg.ownerPublisherId !== session.publisherId) return json(req, res, 404, { error:'not-found' });
    const item = pkg.assetBundle?.files?.[slot];
    if (!item) return json(req, res, 404, { error:'not-found' });
    return binary(req, res, path.join(characterBundleDir(id, pkg.assetBundle.uploadId), item.filename), item.mime, { 'cache-control':'private, no-store', 'x-content-type-options':'nosniff' });
  }
  if (url.pathname === '/api/workshop/uploads/character' && req.method === 'POST') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error:'login-required' });
    const release = beginCharacterUploadAdmission(session.publisherId);
    try {
      const input = JSON.parse(await readBody(req, 26 * 1024 * 1024));
      return json(req, res, 201, await createCharacterUpload(input, session.publisherId), { 'cache-control':'no-store' });
    } finally {
      release();
    }
  }
  if (url.pathname === '/api/admin/review/packages' && req.method === 'GET') {
    requireAdmin(req);
    const packages = await listPackagesForReview(url.searchParams.get('status') || 'pending', publicBaseUrl);
    return json(req, res, 200, { packages: applyPackageFilters(packages, url.searchParams) });
  }
  if (/^\/api\/admin\/review\/packages\/[^/]+\/assets\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
    requireAdmin(req);
    const parts = url.pathname.split('/');
    const id = decodeURIComponent(parts[5] || '');
    const slot = decodeURIComponent(parts[7] || '');
    const pkg = await getPackage(id);
    const item = pkg.assetBundle?.files?.[slot];
    if (!item) return json(req, res, 404, { error:'not-found' });
    return binary(req, res, path.join(characterBundleDir(id, pkg.assetBundle.uploadId), item.filename), item.mime, { 'cache-control':'private, no-store', 'x-content-type-options':'nosniff' });
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
    const { pkg, uploadRecord } = await packageInputForPublish(input, session.publisherId, publicBaseUrl);
    const meta = await savePackage(pkg, session.publisherId, { createOnly: true, baseUrl: publicBaseUrl, uploadRecord });
    return json(req, res, 200, meta);
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'PUT') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const input = JSON.parse(await readBody(req));
    const { pkg, uploadRecord } = await packageInputForPublish(input, session.publisherId, publicBaseUrl);
    if (pkg.id !== id) return json(req, res, 400, { error: 'package-id-mismatch' });
    const meta = await savePackage(pkg, session.publisherId, { updateOnly: true, expectedRevision: requiredExpectedRevision(req, input), baseUrl: publicBaseUrl, uploadRecord });
    return json(req, res, 200, meta);
  }
  if (/^\/api\/workshop\/packages\/[^/]+\/purge$/.test(url.pathname) && req.method === 'POST') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/')[4] || '');
    const result = await purgePackage(id, session.publisherId, { expectedRevision: requiredExpectedRevision(req), baseUrl: publicBaseUrl });
    return json(req, res, 200, result);
  }
  if (url.pathname.startsWith('/api/workshop/packages/') && req.method === 'DELETE') {
    const session = sessionFromRequest(req);
    if (!session) return json(req, res, 401, { error: 'login-required' });
    const id = decodeURIComponent(url.pathname.split('/').pop() || '');
    const meta = await deletePackage(id, session.publisherId, { expectedRevision: requiredExpectedRevision(req), baseUrl: publicBaseUrl });
    return json(req, res, 200, { ok:true, package:meta });
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
    ...(PUBLIC_PACKAGE_DIR ? [['PUBLIC_PACKAGE_DIR', PUBLIC_PACKAGE_DIR]] : []),
    ['CHARACTER_UPLOAD_DIR', CHARACTER_UPLOAD_DIR],
    ['CHARACTER_ASSET_STORE_DIR', CHARACTER_ASSET_STORE_DIR],
    ['PUBLIC_ASSET_DIR', PUBLIC_ASSET_DIR],
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

function isLoopbackListenHost() {
  return HOST === 'localhost' || HOST === '127.0.0.1' || HOST === '::1' || HOST === '[::1]';
}

function assertSecureConfiguration() {
  if (isLoopbackListenHost()) return;
  const invalid = value => Buffer.byteLength(String(value || ''), 'utf8') < 32 || /^dev-(session|hash)-secret$/.test(String(value || ''));
  if (invalid(SESSION_SECRET) || invalid(HASH_SECRET) || SESSION_SECRET === HASH_SECRET) {
    throw new Error('[config] 公网 Gateway 必须配置两个不同且至少 32 字节的 SESSION_SECRET / HASH_SECRET');
  }
  if (LOGIN_HANDOFF_RATE_PER_SEC * (LOGIN_HANDOFF_TTL_MS / 1000) + LOGIN_HANDOFF_RATE_BURST >= LOGIN_HANDOFF_MAX) {
    throw new Error('[config] LOGIN_HANDOFF_RATE_PER_SEC / BURST 必须保证一个 TTL 窗口内无法填满 LOGIN_HANDOFF_MAX');
  }
}

assertSecureConfiguration();
await assertDataPathsWritable();
await ensureStore();
http.createServer((req, res) => {
  route(req, res).catch(error => {
    const message = String(error && error.message || error);
    const status = statusForError(message);
    if (status >= 500) console.error('[gateway] unhandled error:', error);
    json(req, res, status, { error: clientErrorMessage(message, status) });
  });
}).listen(PORT, HOST, () => {
  console.log(`Workshop Gateway listening on ${HOST}:${PORT}`);
});
