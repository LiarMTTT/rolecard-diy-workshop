#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  gatewayUrl: 'https://43-132-171-157.sslip.io',
  pagesBaseUrl: 'https://liarmttt.github.io/rolecard-diy-workshop',
  vpsHost: '43.132.171.157',
  vpsUser: 'root',
  gatewayDir: '/opt/rolecard-diy-workshop/gateway',
  gatewayContainer: 'rolecard-workshop-gateway',
};

const args = parseArgs(process.argv.slice(2));
const config = {
  gatewayUrl: trimSlash(args.gatewayUrl || process.env.WORKSHOP_GATEWAY_URL || DEFAULTS.gatewayUrl),
  pagesBaseUrl: trimSlash(args.pagesBaseUrl || process.env.WORKSHOP_PAGES_BASE_URL || DEFAULTS.pagesBaseUrl),
  vpsHost: args.vpsHost || process.env.WORKSHOP_VPS_HOST || DEFAULTS.vpsHost,
  vpsUser: args.vpsUser || process.env.WORKSHOP_VPS_USER || DEFAULTS.vpsUser,
  gatewayDir: args.gatewayDir || process.env.WORKSHOP_GATEWAY_DIR || DEFAULTS.gatewayDir,
  gatewayContainer: args.gatewayContainer || process.env.WORKSHOP_GATEWAY_CONTAINER || DEFAULTS.gatewayContainer,
  ssh: args.ssh || process.env.WORKSHOP_SSH || '',
  adminToken: args.adminToken || process.env.ADMIN_TOKEN || '',
  corsOrigin: args.corsOrigin || args.corsorigin || process.env.CORS_ORIGIN || positionalUrl(args) || truthyNpmValue(process.env.npm_config_corsorigin) || truthyNpmValue(process.env.npm_config_cors_origin) || '',
  runSsh: Boolean(args.ssh || process.env.WORKSHOP_SSH || args.sshCheck === 'true'),
};

const results = [];

