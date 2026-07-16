#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const secretFile = args.secretFile || process.env.WORKSHOP_SECRET_FILE || '';
const secretConfig = secretFile ? loadSecretConfig(secretFile) : null;
const sshTarget = args.ssh || process.env.WORKSHOP_SSH || secretSshTarget(secretConfig) || 'rolecard-workshop-vps';
const gatewayDir = args.gatewayDir || secretConfig?.vps?.gatewayDir || '/opt/rolecard-diy-workshop/gateway';
const localGatewayDir = args.localGateway || fileURLToPath(new URL('../dist-gateway/', import.meta.url));
const buildReleaseScript = fileURLToPath(new URL('../gateway/tools/build_release.mjs', import.meta.url));
const shouldBuildRelease = !args.localGateway;
const inspectOnly = args.inspect === 'true';
const remoteCheckOnly = args.remoteCheck === 'true';
const purgeKnownSamplesMode = String(args.purgeKnownSamples || '').trim().toLowerCase();
const skipScp = args['no-scp'] === 'true' || process.env.WORKSHOP_NO_SCP === '1';
const container = args.container || secretConfig?.vps?.gatewayContainer || 'rolecard-workshop-gateway';
const image = args.image || 'node:20-alpine';
const port = args.port || '8787';
const dataDir = args.dataDir || '/var/lib/rolecard-diy-workshop';
const publicDir = args.publicDir || secretConfig?.storage?.publicPackageDir || '/usr/local/lighthouse/softwares/cloudreve/workshop-public/xingyue';
const healthUrl = args.healthUrl || (secretConfig?.gateway?.publicBaseUrl ? `${String(secretConfig.gateway.publicBaseUrl).replace(/\/+$/, '')}/api/workshop/health` : '') || 'https://43-132-171-157.sslip.io/api/workshop/health';
const corsOriginDefault = String(args.corsOrigin || args.corsorigin || process.env.WORKSHOP_CORS_ORIGINS || '*').trim() || '*';
let temporaryIdentityDir = '';

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

