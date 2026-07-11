#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const sshTarget = args.ssh || process.env.WORKSHOP_SSH || 'rolecard-workshop-vps';
const gatewayDir = args.gatewayDir || '/opt/rolecard-diy-workshop/gateway';
const localGatewayDir = args.localGateway || fileURLToPath(new URL('../dist-gateway/', import.meta.url));
const buildReleaseScript = fileURLToPath(new URL('../gateway/tools/build_release.mjs', import.meta.url));
const shouldBuildRelease = !args.localGateway;
const inspectOnly = args.inspect === 'true';
const skipScp = args['no-scp'] === 'true' || process.env.WORKSHOP_NO_SCP === '1';
const container = args.container || 'rolecard-workshop-gateway';
const image = args.image || 'node:20-alpine';
const port = args.port || '8787';
const dataDir = args.dataDir || '/var/lib/rolecard-diy-workshop';
const publicDir = args.publicDir || '/usr/local/lighthouse/softwares/cloudreve/workshop-public/xingyue';
const healthUrl = args.healthUrl || 'https://43-132-171-157.sslip.io/api/workshop/health';
const corsOrigins = collectOrigins(args);

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

function collectOrigins(parsed) {
  const values = [];
  if (parsed.corsOrigin) values.push(...String(parsed.corsOrigin).split(','));
  if (process.env.WORKSHOP_CORS_ORIGINS) values.push(...String(process.env.WORKSHOP_CORS_ORIGINS).split(','));
  values.push(
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'http://127.0.0.1:8766',
    'http://localhost:8766',
  );
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
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
CORS=$(grep '^CORS_ORIGIN=' .env | cut -d= -f2- | tr -d '\\r' || true)
for ORIGIN in ${corsOrigins.map(shQuote).join(' ')}; do
  ORIGIN=$(printf '%s' "$ORIGIN" | tr -d '\\r')
  case ",$CORS," in
    *",$ORIGIN,"*) ;;
    *) CORS="$CORS,$ORIGIN" ;;
  esac
done
CORS=$(printf '%s' "$CORS" | tr ',' '\\n' | tr -d '\\r' | awk 'NF && !seen[$0]++' | paste -sd, -)
TMP=$(mktemp)
awk -v cors="$CORS" 'BEGIN{done=0} /^CORS_ORIGIN=/{print "CORS_ORIGIN=" cors; done=1; next} {print} END{if(!done) print "CORS_ORIGIN=" cors}' .env > "$TMP"
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

async function main() {
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
  if (result.code) process.exit(result.code);
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
    const child = spawn('scp', [...scpArgs, sshTarget + ':' + remoteDest], { windowsHide: true });
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
  process.exit(1);
});

function runSshScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [sshTarget, 'sh -s'], { windowsHide: true });
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