function parseArgs(items) {
  const out = { _: [] };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith('--')) {
      out._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = items[index + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function positionalUrl(parsedArgs) {
  return (parsedArgs._ || []).find(item => /^https?:\/\//i.test(item)) || '';
}

function truthyNpmValue(value) {
  if (!value || value === 'true' || value === 'false') return '';
  return value;
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function record(level, group, name, detail, fix = '') {
  results.push({ level, group, name, detail, fix });
}

async function fetchJson(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal, ...options });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      clearTimeout(timer);
      return { res, text, body };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function command(name, argsForCommand, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(name, argsForCommand, {
      cwd: repoRoot,
      windowsHide: true,
      timeout: options.timeout || 15000,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
      code: error.code,
    };
  }
}

async function npmCommand(argsForCommand, options = {}) {
  if (process.platform === 'win32') {
    return command('cmd.exe', ['/d', '/s', '/c', 'npm', ...argsForCommand], options);
  }
  return command('npm', argsForCommand, options);
}

async function checkGit() {
  const status = await command('git', ['status', '--porcelain=v1', '--branch']);
  if (!status.ok) {
    record('fail', 'git', 'status', status.stderr || 'git status failed');
    return;
  }
  record('ok', 'git', 'status', status.stdout.split(/\r?\n/)[0] || 'clean branch line');

  const remote = await command('git', ['remote', 'get-url', 'origin']);
  if (remote.ok && remote.stdout) record('ok', 'git', 'origin', remote.stdout);
  else record('fail', 'git', 'origin', remote.stderr || 'missing origin remote');

  const branch = await command('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstream = await command('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (branch.ok && upstream.ok) record('ok', 'git', 'upstream', `${branch.stdout} -> ${upstream.stdout}`);
  else record('warn', 'git', 'upstream', 'no upstream configured', 'Run: git branch --set-upstream-to origin/main main');

  const dirtyLines = status.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('##'));
  if (dirtyLines.length) record('warn', 'git', 'working tree', `${dirtyLines.length} changed file(s)`, 'Review with: git status --short');
  else record('ok', 'git', 'working tree', 'clean');
}

async function checkLocalBuild() {
  const check = await npmCommand(['run', 'check'], { timeout: 60000 });
  if (check.ok) record('ok', 'local', 'npm run check', 'static and gateway syntax checks passed');
  else record('fail', 'local', 'npm run check', check.stderr || check.stdout, 'Run npm run check locally and fix reported errors.');

  const release = await npmCommand(['--prefix', 'gateway', 'run', 'build:release'], { timeout: 60000 });
  if (release.ok) record('ok', 'local', 'gateway release', 'dist-gateway rebuilt');
  else record('fail', 'local', 'gateway release', release.stderr || release.stdout, 'Run npm --prefix gateway run build:release');
}

async function checkPages() {
  const urls = [
    '/workshop-index.json',
    '/cards/xingyue/index.json',
    '/runtime/xingyue/2.9.0/manifest.json',
  ];
  for (const suffix of urls) {
    const url = `${config.pagesBaseUrl}${suffix}`;
    try {
      const { res, body } = await fetchJson(url);
      if (res.ok && body) record('ok', 'github-pages', suffix, `HTTP ${res.status}`);
      else record('fail', 'github-pages', suffix, `HTTP ${res.status}`, 'Check GitHub Pages workflow and repository Pages settings.');
    } catch (error) {
      record('fail', 'github-pages', suffix, error.message);
    }
  }
}

async function checkGateway() {
  const urls = [
    ['/api/workshop/packages', 'public index'],
    ['/api/workshop/health', 'gateway health under API prefix'],
    ['/workshop/admin/', 'admin page'],
    ['/api/workshop/me', 'login status'],
  ];
  for (const [suffix, label] of urls) {
    const url = `${config.gatewayUrl}${suffix}`;
    try {
      const { res, body, text } = await fetchJson(url);
      if (suffix === '/api/workshop/me' && res.status === 401 && body?.loggedIn === false) {
        record('ok', 'gateway', label, 'HTTP 401 loggedIn=false');
      } else if (res.ok && (body || text)) {
        record('ok', 'gateway', label, `HTTP ${res.status}`);
      } else {
        record('fail', 'gateway', label, `HTTP ${res.status}`, 'Check Nginx reverse proxy and Gateway service.');
      }
    } catch (error) {
      record('fail', 'gateway', label, error.message);
    }
  }

  try {
    const { res } = await fetchText(`${config.gatewayUrl}/auth/discord/login`, { redirect: 'manual' });
    const location = res.headers.get('location') || '';
    if (res.status === 302 && location.includes('discord.com/oauth2/authorize')) {
      if (location.includes('client_id=&')) {
        record('warn', 'gateway', 'discord oauth', 'login route exists but DISCORD_CLIENT_ID is empty', 'Configure Discord application credentials on the VPS.');
      } else {
        record('ok', 'gateway', 'discord oauth', 'login route redirects to Discord with a client id');
      }
    } else {
      record('fail', 'gateway', 'discord oauth', `unexpected HTTP ${res.status}`, 'Check /auth/discord/login reverse proxy and env.');
    }
  } catch (error) {
    record('fail', 'gateway', 'discord oauth', error.message);
  }

  try {
    const res = await fetch(`${config.gatewayUrl}/api/admin/review/packages?status=pending`, {
      headers: config.adminToken ? { authorization: `Bearer ${config.adminToken}` } : {},
    });
    if (config.adminToken && res.ok) record('ok', 'gateway', 'admin api', 'ADMIN_TOKEN accepted');
    else if (!config.adminToken && res.status === 403) record('warn', 'gateway', 'admin api', 'admin route is protected; set ADMIN_TOKEN to verify access');
    else record('fail', 'gateway', 'admin api', `HTTP ${res.status}`, 'Verify ADMIN_TOKEN and Gateway env.');
  } catch (error) {
    record('fail', 'gateway', 'admin api', error.message);
  }
}

async function fetchText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, { signal: controller.signal, ...options });
      clearTimeout(timer);
      return { res };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function checkCors() {
  const origin = config.corsOrigin || 'http://127.0.0.1:8000';
  try {
    const res = await fetch(`${config.gatewayUrl}/api/workshop/packages`, { headers: { origin } });
    const allowOrigin = res.headers.get('access-control-allow-origin') || '';
    const allowCredentials = res.headers.get('access-control-allow-credentials') || '';
    if (allowOrigin === origin && allowCredentials === 'true') {
      record('ok', 'cors', 'origin', `${origin} is allowed with credentials`);
    } else {
      record('warn', 'cors', 'origin', `requested ${origin}; server returned ${allowOrigin || '(empty)'}`, 'Set CORS_ORIGIN on the VPS to the exact SillyTavern/front-end origin.');
    }
  } catch (error) {
    record('fail', 'cors', 'origin', error.message);
  }
}

async function checkSsh() {
  const knownHosts = path.join(os.homedir(), '.ssh', 'known_hosts');
  try {
    await fs.access(knownHosts);
    const result = await command('ssh-keygen', ['-F', config.vpsHost]);
    if (result.ok && result.stdout) record('ok', 'ssh', 'known host', `${config.vpsHost} is in known_hosts`);
    else record('warn', 'ssh', 'known host', `${config.vpsHost} not found in known_hosts`, `Connect once: ssh ${config.vpsUser}@${config.vpsHost}`);
  } catch {
    record('warn', 'ssh', 'known host', 'no ~/.ssh/known_hosts file');
  }

  const sshDir = path.join(os.homedir(), '.ssh');
  const privateKeys = await fs.readdir(sshDir).catch(() => []);
  const keyCandidates = privateKeys.filter(name => /^(id_|.+\.pem$|xingyue_workshop_vps_)/.test(name) && !name.endsWith('.pub') && name !== 'known_hosts');
  if (keyCandidates.length) record('ok', 'ssh', 'private key', keyCandidates.join(', '));
  else record('warn', 'ssh', 'private key', 'no private key found in ~/.ssh', 'Add a VPS SSH key or use browser/server console before running --ssh.');

  if (!config.runSsh) {
    record('warn', 'ssh', 'remote check', 'skipped; pass --ssh to run remote commands');
    return;
  }

  const remote = config.ssh || `${config.vpsUser}@${config.vpsHost}`;
  const remoteScript = [
    `cd ${quoteSh(config.gatewayDir)}`,
    'pwd',
    'test -f .env && echo ENV_OK || echo ENV_MISSING',
    'if command -v npm >/dev/null 2>&1; then',
    '  node -v && npm run self-check;',
    `elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx ${quoteSh(config.gatewayContainer)}; then`,
    `  docker exec ${quoteSh(config.gatewayContainer)} sh -lc 'cd /app && node -v && npm run self-check';`,
    'else',
    '  echo "NO_NODE_OR_GATEWAY_CONTAINER"; exit 127;',
    'fi',
  ].join('\n');
  const result = await command('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', remote, remoteScript], { timeout: 30000 });
  if (result.ok) record('ok', 'ssh', 'remote gateway', result.stdout);
  else record('fail', 'ssh', 'remote gateway', result.stderr || result.stdout, 'Confirm SSH key, remote path, and Gateway service.');
}

function quoteSh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function printResults() {
  const order = { fail: 0, warn: 1, ok: 2 };
  const sorted = results.slice().sort((a, b) => order[a.level] - order[b.level] || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  for (const item of sorted) {
    const mark = item.level === 'ok' ? 'OK' : item.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${mark}] ${item.group}/${item.name}: ${item.detail}`);
    if (item.fix) console.log(`      fix: ${item.fix}`);
  }
  const summary = {
    ok: results.filter(item => item.level === 'ok').length,
    warnings: results.filter(item => item.level === 'warn').length,
    failures: results.filter(item => item.level === 'fail').length,
    gatewayUrl: config.gatewayUrl,
    pagesBaseUrl: config.pagesBaseUrl,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures) process.exitCode = 1;
}

console.log('[ops] rolecard DIY workshop takeover check');
console.log(`[ops] repo: ${repoRoot}`);
console.log(`[ops] gateway: ${config.gatewayUrl}`);
console.log(`[ops] pages: ${config.pagesBaseUrl}`);

await checkGit();
await checkLocalBuild();
await checkPages();
await checkGateway();
await checkCors();
await checkSsh();
printResults();