function loadSecretConfig(filename) {
  try {
    return JSON.parse(readFileSync(path.resolve(filename), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('无法读取或解析 workshop secret file');
  }
}

function secretSshTarget(secret) {
  const host = String(secret?.vps?.host || '').trim();
  const user = String(secret?.vps?.user || '').trim();
  return host ? (user ? `${user}@${host}` : host) : '';
}

function resolveIdentityFile() {
  if (!secretConfig) return '';
  const configured = String(secretConfig?.key?.privateKeyPath || '').trim();
  const expanded = configured.startsWith('~/') || configured.startsWith('~\\')
    ? path.join(os.homedir(), configured.slice(2))
    : configured;
  const candidate = expanded && (path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(path.resolve(secretFile)), expanded));
  if (candidate && existsSync(candidate)) return candidate;
  const embedded = String(secretConfig?.key?.privateKeyOpenSSH || '');
  if (!embedded) throw new Error('workshop secret file 未提供可用 SSH private key');
  temporaryIdentityDir ||= mkdtempSync(path.join(os.tmpdir(), 'rolecard-workshop-key-'));
  const identity = path.join(temporaryIdentityDir, 'id_workshop');
  if (!existsSync(identity)) {
    writeFileSync(identity, embedded.endsWith('\n') ? embedded : `${embedded}\n`, { mode: 0o600 });
    if (process.platform === 'win32') {
      const acl = spawnSync('icacls.exe', [identity, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(R)`], { windowsHide: true, stdio: 'ignore' });
      if (acl.status) throw new Error('无法收紧临时 SSH private key 权限');
    }
  }
  return identity;
}

function sshOptions() {
  const identity = resolveIdentityFile();
  return identity ? ['-i', identity, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=45', '-o', 'StrictHostKeyChecking=accept-new'] : [];
}

function cleanupTemporaryIdentity() {
  if (temporaryIdentityDir) rmSync(temporaryIdentityDir, { recursive: true, force: true });
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function remoteScript(appDir, useActiveRelease = false) {
  return `
set -eu
cd ${shQuote(gatewayDir)}
APP_DIR=${shQuote(appDir)}
RELEASES_DIR=${shQuote(path.posix.join(gatewayDir, '.releases'))}
ACTIVE_FILE="$RELEASES_DIR/.active"
if [ ${useActiveRelease ? '1' : '0'} -eq 1 ] && [ -f "$ACTIVE_FILE" ]; then
  ACTIVE_DIR=$(cat "$ACTIVE_FILE")
  case "$ACTIVE_DIR" in
    "$RELEASES_DIR"/release-*) APP_DIR="$ACTIVE_DIR" ;;
    ${shQuote(gatewayDir)}) APP_DIR="$ACTIVE_DIR" ;;
    *) printf 'invalid active release: %s\n' "$ACTIVE_DIR" >&2; exit 3 ;;
  esac
fi
test -f "$APP_DIR/server.js"
test -f "$APP_DIR/shared/workshop-package-contract.js"
STAMP=$(date +%Y%m%d%H%M%S)
cp .env ".env.bak.$STAMP"
# CORS_ORIGIN 是既定架构决策（默认 * 全放：玩家酒馆 origin 不可枚举，精确白名单会锁死全体玩家登录）。
# deploy 不改写 .env 里已有的值，只在该键缺失时补默认。勿再加「剔除 *」或「自动追加白名单」逻辑（见 E18）。
if ! grep -q '^CORS_ORIGIN=' .env; then
  printf 'CORS_ORIGIN=%s\\n' ${shQuote(corsOriginDefault)} >> .env
fi
TMP=$(mktemp)
awk '
BEGIN {
  values["PACKAGE_STORE_DIR"]="/data/packages"
  values["INDEX_FILE"]="/data/index.json"
  values["PUBLISHER_FILE"]="/data/publishers.json"
  values["VOTES_FILE"]="/data/votes.json"
  values["AUDIT_LOG_FILE"]="/data/audit-log.jsonl"
  values["PUBLIC_SYNC_REPORT_FILE"]="/data/public-sync-report.json"
  values["CHARACTER_UPLOAD_DIR"]="/data/character-uploads"
  values["CHARACTER_ASSET_STORE_DIR"]="/data/character-assets"
  values["PUBLIC_PACKAGE_DIR"]="/public-packages"
  values["PUBLIC_ASSET_DIR"]="/public-packages/assets"
}
{
  key=$0; sub(/=.*/, "", key)
  if (key in values) { if (!seen[key]++) print key "=" values[key]; next }
  print
}
END { for (key in values) if (!seen[key]) print key "=" values[key] }
' .env > "$TMP"
mv "$TMP" .env
OLD_NAME=${shQuote(container)}
BAK_NAME="${container}-prev-$STAMP"
if docker ps -a --format '{{.Names}}' | grep -qx "$OLD_NAME"; then
  docker stop "$OLD_NAME" >/dev/null
  docker rename "$OLD_NAME" "$BAK_NAME"
fi
if ! docker run -d --name "$OLD_NAME" --restart unless-stopped --env-file ${shQuote(gatewayDir)}/.env -p ${port}:8787 -v "$APP_DIR:/app:ro" -v ${shQuote(dataDir)}:/data -v ${shQuote(publicDir)}:/public-packages -w /app ${shQuote(image)} node server.js >/tmp/rolecard-workshop-new-container.txt; then
  docker rm -f "$OLD_NAME" >/dev/null 2>&1 || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$BAK_NAME"; then
    docker rename "$BAK_NAME" "$OLD_NAME"
    docker start "$OLD_NAME" >/dev/null
  fi
  exit 1
fi
sleep 2
if ! curl -fsS ${shQuote(healthUrl)} >/dev/null; then
  docker logs --tail 80 "$OLD_NAME" || true
  docker rm -f "$OLD_NAME" >/dev/null || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$BAK_NAME"; then
    docker rename "$BAK_NAME" "$OLD_NAME"
    docker start "$OLD_NAME" >/dev/null
  fi
  exit 2
fi
ACTIVE_TMP="$RELEASES_DIR/.active.tmp.$$"
if ! (mkdir -p "$RELEASES_DIR" && printf '%s\n' "$APP_DIR" > "$ACTIVE_TMP" && mv "$ACTIVE_TMP" "$ACTIVE_FILE"); then
  rm -f "$ACTIVE_TMP"
  docker rm -f "$OLD_NAME" >/dev/null || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$BAK_NAME"; then
    docker rename "$BAK_NAME" "$OLD_NAME"
    docker start "$OLD_NAME" >/dev/null
  fi
  exit 3
fi
if docker ps -a --format '{{.Names}}' | grep -qx "$BAK_NAME"; then
  docker rm "$BAK_NAME" >/dev/null
fi
printf 'backup=.env.bak.%s\\n' "$STAMP"
printf 'container=%s\\n' "$OLD_NAME"
printf 'cors=%s\\n' "$CORS"
printf 'health=ok\\n'
`;
}

function remotePurgeKnownSamplesScript(mode) {
  if (!['preview', 'apply'].includes(mode)) throw new Error('purgeKnownSamples must be preview or apply');
  const applyArgs = mode === 'apply' ? ' --apply --gateway-stopped' : '';
  return `
set -eu
cd ${shQuote(gatewayDir)}
ACTIVE_FILE=${shQuote(path.posix.join(gatewayDir, '.releases', '.active'))}
test -f "$ACTIVE_FILE"
APP_DIR=$(cat "$ACTIVE_FILE")
case "$APP_DIR" in
  ${shQuote(path.posix.join(gatewayDir, '.releases'))}/release-*) ;;
  *) printf 'invalid active release: %s\n' "$APP_DIR" >&2; exit 3 ;;
esac
test -f "$APP_DIR/tools/purge_known_samples.mjs"
WAS_RUNNING=0
if docker ps --format '{{.Names}}' | grep -qx ${shQuote(container)}; then
  WAS_RUNNING=1
  docker stop ${shQuote(container)} >/dev/null
fi
restore_gateway() {
  if [ "$WAS_RUNNING" -eq 1 ]; then docker start ${shQuote(container)} >/dev/null; fi
}
trap restore_gateway EXIT INT TERM
docker run --rm --env-file ${shQuote(path.posix.join(gatewayDir, '.env'))} -v "$APP_DIR:/app:ro" -v ${shQuote(dataDir)}:/data -v ${shQuote(publicDir)}:/public-packages -w /app ${shQuote(image)} node tools/purge_known_samples.mjs --all-known${applyArgs}
restore_gateway
WAS_RUNNING=0
trap - EXIT INT TERM
if [ ${mode === 'apply' ? '1' : '0'} -eq 1 ]; then
  sleep 2
  curl -fsS ${shQuote(healthUrl)} >/dev/null
  printf 'health=ok\n'
fi
`;
}

async function main() {
  if (purgeKnownSamplesMode) {
    const result = await runSshScript(remotePurgeKnownSamplesScript(purgeKnownSamplesMode));
    if (result.stderr.trim()) console.error(result.stderr.trim());
    console.log(result.stdout.trim());
    if (result.code) process.exitCode = result.code;
    return;
  }
  if (remoteCheckOnly) {
    const result = await runSshScript(`set -eu\ndocker exec ${shQuote(container)} sh -lc 'cd /app && npm run self-check'\n`);
    if (result.stderr.trim()) console.error(result.stderr.trim());
    console.log(result.stdout.trim());
    if (result.code) process.exitCode = result.code;
    return;
  }
  if (inspectOnly) {
    if (shouldBuildRelease) await runCommand(process.execPath, [buildReleaseScript], 'gateway release build');
    const releaseFiles = collectReleaseFiles(localGatewayDir);
    assertReleasePayload(releaseFiles, localGatewayDir);
    console.log(JSON.stringify({ localGatewayDir, files: releaseFiles }, null, 2));
    return;
  }
  let appDir = gatewayDir;
  if (skipScp) {
    console.log('[scp] 跳过代码同步（--no-scp），仅更新 .env 并重建容器');
  } else {
    if (shouldBuildRelease) await runCommand(process.execPath, [buildReleaseScript], 'gateway release build');
    const releaseFiles = collectReleaseFiles(localGatewayDir);
    assertReleasePayload(releaseFiles, localGatewayDir);
    appDir = await syncCode(releaseFiles);
  }
  const script = remoteScript(appDir, skipScp);
  const result = await runSshScript(script);
  if (result.stderr.trim()) console.error(result.stderr.trim());
  console.log(result.stdout.trim());
  if (result.code) process.exitCode = result.code;
}

function collectReleaseFiles(root, relativeDir = '') {
  const absoluteDir = path.join(root, relativeDir);
  const files = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...collectReleaseFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath.split(path.sep).join('/'));
  }
  return files.sort();
}

function assertReleasePayload(files, root) {
  for (const required of ['server.js', 'package.json', 'shared/workshop-package-contract.js']) {
    if (!files.includes(required)) throw new Error('gateway release 缺少必需文件: ' + required);
  }
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (packageJson.type !== 'module') throw new Error('gateway release package.json 必须声明 type=module');
  const contract = readFileSync(path.join(root, 'shared', 'workshop-package-contract.js'), 'utf8');
  if (/from\s+['"]\.\.\/\.\.\/shared\//.test(contract)) {
    throw new Error('gateway release shared contract 不是自包含文件');
  }
}

async function syncCode(releaseFiles) {
  const releaseId = `release-${Date.now()}-${process.pid}`;
  const remoteReleaseDir = path.posix.join(gatewayDir, '.releases', releaseId);
  console.log('[scp] 同步完整 dist-gateway → ' + sshTarget + ':' + remoteReleaseDir);
  const remoteDirs = [...new Set(releaseFiles.map(name => path.posix.dirname(name)).filter(name => name !== '.'))];
  const prepare = await runSshScript(`set -eu\nmkdir -p ${[remoteReleaseDir, ...remoteDirs.map(name => path.posix.join(remoteReleaseDir, name))].map(shQuote).join(' ')}\n`);
  if (prepare.code) throw new Error('远程目录准备失败(code ' + prepare.code + '): ' + prepare.stderr.trim());
  for (const name of releaseFiles) {
    await runScp([path.join(localGatewayDir, ...name.split('/'))], path.posix.join(remoteReleaseDir, name));
  }
  const ready = await runSshScript(`set -eu\ntest -f ${shQuote(path.posix.join(remoteReleaseDir, 'server.js'))}\ntest -f ${shQuote(path.posix.join(remoteReleaseDir, 'shared/workshop-package-contract.js'))}\n: > ${shQuote(path.posix.join(remoteReleaseDir, '.ready'))}\n`);
  if (ready.code) throw new Error('远程 release 校验失败(code ' + ready.code + '): ' + ready.stderr.trim());
  console.log('[scp] 代码同步完成（files: ' + releaseFiles.length + '）');
  return remoteReleaseDir;
}

function runCommand(command, commandArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(label + ' 失败(code ' + code + ')')) : resolve());
  });
}

function runScp(scpArgs, remoteDest) {
  return new Promise((resolve, reject) => {
    const child = spawn('scp', [...sshOptions(), ...scpArgs, sshTarget + ':' + remoteDest], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code) reject(new Error('scp 失败(code ' + code + '): ' + stderr.trim()));
      else resolve();
    });
  });
}

main().catch(error => {
  console.error(error.stderr || error.message || String(error));
  process.exitCode = 1;
}).finally(cleanupTemporaryIdentity);

function runSshScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...sshOptions(), sshTarget, 'sh -s'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('remote deployment timed out'));
    }, 120000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(script);
  });
}
