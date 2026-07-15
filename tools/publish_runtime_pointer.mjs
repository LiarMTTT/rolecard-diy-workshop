#!/usr/bin/env node
// 指针发版工具（r54 指针跟随架构配套）：把当前 HEAD 写入 runtime manifest 的 pinnedCommit，
// push 指针 commit，purge jsDelivr @main 指针缓存并验证生效（含重试）。
//
// 用法（在 runtime 代码改动已 commit+push、HEAD 即目标版本时执行）：
//   node tools/publish_runtime_pointer.mjs [--scope xingyue] [--version 3.5.0]
//
// ⚠️ 时序坑（2026-07-16 实测）：push 后 GitHub 内容同步需要数秒~数十秒，过早 purge 会让
//   jsDelivr 回源抓到旧内容并重新缓存——本脚本固定等待 20s 后 purge，并以"读回指针==HEAD"为准重试。
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const scope = getArg('--scope', 'xingyue');
const version = getArg('--version', '3.5.0');
const REPO = 'LiarMTTT/rolecard-diy-workshop';
const manifestPath = `runtime/${scope}/${version}/manifest.json`;

const dirty = execSync('git status --porcelain -- ' + manifestPath.split('/')[0]).toString().trim();
const head = execSync('git rev-parse HEAD').toString().trim();
console.log(`目标 commit（当前 HEAD）: ${head.slice(0, 7)}`);
if (dirty && !dirty.split('\n').every(line => line.includes('manifest.json'))) {
  console.error('runtime 目录有未提交改动，先 commit+push 代码再发指针：\n' + dirty);
  process.exit(2);
}

const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (mf.pinnedCommit === head) {
  console.log('指针已指向 HEAD，跳过写入。');
} else {
  mf.pinnedCommit = head;
  fs.writeFileSync(manifestPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');
  execSync(`git add "${manifestPath}"`);
  execSync(`git commit -q -m "${scope} ${version}: 指针 -> ${head.slice(0, 7)}"`);
  execSync('git push -q origin main');
  console.log('指针 commit 已 push。');
}

const pointerUrl = `https://cdn.jsdelivr.net/gh/${REPO}@main/${manifestPath}`;
const pointerUrlCf = `https://testingcf.jsdelivr.net/gh/${REPO}@main/${manifestPath}`;
const purgeUrl = `https://purge.jsdelivr.net/gh/${REPO}@main/${manifestPath}`;

console.log('等待 20s（GitHub 内容同步窗口）…');
await new Promise(r => setTimeout(r, 20000));

let ok = false;
for (let attempt = 1; attempt <= 6; attempt++) {
  try { await fetch(purgeUrl); } catch (_) {}
  await new Promise(r => setTimeout(r, 6000));
  try {
    const j = await (await fetch(pointerUrl, { cache: 'no-store' })).json();
    if (j.pinnedCommit === head) { console.log(`✅ cdn 指针已生效（第 ${attempt} 次）`); ok = true; break; }
    console.log(`第 ${attempt} 次：cdn 仍为 ${String(j.pinnedCommit || '').slice(0, 7)}，重试 purge…`);
  } catch (error) { console.log(`第 ${attempt} 次读回失败：${error.message}`); }
}
if (!ok) { console.error('❌ cdn 指针未在重试窗口内生效，请手动排查。'); process.exit(1); }

try {
  const j = await (await fetch(pointerUrlCf, { cache: 'no-store' })).json();
  console.log(j.pinnedCommit === head ? '✅ testingcf 指针已生效' : `ℹ️ testingcf 仍为 ${String(j.pinnedCommit || '').slice(0, 7)}（备源，最长 12h 自然过期，不阻塞；loader 首源 cdn 已新）`);
} catch (_) { console.log('ℹ️ testingcf 读取失败（备源，不阻塞）'); }
console.log('发版完成：push 即热修，玩家端约 1 分钟内生效。');
