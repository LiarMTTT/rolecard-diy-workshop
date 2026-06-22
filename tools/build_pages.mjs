import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-pages');
const entries = [
  'workshop-index.json',
  'README.md',
  'cards',
  'shared',
  'schemas',
  'examples',
  'runtime',
];

async function copyEntry(relativePath) {
  const source = path.join(root, relativePath);
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

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rolecard DIY Workshop</title>
  <style>
    body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #1f2937; background: #f8fafc; }
    main { width: min(860px, calc(100% - 32px)); margin: 48px auto; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    a { color: #0b63ce; }
    .panel { margin-top: 18px; padding: 18px; border: 1px solid #d7dde8; border-radius: 8px; background: #fff; }
    code { padding: 2px 5px; border-radius: 4px; background: #edf2f7; }
  </style>
</head>
<body>
  <main>
    <h1>Rolecard DIY Workshop</h1>
    <p>Static contracts, schemas, example packages, and fixed-version runtime manifests for role-card workshop content.</p>
    <section class="panel">
      <p><a href="./workshop-index.json">workshop-index.json</a></p>
      <p><a href="./cards/xingyue/index.json">cards/xingyue/index.json</a></p>
      <p><a href="./runtime/xingyue/2.9.0/manifest.json">runtime/xingyue/2.9.0/manifest.json</a></p>
      <p><a href="./schemas/workshop-package.schema.json">schemas/workshop-package.schema.json</a></p>
    </section>
    <p>Player workshop packages are JSON content packages. User-uploaded JavaScript is not accepted or executed.</p>
  </main>
</body>
</html>
`;
await fs.writeFile(path.join(outDir, 'index.html'), indexHtml, 'utf8');
console.log(`[ok] pages artifact built at ${outDir}`);
