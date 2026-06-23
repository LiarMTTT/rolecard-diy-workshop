#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const origins = [
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
];

async function run(name, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(name, args, {
      windowsHide: true,
      timeout: options.timeout || 120000,
      ...options,
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

console.log('[p1] rolecard workshop external chain check');
const adminToken = process.env.ADMIN_TOKEN || await readLocalAdminToken();
const local = await run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', 'run', 'check'] : ['run', 'check']);
console.log(local.stdout);
if (!local.ok) {
  console.error(local.stderr || local.stdout);
  process.exit(1);
}

const takeover = await run('node', [
  'tools/ops_takeover.mjs',
  '--corsOrigin',
  origins.join(','),
  '--ssh',
  'rolecard-workshop-vps',
], {
  timeout: 180000,
  env: adminToken ? { ...process.env, ADMIN_TOKEN: adminToken } : process.env,
});
console.log(takeover.stdout);
if (!takeover.ok) {
  console.error(takeover.stderr || takeover.stdout);
  process.exit(1);
}

console.log('\n[p1] external chain check passed');

async function readLocalAdminToken() {
  try {
    const raw = await fs.readFile('rolecard-workshop-secrets.secret.json', 'utf8');
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return String(data?.gateway?.adminToken || '');
  } catch {
    return '';
  }
}
