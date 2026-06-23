#!/usr/bin/env node

import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const sshTarget = args.ssh || process.env.WORKSHOP_SSH || 'rolecard-workshop-vps';
const gatewayDir = args.gatewayDir || '/opt/rolecard-diy-workshop/gateway';
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

function remoteScript() {
  return `
set -eu
cd ${shQuote(gatewayDir)}
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
if ! docker run -d --name "$OLD_NAME" --restart unless-stopped --env-file ${shQuote(gatewayDir)}/.env -p ${port}:8787 -v ${shQuote(gatewayDir)}:/app:ro -v ${shQuote(dataDir)}:/data -v ${shQuote(publicDir)}:/public-packages -w /app ${shQuote(image)} node server.js >/tmp/rolecard-workshop-new-container.txt; then
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
  const script = remoteScript();
  const result = await runSshScript(script);
  if (result.stderr.trim()) console.error(result.stderr.trim());
  console.log(result.stdout.trim());
  if (result.code) process.exit(result.code);
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
