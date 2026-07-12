#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const packageStoreDir = process.env.PACKAGE_STORE_DIR || './data/packages';
const publicPackageDir = process.env.PUBLIC_PACKAGE_DIR || './data/public/packages';
const reportFile = process.env.PUBLIC_SYNC_REPORT_FILE || './data/public-sync-report.json';
const characterAssetStoreDir = process.env.CHARACTER_ASSET_STORE_DIR || path.join(path.dirname(packageStoreDir), 'character-assets');
const publicAssetDir = process.env.PUBLIC_ASSET_DIR || path.join(publicPackageDir, 'assets');

await fs.mkdir(publicPackageDir, { recursive: true });
await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.mkdir(publicAssetDir, { recursive:true });

const stored = await readPackages(packageStoreDir);
const approved = stored.filter(pkg => (pkg.reviewStatus || 'pending') === 'approved' && !pkg.withdrawnAt);
const approvedIds = new Set(approved.map(pkg => pkg.id));
const copied = [];
const removed = [];
const copiedAssets = [];
const removedAssets = [];

for (const pkg of approved) {
  if (!pkg.assetBundle?.uploadId) continue;
  const id = assertPackageId(pkg.id);
  const uploadId = assertUploadId(pkg.assetBundle.uploadId);
  const source = safeChildPath(safeChildPath(characterAssetStoreDir, id), uploadId);
  const target = safeChildPath(publicAssetDir, id);
  const nonce = crypto.randomBytes(8).toString('hex');
  const staging = `${target}.staging-${nonce}`;
  const backup = `${target}.backup-${nonce}`;
  await fs.mkdir(staging, { recursive:true });
  for (const item of Object.values(pkg.assetBundle.files || {})) {
    const filename = assertAssetFilename(item?.filename);
    await fs.copyFile(path.join(source, filename), path.join(staging, filename));
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
  copiedAssets.push(id);
}

for (const name of await fs.readdir(publicAssetDir).catch(() => [])) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(name) || approvedIds.has(name)) continue;
  await fs.rm(safeChildPath(publicAssetDir, name), { recursive:true, force:true });
  removedAssets.push(name);
}

for (const pkg of approved) {
  const target = path.join(publicPackageDir, `${assertPackageId(pkg.id)}.json`);
  const publicPkg = { ...pkg };
  delete publicPkg.ownerPublisherId;
  delete publicPkg.assetBundle;
  await atomicWriteFile(target, `${JSON.stringify(publicPkg, null, 2)}\n`);
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
  copiedAssets,
  removedAssets,
};

await atomicWriteFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
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

function assertUploadId(value) {
  const id = String(value || '').trim();
  if (!/^xyu_[A-Za-z0-9_-]{24,120}$/.test(id)) throw new Error(`invalid upload id: ${value}`);
  return id;
}

function assertAssetFilename(value) {
  const filename = String(value || '');
  if (!/^(?:avatar|portrait-normal|portrait-nude)-[a-f0-9]{16}\.(?:png|jpg|webp)$/.test(filename)) throw new Error(`invalid asset filename: ${value}`);
  return filename;
}

function safeChildPath(baseDir, child) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, String(child || ''));
  if (target === base || !target.startsWith(`${base}${path.sep}`)) throw new Error('invalid storage path');
  return target;
}

async function atomicWriteFile(target, content) {
  await fs.mkdir(path.dirname(target), { recursive:true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, target);
}
