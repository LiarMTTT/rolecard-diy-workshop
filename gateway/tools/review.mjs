#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args.baseUrl || process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const token = String(args.token || process.env.ADMIN_TOKEN || '');

if (!token) fail('ADMIN_TOKEN is required');

if (args.help || !args.action) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

if (args.action === 'list') {
  const status = args.status || 'pending';
  const body = await request(`/api/admin/review/packages?status=${encodeURIComponent(status)}`);
  printJson(body);
} else if (args.action === 'approve' || args.action === 'reject') {
  if (!args.id) fail('--id is required');
  const status = args.action === 'approve' ? 'approved' : 'rejected';
  const body = await request(`/api/admin/review/packages/${encodeURIComponent(args.id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, reason: args.reason || '' }),
  });
  printJson(body);
} else {
  fail(`Unknown action: ${args.action}`);
}

async function request(path, options = {}) {
  const res = await fetch(baseUrl + path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) fail(`${res.status} ${res.statusText}: ${text}`);
  return body;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--help' || item === '-h') out.help = true;
    else if (item === '--base-url') out.baseUrl = argv[++i];
    else if (item === '--token') out.token = argv[++i];
    else if (item === '--status') out.status = argv[++i];
    else if (item === '--id') out.id = argv[++i];
    else if (item === '--reason') out.reason = argv[++i];
    else if (!out.action) out.action = item;
    else fail(`Unknown argument: ${item}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node tools/review.mjs list [--status pending|approved|rejected|withdrawn|all]
  node tools/review.mjs approve --id <packageId>
  node tools/review.mjs reject --id <packageId> [--reason <text>]

Options:
  --base-url <url>  Gateway URL. Defaults to PUBLIC_BASE_URL or http://127.0.0.1:8787
  --token <token>   Admin token. Defaults to ADMIN_TOKEN
`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
