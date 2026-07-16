/**
 * worldbook-manager-editor.js — 世界书完整编辑器 v0.2.0（P7 AI 与研究）
 * 只依赖注入的 manager / aiAssistant / baselineProvider / hostDocument；不自行探测 Tavern Helper。
 * AI 输出只形成可检查提案，必须手动应用到草稿并继续走原有 diff/保存事务。
 */
'use strict';

const WORLDBOOK_EDITOR_VERSION = '0.2.0';
const WORLDBOOK_EDITOR_BUILD = 'xingyue-p7-r1';
const MODES = Object.freeze(['single','compare','assist','ai']);
const POSITION_TYPES = Object.freeze([
  'before_character_definition','after_character_definition','before_example_messages','after_example_messages',
  'at_depth','before_author_note','after_author_note','outlet',
]);
const RUNTIME_EDITABLE_POSITION_TYPES = Object.freeze(POSITION_TYPES.filter(value => value !== 'outlet'));
const STRATEGY_TYPES = Object.freeze(['constant','selective','vectorized']);
const SECONDARY_LOGICS = Object.freeze(['and_any','and_all','not_all','not_any']);
const ROLES = Object.freeze(['system','user','assistant']);
const AI_TASKS = Object.freeze(['keywords','compress','draft']);
const AI_TASK_LABELS = Object.freeze({ keywords:'建议关键词', compress:'压缩正文', draft:'草拟条目' });
const AI_RESULT_FIELDS = Object.freeze({
  keywords:['strategyType','keys','secondaryKeys','secondaryLogic','scanDepth'],
  compress:['content'],
  draft:['content','strategyType','keys','secondaryKeys','secondaryLogic','scanDepth'],
});
const AI_OUTPUT_KEYS = Object.freeze({
  keywords:['strategyType','primaryKeywords','secondaryKeywords','filterLogic','scanDepth','note'],
  compress:['content','note'],
  draft:['content','strategyType','primaryKeywords','secondaryKeywords','filterLogic','scanDepth','note'],
});
const STRATEGY_LABELS = Object.freeze({ constant:'始终生效', selective:'按关键词生效', vectorized:'语义匹配' });
const SECONDARY_LOGIC_LABELS = Object.freeze({ and_any:'任一次级词', and_all:'全部次级词', not_all:'排除全部命中', not_any:'排除任一次级词' });
const POSITION_LABELS = Object.freeze({
  before_character_definition:'人物设定之前', after_character_definition:'人物设定之后',
  before_example_messages:'示例对话之前', after_example_messages:'示例对话之后',
  at_depth:'聊天记录指定位置', before_author_note:'作者注释之前', after_author_note:'作者注释之后', outlet:'手动插槽',
});
const ROLE_LABELS = Object.freeze({ system:'系统', user:'用户', assistant:'助手' });
const CATEGORY_LABELS = Object.freeze({ core:'核心', variable:'变量', user:'我的条目', workshop:'工坊来源' });
const RECOMMENDATION_PROFILE_LABELS = Object.freeze({
  runtime_state:'当前状态', command:'玩家命令', routing_rule:'规则说明',
  entity_profile:'人物档案', world_lore:'世界设定', generic:'普通条目',
});
const RECOMMENDATION_FIELDS = Object.freeze({
  strategyType:'触发方式', selective:'关键词触发开关', secondaryLogic:'次级条件', scanDepth:'扫描范围',
  positionType:'放置位置', role:'消息角色', depth:'聊天深度', order:'相对排序',
  'recursion.prevent_incoming':'阻止被其他条目连锁触发',
  'recursion.prevent_outgoing':'阻止继续触发其他条目',
  'recursion.delay_until':'递归延迟',
});
const RECOMMENDATION_PATCH_FIELDS = new Set(Object.keys(RECOMMENDATION_FIELDS));
const DIFF_FIELD_LABELS = Object.freeze({
  name:'条目名称', enabled:'参与世界书', keys:'触发关键词', content:'正文', strategyType:'触发方式', selective:'关键词触发开关',
  secondaryKeys:'次级关键词', secondaryLogic:'次级条件', scanDepth:'扫描范围', positionType:'放置位置', role:'消息角色',
  depth:'聊天深度', order:'相对排序', probability:'触发概率', sticky:'持续消息数', cooldown:'冷却消息数', delay:'延迟消息数',
  'recursion.prevent_incoming':'阻止被其他条目连锁触发', 'recursion.prevent_outgoing':'阻止继续触发其他条目', 'recursion.delay_until':'递归延迟',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}
function clone(value) {
  if (typeof structuredClone === 'function') { try { return structuredClone(value); } catch (_) {} }
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') { const out = {}; Object.keys(value).forEach(key => { out[key] = clone(value[key]); }); return out; }
  return value;
}
function parseList(value) { return String(value || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean); }
function formatList(value) { return Array.isArray(value) ? value.join('，') : ''; }
function asNullableNumber(value) { const text = String(value ?? '').trim(); return text === '' ? null : Number(text); }
function numberAttributeValue(value) { return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''; }
function protectedConfirmationAccepted(plan, ack) { return !plan?.requiresProtectedConfirmation || String(ack || '').trim() === '确认修改核心'; }
function sameDraft(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; } }
const EDITOR_MERGE_PATHS = Object.freeze([
  'name','enabled','keys','content','strategyType','selective','secondaryKeys','secondaryLogic','scanDepth',
  'positionType','role','depth','order','probability','sticky','cooldown','delay',
  'recursion.prevent_incoming','recursion.prevent_outgoing','recursion.delay_until',
]);
function categoryForEntry(entry, categoryByUid = new Map()) {
  const baseline = categoryByUid.get(entry?.uid);
  if (baseline === 'core' || baseline === 'variable') return baseline;
  if (entry?.meta?.kind === 'workshop_package') return 'workshop';
  return 'user';
}
function filterWorldbookEntries(entries, filters = {}, categoryByUid = new Map()) {
  const query = String(filters.query || '').trim().toLocaleLowerCase();
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    const category = categoryForEntry(entry, categoryByUid);
    if (filters.category && filters.category !== 'all' && category !== filters.category) return false;
    if (filters.status === 'enabled' && entry.enabled !== true) return false;
    if (filters.status === 'disabled' && entry.enabled !== false) return false;
    if (filters.status === 'programOnly' && entry?.meta?.programOnly !== true) return false;
    if (filters.strategy && filters.strategy !== 'all' && entry.strategyType !== filters.strategy) return false;
    if (!query) return true;
    const haystack = [entry.name, entry.content, ...(entry.keys || []), ...(entry.secondaryKeys || [])].join('\n').toLocaleLowerCase();
    return haystack.includes(query);
  });
}
function formatDiff(diff) {
  const rows = [];
  for (const item of diff?.added || []) rows.push({ kind:'新增', path:'/', name:item.name || `UID ${item.uid}` });
  for (const item of diff?.updated || []) for (const change of item.changes || []) {
    const row = { kind:'更新', path:change.path, name:item.name || item.nameAfter || item.nameBefore || `UID ${item.uid}` };
    if (Object.hasOwn(change,'before')) row.before = clone(change.before);
    if (Object.hasOwn(change,'after')) row.after = clone(change.after);
    rows.push(row);
  }
  for (const item of diff?.deleted || []) rows.push({ kind:'删除', path:'/', name:item.name || `UID ${item.uid}` });
  return rows;
}
function diffFieldKey(path) {
  const keys = String(path || '').split('/').slice(1).map(key => key.replace(/~1/g,'/').replace(/~0/g,'~'));
  const joined = keys.join('.');
  if (DIFF_FIELD_LABELS[joined]) return joined;
  return keys.at(-1) || joined || '/';
}
function friendlyDiffValue(path, value) {
  const key = diffFieldKey(path);
  if (Object.hasOwn(RECOMMENDATION_FIELDS,key)) return recommendationFriendlyValue(key,value);
  if (key === 'enabled') return value === true ? '参与' : value === false ? '停用' : '未设置';
  if (Array.isArray(value)) return value.length ? value.map(String).join('，') : '空';
  if (value === undefined) return '未设置';
  if (value === null || value === '') return '空';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pathValue(owner, path) {
  return String(path || '').split('.').reduce((value, key) => value == null ? undefined : value[key], owner);
}
function setPathValue(owner, path, value) {
  const keys = String(path || '').split('.');
  let target = owner;
  keys.slice(0,-1).forEach(key => {
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  });
  target[keys.at(-1)] = clone(value);
}
function hasOwnPath(owner, path) {
  const keys = String(path || '').split('.');
  let target = owner;
  for (const key of keys) {
    if (target == null || !Object.hasOwn(target,key)) return false;
    target = target[key];
  }
  return true;
}
function deletePathValue(owner, path, baseline) {
  const keys = String(path || '').split('.');
  let target = owner;
  const chain = [owner];
  for (const key of keys.slice(0,-1)) {
    if (!target || typeof target !== 'object' || !Object.hasOwn(target,key)) return;
    target = target[key]; chain.push(target);
  }
  if (!target || typeof target !== 'object') return;
  delete target[keys.at(-1)];
  for (let index = keys.length - 1; index > 0; index -= 1) {
    const child = chain[index];
    const parentPath = keys.slice(0,index).join('.');
    if (!child || typeof child !== 'object' || Object.keys(child).length || hasOwnPath(baseline,parentPath)) break;
    delete chain[index - 1][keys[index - 1]];
  }
}
function sameValue(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; } }
function threeWayMergeEntry(base, local, latest) {
  const merged = clone(latest || {});
  const conflicts = [];
  for (const path of EDITOR_MERGE_PATHS) {
    const baseHas = hasOwnPath(base || {}, path);
    const localHas = hasOwnPath(local || {}, path);
    const latestHas = hasOwnPath(latest || {}, path);
    const baseValue = pathValue(base, path);
    const localValue = pathValue(local, path);
    const latestValue = pathValue(latest, path);
    const localChanged = baseHas !== localHas || !sameValue(baseValue, localValue);
    if (!localChanged) continue;
    const remoteChanged = baseHas !== latestHas || !sameValue(baseValue, latestValue);
    if (remoteChanged && (localHas !== latestHas || !sameValue(localValue, latestValue))) {
      conflicts.push({ path, base:clone(baseValue), local:clone(localValue), latest:clone(latestValue), localHas, latestHas });
      continue;
    }
    if (localHas) setPathValue(merged, path, localValue);
    else deletePathValue(merged, path, latest || {});
  }
  return { merged, conflicts };
}
function validOrder(value) { return Number.isInteger(value) && value >= 0; }
function validDepth(value) { return Number.isInteger(value) && value >= 0; }
function classifyRecommendationProfile(entry) {
  const name = String(entry?.name || '');
  const content = String(entry?.content || '');
  const keys = Array.isArray(entry?.keys) ? entry.keys.map(String) : [];
  if (/^\s*\[(?:mvu_update|mvu_plot|initvar)\]/i.test(name)) return 'routing_rule';
  if (/当前变量|读取变量|当前状态/.test(name) || /get_message_variable|stat_data/.test(content)) return 'runtime_state';
  if (keys.length && keys.every(key => /^《[^》]{1,40}》$/.test(key.trim()))) return 'command';
  if (/规则|协议|输出格式|系统指引|文风|演绎|选择栏|守卫/.test(name)) return 'routing_rule';
  if (/[：:][^：:]{2,12}$/.test(name) && /姓名|年龄|性格|外貌|身份|关系/.test(content)) return 'entity_profile';
  if (/世界|学园|学院|大学|地点|区域|建筑|组织|社团/.test(name)) return 'world_lore';
  return 'generic';
}
function recommendationFriendlyValue(path, value) {
  if (path === 'strategyType') return STRATEGY_LABELS[value] || String(value ?? '');
  if (path === 'secondaryLogic') return SECONDARY_LOGIC_LABELS[value] || String(value ?? '');
  if (path === 'positionType') return POSITION_LABELS[value] || String(value ?? '');
  if (path === 'role') return ROLE_LABELS[value] || String(value ?? '');
  if (path === 'recursion.prevent_incoming' || path === 'recursion.prevent_outgoing') return value === true ? '是' : value === false ? '否' : '未设置';
  if (path === 'recursion.delay_until') return value === undefined ? '未设置' : value === null ? '不延迟' : String(value);
  if (value === 'same_as_global') return '跟随酒馆全局设置';
  return value == null || value === '' ? '未设置' : String(value);
}
function recommendWorldbookSettings(entry, context = {}) {
  const source = clone(entry || {});
  const category = String(context.category || 'user');
  const allEntries = Array.isArray(context.entries) ? context.entries : [];
  const result = { available:true, profile:classifyRecommendationProfile(source), confidence:'medium', patch:{}, decisions:[], suggestions:[], warnings:[], blockers:[] };
  if (source?.meta?.programOnly === true) {
    result.available = false; result.confidence = 'blocked';
    result.blockers.push('仅供程序使用的来源记录不能智能改配置；如需普通条目，请先脱离为用户副本。');
    return result;
  }
  if (category === 'core' || category === 'variable') {
    result.available = false; result.confidence = 'protected';
    result.blockers.push('核心和变量条目由作者维护，不提供一键配置。仍可按 ST 原生字段手工调整，保存时需要额外确认。');
    return result;
  }
  const workshop = category === 'workshop' || source?.meta?.kind === 'workshop_package';
  if (workshop) result.warnings.push('这是工坊来源条目：脚本会保留正文和来源元数据，但可建议修正触发配置；保存后会由内核标记为本地修改。');
  const add = (path, value, reason) => {
    const before = pathValue(source, path);
    if (sameValue(before, value)) return;
    result.patch[path] = clone(value);
    result.decisions.push({ field:path, label:RECOMMENDATION_FIELDS[path] || path, before:clone(before), after:clone(value), reason });
  };
  const keys = Array.isArray(source.keys) ? source.keys.map(key => String(key).trim()).filter(Boolean) : [];
  const secondaryKeys = Array.isArray(source.secondaryKeys) ? source.secondaryKeys.filter(key => String(key).trim()) : [];
  if (source.strategyType === 'vectorized') {
    result.warnings.push('已启用语义匹配，离线脚本会保留它；实际效果取决于 ST 的向量扩展。');
  } else if (keys.length) {
    add('strategyType','selective','已有触发关键词，按提及时加载可避免每轮占用上下文。');
    add('selective',true,'关键词触发条目需要开启选择性匹配。');
  } else if (source.strategyType === 'constant') {
    result.suggestions.push('没有触发关键词，因此沿用“始终生效”；长正文会增加每轮 token 消耗。');
    if (String(source.content || '').length > 1200) result.warnings.push('正文较长且始终生效，建议补充触发关键词后再次智能配置。');
  } else {
    result.blockers.push('当前没有触发关键词。请先选择：始终生效，或填写玩家会在对话中提到的关键词。');
  }
  if (!SECONDARY_LOGICS.includes(source.secondaryLogic)) add('secondaryLogic','and_any','次级条件缺失时采用最保守的“任意一个命中”。');
  else if (!secondaryKeys.length && source.secondaryLogic !== 'and_any') add('secondaryLogic','and_any','没有次级关键词时复杂逻辑不会生效，归一为默认值。');
  else if (secondaryKeys.length && source.secondaryLogic !== 'and_any') result.suggestions.push('检测到作者设置的高级次级逻辑，脚本会保留，不自动简化。');
  if (!(source.scanDepth === 'same_as_global' || (Number.isInteger(source.scanDepth) && source.scanDepth >= 0))) {
    add('scanDepth','same_as_global','扫描范围缺失或非法，改为跟随酒馆全局设置。');
  }
  if (result.profile === 'command' && source.scanDepth === 'same_as_global') add('scanDepth',1,'完整命令关键词只需检查最近消息，减少误触发。');
  if (!workshop) {
    if (result.profile === 'runtime_state') {
      add('positionType','at_depth','当前变量/状态应靠近最新对话，减少旧状态覆盖。');
      add('role','system','运行状态以系统消息身份注入。');
      add('depth',0,'深度 0 最靠近最新消息。');
      if (!validOrder(source.order)) add('order',110,'沿用当前状态类条目的安全基线排序。');
      result.confidence = 'high';
    } else if (result.profile === 'entity_profile') {
      add('positionType','after_character_definition','人物档案放在人物设定之后，语义更连贯。');
      if (!validOrder(source.order)) add('order',100,'沿用人物档案类条目的常用排序。');
      result.confidence = 'high';
    } else if (result.profile === 'routing_rule') {
      add('positionType','before_character_definition','规则或世界设定放在人物定义之前，保持基础设定先行。');
      if (!validOrder(source.order)) add('order',100,'排序缺失时使用保守默认值。');
      result.confidence = 'high';
    } else if (result.profile === 'world_lore') {
      if (!POSITION_TYPES.includes(source.positionType)) add('positionType','before_character_definition','世界设定位置缺失时使用基础设定区。');
      if (!validOrder(source.order)) add('order',100,'排序缺失时使用保守默认值。');
      result.confidence = 'medium';
    } else if (!POSITION_TYPES.includes(source.positionType)) {
      add('positionType','after_character_definition','无法可靠分类时使用通用世界书位置。');
    }
  }
  if (!ROLES.includes(source.role)) add('role','system','世界书信息默认以系统消息身份注入。');
  if (!validDepth(source.depth)) add('depth',4,'深度缺失或非法时使用 ST 通用默认值 4。');
  if (!validOrder(source.order) && !Object.hasOwn(result.patch,'order')) add('order',100,'排序缺失或非法时使用保守默认值 100。');
  if (AN_POSITIONS_FOR_RECOMMENDATION.has(source.positionType)) result.warnings.push('当前位于作者注释区域；如果酒馆把作者注释频率设为 0，该条目会被静默跳过。');
  const recursion = source.recursion || {};
  const hasAdvancedRecursion = recursion.prevent_incoming === false || recursion.prevent_outgoing === false || recursion.delay_until != null;
  if (hasAdvancedRecursion) result.suggestions.push('检测到作者设计的递归链，脚本会完整保留，避免破坏高级联动。');
  else {
    add('recursion.prevent_incoming',true,'默认阻止其他条目连锁触发它，避免意外扩张。');
    add('recursion.prevent_outgoing',true,'默认阻止它继续触发其他条目，避免 token 越滚越多。');
    add('recursion.delay_until',null,'未设计递归链时不设置递归延迟。');
  }
  if (keys.some(key => /^\d+$/.test(key) || /^[A-Za-z0-9]{1,2}$/.test(key))) result.warnings.push('检测到纯数字或过短拉丁关键词，可能误匹配属性栏；脚本不会擅自删除，请手工确认。');
  if (keys.some(key => /[一-鿿぀-ヿ]/.test(key))) result.warnings.push('检测到中日韩关键词；全词匹配应关闭，但当前 Tavern Helper 运行期接口不暴露该字段，需在 ST 真机确认。');
  const peers = allEntries.filter(item => item?.uid !== source.uid && item?.positionType === (result.patch.positionType || source.positionType));
  if (validOrder(source.order) && peers.some(item => item.order === source.order)) result.suggestions.push('发现同位置同顺序条目；这是 ST 允许的。脚本不会重排整本世界书，可直接在“顺序”字段中细调。');
  return result;
}
const AN_POSITIONS_FOR_RECOMMENDATION = new Set(['before_author_note','after_author_note']);
function applyRecommendedSettings(entry, recommendation) {
  const next = clone(entry || {});
  if (!recommendation?.available) return next;
  Object.entries(recommendation.patch || {}).forEach(([path,value]) => {
    if (RECOMMENDATION_PATCH_FIELDS.has(path)) setPathValue(next,path,value);
  });
  return next;
}
function makeRecommendationUndo(before, after, recommendation) {
  return { before:clone(before), after:clone(after), fields:Object.keys(recommendation?.patch || {}).filter(path => RECOMMENDATION_PATCH_FIELDS.has(path)) };
}
function revertRecommendedSettings(current, undo) {
  const next = clone(current || {});
  for (const path of undo?.fields || []) {
    if (!RECOMMENDATION_PATCH_FIELDS.has(path) || !sameValue(pathValue(next,path),pathValue(undo.after,path))) continue;
    if (hasOwnPath(undo.before,path)) setPathValue(next,path,pathValue(undo.before,path));
    else deletePathValue(next,path,undo.before);
  }
  return next;
}
function summarizeWorldbookConfiguration(entry) {
  const strategy = STRATEGY_LABELS[entry?.strategyType] || '未识别触发方式';
  const position = POSITION_LABELS[entry?.positionType] || '未识别位置';
  const recursion = entry?.recursion?.prevent_incoming === true && entry?.recursion?.prevent_outgoing === true ? '已启用安全防连锁' : '沿用原有递归设置';
  return `${strategy} · ${position} · ${recursion}`;
}
function triggerKeywordHelp(entry) {
  if (entry?.strategyType === 'selective') return entry.keys?.length ? '对话中出现任一关键词时，条目会按配置参与世界书。' : '当前设置为按关键词生效；请填写至少一个玩家会提到的关键词。';
  if (entry?.strategyType === 'vectorized') return '当前使用语义匹配；关键词仅作匹配线索，实际效果需在 ST 真机确认。';
  if (entry?.keys?.length) return '当前仍是始终生效；这些关键词暂不控制触发。应用智能配置后才会改为按关键词生效。';
  return '当前始终生效；如希望只在提及时加载，请填写关键词后使用智能配置。';
}

