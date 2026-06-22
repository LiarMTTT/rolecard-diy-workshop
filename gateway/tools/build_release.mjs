import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(gatewayRoot, '..');
const outDir = path.join(repoRoot, 'dist-gateway');
const entries = [
  'server.js',
  'package.json',
  'README.md',
  'DEPLOYMENT.md',
  '.env.example',
  '.env.production.example',
  'public',
  'tools/review.mjs',
  'tools/self_check.mjs',
  'tools/server_takeover.mjs',
  'tools/sync_public_packages.mjs',
];

async function copyEntry(relativePath) {
  const source = path.join(gatewayRoot, relativePath);
  const target = path.join(outDir, relativePath);
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, target, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
for (const entry of entries) await copyEntry(entry);
console.log(`[ok] gateway release built at ${outDir}`);
