import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(path.join(gatewayRoot, 'public', 'admin.html'), 'utf8');

assert.match(html, /<html lang="zh-CN">/, 'admin page language');
assert.match(html, /创意工坊管理台/, 'admin page title');
assert.match(html, /\/api\/admin\/review\/packages/, 'ordinary review API');
assert.match(html, /\/api\/admin\/review\/component-workshop\/packages/, 'component review API');
assert.match(html, /authorization:\s*'Bearer '\s*\+\s*state\.token/, 'Bearer header');
assert.match(html, /x-package-revision/, 'component revision header');
assert.match(html, /showModal/, 'destructive action confirmation dialog');
assert.match(html, /role="status"/, 'announced status messages');
assert.match(html, /setAttribute\('role', kind === 'error' \? 'alert' : 'status'\)/, 'announced errors');
assert.match(html, /prefers-reduced-motion:\s*reduce/, 'reduced motion support');
assert.match(html, /min-height:\s*44px/, 'minimum control target size');
assert.match(html, /@media \(max-width: 680px\)/, 'mobile layout');
assert.match(html, /页面不会执行源码/, 'component source is treated as text');
assert.match(html, /URL\.createObjectURL/, 'review assets use authenticated blobs');
assert.match(html, /assetUrl\.origin !== window\.location\.origin/, 'review assets are restricted to same-origin');
assert.match(html, /pendingCounts/, 'overview pending counts are independent from queue filters');
assert.match(html, /pagehide/, 'authenticated media cleanup');

assert.doesNotMatch(html, /\blocalStorage\.(?:getItem|setItem|removeItem)/, 'no localStorage calls');
assert.match(html, /sessionStorage\.getItem/, 'restore token for the current tab');
assert.match(html, /sessionStorage\.setItem/, 'persist token only for the current tab');
assert.match(html, /sessionStorage\.removeItem/, 'clear current-tab token explicitly');
assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, 'no external script dependency');
assert.doesNotMatch(html, /@import\s+url/i, 'no external font or stylesheet dependency');
assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handlers');

const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
assert.equal(scripts.length, 1, 'exactly one inline script');
assert.doesNotThrow(() => new Function(scripts[0]), 'inline script parses');

console.log('admin page contract: passed');