function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function normalizeWorldbookAiSessionConfig(value = {}) {
  const source = value?.source === 'custom' ? 'custom' : 'current';
  return {
    source,
    apiurl:String(value?.apiurl || '').trim().slice(0,2048),
    key:String(value?.key || '').slice(0,4096),
    model:String(value?.model || '').trim().slice(0,200),
    rememberKey:value?.rememberKey === true,
    allowLocalHttp:value?.allowLocalHttp === true,
  };
}
function redactWorldbookAiSessionConfig(value = {}) {
  const config = normalizeWorldbookAiSessionConfig(value);
  return { source:config.source, apiurl:config.apiurl, model:config.model, rememberKey:config.rememberKey, allowLocalHttp:config.allowLocalHttp, hasKey:!!config.key };
}
function isLoopbackHostname(hostname) {
  const raw = String(hostname || '').toLowerCase();
  const host = (raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1,-1) : raw).replace(/\.$/,'');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const parts = host.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 127;
}
function isPrivateResearchHostname(hostname) {
  const raw = String(hostname || '').toLowerCase();
  const host = (raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1,-1) : raw).replace(/\.$/,'');
  if (!host || isLoopbackHostname(host) || host === '0.0.0.0' || host.endsWith('.local')) return true;
  if (host === '::' || host.startsWith('::') || /^(?:fc|fd|fe8|fe9|fea|feb|fec|fed|fee|fef|ff|2001:db8|2001:10|100:|64:ff9b:)/.test(host)) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || !parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  const [a,b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
function parseAbsoluteHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || text.startsWith('//')) throw new Error('请输入完整的 http:// 或 https:// 地址');
  let url;
  try { url = new URL(text); } catch (_) { throw new Error('地址格式无效，请输入完整 URL'); }
  if (!['http:','https:'].includes(url.protocol)) throw new Error('只允许 http:// 或 https:// 地址');
  if (url.username || url.password) throw new Error('地址中不能包含用户名或密码');
  return url;
}
function validateResearchUrl(value, options = {}) {
  const url = parseAbsoluteHttpUrl(value);
  if (isPrivateResearchHostname(url.hostname)) throw new Error('研究页不允许打开本机、局域网或保留地址');
  const blockedOrigin = String(options.blockedOrigin || '').replace(/\/$/,'');
  if (blockedOrigin && url.origin === blockedOrigin) throw new Error('研究页不能重新嵌入当前 SillyTavern 页面');
  return url.href;
}
function validateCustomApiUrl(value, options = {}) {
  const url = parseAbsoluteHttpUrl(value);
  if (url.search || url.hash) throw new Error('API 基础地址不能包含查询参数或片段');
  if (url.protocol === 'http:' && !(options.allowLocalHttp === true && isLoopbackHostname(url.hostname))) throw new Error('自定义 API 默认要求 HTTPS；本机 HTTP 需显式开启开发模式');
  return url.href.replace(/\/$/,'');
}
function normalizeKeywordArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}必须是字符串数组`);
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`${label}包含非字符串值`);
    const text = item.trim();
    if (!text || text.length > 60) throw new Error(`${label}包含空值或超长词条`);
    if (!result.includes(text)) result.push(text);
  }
  if (result.length > 12) throw new Error(`${label}最多 12 项`);
  return result;
}
function normalizeAiScanDepth(value) {
  if (value === 'same_as_global') return value;
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('扫描深度必须是 same_as_global 或 0–100 的整数');
  return value;
}
function buildWorldbookAiSchema(task) {
  if (!AI_TASKS.includes(task)) throw new Error('未知 AI 任务');
  const note = { type:'string', maxLength:600, description:'只写可检查的简短草拟说明，不输出隐藏思维链' };
  const keywords = {
    strategyType:{ type:'string', enum:['constant','selective','vectorized'] },
    primaryKeywords:{ type:'array', maxItems:12, items:{ type:'string', minLength:1, maxLength:60 } },
    secondaryKeywords:{ type:'array', maxItems:12, items:{ type:'string', minLength:1, maxLength:60 } },
    filterLogic:{ type:'string', enum:[...SECONDARY_LOGICS] },
    scanDepth:{ oneOf:[{ const:'same_as_global' },{ type:'integer', minimum:0, maximum:100 }] },
  };
  const properties = task === 'compress' ? { content:{ type:'string', minLength:1, maxLength:60000 }, note }
    : task === 'keywords' ? { ...keywords, note }
    : { content:{ type:'string', minLength:1, maxLength:60000 }, ...keywords, note };
  return { name:`xingyue_worldbook_${task}_v1`, description:`星月世界书${AI_TASK_LABELS[task]}结构化提案`, strict:true, value:{ type:'object', additionalProperties:false, properties, required:Object.keys(properties) } };
}
function buildWorldbookAiRequest(task, entry, context = {}) {
  if (!AI_TASKS.includes(task)) throw new Error('未知 AI 任务');
  const content = String(entry?.content || '');
  if (content.length > 60000) throw new Error('当前条目正文超过 60000 字，暂不发送给 AI');
  const instruction = String(context.instruction || '').trim();
  if (instruction.length > 2000) throw new Error('附加要求不能超过 2000 字');
  const includeExcerpt = context.includeResearchExcerpt === true;
  const excerpt = includeExcerpt ? String(context.researchExcerpt || '').trim() : '';
  if (includeExcerpt && !excerpt) throw new Error('已勾选研究摘录，但摘录内容为空');
  if (excerpt.length > 12000) throw new Error('研究摘录不能超过 12000 字');
  const taskRules = {
    keywords:'只建议触发方式、主次关键词、过滤逻辑和扫描深度，不修改正文。',
    compress:'在不改变事实、约束、专有名词和程序标记的前提下压缩正文，只返回压缩正文。',
    draft:'生成可继续人工编辑的世界书正文与匹配配置；草拟说明只概括可检查的取舍，不输出隐藏思维链。',
  };
  const lines = [
    `任务：${AI_TASK_LABELS[task]}`,
    `条目名称：${String(entry?.name || '未命名条目')}`,
    `当前触发方式：${String(entry?.strategyType || 'constant')}`,
    `当前主关键词：${formatList(entry?.keys) || '无'}`,
    `当前次关键词：${formatList(entry?.secondaryKeys) || '无'}`,
    '当前正文：', content || '（空）',
  ];
  if (instruction) lines.push('用户附加要求：', instruction);
  if (excerpt) lines.push('用户主动选择的研究摘录：', excerpt);
  return {
    task,
    maxChatHistory:0,
    userInput:lines.join('\n'),
    orderedPrompts:[
      { role:'system', content:`你是星月 3.6.0 世界书编辑助手。${taskRules[task]} 仅输出符合 JSON Schema 的对象；结果只会进入草稿，不得声称已经保存。` },
      'user_input',
    ],
    jsonSchema:buildWorldbookAiSchema(task),
    contextSummary:{ entryName:String(entry?.name || ''), entryCharacters:content.length, instructionCharacters:instruction.length, researchExcerptCharacters:excerpt.length },
  };
}
function normalizeWorldbookAiResult(task, raw) {
  if (!AI_TASKS.includes(task)) throw new Error('未知 AI 任务');
  if (typeof raw !== 'string') throw new Error('AI 返回了工具调用或非文本对象，不能进入草稿');
  if (raw.length > 80000) throw new Error('AI 返回内容超过安全上限');
  let value;
  try { value = JSON.parse(raw); } catch (_) { throw new Error('AI 返回内容不是有效 JSON'); }
  if (!isPlainObject(value)) throw new Error('AI 返回 JSON 必须是对象');
  const allowed = AI_OUTPUT_KEYS[task];
  const actual = Object.keys(value);
  if (actual.some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(value,key))) throw new Error('AI 返回字段与任务 Schema 不一致');
  if (typeof value.note !== 'string') throw new Error('AI 草拟说明必须是字符串');
  const note = value.note.trim();
  if (note.length > 600) throw new Error('AI 草拟说明超过 600 字');
  if (task === 'compress') {
    if (typeof value.content !== 'string') throw new Error('压缩正文必须是字符串');
    const content = value.content.trim();
    if (!content || content.length > 60000) throw new Error('压缩正文为空或超过 60000 字');
    return { content, note };
  }
  const strategyType = STRATEGY_TYPES.includes(value.strategyType) ? value.strategyType : null;
  if (!strategyType) throw new Error('AI 返回了无效触发方式');
  const result = {
    strategyType,
    keys:normalizeKeywordArray(value.primaryKeywords,'主要关键词'),
    secondaryKeys:normalizeKeywordArray(value.secondaryKeywords,'过滤关键词'),
    secondaryLogic:SECONDARY_LOGICS.includes(value.filterLogic) ? value.filterLogic : null,
    scanDepth:normalizeAiScanDepth(value.scanDepth),
    note,
  };
  if (!result.secondaryLogic) throw new Error('AI 返回了无效过滤逻辑');
  if (task === 'draft') {
    if (typeof value.content !== 'string') throw new Error('草拟正文必须是字符串');
    result.content = value.content.trim();
    if (!result.content || result.content.length > 60000) throw new Error('草拟正文为空或超过 60000 字');
  }
  return result;
}
function applyWorldbookAiProposal(entry, proposal) {
  if (!proposal || !AI_TASKS.includes(proposal.task) || !isPlainObject(proposal.output)) return clone(entry || {});
  const next = clone(entry || {});
  for (const field of AI_RESULT_FIELDS[proposal.task]) if (Object.hasOwn(proposal.output,field)) next[field] = clone(proposal.output[field]);
  return next;
}
function worldbookAiProposalRows(entry, proposal) {
  const after = applyWorldbookAiProposal(entry,proposal);
  return (AI_RESULT_FIELDS[proposal?.task] || []).filter(field => !sameValue(entry?.[field],after?.[field])).map(field => ({ field, before:clone(entry?.[field]), after:clone(after?.[field]) }));
}
function worldbookAiDraftFingerprint(entry) {
  const value = {};
  for (const field of ['uid','name','enabled','strategyType','keys','secondaryKeys','secondaryLogic','scanDepth','positionType','role','depth','order','content','probability','sticky','cooldown','delay','recursion','meta']) value[field] = entry?.[field];
  try { return JSON.stringify(value); } catch (_) { return ''; }
}
function safeWorldbookAiError(error, config = {}) {
  let message = String(error?.message || error || 'AI 请求失败');
  const key = String(config?.key || '');
  if (key) message = message.split(key).join('[已隐藏密钥]');
  message = message.replace(/Bearer\s+[^\s,;]+/gi,'Bearer [已隐藏]').replace(/sk-[A-Za-z0-9_-]{8,}/g,'[已隐藏密钥]');
  if (/401|unauthorized|invalid api key/i.test(message)) return '自定义 API 拒绝了密钥，请检查后重试';
  if (/429|rate.?limit/i.test(message)) return '请求过于频繁或额度受限，请稍后重试';
  if (/abort|cancel|停止|中断/i.test(message)) return 'AI 请求已取消';
  return message.slice(0,300);
}

function createWorldbookEditor(options = {}) {
  const manager = options.manager;
  const hostDocument = options.hostDocument;
  const baselineProvider = options.baselineProvider;
  if (!manager || !hostDocument) throw new Error('createWorldbookEditor 需要 manager 与 hostDocument');
  const aiAssistant = options.aiAssistant || null;
  const openRecovery = options.openRecovery;
  const openCurrentChatOpeningEditor = options.openCurrentChatOpeningEditor;
  let root = null;
  let ownedStyle = null;
  let destroyed = false;
  let previousFocus = null;
  let session = null;
  let baseline = null;
  let categoryByUid = new Map();
  let entries = [];
  let original = null;
  let draft = null;
  let selectedUid = null;
  let mode = 'single';
  let pendingPlan = null;
  let pendingTransition = null;
  let conflictDraft = null;
  let pendingRecommendation = null;
  let recommendationUndo = null;
  let modalReturnFocus = null;
  let aiConfig = normalizeWorldbookAiSessionConfig((() => { try { return aiAssistant?.loadSessionConfig?.() || {}; } catch (_) { return {}; } })());
  let aiInstruction = '';
  let researchState = { urlInput:'', loadedUrl:'', excerpt:'', includeExcerpt:false };
  let activeAiRequest = null;
  let pendingAiProposal = null;
  let aiProposalUndo = null;
  let aiError = null;
  let lastAiTask = null;
  let aiEpoch = 0;
  let status = { kind:'idle', text:'尚未载入世界书。' };
  const filters = { query:'', category:'all', status:'all', strategy:'all' };

  function ensureStyle() {
    if (hostDocument.getElementById('worldbook-manager-editor-style')) return;
    const style = hostDocument.createElement('style');
    style.id = 'worldbook-manager-editor-style';
    style.textContent = `
