#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const packageStoreDir = process.env.PACKAGE_STORE_DIR || './data/packages';
const publicPackageDir = process.env.PUBLIC_PACKAGE_DIR || './data/public/packages';
const reportFile = process.env.PUBLIC_SYNC_REPORT_FILE || './data/public-sync-report.json';

await fs.mkdir(publicPackageDir, { recursive: true });
await fs.mkdir(path.dirname(reportFile), { recursive: true });

const stored = await readPackages(packageStoreDir);
const approved = stored.filter(pkg => (pkg.reviewStatus || 'pending') === 'approved' && !pkg.withdrawnAt);
const approvedIds = new Set(approved.map(pkg => pkg.id));
const copied = [];
const removed = [];

for (const pkg of approved) {
  const target = path.join(publicPackageDir, `${assertPackageId(pkg.id)}.json`);
  const publicPkg = { ...pkg };
  delete publicPkg.ownerPublisherId;
  await fs.writeFile(target, `${JSON.stringify(publicPkg, null, 2)}\n`, 'utf8');
  copied.push(pkg.id);
}

for (const name of await fs.readdir(publicPackageDir).catch(() => [])) {
  if (!name.endsWith('.json')) continue;
  const id = name.slice(0, -5);
  if (!approvedIds.has(id)) {
    await fs.rm(path.join(publicPackageDir, name), { force: true });
    removed.push(id);
  }
}

const report = {
  syncedAt: new Date().toISOString(),
  packageStoreDir,
  publicPackageDir,
  approved: approved.length,
  copied,
  removed,
};

await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

async function readPackages(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  const packages = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (pkg && pkg.id) packages.push(pkg);
    } catch (error) {
      console.warn(`skip invalid package ${name}: ${error.message}`);
    }
  }
  return packages;
}

function assertPackageId(id) {
  const text = String(id || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(text)) throw new Error(`invalid package id: ${id}`);
  return text;
}
