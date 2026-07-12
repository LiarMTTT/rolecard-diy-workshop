import fs from 'node:fs/promises';
import path from 'node:path';

const env = process.env;
const PACKAGE_STORE_DIR = path.resolve(env.PACKAGE_STORE_DIR || './data/packages');
const INDEX_FILE = path.resolve(env.INDEX_FILE || './data/index.json');
const PUBLIC_PACKAGE_DIR = env.PUBLIC_PACKAGE_DIR ? path.resolve(env.PUBLIC_PACKAGE_DIR) : '';
const CHARACTER_ASSET_STORE_DIR = path.resolve(env.CHARACTER_ASSET_STORE_DIR || path.join(path.dirname(PACKAGE_STORE_DIR), 'character-assets'));
const PUBLIC_ASSET_DIR = path.resolve(env.PUBLIC_ASSET_DIR || (PUBLIC_PACKAGE_DIR ? path.join(PUBLIC_PACKAGE_DIR, 'assets') : './data/public/assets'));
const AUDIT_LOG_FILE = path.resolve(env.AUDIT_LOG_FILE || './data/audit-log.jsonl');
const VOTES_FILE = path.resolve(env.VOTES_FILE || './data/votes.json');
const CHARACTER_UPLOAD_DIR = path.resolve(env.CHARACTER_UPLOAD_DIR || path.join(path.dirname(PACKAGE_STORE_DIR), 'character-uploads'));

const KNOWN_SAMPLE_IDS = Object.freeze([
  'sample-transfer-identity',
  'sample-club-senior',
  'sample-night-curfew',
  'sample-lilith-ticket',
  'sample-watch-shell-blueprint',
  'sample-energy-gel-recipe',
  'sample-campus-rumor-skill',
  'sample-roster-function',
]);
const known = new Set(KNOWN_SAMPLE_IDS);

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const gatewayStopped = argv.includes('--gateway-stopped');
  const allKnown = argv.includes('--all-known');
  const idArg = argv.find(value => value.startsWith('--ids='));
  const ids = allKnown
    ? [...KNOWN_SAMPLE_IDS]
    : String(idArg || '').slice('--ids='.length).split(',').map(value => value.trim()).filter(Boolean);
  if (!ids.length) throw new Error('usage: node tools/purge_known_samples.mjs (--all-known | --ids=id1,id2) [--apply --gateway-stopped]');
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) throw new Error(`refusing unknown package ids: ${unknown.join(', ')}`);
  if (apply && !gatewayStopped) throw new Error('refusing live mutation: stop Gateway and pass --gateway-stopped');
  return { apply, gatewayStopped, ids:[...new Set(ids)] };
}

function exactJsonPath(baseDir, id) {
  const target = path.resolve(baseDir, `${id}.json`);
  if (path.dirname(target) !== path.resolve(baseDir)) throw new Error(`unsafe package path: ${id}`);
  return target;
}

function exactChildDir(baseDir, id) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, id);
  if (target === base || path.dirname(target) !== base) throw new Error(`unsafe asset path: ${id}`);
  return target;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

const { apply, ids } = parseArgs(process.argv.slice(2));
const index = await readJson(INDEX_FILE, { generatedAt:null, packages:[] });
const votes = await readJson(VOTES_FILE, { votes:{}, updatedAt:'' });
const indexedIds = new Set((Array.isArray(index.packages) ? index.packages : []).map(item => String(item?.id || '')));
const report = [];
const stagedUploads = [];

for (const name of await fs.readdir(CHARACTER_UPLOAD_DIR).catch(() => [])) {
  if (!/^xyu_[A-Za-z0-9_-]{24,120}$/.test(name)) continue;
  const record = await readJson(path.join(CHARACTER_UPLOAD_DIR, name, 'upload.json'), null);
  if (record && ids.includes(String(record.package?.id || ''))) stagedUploads.push(name);
}

for (const id of ids) {
  const packageFile = exactJsonPath(PACKAGE_STORE_DIR, id);
  const stored = await readJson(packageFile, null);
  if (stored && String(stored.id || '') !== id) throw new Error(`stored package id mismatch for ${id}`);
  report.push({ id, stored:Boolean(stored), indexed:indexedIds.has(id) });
}

console.log(JSON.stringify({ mode:apply ? 'apply' : 'preview', packages:report, stagedUploads:stagedUploads.length }, null, 2));
if (!apply) process.exit(0);

await fs.mkdir(path.dirname(INDEX_FILE), { recursive:true });
await fs.mkdir(path.dirname(AUDIT_LOG_FILE), { recursive:true });
for (const { id } of report) {
  await fs.rm(exactJsonPath(PACKAGE_STORE_DIR, id), { force:true });
  if (PUBLIC_PACKAGE_DIR) await fs.rm(exactJsonPath(PUBLIC_PACKAGE_DIR, id), { force:true });
  await fs.rm(exactChildDir(CHARACTER_ASSET_STORE_DIR, id), { recursive:true, force:true });
  await fs.rm(exactChildDir(PUBLIC_ASSET_DIR, id), { recursive:true, force:true });
}
for (const uploadId of stagedUploads) await fs.rm(exactChildDir(CHARACTER_UPLOAD_DIR, uploadId), { recursive:true, force:true });

const removed = new Set(ids);
const nextIndex = {
  ...index,
  generatedAt:new Date().toISOString(),
  packages:(Array.isArray(index.packages) ? index.packages : []).filter(item => !removed.has(String(item?.id || ''))),
};
const indexTmp = `${INDEX_FILE}.${process.pid}.tmp`;
await fs.writeFile(indexTmp, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8');
await fs.rename(indexTmp, INDEX_FILE);

const nextVotes = { ...votes, votes:{ ...(votes.votes || {}) }, updatedAt:new Date().toISOString() };
for (const id of ids) delete nextVotes.votes[id];
const votesTmp = `${VOTES_FILE}.${process.pid}.tmp`;
await fs.mkdir(path.dirname(VOTES_FILE), { recursive:true });
await fs.writeFile(votesTmp, `${JSON.stringify(nextVotes, null, 2)}\n`, 'utf8');
await fs.rename(votesTmp, VOTES_FILE);

const deletedAt = new Date().toISOString();
const auditLines = ids.map(packageId => JSON.stringify({
  at:deletedAt,
  action:'maintenance.sample-purged',
  packageId,
})).join('\n');
await fs.appendFile(AUDIT_LOG_FILE, `${auditLines}\n`, 'utf8');
console.log(JSON.stringify({ ok:true, removed:ids, auditAction:'maintenance.sample-purged' }, null, 2));