.wbe-shell,.wbe-shell *{box-sizing:border-box}.wbe-shell{--bg:#0b1018;--panel:#121b27;--panel2:#182333;--line:#31465f;--text:#edf6ff;--muted:#9bb0c6;--accent:#70c9f3;--good:#78dfb1;--warn:#f3c878;--bad:#ff858c;position:fixed;inset:0;z-index:2147483600;width:100dvw;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);background:rgba(3,7,12,.96);color:var(--text);font:14px/1.55 "Microsoft YaHei",sans-serif;overflow:hidden}.wbe-shell[hidden]{display:none!important}.wbe-app{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);background:linear-gradient(145deg,#0c131e,#091018)}
.wbe-top{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);background:#0d1622}.wbe-title{min-width:0}.wbe-title h2{font-size:18px;margin:0}.wbe-title p{margin:2px 0 0;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wbe-top-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}.wbe-button{min-height:44px;border:1px solid var(--line);border-radius:8px;background:#142235;color:var(--text);padding:8px 13px;cursor:pointer}.wbe-button:hover,.wbe-button:focus-visible{border-color:var(--accent);outline:2px solid transparent}.wbe-button.primary{background:#0e4964;border-color:#48b7e7}.wbe-button.danger{background:#4e1b24;border-color:#b95661}.wbe-button:disabled{opacity:.5;cursor:not-allowed}
.wbe-main{min-height:0;display:grid;grid-template-columns:minmax(250px,21vw) minmax(0,1fr)}.wbe-sidebar{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border-right:1px solid var(--line);background:#0e1722}.wbe-filters{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;border-bottom:1px solid var(--line)}.wbe-filters input{grid-column:1/-1}.wbe-shell input,.wbe-shell textarea,.wbe-shell select{width:100%;min-width:0;border:1px solid var(--line);border-radius:7px;background:#09121d;color:var(--text);padding:9px 10px;font:inherit;font-size:16px}.wbe-list{overflow:auto;padding:8px}.wbe-entry{width:100%;min-height:54px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;margin:0 0 6px;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:#121c29;color:var(--text);text-align:left;cursor:pointer}.wbe-entry.is-selected{border-color:var(--accent);background:#162b3b}.wbe-entry.is-protected{border-left:4px solid var(--bad)}.wbe-dot{width:9px;height:9px;border-radius:50%;background:#657487}.wbe-dot.on{background:var(--good)}.wbe-entry strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wbe-entry small{color:var(--muted)}
.wbe-workspace{min-width:0;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto}.wbe-toolbar{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);background:#101a27}.wbe-mode{display:flex;gap:5px}.wbe-mode button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}.wbe-badge{border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--muted);font-size:12px}.wbe-badge.core,.wbe-badge.variable{border-color:var(--bad);color:var(--bad)}.wbe-badge.workshop{border-color:var(--warn);color:var(--warn)}.wbe-status{min-height:35px;padding:7px 14px;border-bottom:1px solid var(--line);color:var(--muted);background:#0d151f}.wbe-status.error{color:var(--bad)}.wbe-status.success{color:var(--good)}.wbe-content{min-height:0;overflow:hidden}.wbe-layout{height:100%;min-width:0;display:grid;overflow:hidden}.wbe-layout.single{grid-template-columns:minmax(0,1fr)}.wbe-layout.compare,.wbe-layout.assist{grid-template-columns:minmax(280px,.9fr) minmax(420px,1.4fr)}.wbe-left{min-width:0;min-height:0;overflow:auto;padding:14px;border-right:1px solid var(--line);background:#0d1621}.wbe-form{min-width:0;min-height:0;overflow:auto;padding:14px 16px 90px}.wbe-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wbe-form label{display:grid;gap:5px;color:var(--muted)}.wbe-form [hidden]{display:none!important}.wbe-form label.wide{grid-column:1/-1}.wbe-form label.double{grid-column:span 2}.wbe-form textarea{min-height:260px;resize:vertical;white-space:pre-wrap}.wbe-check{display:flex!important;align-items:center;gap:8px}.wbe-check input{width:auto}.wbe-readonly{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:8px;background:#09121d;padding:12px;min-height:160px}.wbe-assist-card{border:1px solid var(--line);border-radius:8px;background:#121e2c;padding:11px;margin-bottom:10px}.wbe-assist-card h3{margin:0 0 6px;font-size:14px}.wbe-assist-card ul{margin:6px 0;padding-left:20px}.wbe-footer{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--line);background:#0d1622}.wbe-footer .spacer{flex:1}.wbe-program-actions{display:flex;gap:8px;flex-wrap:wrap}
.wbe-modal{position:absolute;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.72)}.wbe-modal[hidden]{display:none}.wbe-modal-card{width:min(720px,100%);max-height:min(760px,90dvh);overflow:auto;border:1px solid var(--line);border-radius:12px;background:#101a27;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.55)}.wbe-modal-card h3{margin-top:0}.wbe-diff{display:grid;gap:6px;margin:12px 0}.wbe-diff-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px;border:1px solid var(--line);border-radius:7px;padding:7px;background:#0a131e}.wbe-diff-row small{grid-column:2;color:var(--muted);overflow-wrap:anywhere}.wbe-empty{display:grid;place-items:center;height:100%;padding:28px;color:var(--muted);text-align:center}
.wbe-basic-help{font-size:12px;color:var(--muted)}.wbe-config-summary{grid-column:1/-1;border:1px solid var(--line);border-radius:9px;background:#0d1723;padding:10px 12px;color:var(--muted)}.wbe-native-section{grid-column:1/-1;border:1px solid var(--line);border-radius:10px;background:#0c1723;padding:12px}.wbe-native-section h3{margin:0 0 10px;font-size:14px;color:var(--accent)}.wbe-native-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wbe-native-note{grid-column:1/-1;color:var(--muted);font-size:12px;margin:0}.wbe-source-details,.wbe-st-only-details{grid-column:1/-1;border:1px dashed var(--line);border-radius:10px;background:#0b141f;padding:10px 12px}.wbe-source-details summary,.wbe-st-only-details summary{cursor:pointer;color:var(--accent);font-weight:700}.wbe-source-details textarea{margin-top:10px;min-height:130px}.wbe-st-only-details ul{margin:8px 0 0;padding-left:20px;color:var(--muted)}.wbe-smart-card{grid-column:1/-1;border:1px solid #376780;border-radius:10px;background:linear-gradient(135deg,#102438,#0d1a28);padding:13px}.wbe-smart-card h3{margin:0 0 5px;font-size:15px}.wbe-smart-card p{margin:4px 0;color:var(--muted)}.wbe-smart-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.wbe-recommendation-list{display:grid;gap:7px;margin:12px 0}.wbe-recommendation-row{border:1px solid var(--line);border-radius:8px;background:#0a131e;padding:9px}.wbe-recommendation-row b{display:block;margin-bottom:3px}.wbe-recommendation-row small{display:block;color:var(--muted);margin-top:4px}.wbe-callout{border-left:3px solid var(--warn);padding:7px 10px;margin:8px 0;background:#1b1a13;color:#f5dfac}.wbe-callout.error{border-color:var(--bad);background:#25151a;color:#ffc3c7}.wbe-ai-layout{height:100%;overflow:auto;padding:14px;display:grid;grid-template-columns:minmax(360px,.9fr) minmax(420px,1.1fr);gap:14px}.wbe-ai-card{min-width:0;border:1px solid var(--line);border-radius:10px;background:#0d1825;padding:14px}.wbe-ai-card h3{margin:0 0 8px;color:var(--accent)}.wbe-ai-card p{color:var(--muted)}.wbe-ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wbe-ai-grid label{display:grid;gap:5px;color:var(--muted)}.wbe-ai-grid .wide{grid-column:1/-1}.wbe-ai-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.wbe-ai-result{border:1px solid var(--good);border-radius:9px;background:#0d211d;padding:11px;margin-top:12px}.wbe-ai-result.stale{border-color:var(--warn);background:#211c0d}.wbe-ai-result-row{display:grid;gap:3px;border-top:1px solid var(--line);padding:7px 0}.wbe-ai-result-row:first-of-type{border-top:0}.wbe-research-frame{width:100%;min-height:420px;border:1px solid var(--line);border-radius:8px;background:#fff}.wbe-research-empty{min-height:220px;display:grid;place-items:center;border:1px dashed var(--line);border-radius:8px;color:var(--muted);text-align:center;padding:20px}.wbe-ai-secret-note{font-size:12px;color:var(--warn)}
@media(max-width:1000px){.wbe-main{grid-template-columns:minmax(220px,34vw) minmax(0,1fr)}.wbe-form-grid,.wbe-native-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wbe-layout.compare,.wbe-layout.assist{grid-template-columns:minmax(230px,.8fr) minmax(340px,1.2fr)}.wbe-ai-layout{grid-template-columns:1fr}}
@media(max-width:760px){.wbe-top{padding:9px 10px}.wbe-title p{display:none}.wbe-top-actions .secondary-label{display:none}.wbe-main{display:block;overflow:auto}.wbe-sidebar{min-height:auto;border-right:0;border-bottom:1px solid var(--line)}.wbe-list{display:flex;overflow:auto;gap:6px;padding:8px}.wbe-entry{min-width:210px;margin:0}.wbe-workspace{height:auto;min-height:calc(100dvh - 190px)}.wbe-toolbar{position:sticky;top:0;z-index:2;overflow:auto;flex-wrap:wrap}.wbe-layout.compare,.wbe-layout.assist{grid-template-columns:1fr}.wbe-left{border-right:0;border-bottom:1px solid var(--line);max-height:34dvh}.wbe-form{overflow:visible;padding-bottom:110px}.wbe-form-grid,.wbe-native-grid{grid-template-columns:1fr}.wbe-form label.double,.wbe-form label.wide{grid-column:auto}.wbe-config-summary,.wbe-smart-card,.wbe-native-section,.wbe-source-details,.wbe-st-only-details{grid-column:auto}.wbe-ai-layout{height:auto;padding:10px}.wbe-ai-grid{grid-template-columns:1fr}.wbe-ai-grid .wide{grid-column:auto}.wbe-research-frame{min-height:55dvh}.wbe-footer{position:sticky;bottom:0;z-index:3;flex-wrap:wrap}.wbe-program-actions{width:100%}.wbe-button{min-width:44px}.wbe-modal{position:fixed;padding:10px}.wbe-modal-card{max-height:calc(100dvh - 20px)}}
@media(max-width:420px){.wbe-filters{grid-template-columns:1fr}.wbe-filters input{grid-column:auto}.wbe-top-actions{gap:4px}.wbe-top-actions .wbe-button{padding-inline:9px}.wbe-mode{overflow:auto}.wbe-status{font-size:12px}}
@media(prefers-reduced-motion:reduce){.wbe-shell *{scroll-behavior:auto!important}}
`;
    (hostDocument.head || hostDocument.documentElement).appendChild(style);
    ownedStyle = style;
  }

  function mount() {
    if (destroyed) throw new Error('世界书编辑器已销毁');
    if (root?.isConnected) return root;
    ensureStyle();
    root = hostDocument.createElement('div');
    root.className = 'wbe-shell';
    root.hidden = true;
    root.innerHTML = `<div class="wbe-app" role="dialog" aria-modal="true" aria-label="世界书条目编辑器">
      <header class="wbe-top"><div class="wbe-title"><h2>世界书条目编辑器</h2><p data-wbe-worldbook>尚未定位绑定世界书</p></div><div class="wbe-top-actions"><button class="wbe-button" data-wbe-action="recovery"><span class="secondary-label">备份与</span>恢复</button><button class="wbe-button" data-wbe-action="reload">重载</button><button class="wbe-button" data-wbe-action="close">关闭</button></div></header>
      <main class="wbe-main"><aside class="wbe-sidebar"><div class="wbe-filters"><input data-wbe-filter="query" type="search" placeholder="搜索名称、关键词或正文" aria-label="搜索条目"><select data-wbe-filter="category" aria-label="来源分类"><option value="all">全部来源</option><option value="core">核心</option><option value="variable">变量</option><option value="workshop">工坊来源</option><option value="user">我的条目</option></select><select data-wbe-filter="status" aria-label="启用状态"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option><option value="programOnly">仅供程序使用</option></select><select data-wbe-filter="strategy" aria-label="触发方式筛选"><option value="all">全部触发方式</option><option value="constant">始终生效</option><option value="selective">按关键词生效</option><option value="vectorized">语义匹配</option></select></div><div class="wbe-list" data-wbe-list></div></aside>
      <section class="wbe-workspace"><div class="wbe-toolbar"><div class="wbe-mode" role="group" aria-label="查看方式"><button class="wbe-button" data-wbe-mode="single">编辑</button><button class="wbe-button" data-wbe-mode="compare">修改对比</button><button class="wbe-button" data-wbe-mode="assist">检查</button><button class="wbe-button" data-wbe-mode="ai">AI 与研究</button></div><span class="wbe-badge" data-wbe-category>未选择</span><span class="wbe-basic-help">字段层级对齐 SillyTavern 1.14.0</span></div><div class="wbe-status" data-wbe-status role="status" aria-live="polite"></div><div class="wbe-content" data-wbe-content></div><footer class="wbe-footer"><div class="wbe-program-actions" data-wbe-program-actions></div><span class="spacer"></span><button class="wbe-button primary" data-wbe-action="prepare-save" disabled>校验并保存</button></footer></section></main>
      <div class="wbe-modal" data-wbe-modal hidden></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('keydown', onKeydown);
    (hostDocument.body || hostDocument.documentElement).appendChild(root);
    renderAll();
    return root;
  }

  function setStatus(text, kind = 'idle') { status = { text:String(text || ''), kind }; renderStatus(); }
  function renderStatus() {
    const node = root?.querySelector('[data-wbe-status]');
    if (!node) return;
    node.className = `wbe-status ${status.kind === 'error' ? 'error' : status.kind === 'success' ? 'success' : ''}`;
    node.textContent = status.text;
    if (status.kind === 'error') node.setAttribute('role','alert'); else node.setAttribute('role','status');
  }
  function renderList() {
    const node = root?.querySelector('[data-wbe-list]');
    if (!node) return;
    const visible = filterWorldbookEntries(entries, filters, categoryByUid);
    node.innerHTML = visible.length ? visible.map(entry => {
      const category = categoryForEntry(entry, categoryByUid);
      const protectedClass = category === 'core' || category === 'variable' ? ' is-protected' : '';
      return `<button class="wbe-entry${entry.uid === selectedUid ? ' is-selected' : ''}${protectedClass}" data-wbe-action="select" data-wbe-uid="${Number(entry.uid)}"><i class="wbe-dot${entry.enabled ? ' on' : ''}"></i><strong>${escapeHtml(entry.name || '未命名条目')}</strong><small>${escapeHtml(CATEGORY_LABELS[category] || category)}</small></button>`;
    }).join('') : '<div class="wbe-empty">没有符合筛选条件的条目。</div>';
  }
  function optionHtml(values, current, labels = {}) { return values.map(value => `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join(''); }
  function positionOptionHtml(current) {
    const existingOutlet = current === 'outlet' ? '<option value="outlet" selected disabled>手动插槽（请在 ST 原生管理器编辑）</option>' : '';
    return existingOutlet + optionHtml(RUNTIME_EDITABLE_POSITION_TYPES,current,POSITION_LABELS);
  }
  function formHtml(entry) {
    const locked = entry?.meta?.programOnly === true;
    const category = categoryForEntry(entry, categoryByUid);
    const atDepth = entry.positionType === 'at_depth';
    const recommendation = recommendWorldbookSettings(entry, { entries, category });
    const blocked = recommendation.blockers.length ? `<p class="wbe-callout${recommendation.available ? '' : ' error'}">${escapeHtml(recommendation.blockers.join(' '))}</p>` : '';
    const warning = `<p class="wbe-basic-help" data-wbe-key-help>${escapeHtml(triggerKeywordHelp(entry))}</p>`;
    return `<form class="wbe-form" data-wbe-form><div class="wbe-form-grid">
      <label class="double">条目名称<input data-wbe-field="name" value="${escapeHtml(entry.name)}"></label>
      <label class="wbe-check">参与世界书<input data-wbe-field="enabled" type="checkbox"${entry.enabled ? ' checked' : ''}${locked ? ' disabled' : ''}></label>
      <section class="wbe-native-section" data-wbe-section="st-entry-header" aria-label="ST 常用设置"><h3>ST 常用设置</h3><div class="wbe-native-grid">
        <label>触发方式<select data-wbe-field="strategyType"${locked ? ' disabled' : ''}>${optionHtml(STRATEGY_TYPES,entry.strategyType,STRATEGY_LABELS)}</select></label>
        <label>插入位置<select data-wbe-field="positionType">${positionOptionHtml(entry.positionType)}</select></label>
        <label data-wbe-at-depth${atDepth ? '' : ' hidden'}>消息身份<select data-wbe-field="role">${optionHtml(ROLES,entry.role,ROLE_LABELS)}</select></label>
        <label data-wbe-at-depth${atDepth ? '' : ' hidden'}>聊天深度<input data-wbe-field="depth" type="number" min="0" value="${Number(entry.depth) || 0}"></label>
        <label>顺序<input data-wbe-field="order" type="number" min="0" value="${Number(entry.order) || 0}"></label>
        <label>触发概率（%）<input data-wbe-field="probability" type="number" min="0" max="100" value="${Number(entry.probability) || 0}"></label>
      </div></section>
      <section class="wbe-native-section" data-wbe-section="st-keywords" aria-label="关键词与扫描"><h3>关键词与扫描</h3><div class="wbe-native-grid">
        <label class="wide">主要关键词<input data-wbe-field="keys" value="${escapeHtml(formatList(entry.keys))}" placeholder="例如：天文社，入部申请">${warning}</label>
        <label>可选过滤逻辑<select data-wbe-field="secondaryLogic">${optionHtml(SECONDARY_LOGICS,entry.secondaryLogic,SECONDARY_LOGIC_LABELS)}</select></label>
        <label>可选过滤关键词<input data-wbe-field="secondaryKeys" value="${escapeHtml(formatList(entry.secondaryKeys))}" placeholder="留空则忽略过滤"></label>
        <label>扫描深度<input data-wbe-field="scanDepth" value="${escapeHtml(entry.scanDepth)}" placeholder="same_as_global 或数字"></label>
        <p class="wbe-native-note">以上对应 ST 原生 Primary Keywords、Optional Filter、Logic 与 Scan Depth；不是创作者专用字段。</p>
      </div></section>
      <label class="wide">正文<textarea data-wbe-field="content">${escapeHtml(entry.content)}</textarea></label>
      <section class="wbe-native-section" data-wbe-section="st-recursion-effects" aria-label="递归与持续效果"><h3>递归与持续效果（ST 原生）</h3><div class="wbe-native-grid">
        <label class="wbe-check">不可被其他条目递归激活<input data-wbe-field="prevent_incoming" type="checkbox"${entry.recursion?.prevent_incoming ? ' checked' : ''}${locked ? ' disabled' : ''}></label>
        <label class="wbe-check">不再递归激活其他条目<input data-wbe-field="prevent_outgoing" type="checkbox"${entry.recursion?.prevent_outgoing ? ' checked' : ''}${locked ? ' disabled' : ''}></label>
        <label>延迟到递归层级<input data-wbe-field="delay_until" type="number" min="0" value="${escapeHtml(numberAttributeValue(entry.recursion?.delay_until))}"${locked ? ' disabled' : ''}></label>
        <label>黏性（消息数）<input data-wbe-field="sticky" type="number" min="0" value="${escapeHtml(numberAttributeValue(entry.sticky))}"></label>
        <label>冷却（消息数）<input data-wbe-field="cooldown" type="number" min="0" value="${escapeHtml(numberAttributeValue(entry.cooldown))}"></label>
        <label>延迟（消息数）<input data-wbe-field="delay" type="number" min="0" value="${escapeHtml(numberAttributeValue(entry.delay))}"></label>
        <p class="wbe-native-note">ST 1.14.0 在条目展开后直接显示这些字段。智能配置可以估算安全值，但不会替代手工编辑。</p>
      </div></section>
      <div class="wbe-config-summary"><b>当前配置</b> · ${escapeHtml(summarizeWorldbookConfiguration(entry))}</div>
      <section class="wbe-smart-card" aria-label="辅助配置"><h3>辅助配置（可选，不保存）</h3><p>按当前条目内容估算 ST 字段，适合不想逐项调参时使用；所有原生字段仍可直接手工编辑。</p><p>不会改正文、启用状态、关键词或工坊元数据；应用后仍需单独点击“校验并保存”。</p>${blocked}<div class="wbe-smart-actions"><button type="button" class="wbe-button primary" data-wbe-action="recommend-settings"${recommendation.available ? '' : ' disabled'}>生成配置建议</button>${recommendationUndo ? '<button type="button" class="wbe-button" data-wbe-action="undo-recommendation">撤销智能配置</button><span class="wbe-basic-help">建议已应用到草稿，尚未保存。</span>' : ''}</div></section>
      <details class="wbe-st-only-details"><summary>ST 原生管理器中的其他字段</summary><p>酒馆助手当前运行时 WorldbookEntry API 不暴露下列字段，卡内编辑器不会伪造保存；需要时请在 ST 原生世界书管理器中编辑：</p><ul><li>区分大小写、完整单词</li><li>包含组、优先级、组权重、组评分</li><li>Outlet Name、Automation ID、忽略预算</li><li>角色/标签过滤、生成类型过滤</li><li>Additional Matching Sources</li></ul></details>
      <details class="wbe-source-details"><summary>来源与技术信息（只读）</summary><label>UID<input readonly value="${escapeHtml(entry.uid)}"></label><label>受管元数据<textarea readonly>${escapeHtml(JSON.stringify(entry.meta || {},null,2))}</textarea></label></details>
    </div></form>`;
  }
  function persistAiConfig() {
    try {
      const result = aiAssistant?.saveSessionConfig?.(clone(aiConfig));
      if (aiConfig.rememberKey && result?.sessionStored === false) { setStatus('无法写入 sessionStorage；Key 仍只保留在当前内存，重新载入后不会恢复。','error'); return false; }
      return true;
    } catch (_) { setStatus('AI 会话设置暂时无法保存；密钥仍只保留在当前内存。','error'); return false; }
  }
  function aiBlockedReason() {
    if (!draft) return '请先选择一个条目';
    const category = categoryForEntry(draft,categoryByUid);
    if (draft?.meta?.programOnly === true) return '仅供程序使用的来源记录不能由 AI 改写；请先脱离为用户副本';
    if (category === 'core' || category === 'variable') return '核心和变量条目由作者维护，P7 不提供 AI 改写';
    return '';
  }
  function researchCandidate() {
    try {
      return { url:validateResearchUrl(researchState.urlInput,{ blockedOrigin:hostDocument.defaultView?.location?.origin || '' }), error:'' };
    } catch (error) { return { url:'', error:String(error?.message || error || '') }; }
  }
  function friendlyAiValue(field, value) {
    if (field === 'content') return `正文 ${String(value || '').length} 字`;
    if (field === 'strategyType') return STRATEGY_LABELS[value] || String(value || '');
    if (field === 'secondaryLogic') return SECONDARY_LOGIC_LABELS[value] || String(value || '');
    if (field === 'scanDepth') return value === 'same_as_global' ? '跟随酒馆全局设置' : String(value ?? '');
    if (Array.isArray(value)) return value.length ? value.join('，') : '空';
    return value == null || value === '' ? '空' : String(value);
  }
  function aiProposalHtml() {
    if (!pendingAiProposal) return '';
    const stale = pendingAiProposal.baseFingerprint !== worldbookAiDraftFingerprint(draft);
    const rows = worldbookAiProposalRows(pendingAiProposal.baseDraft,pendingAiProposal);
    const rowHtml = rows.length ? rows.map(row => `<div class="wbe-ai-result-row"><b>${escapeHtml(DIFF_FIELD_LABELS[row.field] || row.field)}</b><span>${escapeHtml(friendlyAiValue(row.field,row.before))} → ${escapeHtml(friendlyAiValue(row.field,row.after))}</span></div>`).join('') : '<p>提案与生成时的草稿没有字段差异。</p>';
    return `<div class="wbe-ai-result${stale ? ' stale' : ''}"><h3>AI 提案 · ${escapeHtml(AI_TASK_LABELS[pendingAiProposal.task])}</h3>${stale ? '<p class="wbe-callout">生成后草稿已被修改；为避免覆盖新内容，本提案只能查看，不能应用。请重新生成。</p>' : ''}${rowHtml}${pendingAiProposal.output.note ? `<p><b>草拟说明：</b>${escapeHtml(pendingAiProposal.output.note)}</p>` : ''}<div class="wbe-ai-actions"><button type="button" class="wbe-button" data-wbe-action="discard-ai-proposal">放弃提案</button><button type="button" class="wbe-button primary" data-wbe-action="apply-ai-proposal"${stale || !rows.length ? ' disabled' : ''}>应用到草稿</button></div></div>`;
  }
  function aiWorkspaceHtml() {
    const blocked = aiBlockedReason();
    const candidate = researchCandidate();
    const custom = aiConfig.source === 'custom';
    const running = !!activeAiRequest;
    const unavailable = typeof aiAssistant?.generate !== 'function';
    const contextChars = String(draft?.content || '').length;
    const excerptChars = researchState.includeExcerpt ? String(researchState.excerpt || '').trim().length : 0;
    const taskButtons = AI_TASKS.map(task => `<button type="button" class="wbe-button${task === 'draft' ? ' primary' : ''}" data-wbe-ai-task="${task}"${running || unavailable || blocked ? ' disabled' : ''}>${escapeHtml(AI_TASK_LABELS[task])}</button>`).join('');
    const errorHtml = aiError ? `<div class="wbe-callout error"><b>请求未完成：</b>${escapeHtml(aiError.message)}<div class="wbe-ai-actions"><button type="button" class="wbe-button" data-wbe-action="retry-ai"${running || !lastAiTask ? ' disabled' : ''}>重试本任务</button></div></div>` : '';
    const loadedFrame = researchState.loadedUrl ? `<iframe class="wbe-research-frame" title="受限研究页" src="${escapeHtml(researchState.loadedUrl)}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; fullscreen 'none'"></iframe>` : '<div class="wbe-research-empty">输入公开网页地址后载入。若站点拒绝嵌入，不会放宽 sandbox；请使用外部打开。</div>';
    const external = candidate.url ? `<a class="wbe-button" href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener noreferrer">外部打开</a>` : '<span class="wbe-button" aria-disabled="true">外部打开</span>';
    return `<div class="wbe-ai-layout">
      <section class="wbe-ai-card" aria-label="AI 草稿助手"><h3>AI 草稿助手</h3><p>默认沿用酒馆当前 Chat Completion 配置。请求不带聊天历史、Persona、角色描述或未选择的世界书内容；输出只形成提案。</p>
        ${blocked ? `<p class="wbe-callout error">${escapeHtml(blocked)}</p>` : ''}${unavailable ? '<p class="wbe-callout error">当前运行时未提供 AI adapter；仍可使用本地检查和手工编辑。</p>' : ''}
        <div class="wbe-ai-grid"><label>模型来源<select data-wbe-ai-field="source"><option value="current"${custom ? '' : ' selected'}>使用当前 ST 模型</option><option value="custom"${custom ? ' selected' : ''}>会话级自定义 API</option></select></label><label class="wide">附加要求（可选）<textarea data-wbe-ai-field="instruction" maxlength="2000" placeholder="例如：保留校规编号，不压缩人名">${escapeHtml(aiInstruction)}</textarea></label></div>
        <details${custom ? ' open' : ''}><summary>AI 设置${custom ? ' · 自定义 OpenAI-compatible API' : ''}</summary><div class="wbe-ai-grid">
          <label class="wide">API 基础地址<input data-wbe-ai-field="apiurl" value="${escapeHtml(aiConfig.apiurl)}" placeholder="https://example.com/v1" autocomplete="off" spellcheck="false"></label>
          <label>模型<input data-wbe-ai-field="model" value="${escapeHtml(aiConfig.model)}" placeholder="model-name" autocomplete="off" spellcheck="false"></label>
          <label>API Key<input data-wbe-ai-field="key" type="password" value="${escapeHtml(aiConfig.key)}" autocomplete="new-password" spellcheck="false"></label>
          <label class="wbe-check wide">本标签页记住 Key<input data-wbe-ai-field="rememberKey" type="checkbox"${aiConfig.rememberKey ? ' checked' : ''}></label>
          <label class="wbe-check wide">允许本机 HTTP API（开发模式）<input data-wbe-ai-field="allowLocalHttp" type="checkbox"${aiConfig.allowLocalHttp ? ' checked' : ''}></label>
          <p class="wbe-ai-secret-note wide">Key 默认只保留在内存；勾选后才进入 sessionStorage。不会进入 localStorage、世界书、卡包、MVU、快照、diff 或日志。</p>
          <div class="wbe-ai-actions wide"><button type="button" class="wbe-button danger" data-wbe-action="clear-ai-config">立即清除会话 API 设置</button></div>
        </div></details>
        <p>本次上下文：当前条目 ${contextChars} 字${excerptChars ? ` + 主动选择摘录 ${excerptChars} 字` : ''}。研究页 URL 本身不会发送。</p>
        <div class="wbe-ai-actions">${taskButtons}${running ? '<button type="button" class="wbe-button danger" data-wbe-action="cancel-ai">取消生成</button>' : ''}${aiProposalUndo ? '<button type="button" class="wbe-button" data-wbe-action="undo-ai-proposal">撤销上次 AI 应用</button>' : ''}</div>
        ${running ? `<p role="status">正在${escapeHtml(AI_TASK_LABELS[activeAiRequest.task])}，可以随时取消…</p>` : ''}${errorHtml}${aiProposalHtml()}
      </section>
      <section class="wbe-ai-card" aria-label="研究摘录"><h3>查资料与摘录</h3><p>研究页只负责显示，不抓取网页、不读取 iframe DOM、不代理请求，也不会自动访问剪贴板。只校验首次载入地址；站点后续重定向不受卡内代码控制，请勿载入不可信站点。</p>
        <div class="wbe-ai-grid"><label class="wide">公开网页地址<input data-wbe-ai-field="researchUrl" value="${escapeHtml(researchState.urlInput)}" placeholder="https://example.com/article" autocomplete="off" spellcheck="false"></label></div>
        <div class="wbe-ai-actions"><button type="button" class="wbe-button primary" data-wbe-action="load-research">在受限框架中载入</button>${external}<button type="button" class="wbe-button" data-wbe-action="clear-research">清空研究页</button></div>
        ${candidate.error && researchState.urlInput ? `<p class="wbe-callout error">${escapeHtml(candidate.error)}</p>` : ''}${loadedFrame}
        <div class="wbe-ai-grid"><label class="wide">手工粘贴摘录<textarea data-wbe-ai-field="researchExcerpt" maxlength="12000" placeholder="只有你主动粘贴的文字才可能进入 AI 上下文">${escapeHtml(researchState.excerpt)}</textarea></label><label class="wbe-check wide">将这段摘录加入下一次 AI 请求<input data-wbe-ai-field="includeResearchExcerpt" type="checkbox"${researchState.includeExcerpt ? ' checked' : ''}></label></div>
        <p>默认不发送摘录；必须逐次勾选。摘录只存在当前编辑器内存，关闭 runtime 后清除。</p>
      </section>
    </div>`;
  }
  function readAiField(target, eventType = 'input') {
    const key = target.dataset.wbeAiField;
    if (!key) return;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    if (['source','apiurl','key','model','rememberKey','allowLocalHttp'].includes(key)) {
      aiConfig = normalizeWorldbookAiSessionConfig({ ...aiConfig, [key]:value });
      persistAiConfig();
      if (key === 'source' || key === 'rememberKey' || key === 'allowLocalHttp') { renderWorkspace(); focusAiTarget(`[data-wbe-ai-field="${key}"]`); }
      return;
    }
    if (key === 'instruction') aiInstruction = String(value || '');
    else if (key === 'researchUrl') { researchState.urlInput = String(value || ''); if (eventType === 'change') { renderWorkspace(); focusAiTarget('[data-wbe-ai-field="researchUrl"]'); } }
    else if (key === 'researchExcerpt') researchState.excerpt = String(value || '');
    else if (key === 'includeResearchExcerpt') { researchState.includeExcerpt = value === true; renderWorkspace(); focusAiTarget('[data-wbe-ai-field="includeResearchExcerpt"]'); }
  }
  function makeAiGenerationId(task) {
    try { return `xingyue-p7-${task}-${hostDocument.defaultView.crypto.randomUUID()}`; }
    catch (_) { return `xingyue-p7-${task}-${Date.now()}-${++aiEpoch}`; }
  }
  function focusAiTarget(selector) {
    const target = root?.querySelector?.(selector);
    if (target?.focus) { target.focus(); return true; }
    const statusNode = root?.querySelector?.('[data-wbe-status]');
    if (statusNode?.focus) { statusNode.setAttribute('tabindex','-1'); statusNode.focus(); return true; }
    return false;
  }
  function cancelActiveAi(reason = '', rerender = true) {
    const active = activeAiRequest;
    aiEpoch += 1;
    activeAiRequest = null;
    if (active?.generationId) { try { aiAssistant?.cancel?.(active.generationId); } catch (_) {} }
    if (reason) setStatus(reason);
    if (rerender && root) { renderWorkspace(); focusAiTarget(lastAiTask ? `[data-wbe-ai-task="${lastAiTask}"]` : '[data-wbe-mode="ai"]'); }
    return !!active;
  }
  async function runAiTask(task) {
    if (!AI_TASKS.includes(task)) throw new Error('未知 AI 任务');
    const blocked = aiBlockedReason();
    if (blocked) throw new Error(blocked);
    if (typeof aiAssistant?.generate !== 'function') throw new Error('当前运行时未提供 AI adapter');
    const config = normalizeWorldbookAiSessionConfig(aiConfig);
    if (config.source === 'custom') {
      config.apiurl = validateCustomApiUrl(config.apiurl,{ allowLocalHttp:config.allowLocalHttp });
      if (!config.model) throw new Error('自定义 API 必须填写模型名称');
    }
    aiConfig = config;
    persistAiConfig();
    const baseDraft = clone(draft);
    const request = buildWorldbookAiRequest(task,baseDraft,{ instruction:aiInstruction, researchExcerpt:researchState.excerpt, includeResearchExcerpt:researchState.includeExcerpt });
    researchState.includeExcerpt = false;
    const generationId = makeAiGenerationId(task);
    const epoch = ++aiEpoch;
    activeAiRequest = { generationId, task, epoch, selectedUid, sessionId:session?.sessionId || '', revision:session?.revision || '', baseFingerprint:worldbookAiDraftFingerprint(baseDraft) };
    pendingAiProposal = null; aiError = null; lastAiTask = task;
    setStatus(`正在${AI_TASK_LABELS[task]}；只生成提案，不会保存世界书。`);
    renderWorkspace();
    focusAiTarget('[data-wbe-action="cancel-ai"]');
    try {
      const raw = await aiAssistant.generate({ ...request, generationId },clone(config));
      if (!activeAiRequest || activeAiRequest.epoch !== epoch || activeAiRequest.generationId !== generationId) return null;
      const output = normalizeWorldbookAiResult(task,raw);
      pendingAiProposal = { task, output, baseDraft, baseFingerprint:activeAiRequest.baseFingerprint, generationId };
      activeAiRequest = null;
      setStatus('AI 提案已返回；请检查差异后再应用到草稿。','success');
      renderWorkspace();
      focusAiTarget('[data-wbe-action="apply-ai-proposal"]');
      return clone(pendingAiProposal);
    } catch (error) {
      if (!activeAiRequest || activeAiRequest.epoch !== epoch) return null;
      activeAiRequest = null;
      aiError = { task, message:safeWorldbookAiError(error,config) };
      setStatus(aiError.message,'error');
      renderWorkspace();
      focusAiTarget('[data-wbe-action="retry-ai"]');
      return null;
    }
  }
  function applyAiProposal() {
    if (!pendingAiProposal || !draft) return;
    if (pendingAiProposal.baseFingerprint !== worldbookAiDraftFingerprint(draft)) { setStatus('草稿在生成后已变化；请重新生成，避免覆盖新内容。','error'); renderWorkspace(); return; }
    const before = clone(draft);
    const after = applyWorldbookAiProposal(draft,pendingAiProposal);
    aiProposalUndo = { before, after:clone(after), fields:[...(AI_RESULT_FIELDS[pendingAiProposal.task] || [])] };
    draft = after; pendingAiProposal = null; pendingPlan = null;
    setStatus('AI 提案已应用到当前草稿，尚未保存；可撤销或继续生成 diff。','success');
    renderWorkspace();
  }
  function undoAiProposal() {
    if (!draft || !aiProposalUndo) return;
    const next = clone(draft);
    for (const field of aiProposalUndo.fields) if (sameValue(next[field],aiProposalUndo.after[field])) {
      if (Object.hasOwn(aiProposalUndo.before,field)) next[field] = clone(aiProposalUndo.before[field]); else delete next[field];
    }
    draft = next; aiProposalUndo = null; pendingPlan = null;
    setStatus('已撤销上次 AI 应用；之后的手工修改保持不变。');
    renderWorkspace();
  }
  function renderAssistHtml() {
    if (!draft) return '';
    const validation = manager.validate?.([draft], { surface:'runtime' }) || { ok:true, errors:[], warnings:[] };
    const issues = [...(validation.errors || []), ...(validation.warnings || [])];
    const active = manager.previewActivation?.(entries.map(entry => entry.uid === selectedUid ? draft : entry), { text:draft.content }) || { active:[], inactive:[], uncertain:[] };
    return `<div class="wbe-assist-card"><h3>本地校验</h3><p>${validation.ok ? '当前草稿通过运行期字段校验。' : '当前草稿仍有阻断项。'}</p>${issues.length ? `<ul>${issues.map(item => `<li>${escapeHtml(item.rule)} · ${escapeHtml(item.message)}</li>`).join('')}</ul>` : ''}</div>
      <div class="wbe-assist-card"><h3>静态激活近似</h3><p>激活 ${active.active?.length || 0} · 未激活 ${active.inactive?.length || 0} · 不确定 ${active.uncertain?.length || 0}</p><p>概率、向量匹配与真实上下文仍需在 ST 真机确认。</p></div>
      <div class="wbe-assist-card"><h3>普通玩家摘要</h3><p>${escapeHtml(summarizeWorldbookConfiguration(draft))}</p><p>字节数（近似）：${new TextEncoder().encode(String(draft.content || '')).length}</p><p>检查模式只做本地校验、字段说明和静态激活预览。</p></div>`;
  }
  function renderWorkspace() {
    const content = root?.querySelector('[data-wbe-content]');
    const badge = root?.querySelector('[data-wbe-category]');
    const save = root?.querySelector('[data-wbe-action="prepare-save"]');
    const actions = root?.querySelector('[data-wbe-program-actions]');
    root?.querySelectorAll('[data-wbe-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wbeMode === mode)));
    if (!content || !badge || !save || !actions) return;
    if (!draft) {
      badge.textContent = '未选择'; badge.className = 'wbe-badge'; save.disabled = true; actions.innerHTML = '';
      content.innerHTML = '<div class="wbe-empty">从左侧选择一个条目开始编辑。</div>'; return;
    }
    const category = categoryForEntry(draft, categoryByUid);
    badge.textContent = (CATEGORY_LABELS[category] || category) + (draft.meta?.programOnly ? ' · 仅供程序使用' : '');
    badge.className = `wbe-badge ${category}`;
    save.disabled = false;
    actions.innerHTML = draft.meta?.programOnly === true
      ? '<button class="wbe-button" data-wbe-action="edit-source">编辑来源记录</button><button class="wbe-button" data-wbe-action="edit-current-chat">编辑当前聊天正文</button><button class="wbe-button danger" data-wbe-action="prepare-detach">脱离为用户副本</button>'
      : '';
    if (mode === 'ai') { content.innerHTML = aiWorkspaceHtml(); return; }
    const left = mode === 'compare' ? `<div class="wbe-left"><h3>保存前原条目</h3><div class="wbe-readonly">${escapeHtml(JSON.stringify(original,null,2))}</div></div>`
      : mode === 'assist' ? `<div class="wbe-left"><h3>本地检查</h3>${renderAssistHtml()}</div>` : '';
    content.innerHTML = `<div class="wbe-layout ${mode}">${left}${formHtml(draft)}</div>`;
  }
  function renderAll() {
    if (!root) return;
    const worldbook = root.querySelector('[data-wbe-worldbook]');
    if (worldbook) worldbook.textContent = session ? `${session.worldbookName} · ${session.revision.slice(0,16)}…` : '尚未定位绑定世界书';
    renderList(); renderWorkspace(); renderStatus();
  }
  function isDirty() { return !!draft && !!original && !sameDraft(draft, original); }
  function showDirtyTransition(kind, payload = {}) {
    pendingTransition = { kind, ...payload };
    modalReturnFocus = hostDocument.activeElement;
    const modal = root.querySelector('[data-wbe-modal]');
    const label = kind === 'select' ? '切换条目' : '重载世界书';
    modal.innerHTML = `<div class="wbe-modal-card" role="alertdialog" aria-modal="true" tabindex="-1"><h3>当前来源草稿尚未保存</h3><p>${label}会放弃当前未保存草稿。关闭编辑器或前往“当前聊天正文”不会丢草稿，重新打开即可继续。</p><div class="wbe-top-actions"><button class="wbe-button" data-wbe-action="cancel-transition">继续编辑当前草稿</button><button class="wbe-button danger" data-wbe-action="confirm-transition">放弃草稿并${label}</button></div></div>`;
    modal.hidden = false;
    focusModalStart(modal);
  }
  function selectEntry(uid, { force = false } = {}) {
    const next = entries.find(entry => entry.uid === uid);
    if (!next) return;
    if (!force && selectedUid !== uid && isDirty()) { showDirtyTransition('select', { uid }); return; }
    if (selectedUid !== uid) cancelActiveAi('',false);
    selectedUid = uid; original = clone(next); draft = clone(next); pendingPlan = null; conflictDraft = null; pendingRecommendation = null; recommendationUndo = null; pendingAiProposal = null; aiProposalUndo = null; aiError = null;
    setStatus('已载入条目草稿；保存前会先生成字段级 diff。'); renderList(); renderWorkspace();
  }
  async function reload({ preserveDraft = false, force = false } = {}) {
    if (destroyed) throw new Error('世界书编辑器已销毁');
    if (!force && !preserveDraft && session && isDirty()) { showDirtyTransition('reload'); return; }
    cancelActiveAi('',false); pendingAiProposal = null; aiError = null;
    const kept = preserveDraft ? clone(draft) : null;
    const keptBase = preserveDraft ? clone(original) : null;
    setStatus('正在读取绑定世界书与出厂分类…');
    const nextSession = await manager.openEditorSession();
    if (destroyed) throw new Error('世界书编辑器已销毁，已放弃迟到的读取结果');
    session = nextSession;
    entries = session.entries;
    if (!baseline && typeof baselineProvider === 'function') {
      const nextBaseline = await baselineProvider();
      if (destroyed) throw new Error('世界书编辑器已销毁，已放弃迟到的分类结果');
      baseline = nextBaseline;
    }
    categoryByUid = new Map((baseline?.entries || []).map(record => [record.uid,record.category]));
    if (kept && entries.some(entry => entry.uid === kept.uid)) {
      original = clone(entries.find(entry => entry.uid === kept.uid));
      const merge = threeWayMergeEntry(keptBase, kept, original);
      draft = merge.merged; selectedUid = kept.uid; conflictDraft = kept;
      if (merge.conflicts.length) {
        pendingTransition = { kind:'merge-conflict', merge, kept };
        const modal = root.querySelector('[data-wbe-modal]');
        const labels = merge.conflicts.map(item => DIFF_FIELD_LABELS[item.path] || item.path).join('、');
        modal.innerHTML = `<div class="wbe-modal-card" role="alertdialog" aria-modal="true" tabindex="-1"><h3>发现同字段冲突</h3><p>非重叠修改已安全合并。以下字段远端和本地都发生变化：${escapeHtml(labels)}。</p><div class="wbe-top-actions"><button class="wbe-button" data-wbe-action="accept-remote-conflicts">冲突字段使用远端</button><button class="wbe-button danger" data-wbe-action="accept-local-conflicts">冲突字段改用本地</button></div></div>`;
        modal.hidden = false; focusModalStart(modal);
        setStatus('已保留远端非重叠修改；同字段冲突等待你的选择。','error');
      } else {
        setStatus('已三方合并最新原文与本地草稿；远端非重叠修改已保留。','success');
      }
    } else if (kept) {
      original = null; draft = kept; selectedUid = null; conflictDraft = kept;
      pendingTransition = { kind:'deleted-entry', kept, deletedUid:kept.uid };
      const modal = root.querySelector('[data-wbe-modal]');
      modal.innerHTML = `<div class="wbe-modal-card" role="alertdialog" aria-modal="true" tabindex="-1"><h3>来源条目已被远端删除</h3><p>本地草稿仍保留在编辑器内，但不能覆盖一个已经不存在的 UID。请选择复制为新的普通条目，或明确放弃本地草稿。</p><div class="wbe-top-actions"><button class="wbe-button primary" data-wbe-action="recover-deleted-copy">复制为新条目</button><button class="wbe-button danger" data-wbe-action="discard-deleted-draft">放弃本地草稿</button></div></div>`;
      modal.hidden = false; focusModalStart(modal);
      setStatus('远端已删除当前条目；本地草稿等待恢复或放弃。','error');
    } else if (selectedUid != null && entries.some(entry => entry.uid === selectedUid)) selectEntry(selectedUid);
    else if (entries.length) selectEntry(entries[0].uid);
    else { selectedUid = null; original = null; draft = null; setStatus('当前世界书没有可编辑条目。'); }
    renderAll();
  }
  function readField(target) {
    if (!draft) return;
    const key = target.dataset.wbeField;
    if (!key) return;
    if (key === 'keys' || key === 'secondaryKeys') draft[key] = parseList(target.value);
    else if (key === 'enabled') draft.enabled = target.checked;
    else if (key === 'prevent_incoming' || key === 'prevent_outgoing') draft.recursion = { ...draft.recursion, [key]:target.checked };
    else if (key === 'delay_until') draft.recursion = { ...draft.recursion, delay_until:asNullableNumber(target.value) };
    else if (['depth','order','probability'].includes(key)) draft[key] = Number(target.value);
    else if (['sticky','cooldown','delay'].includes(key)) draft[key] = asNullableNumber(target.value);
    else if (key === 'scanDepth') draft.scanDepth = target.value === 'same_as_global' ? target.value : (Number.isNaN(Number(target.value)) ? target.value : Number(target.value));
    else draft[key] = target.value;
    pendingPlan = null; pendingRecommendation = null; setStatus('草稿已修改，尚未保存。');
    if (key === 'strategyType') { const help = root.querySelector('[data-wbe-key-help]'); if (help) help.textContent = triggerKeywordHelp(draft); }
    if (key === 'positionType') root.querySelectorAll('[data-wbe-at-depth]').forEach(node => { node.hidden = draft.positionType !== 'at_depth'; });
    if (mode === 'assist') {
      const left = root.querySelector('.wbe-left'); if (left) left.innerHTML = `<h3>本地检查</h3>${renderAssistHtml()}`;
    }
  }
  function modalHtml(plan, detach = false) {
    const rows = formatDiff(plan.diff);
    const protectedPrompt = plan.requiresProtectedConfirmation ? '<label>额外确认：请输入“确认修改核心”<input data-wbe-protected-ack autocomplete="off"></label>' : '';
    const activation = plan.activation ? `<p>静态激活近似：激活 ${plan.activation.active?.length || 0} · 未激活 ${plan.activation.inactive?.length || 0} · 不确定 ${plan.activation.uncertain?.length || 0}</p>` : '';
    return `<div class="wbe-modal-card" role="alertdialog" aria-modal="true" tabindex="-1"><h3>${detach ? '确认脱离为普通用户副本' : '确认保存条目'}</h3><p>${detach ? '原来源记录保持不变；新副本移除工坊管理身份并默认停用。' : '提交前会建立完整世界书快照，并再次校验绑定世界书与 revision。'}</p>${activation}<div class="wbe-diff">${rows.map(row => { const field = diffFieldKey(row.path); const values = Object.hasOwn(row,'before') || Object.hasOwn(row,'after') ? `<small>${escapeHtml(friendlyDiffValue(row.path,row.before))} → ${escapeHtml(friendlyDiffValue(row.path,row.after))}</small>` : ''; return `<div class="wbe-diff-row"><b>${escapeHtml(row.kind)}</b><span>${escapeHtml(row.name)} · ${escapeHtml(DIFF_FIELD_LABELS[field] || field)}</span>${values}</div>`; }).join('') || '<p>无字段变化。</p>'}</div>${protectedPrompt}<div class="wbe-top-actions"><button class="wbe-button" data-wbe-action="cancel-plan">取消</button><button class="wbe-button primary" data-wbe-action="commit-plan">确认提交</button></div></div>`;
  }
  function recommendationModalHtml(recommendation) {
    const decisions = recommendation.decisions || [];
    const decisionHtml = decisions.length ? decisions.map(item => `<div class="wbe-recommendation-row"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(recommendationFriendlyValue(item.field,item.before))} → ${escapeHtml(recommendationFriendlyValue(item.field,item.after))}</span><small>${escapeHtml(item.reason)}</small></div>`).join('') : '<p>当前可自动处理的配置已经合理，无需改动。</p>';
    const blockers = (recommendation.blockers || []).map(item => `<p class="wbe-callout error">${escapeHtml(item)}</p>`).join('');
    const warnings = (recommendation.warnings || []).map(item => `<p class="wbe-callout">${escapeHtml(item)}</p>`).join('');
    const suggestions = (recommendation.suggestions || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
    const profileLabel = RECOMMENDATION_PROFILE_LABELS[recommendation.profile] || RECOMMENDATION_PROFILE_LABELS.generic;
    const summary = decisions.length ? `已识别为“${profileLabel}”，可自动调整 ${decisions.length} 项 ST 条目设置。` : `已识别为“${profileLabel}”，当前无需自动调整。`;
    const details = decisions.length || suggestions ? `<details><summary>查看设置差异${decisions.length ? `（${decisions.length} 项）` : ''}</summary><div class="wbe-recommendation-list">${decisionHtml}</div>${suggestions ? `<ul>${suggestions}</ul>` : ''}</details>` : decisionHtml;
    return `<div class="wbe-modal-card" role="alertdialog" aria-modal="true" tabindex="-1"><h3>智能配置建议</h3><p>${escapeHtml(summary)}</p><p>建议来自本地确定性脚本，不调用 AI。应用只修改当前草稿，不会保存世界书。</p>${blockers}${warnings}${details}<div class="wbe-top-actions"><button class="wbe-button" data-wbe-action="cancel-recommendation">保持原样</button><button class="wbe-button primary" data-wbe-action="apply-recommendation"${decisions.length && recommendation.available ? '' : ' disabled'}>一键应用到草稿</button></div></div>`;
  }
  function focusModalStart(modal) {
    const card = modal?.querySelector('.wbe-modal-card');
    if (!card) return;
    card.scrollTop = 0; card.focus?.({ preventScroll:true }); card.scrollTop = 0;
  }
  function showRecommendation() {
    if (!draft) return;
    const category = categoryForEntry(draft, categoryByUid);
    const recommendation = recommendWorldbookSettings(draft, { entries, category });
    pendingRecommendation = recommendation;
    modalReturnFocus = hostDocument.activeElement;
    const modal = root.querySelector('[data-wbe-modal]');
    modal.innerHTML = recommendationModalHtml(recommendation); modal.hidden = false;
    focusModalStart(modal);
    setStatus('智能配置建议已生成；尚未应用，也没有保存。');
  }
  function applyRecommendation() {
    if (!draft || !pendingRecommendation?.available || !pendingRecommendation.decisions?.length) return;
    const before = clone(draft);
    const after = applyRecommendedSettings(draft,pendingRecommendation);
    recommendationUndo = makeRecommendationUndo(before,after,pendingRecommendation);
    draft = after; pendingPlan = null;
    closeModal(false,false);
    setStatus('智能配置已应用到当前草稿，尚未保存；可撤销或继续检查。','success');
    renderWorkspace();
  }
  function undoRecommendation() {
    if (!draft || !recommendationUndo) return;
    draft = revertRecommendedSettings(draft,recommendationUndo);
    recommendationUndo = null; pendingRecommendation = null; pendingPlan = null;
    setStatus('已撤销智能配置；其他手工修改保持不变。');
    renderWorkspace();
  }
  function showPlan(plan) {
    pendingPlan = plan;
    modalReturnFocus = hostDocument.activeElement;
    const modal = root.querySelector('[data-wbe-modal]');
    modal.innerHTML = modalHtml(plan, plan.kind === 'detach'); modal.hidden = false;
    focusModalStart(modal);
  }
  function closeModal(discard = false, restoreFocus = true) {
    if (discard && ['merge-conflict','deleted-entry'].includes(pendingTransition?.kind)) {
      setStatus('冲突尚未处理：请在对话框中明确选择后再继续。','error');
      return false;
    }
    const modal = root?.querySelector('[data-wbe-modal]');
    if (discard && pendingPlan?.planId) manager.discardPreparedEditorPlan?.(pendingPlan.planId);
    pendingPlan = null;
    pendingTransition = null;
    pendingRecommendation = null;
    if (modal) { modal.hidden = true; modal.innerHTML = ''; }
    if (restoreFocus) { try { modalReturnFocus?.focus?.(); } catch (_) {} }
    modalReturnFocus = null;
    return true;
  }
  async function prepareSave() {
    if (!draft || !session) return;
    if (['merge-conflict','deleted-entry'].includes(pendingTransition?.kind)) { setStatus('请先处理远端冲突，再保存草稿。','error'); return; }
    if (draft.positionType === 'outlet') { setStatus('当前条目是 Outlet，但卡内运行时接口无法保存 Outlet Name；请在 ST 原生世界书管理器编辑，或先改为其他插入位置。','error'); return; }
    setStatus('正在校验草稿并生成 diff…');
    const plan = await manager.prepareEntryEdit({ sessionId:session.sessionId, uid:selectedUid, draft:clone(draft) });
    if (plan.noop) { setStatus('草稿与当前世界书一致，无需写入。','success'); return; }
    showPlan(plan); setStatus('diff 已生成；确认后才会建立快照并保存。');
  }
  async function prepareDetach() {
    if (!draft || !session) return;
    const plan = await manager.prepareDetachProgramOnly({ sessionId:session.sessionId, uid:selectedUid });
    showPlan(plan); setStatus('脱离计划已生成；原来源记录不会被修改。');
  }
  async function commitPlan() {
    if (!pendingPlan) return;
    const ack = root.querySelector('[data-wbe-protected-ack]')?.value?.trim();
    const confirmProtected = protectedConfirmationAccepted(pendingPlan, ack);
    if (!confirmProtected) { setStatus('额外确认文字不匹配，尚未提交。','error'); return; }
    const planId = pendingPlan.planId;
    const planKind = pendingPlan.kind;
    closeModal(false, false);
    setStatus('正在建立快照并提交单次世界书事务…');
    const result = await manager.commitPreparedEditorPlan(planId, { confirmProtected });
    setStatus(result.applied ? '保存成功，已重新读取真实结果。' : '没有字段变化。','success');
    const createdUid = planKind === 'detach' ? result.entries?.at?.(-1)?.uid : null;
    await reload({ force:true });
    if (Number.isInteger(createdUid)) selectEntry(createdUid);
  }
  function clearAiConfig(options = {}) {
    cancelActiveAi('',false);
    if (options.clearAdapter !== false) { try { aiAssistant?.clearSessionConfig?.(); } catch (_) {} }
    aiConfig = normalizeWorldbookAiSessionConfig();
    aiError = null;
    if (root?.isConnected) { setStatus('已清除会话 API 设置与内存密钥。'); renderWorkspace(); }
    return true;
  }
  async function onClick(event) {
    const modeButton = event.target.closest?.('[data-wbe-mode]');
    if (modeButton && root.contains(modeButton)) { mode = MODES.includes(modeButton.dataset.wbeMode) ? modeButton.dataset.wbeMode : 'single'; renderWorkspace(); return; }
    const aiTaskButton = event.target.closest?.('[data-wbe-ai-task]');
    if (aiTaskButton && root.contains(aiTaskButton)) { try { await runAiTask(aiTaskButton.dataset.wbeAiTask); } catch (error) { setStatus(safeWorldbookAiError(error,aiConfig),'error'); } return; }
    const button = event.target.closest?.('[data-wbe-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.wbeAction;
    try {
      if (action === 'select') selectEntry(Number(button.dataset.wbeUid));
      else if (action === 'close') close();
      else if (action === 'reload') await reload();
      else if (action === 'recommend-settings') showRecommendation();
      else if (action === 'apply-recommendation') applyRecommendation();
      else if (action === 'undo-recommendation') undoRecommendation();
      else if (action === 'cancel-recommendation') { closeModal(false); setStatus('未应用智能配置，世界书和草稿均未改变。'); }
      else if (action === 'cancel-ai') cancelActiveAi('AI 请求已取消。');
      else if (action === 'retry-ai') await runAiTask(lastAiTask);
      else if (action === 'apply-ai-proposal') applyAiProposal();
      else if (action === 'discard-ai-proposal') { pendingAiProposal = null; setStatus('已放弃 AI 提案，草稿未改变。'); renderWorkspace(); }
      else if (action === 'undo-ai-proposal') undoAiProposal();
      else if (action === 'clear-ai-config') clearAiConfig();
      else if (action === 'load-research') { researchState.loadedUrl = validateResearchUrl(researchState.urlInput,{ blockedOrigin:hostDocument.defaultView?.location?.origin || '' }); setStatus('研究页已在受限 sandbox 中载入；不会自动读取页面内容。','success'); renderWorkspace(); }
      else if (action === 'clear-research') { researchState = { urlInput:'', loadedUrl:'', excerpt:'', includeExcerpt:false }; setStatus('已清空研究页与内存摘录。'); renderWorkspace(); }
      else if (action === 'reload-keep') { closeModal(); await reload({ preserveDraft:true }); }
      else if (action === 'reload-discard') { closeModal(); await reload({ force:true }); }
      else if (action === 'accept-remote-conflicts') { conflictDraft = null; closeModal(false); setStatus('冲突字段已保留远端值；非重叠本地修改仍在草稿中。','success'); renderWorkspace(); }
      else if (action === 'accept-local-conflicts') {
        const transition = pendingTransition ? { ...pendingTransition } : null;
        for (const item of transition?.merge?.conflicts || []) {
          if (item.localHas) setPathValue(draft, item.path, item.local);
          else deletePathValue(draft, item.path, original || {});
        }
        conflictDraft = null; closeModal(false); setStatus('已明确选择本地冲突值；保存前请检查字段级 diff。','success'); renderWorkspace();
      }
      else if (action === 'recover-deleted-copy') {
        const transition = pendingTransition ? { ...pendingTransition } : null;
        if (transition?.kind !== 'deleted-entry' || !transition.kept) return;
        const recovered = clone(transition.kept);
        const deletedUid = recovered.uid; delete recovered.uid;
        recovered.name = String(recovered.name || '恢复条目') + '（恢复副本）';
        const meta = { ...(recovered.meta || {}) };
        ['source','kind','packageId','packageType','packageTarget','programOnly','revision','contentHash','installedAt','version'].forEach(key => { delete meta[key]; });
        meta.recoveredFromDeletedUid = deletedUid;
        recovered.meta = meta;
        const result = await manager.writeBatch([recovered], { expectedRevision:session.revision });
        closeModal(false, false); conflictDraft = null;
        setStatus('本地草稿已复制为新的普通条目。','success');
        await reload({ force:true });
        const createdUid = result.entries?.at?.(-1)?.uid;
        if (Number.isInteger(createdUid)) selectEntry(createdUid);
      }
      else if (action === 'discard-deleted-draft') {
        pendingTransition = null; conflictDraft = null; closeModal(false, false);
        if (entries.length) selectEntry(entries[0].uid, { force:true });
        else { selectedUid = null; original = null; draft = null; renderAll(); }
        setStatus('已明确放弃被删除条目的本地草稿。');
      }
      else if (action === 'recovery') { await openRecovery?.(); }
      else if (action === 'prepare-save') await prepareSave();
      else if (action === 'prepare-detach') await prepareDetach();
      else if (action === 'commit-plan') await commitPlan();
      else if (action === 'cancel-plan') { closeModal(true); setStatus('已取消，世界书未改动。'); }
      else if (action === 'cancel-transition') { closeModal(false); setStatus('已保留当前未保存草稿。'); }
      else if (action === 'confirm-transition') {
        const transition = pendingTransition ? { ...pendingTransition } : null;
        closeModal(false, false);
        if (transition?.kind === 'select') selectEntry(transition.uid, { force:true });
        else if (transition?.kind === 'reload') await reload({ force:true });
      }
      else if (action === 'edit-source') { setStatus('当前正在编辑来源记录；保存只会改世界书条目。'); }
      else if (action === 'edit-current-chat') { await openCurrentChatOpeningEditor?.(); }
    } catch (error) {
      const conflict = error?.name === 'WorldbookRevisionConflictError' || /版本冲突|已切换/.test(error?.message || '');
      if (conflict) {
        const modal = root.querySelector('[data-wbe-modal]');
        modal.innerHTML = `<div class="wbe-modal-card" role="alertdialog" aria-modal="true" tabindex="-1"><h3>世界书已变化</h3><p>${escapeHtml(error.message || '保存前内容已变化。')}</p><p>不会自动覆盖。你可以保留本地草稿与最新原文重新对比，或放弃草稿。</p><div class="wbe-top-actions"><button class="wbe-button" data-wbe-action="reload-keep">重载最新并保留草稿</button><button class="wbe-button danger" data-wbe-action="reload-discard">放弃草稿并重载</button></div></div>`;
        modal.hidden = false; conflictDraft = clone(draft);
        modalReturnFocus = hostDocument.activeElement;
        focusModalStart(modal);
      }
      setStatus(error?.message || String(error),'error');
    }
  }
  function onInput(event) {
    const filter = event.target?.dataset?.wbeFilter;
    if (filter) { filters[filter] = event.target.value; renderList(); return; }
    if (event.target?.dataset?.wbeAiField) { readAiField(event.target,event.type); return; }
    if (event.target?.dataset?.wbeField) readField(event.target);
  }
  function onKeydown(event) {
    if (event.key === 'Escape') { if (!root.querySelector('[data-wbe-modal]')?.hidden) closeModal(true); else close(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void prepareSave().catch(error => setStatus(error.message || String(error),'error')); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); root.querySelector('[data-wbe-filter="query"]')?.focus?.(); }
    if (event.key === 'Tab') {
      const modal = root.querySelector('[data-wbe-modal]');
      const scope = modal && !modal.hidden ? modal : root;
      const focusable = [...scope.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node => !node.closest('[hidden]'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = hostDocument.activeElement;
      const card = modal && !modal.hidden ? modal.querySelector('.wbe-modal-card') : null;
      if (card && active === card) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (!scope.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
  }
  async function open() {
    mount(); previousFocus = hostDocument.activeElement; root.hidden = false;
    if (session && draft) { setStatus(isDirty() ? '已恢复未保存的来源草稿。' : '已恢复编辑会话。'); renderAll(); }
    else await reload();
    if (destroyed || !root) throw new Error('世界书编辑器已销毁，不能完成打开');
    root.querySelector('[data-wbe-filter="query"]')?.focus?.();
    return root;
  }
  function close() {
    if (!root) return;
    if (!closeModal(true)) return;
    cancelActiveAi('',false); root.hidden = true;
    try { previousFocus?.focus?.(); } catch (_) {}
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; cancelActiveAi('',false); researchState = { urlInput:'', loadedUrl:'', excerpt:'', includeExcerpt:false }; closeModal(true);
    if (root) { root.removeEventListener('click',onClick); root.removeEventListener('input',onInput); root.removeEventListener('change',onInput); root.removeEventListener('keydown',onKeydown); root.remove(); }
    try { ownedStyle?.remove?.(); } catch (_) {}
    ownedStyle = null;
    root = null;
  }
  return { mount, open, close, reload, destroy, selectEntry, runAiTask, cancelActiveAi, clearAiConfig, get root(){ return root; }, get state(){ return { session:clone(session), entries:clone(entries), original:clone(original), draft:clone(draft), selectedUid, mode, pendingRecommendation:clone(pendingRecommendation), recommendationUndo:clone(recommendationUndo), aiConfig:redactWorldbookAiSessionConfig(aiConfig), activeAiRequest:clone(activeAiRequest), pendingAiProposal:clone(pendingAiProposal), aiProposalUndo:aiProposalUndo ? { fields:[...aiProposalUndo.fields] } : null, research:{ loadedUrl:researchState.loadedUrl, excerptCharacters:researchState.excerpt.length, includeExcerpt:researchState.includeExcerpt }, aiError:clone(aiError), status:{ ...status }, pendingPlan:clone(pendingPlan), conflictDraft:clone(conflictDraft), filters:{ ...filters } }; } };
}

const WorldbookManagerEditor = { WORLDBOOK_EDITOR_VERSION, WORLDBOOK_EDITOR_BUILD, createWorldbookEditor, filterWorldbookEntries, categoryForEntry, formatDiff, numberAttributeValue, protectedConfirmationAccepted, threeWayMergeEntry, recommendWorldbookSettings, applyRecommendedSettings, revertRecommendedSettings, summarizeWorldbookConfiguration, normalizeWorldbookAiSessionConfig, redactWorldbookAiSessionConfig, validateResearchUrl, validateCustomApiUrl, buildWorldbookAiSchema, buildWorldbookAiRequest, normalizeWorldbookAiResult, applyWorldbookAiProposal, worldbookAiProposalRows, worldbookAiDraftFingerprint, safeWorldbookAiError };
if (typeof window !== 'undefined') window.WorldbookManagerEditor = WorldbookManagerEditor;
export { WORLDBOOK_EDITOR_VERSION, WORLDBOOK_EDITOR_BUILD, createWorldbookEditor, filterWorldbookEntries, categoryForEntry, formatDiff, numberAttributeValue, protectedConfirmationAccepted, threeWayMergeEntry, recommendWorldbookSettings, applyRecommendedSettings, revertRecommendedSettings, summarizeWorldbookConfiguration, normalizeWorldbookAiSessionConfig, redactWorldbookAiSessionConfig, validateResearchUrl, validateCustomApiUrl, buildWorldbookAiSchema, buildWorldbookAiRequest, normalizeWorldbookAiResult, applyWorldbookAiProposal, worldbookAiProposalRows, worldbookAiDraftFingerprint, safeWorldbookAiError, WorldbookManagerEditor };
