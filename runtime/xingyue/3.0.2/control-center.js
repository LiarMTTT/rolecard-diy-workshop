(() => {
  const VERSION = '3.0.2';
  const BUTTON_NAME = '星月私立高等学院 控制中心 v3.0.2';
  // 任务3.3：单一真相源 RUNTIME_BASE_URL；media_library.js/status_bar_regex.html 从 window.XY_RT_BASE 读（降级保留内联硬编码）
  const RUNTIME_BASE_URL = 'https://cdn.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.0.2';
  // 任务3.4：开局草稿 localStorage key 提顶层常量，版本 bump 只改这一处（bindOpeningPage 内层 STORAGE_KEY 须与此保持同步）
  const OPENING_DRAFT_KEY = 'xingyue-opening-draft-v291';
  const CONTROL_PANEL_ID = 'xingyue-control-center-panel';
  const CONTROL_PANEL_STYLE_ID = 'xingyue-control-center-style';
  const WAND_CONTAINER_ID = 'xingyue-control-center-wand-container';
  const WAND_BUTTON_ID = 'xingyue-control-center-wand-button';
  const STORAGE_KEY = 'xingyue-academy-control-center-settings-v291';
  const STATIC_INDEX_URL = 'https://liarmttt.github.io/rolecard-diy-workshop/cards/xingyue/index.json';
  const DEFAULT_GATEWAY_URL = 'https://43-132-171-157.sslip.io';
  const SUPPORTED_TYPES = ['character','user_identity','world_factor','shop_item','blueprint','recipe','skill','function'];
  const BLOCKED_TYPES = ['opening_pack','prompt_patch','ui_theme'];
  const SUPPORTED_CARD_SCOPES = ['xingyue','shared'];
  const SUPPORTED_RATINGS = ['general','mature','restricted'];
  const OPENING_SOURCE = 'xingyue-opening-wizard';
  const WORKSHOP_SOURCE = 'xingyue-workshop';
  const WORLD_FACTOR_COMMENT = '[世界因子]当前设定';
  const IDENTITY_COMMENT = '[星月开局]{{user}}身份设定';
  const WORKSHOP_START_COMMENT = '--/星月工坊开始';
  const WORKSHOP_END_COMMENT = '--/星月工坊结束';
  const DEFAULT_SETTINGS = {
    gatewayUrl: DEFAULT_GATEWAY_URL,
    staticIndexUrl: STATIC_INDEX_URL,
    mediaDisplayEnabled: true,
    newsPolicyEnabled: true,
    radarCleanupPolicyEnabled: true,
    summaryUpdateEnabled: true,
    showFrozenInteractiveCharacters: false,
    panelLeft: 0,
    panelTop: 82,
    panelWidth: 520,
    panelHeight: 640,
  };
  if (window.XingyueControlCenter?.destroy) {
    try { window.XingyueControlCenter.destroy(); } catch (_) {}
  }
  let panelOpen = false;
  let workshopCache = [];
  let lastError = '';
  let selectedRecipeId = '';
  let selectedNpcName = '';
  let lastCraftPreview = null;
  let lastNpcPerspective = null;
  let lastVariableFix = null; // B17：当前楼变量重算/定点修正的最近一次结果（预览→写回）
  let workshopAuth = { checked: false, loggedIn: false, publisherId: '', error: '' };
  let workshopIdentity = null; // B4：Discord 昵称/头像，仅内存、随登录交接页 postMessage 传入；不持久化
  const npcPerspectiveCache = {};
  const disposers = [];
  function hostWindow() {
    try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (_) {}
    return window;
  }
  function hostDocument() {
    try { return hostWindow().document || document; } catch (_) { return document; }
  }
  // 控制中心主作用域的 mediaLibrary：renderPanel / renderMediaLibrarySection 等都在 bindOpeningPage 外，
  // 而原 mediaLibrary 只定义在 bindOpeningPage 内部（约 line 1371），导致这些主作用域调用抛
  // ReferenceError「mediaLibrary is not defined」→ 控制中心媒体库分区渲染失败、整面板空白。
  function mediaLibrary() {
    return window.XingyueMediaLibrary || hostWindow().XingyueMediaLibrary || window.CrossedZoneMediaLibrary || hostWindow().CrossedZoneMediaLibrary || null;
  }
  function toast(kind, message) {
    try { if (window.toastr && typeof window.toastr[kind] === 'function') window.toastr[kind](message); } catch (_) {}
  }
  function safeJson(value, fallback) {
    try { return JSON.stringify(value, null, 2); } catch (_) { return fallback || ''; }
  }
  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }
  function numberOf(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : fallback;
  }
  function textOf(value, fallback) {
    const text = String(value ?? '').trim();
    return text || fallback || '';
  }
  function pointerEscape(value) {
    return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
  }
  function packageKey(pkg) {
    return String(pkg?.id || '') + '::' + String(pkg?.type || '');
  }
  function packageRevision(pkg) {
    return String(pkg?.revision || pkg?.updatedAt || pkg?.packageVersion || VERSION);
  }
  function mvuHost() {
    return window.Mvu || hostWindow().Mvu || null;
  }
  function helperHost() {
    const candidates = [window, hostWindow()];
    for (const target of candidates) {
      if (target?.TavernHelper) return target.TavernHelper;
      if (target?.generateRaw || target?.getChatMessages) return target;
    }
    return null;
  }
  function getCurrentMvuData() {
    const Mvu = mvuHost();
    if (!Mvu?.getMvuData) throw new Error('MVU 尚未就绪');
    return Mvu.getMvuData({ type: 'message', message_id: 'latest' });
  }
  function statRoot(mvuData) {
    return (mvuData && isObject(mvuData.stat_data)) ? mvuData.stat_data : (mvuData || {});
  }
  function readSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }
  let settings = readSettings();
  function saveSettings(partial) {
    settings = { ...settings, ...(partial || {}) };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
    broadcastHudSettingsUpdate();
    renderPanel();
    return { ...settings };
  }
  function clampPanelRect(rect, doc = hostDocument()) {
    const win = doc.defaultView || hostWindow();
    const vw = Math.max(320, Number(win.innerWidth || 1280));
    const vh = Math.max(320, Number(win.innerHeight || 720));
    const width = Math.max(320, Math.min(Number(rect.width || settings.panelWidth || 520), vw - 16));
    const height = Math.max(260, Math.min(Number(rect.height || settings.panelHeight || 640), vh - 16));
    const left = Math.max(8, Math.min(Number(rect.left || settings.panelLeft || vw - width - 22), vw - width - 8));
    const top = Math.max(8, Math.min(Number(rect.top || settings.panelTop || 82), vh - height - 8));
    return { left, top, width, height };
  }
  function applyPanelRect(panel) {
    if (!panel) return;
    const rect = clampPanelRect({
      left: settings.panelLeft,
      top: settings.panelTop,
      width: settings.panelWidth,
      height: settings.panelHeight,
    }, panel.ownerDocument || hostDocument());
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.width = rect.width + 'px';
    panel.style.height = rect.height + 'px';
  }
  function savePanelRect(panel) {
    if (!panel) return;
    const rect = clampPanelRect({
      left: parseFloat(panel.style.left),
      top: parseFloat(panel.style.top),
      width: parseFloat(panel.style.width || panel.offsetWidth),
      height: parseFloat(panel.style.height || panel.offsetHeight),
    }, panel.ownerDocument || hostDocument());
    settings = { ...settings, panelLeft: rect.left, panelTop: rect.top, panelWidth: rect.width, panelHeight: rect.height };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
  }
  function broadcastHudSettingsUpdate() {
    const detail = { settings: { ...settings }, source: 'xingyue-control-center', version: VERSION };
    // 正式事件名只保留 'crossed-zone-hud-settings-updated'，'xingyue-hud-settings-updated' 已废弃死信（任务3.2）
    [window, hostWindow()].forEach(target => {
      try { target.dispatchEvent(new CustomEvent('crossed-zone-hud-settings-updated', { detail })); } catch (_) {}
    });
  }
  function stylePanel(doc) {
    if (doc.getElementById(CONTROL_PANEL_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = CONTROL_PANEL_STYLE_ID;
    style.textContent =
      '#xingyue-control-center-panel{position:fixed;z-index:2147483000;right:auto;top:82px;width:min(520px,calc(100vw - 28px));height:min(640px,78vh);overflow:auto;color:#d9f4ff;background:linear-gradient(180deg,rgba(12,28,44,.97),rgba(4,11,18,.99));border:1px solid rgba(107,199,242,.7);box-shadow:0 16px 46px rgba(0,0,0,.55),0 0 24px rgba(107,199,242,.22);font:12px/1.55 "Microsoft YaHei",sans-serif;padding:12px;resize:none}' +
      '#xingyue-control-center-panel[hidden]{display:none!important}#xingyue-control-center-panel button{background:rgba(107,199,242,.08);border:1px solid rgba(107,199,242,.45);color:#d9f4ff;padding:4px 8px;cursor:pointer}#xingyue-control-center-panel button:hover{background:rgba(107,199,242,.18)}' +
      '#xingyue-control-center-panel input,#xingyue-control-center-panel textarea,#xingyue-control-center-panel select{width:100%;min-width:0;background:rgba(3,8,13,.82);border:1px solid rgba(107,199,242,.35);color:#d9f4ff;padding:5px;font:inherit}#xingyue-control-center-panel textarea{min-height:72px;resize:vertical}' +
      '#xingyue-control-center-panel .xy-head{display:flex;gap:8px;align-items:center;margin:-4px -4px 10px;padding:4px;cursor:move;user-select:none}.xy-title{font-weight:700;color:#fff}.xy-close{margin-left:auto}.xy-resize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;border-right:2px solid rgba(255,212,122,.72);border-bottom:2px solid rgba(255,212,122,.72);cursor:nwse-resize}.xy-grid{display:grid;gap:8px}.xy-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);padding:7px;background:rgba(255,255,255,.035)}.xy-section{border:1px solid rgba(107,199,242,.22);padding:8px;background:rgba(255,255,255,.025)}.xy-section h4{margin:0 0 6px;color:#fff}.xy-section label{display:grid;gap:4px;margin:6px 0;color:#9fc7d8}.xy-list{display:grid;gap:6px}.xy-card{border:1px solid rgba(107,199,242,.2);padding:7px;background:rgba(0,0,0,.18)}.xy-actions{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.xy-pre{white-space:pre-wrap;max-height:220px;overflow:auto;border:1px dashed rgba(107,199,242,.24);background:rgba(0,0,0,.22);padding:7px;color:#bfeaff}.xy-muted{color:#9fc7d8}.xy-switch-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.xy-switch{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);background:rgba(255,255,255,.025);padding:7px;text-align:left}.xy-switch b{display:block;color:#fff;font-weight:600}.xy-switch span{display:block;color:#9fc7d8;font-size:11px}.xy-switch i{font-style:normal;color:#ffd47a}.xy-switch.is-on{border-color:rgba(115,226,189,.55);background:rgba(115,226,189,.08)}.xy-switch.is-on i{color:#73e2bd}.native-wand-menu{display:inline-flex;align-items:center;margin-left:4px}#xingyue-control-center-wand-button{border:1px solid rgba(107,199,242,.45);background:rgba(107,199,242,.08);color:#d9f4ff;padding:2px 7px;cursor:pointer}@media(max-width:520px){#xingyue-control-center-panel .xy-switch-grid{grid-template-columns:1fr}}';
    (doc.head || doc.documentElement).appendChild(style);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function assertOptionalString(value, name, maxLength) {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') throw new Error(name + ' 必须是字符串');
    if (value.length > maxLength) throw new Error(name + ' 超过长度限制');
  }
  function validatePackage(pkg, allowedTypes) {
    if (!isObject(pkg)) throw new Error('工坊包不是 JSON 对象');
    const size = JSON.stringify(pkg).length;
    if (size > 256 * 1024) throw new Error('工坊包超过 256KB 限制');
    if (!pkg.packageVersion || typeof pkg.packageVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.packageVersion)) {
      throw new Error('工坊包 packageVersion 无效');
    }
    if (BLOCKED_TYPES.includes(pkg.type)) throw new Error('该类型暂不开放：' + pkg.type);
    if (!SUPPORTED_TYPES.includes(pkg.type)) throw new Error('未知工坊包类型：' + (pkg.type || '空'));
    if (allowedTypes && allowedTypes.length && !allowedTypes.includes(pkg.type)) throw new Error('当前页面不接受类型：' + pkg.type);
    if (!pkg.id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(String(pkg.id))) throw new Error('工坊包 id 无效');
    if (!SUPPORTED_CARD_SCOPES.includes(pkg.cardScope)) throw new Error('工坊包 cardScope 不适用于星月：' + (pkg.cardScope || '空'));
    if (!pkg.title || typeof pkg.title !== 'string' || pkg.title.length > 120) throw new Error('工坊包标题无效');
    assertOptionalString(pkg.summary, '工坊包 summary', 600);
    assertOptionalString(pkg.authorName, '工坊包 authorName', 80);
    if (pkg.rating !== undefined && !SUPPORTED_RATINGS.includes(pkg.rating)) throw new Error('工坊包 rating 无效：' + pkg.rating);
    if (pkg.language !== undefined && (typeof pkg.language !== 'string' || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(pkg.language))) {
      throw new Error('工坊包 language 无效');
    }
    if (pkg.tags !== undefined) {
      if (!Array.isArray(pkg.tags) || pkg.tags.length > 12) throw new Error('工坊包 tags 无效');
      pkg.tags.forEach(tag => {
        if (typeof tag !== 'string' || !tag.trim() || tag.length > 40) throw new Error('工坊包 tag 无效');
      });
    }
    if (!isObject(pkg.payload)) throw new Error('工坊包缺少 payload');
    return pkg;
  }
  // —— 工坊会话 Token（无状态，存 localStorage，走 Authorization: Bearer，绕开第三方 Cookie 淘汰）——
  function getWorkshopToken() { try { return localStorage.getItem('xingyue-workshop-token') || ''; } catch (_) { return ''; } }
  function setWorkshopToken(token) { try { if (token) localStorage.setItem('xingyue-workshop-token', String(token)); else localStorage.removeItem('xingyue-workshop-token'); } catch (_) {} }
  // B3：登出——清 token + 重置鉴权态 + 重渲染（已登录时 login-discord 动作走这里，避免再弹登录页）
  async function logout() {
    // #5a：先请求 Gateway 清会话 cookie，否则 /me 靠 cookie 回退仍返回已登录 → 登出「失效」。
    try { const base = gatewayBaseUrl(); if (base) await fetch(base + '/api/workshop/logout', { method: 'POST', credentials: 'include', headers: authHeaders() }); } catch (_) {}
    setWorkshopToken(null);
    workshopAuth = { checked: true, loggedIn: false, publisherId: '', error: '' };
    workshopIdentity = null;
    try { refreshWorkshop(); } catch (_) {}
    return { ...workshopAuth };
  }
  function getWorkshopIdentity() { return workshopIdentity ? { ...workshopIdentity } : null; }
  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    const token = getWorkshopToken();
    if (token) headers.authorization = 'Bearer ' + token;
    return headers;
  }
  // 监听登录成功交接页 postMessage 回传的 token（监听挂在 hostWindow——loginDiscord 用 hostWindow().open，opener 即 hostWindow）
  function captureWorkshopLogin() {
    let hw;
    try { hw = hostWindow(); } catch (_) { return; }
    if (!hw || hw.__xyWorkshopLoginListener) return;
    hw.__xyWorkshopLoginListener = true;
    try {
      hw.addEventListener('message', function (event) {
        try {
          const gw = gatewayBaseUrl();
          let okOrigin = false;
          try { okOrigin = !!gw && new URL(gw).origin === event.origin; } catch (_) {}
          if (!okOrigin) return;
          const data = event.data;
          if (!data || data.type !== 'xy-workshop-token' || !data.token) return;
          setWorkshopToken(String(data.token));
          if (data.name || data.avatar) workshopIdentity = { name: String(data.name || ''), avatar: String(data.avatar || '') };
          checkWorkshopAuth().then(function () { try { refreshWorkshop(); } catch (_) {} });
        } catch (_) {}
      });
    } catch (_) {}
  }
  async function fetchJson(url, options) {
    const opt = options || {};
    const res = await fetch(url, { credentials: 'include', ...opt, headers: authHeaders(opt.headers) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  function gatewayBaseUrl() {
    return String(settings.gatewayUrl || DEFAULT_GATEWAY_URL || '').replace(/\/+$/, '');
  }
  async function checkWorkshopAuth() {
    const base = gatewayBaseUrl();
    if (!base) {
      workshopAuth = { checked: true, loggedIn: false, publisherId: '', error: 'gateway-url-missing' };
      return { ...workshopAuth };
    }
    try {
      const res = await fetch(base + '/api/workshop/me', { credentials: 'include', headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      workshopAuth = {
        checked: true,
        loggedIn: Boolean(res.ok && body.loggedIn),
        publisherId: String(body.publisherId || ''),
        error: res.ok || res.status === 401 ? '' : 'HTTP ' + res.status,
      };
    } catch (error) {
      workshopAuth = { checked: true, loggedIn: false, publisherId: '', error: error.message || String(error) };
    }
    return { ...workshopAuth };
  }
  function workshopLoginUrl() {
    let ret = '';
    try { ret = hostWindow().location.origin || ''; } catch (_) {}
    return gatewayBaseUrl() + '/auth/discord/login' + (ret ? ('?return=' + encodeURIComponent(ret)) : '');
  }
  async function refreshWorkshop(options = {}) {
    const types = options.types || [];
    const list = [];
    lastError = '';
    // 未登录也能浏览/下载公开包（对齐 api-contract）；登录态仍刷新，供 UI 显示与赞踩/发布判断
    await checkWorkshopAuth();
    try {
      const index = await fetchJson(gatewayBaseUrl() + '/api/workshop/packages?cardScope=xingyue');
      list.push(...(index.packages || []));
    } catch (error) {
      lastError = 'gateway-index:' + (error.message || error);
      // 任务4.13：rethrow 让调用方 catch 到失败（之前静默导致工坊 tab 无 toast 提示）
      throw error;
    }
    const byId = new Map();
    list.forEach(pkg => {
      if (!pkg || !pkg.id) return;
      if (types.length && !types.includes(pkg.type)) return;
      byId.set(packageKey(pkg), pkg);
    });
    workshopCache = [...byId.values()];
    renderPanel();
    return workshopCache;
  }
  async function packageDetail(pkg) {
    if (pkg.payload) return validatePackage(pkg);
    if (!pkg.manifestUrl) throw new Error('包缺少 manifestUrl');
    return validatePackage(await fetchJson(pkg.manifestUrl));
  }
  function packageToWorldbookText(pkg) {
    return [
      '# ' + pkg.title,
      '',
      pkg.summary || '',
      '',
      'type: ' + pkg.type,
      'id: ' + pkg.id,
      'revision: ' + packageRevision(pkg),
      'tags: ' + (pkg.tags || []).join(', '),
      '',
      'payload:',
      JSON.stringify(pkg.payload || {}, null, 2),
    ].join('\n');
  }
  function readOpeningDraft() {
    try { return JSON.parse(localStorage.getItem(OPENING_DRAFT_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeOpeningDraft(patch) {
    const next = { ...readOpeningDraft(), ...(patch || {}) };
    try { localStorage.setItem(OPENING_DRAFT_KEY, JSON.stringify(next)); } catch (_) {}
    return next;
  }
  function importPackageToDraft(pkg) {
    pkg = validatePackage(pkg);
    const draft = readOpeningDraft();
    draft.packages = Array.isArray(draft.packages) ? draft.packages : [];
    const key = packageKey(pkg);
    draft.packages = draft.packages.filter(item => packageKey(item) !== key).concat([pkg]);
    draft.enabledPackages = (draft.enabledPackages && typeof draft.enabledPackages === 'object') ? draft.enabledPackages : {};
    if (draft.enabledPackages[key] === undefined) draft.enabledPackages[key] = false;
    if (pkg.type === 'user_identity') {
      draft.player_identity = pkg.payload.identity || draft.player_identity || '';
      draft.player_callname = pkg.payload.callname || draft.player_callname || '';
      draft.player_background = pkg.payload.background || draft.player_background || '';
      draft.enabledPackages[key] = true;
    }
    if (pkg.type === 'world_factor') {
      draft.worldFactors = Array.isArray(draft.worldFactors) ? draft.worldFactors : [];
      draft.worldFactors = draft.worldFactors.filter(item => packageKey(item) !== key).concat([pkg]);
    }
    try { localStorage.setItem(OPENING_DRAFT_KEY, JSON.stringify(draft)); } catch (_) {}
    return draft;
  }
  async function importPackage(pkg, options = {}) {
    pkg = validatePackage(pkg, options.allowedTypes || []);
    importPackageToDraft(pkg);
    toast('success', '已导入工坊包：' + pkg.title);
    return pkg;
  }
  async function installPackageToWorldbook(pkg, options = {}) {
    pkg = validatePackage(pkg, options.allowedTypes || []);
    const result = await installWorkshopPackageEntries(pkg);
    if (result?.applied) toast('success', '已安装到聊天世界书：' + pkg.title);
    else if (result?.warning) toast('info', result.warning);
    return { ...result, package: pkg };
  }
  function worldFactorContent(draft = readOpeningDraft()) {
    const lines = [];
    if (Array.isArray(draft.selected_world_factors)) draft.selected_world_factors.forEach(item => lines.push('- ' + item));
    if (Array.isArray(draft.custom_world_factors)) draft.custom_world_factors.forEach(f => {
      const title = String((f && f.title) || '').trim();
      const content = String((f && f.content) || '').trim();
      if (title && content) lines.push('- ' + title + '：' + content);
      else if (title || content) lines.push('- ' + (title || content));
    });
    if (draft.custom_world_factor) String(draft.custom_world_factor).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(item => lines.push('- ' + item));
    return lines.join('\n').trim();
  }
  function workshopWorldbookEntries(draft = readOpeningDraft()) {
    const byPackage = new Map();
    const enabled = draft.enabledPackages && typeof draft.enabledPackages === 'object' ? draft.enabledPackages : {};
    (draft.packages || []).forEach(pkg => {
      if (!pkg || !pkg.id || !pkg.type) return;
      if (enabled[packageKey(pkg)] !== true) return;
      byPackage.set(packageKey(pkg), pkg);
    });
    return [...byPackage.values()]
      .map(pkg => ({
        comment: '[星月工坊][' + pkg.type + ']' + pkg.title,
        content: packageToWorldbookText(pkg),
        packageId: pkg.id,
        packageType: pkg.type,
        revision: packageRevision(pkg),
      }));
  }
  function identityContent(draft = readOpeningDraft()) {
    const identity = String(draft.player_identity || '').trim();
    const callname = String(draft.player_callname || '').trim();
    const appearance = String(draft.player_appearance || '').trim();
    const skills = String(draft.player_skills || '').trim();
    const background = String(draft.player_background || '').trim();
    // 仅当玩家在身份页填了任意文本字段才生成覆盖条目，避免用默认值凭空覆盖角色卡自带身份
    if (!identity && !callname && !appearance && !skills && !background) return '';
    const lines = [];
    if (identity) lines.push('    - 身份: ' + identity);
    if (callname) lines.push('    - 称呼: ' + callname);
    const attrs = (draft.core_attributes && typeof draft.core_attributes === 'object') ? draft.core_attributes : null;
    if (attrs) {
      const parts = Object.keys(attrs).map(key => key + ' ' + (Number(attrs[key]) || 0));
      if (parts.length) lines.push('    - 核心属性: ' + parts.join(' / '));
    }
    if (appearance) lines.push('    - 外貌: ' + appearance);
    if (skills) lines.push('    - 技能与天赋: ' + skills.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join('；'));
    if (background) lines.push('    - 背景: ' + background);
    // 任务4.3：补 player_avatar 行，写入世界书条目时包含头像引用
    const avatar = String(draft.player_avatar || '').trim();
    if (avatar) lines.push('    - 头像: ' + avatar);
    return '<user_roles>\n' + lines.join('\n') + '\n</user_roles>';
  }
  function openingWorldbookPayload(draft = readOpeningDraft()) {
    return {
      identity: identityContent(draft),
      worldFactor: worldFactorContent(draft),
      workshopEntries: workshopWorldbookEntries(draft),
      worldbookName: null,
      applied: false,
      warning: '',
    };
  }
  function dispatchOpeningWorldbookPreview(payload) {
    try {
      window.dispatchEvent(new CustomEvent('xingyue-opening-worldbook-preview', { detail: payload }));
      hostWindow().dispatchEvent(new CustomEvent('xingyue-opening-worldbook-preview', { detail: payload }));
    } catch (_) {}
  }
  function makeConstantEntry(name, content, extra) {
    const options = extra?.__options || {};
    const cleanExtra = { ...(extra || {}) };
    delete cleanExtra.__options;
    const source = cleanExtra.source || OPENING_SOURCE;
    delete cleanExtra.source;
    return {
      name,
      enabled: options.enabled ?? Boolean(String(content || '').trim()),
      strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: 'before_author_note', role: 'system', depth: 4, order: options.order ?? 100 },
      content: String(content || ''),
      probability: 100,
      recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
      extra: { source, version: VERSION, ...cleanExtra },
    };
  }
  function makeWorkshopBoundaryEntry(name, kind) {
    return makeConstantEntry(name, '', {
      source: WORKSHOP_SOURCE,
      kind,
      __options: { enabled: false, order: kind === 'workshop_boundary_start' ? 101 : 199 },
    });
  }
  function worldbookApiHost() {
    const candidates = [window, hostWindow(), window?.TavernHelper, hostWindow()?.TavernHelper];
    for (const target of candidates) {
      if (target?.updateWorldbookWith && (target?.getCharWorldbookNames || target?.getWorldbookNames)) return target;
    }
    return null;
  }
  // #6：开局/工坊条目写入「角色卡绑定的世界书」（同源 4.2 范式 getCharWorldbookNames('current').primary），
  // 取代旧的 getOrCreateChatWorldbook（会另建聊天世界书、撞名报错、且写错对象）。
  async function resolveCardWorldbookName(apiHost) {
    try { const c = apiHost?.getCharWorldbookNames?.('current'); if (c && c.primary) return c.primary; } catch (_) {}
    try {
      const all = apiHost?.getWorldbookNames?.();
      if (Array.isArray(all)) { const hit = all.find(n => /星月私立高等学院\s*ver/.test(String(n))); if (hit) return hit; }
    } catch (_) {}
    return '';
  }
  function isOpeningManagedEntry(entry) {
    return entry?.extra?.source === OPENING_SOURCE && (entry.name === WORLD_FACTOR_COMMENT || entry.name === IDENTITY_COMMENT || entry.extra?.kind === 'world_factor' || entry.extra?.kind === 'identity');
  }
  function isWorkshopManagedEntry(entry) {
    if (entry?.extra?.source === WORKSHOP_SOURCE) return true;
    return entry?.extra?.source === OPENING_SOURCE && entry.extra?.kind === 'workshop_package';
  }
  function upsertEntries(existing, openingEntries, workshopEntries) {
    const preservedByName = new Map();
    (Array.isArray(existing) ? existing : []).forEach(entry => {
      if (isOpeningManagedEntry(entry) || isWorkshopManagedEntry(entry)) {
        preservedByName.set(entry.name, entry);
      }
    });
    const preserveUid = entry => {
      const previous = preservedByName.get(entry.name);
      return previous?.uid ? { ...entry, uid: previous.uid } : entry;
    };
    const base = (Array.isArray(existing) ? existing : []).filter(entry => !isOpeningManagedEntry(entry) && !isWorkshopManagedEntry(entry));
    const workshopBlock = [
      makeWorkshopBoundaryEntry(WORKSHOP_START_COMMENT, 'workshop_boundary_start'),
      ...workshopEntries,
      makeWorkshopBoundaryEntry(WORKSHOP_END_COMMENT, 'workshop_boundary_end'),
    ].map(preserveUid);
    return [
      ...base,
      ...openingEntries.map(preserveUid),
      ...workshopBlock,
    ];
  }
  function sameWorkshopPackage(entry, item) {
    const targetId = item?.packageId ?? item?.extra?.packageId;
    const targetType = item?.packageType ?? item?.extra?.packageType;
    return entry?.extra?.source === WORKSHOP_SOURCE &&
      entry?.extra?.kind === 'workshop_package' &&
      String(entry.extra.packageId || '') === String(targetId || '') &&
      String(entry.extra.packageType || '') === String(targetType || '');
  }
  function installSingleWorkshopEntry(existing, entry) {
    const source = Array.isArray(existing) ? existing : [];
    const start = makeWorkshopBoundaryEntry(WORKSHOP_START_COMMENT, 'workshop_boundary_start');
    const end = makeWorkshopBoundaryEntry(WORKSHOP_END_COMMENT, 'workshop_boundary_end');
    const nonWorkshop = [];
    const workshopPackages = [];
    source.forEach(item => {
      if (item?.name === WORKSHOP_START_COMMENT || item?.name === WORKSHOP_END_COMMENT) return;
      if (isWorkshopManagedEntry(item)) {
        if (!sameWorkshopPackage(item, entry)) workshopPackages.push(item);
        return;
      }
      nonWorkshop.push(item);
    });
    return [
      ...nonWorkshop,
      start,
      ...workshopPackages,
      entry,
      end,
    ];
  }
  function makeWorkshopPackageEntry(item, installedAt = new Date().toISOString()) {
    return makeConstantEntry(item.comment, item.content, {
      source: WORKSHOP_SOURCE,
      kind: 'workshop_package',
      packageId: item.packageId,
      packageType: item.packageType,
      revision: item.revision,
      installedAt,
      __options: { order: 110 },
    });
  }
  async function writeOpeningWorldbookEntries(draft = readOpeningDraft(), options = {}) {
    const scope = options.scope || 'all'; // #2(2.9.8)：'identity' 只身份/世界因子 · 'workshop' 只工坊内容 · 'all' 两者
    const payload = openingWorldbookPayload(draft);
    const apiHost = worldbookApiHost();
    if (!apiHost) {
      payload.warning = '当前环境未检测到 Tavern Helper 世界书 API，已仅生成预览事件。';
      dispatchOpeningWorldbookPreview(payload);
      return payload;
    }
    const worldbookName = await resolveCardWorldbookName(apiHost);
    if (!worldbookName) {
      payload.warning = '未能定位角色卡绑定的世界书，已仅生成预览事件。请确认已在 ST 正常打开本角色卡。';
      dispatchOpeningWorldbookPreview(payload);
      return payload;
    }
    const openingEntries = [];
    if (payload.identity) openingEntries.push(makeConstantEntry(IDENTITY_COMMENT, payload.identity, { kind: 'identity' }));
    if (payload.worldFactor) openingEntries.push(makeConstantEntry(WORLD_FACTOR_COMMENT, payload.worldFactor, { kind: 'world_factor' }));
    const installedAt = new Date().toISOString();
    const workshopEntries = payload.workshopEntries.map(item => makeWorkshopPackageEntry(item, installedAt));
    if (scope === 'identity' && !openingEntries.length) {
      payload.warning = '没有可写入的身份/世界因子内容。'; dispatchOpeningWorldbookPreview(payload); return payload;
    }
    if (scope === 'workshop' && !workshopEntries.length) {
      payload.warning = '没有已启用的工坊内容可注入。'; dispatchOpeningWorldbookPreview(payload); return payload;
    }
    await apiHost.updateWorldbookWith(worldbookName, worldbook => {
      // #2(2.9.8)：拆 scope 时保留未更新的那一类，避免「只写身份」误删工坊条目（反之亦然）。
      const cur = Array.isArray(worldbook) ? worldbook : [];
      const keepOpening = cur.filter(isOpeningManagedEntry);
      const keepWorkshopPkgs = cur.filter(e => isWorkshopManagedEntry(e) && e.extra?.kind === 'workshop_package');
      const finalOpening = scope === 'workshop' ? keepOpening : openingEntries;
      const finalWorkshop = scope === 'identity' ? keepWorkshopPkgs : workshopEntries;
      return upsertEntries(worldbook, finalOpening, finalWorkshop);
    }, { render: 'debounced' });
    payload.worldbookName = worldbookName;
    payload.applied = true;
    payload.scope = scope;
    dispatchOpeningWorldbookPreview(payload);
    return payload;
  }
  async function installWorkshopPackageEntries(pkg) {
    const payload = {
      worldFactor: '',
      workshopEntries: [{
        comment: '[星月工坊][' + pkg.type + ']' + pkg.title,
        content: packageToWorldbookText(pkg),
        packageId: pkg.id,
        packageType: pkg.type,
        revision: packageRevision(pkg),
      }],
      worldbookName: null,
      applied: false,
      warning: '',
    };
    const apiHost = worldbookApiHost();
    if (!apiHost) {
      payload.warning = '当前环境未检测到 Tavern Helper 世界书 API，已仅生成预览事件。';
      dispatchOpeningWorldbookPreview(payload);
      return payload;
    }
    const worldbookName = await resolveCardWorldbookName(apiHost);
    if (!worldbookName) {
      payload.warning = '未能定位角色卡绑定的世界书，已仅生成预览事件。请确认已在 ST 正常打开本角色卡。';
      dispatchOpeningWorldbookPreview(payload);
      return payload;
    }
    const item = payload.workshopEntries[0];
    const entry = makeWorkshopPackageEntry(item);
    await apiHost.updateWorldbookWith(worldbookName, worldbook => installSingleWorkshopEntry(worldbook, entry), { render: 'debounced' });
    payload.worldbookName = worldbookName;
    payload.applied = true;
    dispatchOpeningWorldbookPreview(payload);
    return payload;
  }
  function previewOpeningWrites(draft = readOpeningDraft()) {
    const payload = {
      identity: identityContent(draft),
      worldFactor: worldFactorContent(draft),
      workshopEntries: workshopWorldbookEntries(draft).map(item => item.comment),
    };
    return payload;
  }
  function readCurrentStatSafe() {
    try { return statRoot(getCurrentMvuData()); } catch (_) { return null; }
  }
  function recipeEntries(root = readCurrentStatSafe()) {
    const recipes = isObject(root?.配方) ? root.配方 : {};
    return Object.entries(recipes).map(([id, value]) => ({
      id,
      title: textOf(value?.名称 || value?.title || value?.标题, id),
      recipe: isObject(value) ? value : {},
    }));
  }
  function normalizeQuantityRecord(source, defaultAmount = 1) {
    const out = [];
    const push = (id, amount, data) => {
      id = textOf(id);
      if (!id) return;
      out.push({ id, amount: Math.max(0, numberOf(amount, defaultAmount)), data: clone(data) || {} });
    };
    if (Array.isArray(source)) {
      source.forEach(item => {
        if (typeof item === 'string') push(item, defaultAmount, { 名称: item });
        else if (isObject(item)) push(item.id || item.ID || item.物品ID || item.物品 || item.名称 || item.name, item.数量 ?? item.count ?? item.amount ?? defaultAmount, item);
      });
      return out;
    }
    if (isObject(source)) {
      Object.entries(source).forEach(([id, item]) => {
        if (isObject(item)) push(item.id || item.ID || item.物品ID || item.物品 || item.名称 || item.name || id, item.数量 ?? item.count ?? item.amount ?? defaultAmount, item);
        else push(id, item, { 名称: id, 数量: item });
      });
    }
    return out;
  }
  function recipeRequirements(recipe) {
    const input = recipe?.输入 || recipe?.input || {};
    const source = input.材料 ?? input.materials ?? input.消耗 ?? input.items ?? recipe?.材料 ?? recipe?.materials ?? input;
    return normalizeQuantityRecord(source, 1).filter(item => item.amount > 0);
  }
  function recipeProducts(recipe, branch) {
    const output = recipe?.输出 || recipe?.output || {};
    const randomSource = output.随机产物 || output.random || output.randomItems;
    if (branch === 'success' && randomSource) return pickWeighted(normalizeQuantityRecord(randomSource, 1));
    const failSource = output.失败副产物 || output.failItems || output.failureItems;
    if (branch === 'failure' && failSource) return normalizeQuantityRecord(failSource, 1);
    const source = output.产物 ?? output.成功产物 ?? output.items ?? output.物品 ?? output.道具 ?? (!randomSource && !failSource ? output : null);
    return branch === 'success' ? normalizeQuantityRecord(source, 1) : [];
  }
  function pickWeighted(items) {
    if (!items.length) return [];
    const weightOf = item => Math.max(0, numberOf(item.data?.权重 ?? item.data?.weight, 1));
    const total = items.reduce((sum, item) => sum + weightOf(item), 0);
    if (total <= 0) return [items[items.length - 1]];
    let roll = Math.random() * total;
    for (const item of items) {
      roll -= weightOf(item);
      if (roll <= 0) return [item];
    }
    return [items[items.length - 1]];
  }
  function inventoryItem(root, id) {
    const items = isObject(root?.资产库?.物品) ? root.资产库.物品 : {};
    return items[id];
  }
  function inventoryAmount(root, id) {
    const item = inventoryItem(root, id);
    if (typeof item === 'number') return item;
    if (isObject(item)) return numberOf(item.数量 ?? item.count ?? item.amount, 0);
    return 0;
  }
  function recipeChance(recipe, root) {
    const settle = recipe?.结算 || recipe?.settlement || {};
    let chance = numberOf(settle.成功率 ?? settle.successRate, 1);
    if (chance > 1) chance /= 100;
    const check = settle.检定 || settle.check;
    if (isObject(check)) {
      const key = textOf(check.属性 || check.技能 || check.key || check.name);
      const difficulty = numberOf(check.难度 ?? check.difficulty, 0);
      const bonus = numberOf(check.加成 ?? check.bonus, 0);
      const attr = numberOf(root?.user?.核心属性?.[key], 0);
      const skillText = root?.天赋与技能?.技能?.[key]?.技能等级 || root?.天赋与技能?.技能?.[key]?.等级;
      const skill = numberOf(skillText, 0);
      if (key) chance += Math.max(attr, skill) * 0.03 + bonus * 0.01 - difficulty * 0.01;
    }
    return Math.max(0, Math.min(1, chance));
  }
  function failureRequirements(recipe, baseRequirements) {
    const source = recipe?.结算?.失败消耗 ?? recipe?.settlement?.failureConsume;
    if (source === undefined || source === null || source === false) return [];
    if (typeof source === 'number') {
      return baseRequirements.map(item => ({ ...item, amount: Math.ceil(item.amount * Math.max(0, source)) })).filter(item => item.amount > 0);
    }
    return normalizeQuantityRecord(source, 1).filter(item => item.amount > 0);
  }
  function opForPath(root, pathParts, value) {
    let cursor = root;
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      cursor = cursor?.[pathParts[i]];
      if (!isObject(cursor) && !Array.isArray(cursor)) break;
    }
    const key = pathParts[pathParts.length - 1];
    const exists = cursor && Object.prototype.hasOwnProperty.call(cursor, key);
    return { op: exists ? 'replace' : 'add', path: '/' + pathParts.map(pointerEscape).join('/'), value };
  }
  function ensureAssetPatch(root, ops) {
    if (!isObject(root.资产库)) ops.push({ op: 'add', path: '/资产库', value: { 物品: {}, 容器: { 随身: [], 仓储: {}, 放置: {} }, 流转记录: {} } });
    else {
      if (!isObject(root.资产库.物品)) ops.push(opForPath(root, ['资产库', '物品'], {}));
      if (!isObject(root.资产库.容器)) ops.push(opForPath(root, ['资产库', '容器'], { 随身: [], 仓储: {}, 放置: {} }));
      if (!isObject(root.资产库.流转记录)) ops.push(opForPath(root, ['资产库', '流转记录'], {}));
    }
  }
  function buildCraftSettlement(recipeId, options = {}) {
    const root = readCurrentStatSafe();
    if (!root) throw new Error('当前楼 MVU 变量不可读取');
    const entry = recipeEntries(root).find(item => item.id === recipeId);
    if (!entry) throw new Error('未选择有效配方');
    const requirements = recipeRequirements(entry.recipe);
    const missing = requirements
      .map(item => ({ ...item, available: inventoryAmount(root, item.id) }))
      .filter(item => item.available < item.amount);
    if (missing.length) return { ok: false, recipeId, title: entry.title, requirements, missing, patch: [], message: '材料不足' };
    const chance = recipeChance(entry.recipe, root);
    const shouldRoll = options.commit !== false && chance < 1;
    const roll = shouldRoll ? Math.random() : null;
    const success = shouldRoll ? roll <= chance : true;
    const consume = success ? requirements : failureRequirements(entry.recipe, requirements);
    const products = recipeProducts(entry.recipe, success ? 'success' : 'failure');
    const ops = [];
    ensureAssetPatch(root, ops);
    consume.forEach(req => {
      const item = inventoryItem(root, req.id);
      const current = inventoryAmount(root, req.id);
      const nextAmount = Math.max(0, current - req.amount);
      if (isObject(item)) ops.push(opForPath(root, ['资产库', '物品', req.id], { ...clone(item), 数量: nextAmount }));
      else ops.push(opForPath(root, ['资产库', '物品', req.id], { 名称: req.id, 数量: nextAmount }));
    });
    products.forEach(product => {
      const existing = inventoryItem(root, product.id);
      const current = inventoryAmount(root, product.id);
      const value = isObject(existing)
        ? { ...clone(existing), 数量: current + product.amount }
        : { 名称: product.data?.名称 || product.id, 数量: product.amount, 来源: '配方制造' };
      ops.push(opForPath(root, ['资产库', '物品', product.id], value));
    });
    if (products.length) {
      const carried = Array.isArray(root?.资产库?.容器?.随身) ? [...root.资产库.容器.随身] : [];
      products.forEach(product => { if (!carried.includes(product.id)) carried.push(product.id); });
      ops.push(opForPath(root, ['资产库', '容器', '随身'], carried));
    }
    const recordId = 'craft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    ops.push({
      op: 'add',
      path: '/资产库/流转记录/' + pointerEscape(recordId),
      value: {
        时间: new Date().toISOString(),
        操作: entry.recipe.类型 || entry.recipe.type || '制造/改造',
        物品ID: products.map(item => item.id).join(', ') || entry.title,
        数量: products.reduce((sum, item) => sum + item.amount, 0),
        来源: '配方:' + entry.title,
        去向: success ? '资产库.物品' : '失败副产物/记录',
        结果: success ? '成功' : '失败',
      },
    });
    return { ok: true, recipeId, title: entry.title, requirements, missing: [], products, consume, chance, roll, success, patch: ops };
  }
  function decodePointer(part) {
    return String(part).replace(/~1/g, '/').replace(/~0/g, '~');
  }
  function applyPatchObject(target, ops) {
    ops.forEach(op => {
      const parts = String(op.path || '').replace(/^\//, '').split('/').filter(Boolean).map(decodePointer);
      let cursor = target;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        if (!isObject(cursor[key]) && !Array.isArray(cursor[key])) cursor[key] = {};
        cursor = cursor[key];
      }
      const key = parts[parts.length - 1];
      if (op.op === 'remove') {
        if (Array.isArray(cursor)) cursor.splice(Number(key), 1);
        else delete cursor[key];
      } else {
        cursor[key] = clone(op.value);
      }
    });
    return target;
  }
  async function applyCraftSettlement(recipeId) {
    const settlement = buildCraftSettlement(recipeId, { commit: true });
    if (!settlement.ok) throw new Error(settlement.message + '：' + settlement.missing.map(item => item.id + ' ' + item.available + '/' + item.amount).join('，'));
    const Mvu = mvuHost();
    if (!Mvu?.replaceMvuData) throw new Error('MVU 写入接口尚未就绪');
    const oldData = getCurrentMvuData();
    const message = '<UpdateVariable><JSONPatch>' + JSON.stringify(settlement.patch) + '</JSONPatch></UpdateVariable>';
    let nextData = null;
    if (typeof Mvu.parseMessage === 'function') {
      try { nextData = await Mvu.parseMessage(message, oldData); } catch (_) { nextData = null; }
    }
    if (!nextData) {
      nextData = clone(oldData);
      applyPatchObject(statRoot(nextData), settlement.patch);
    }
    await Mvu.replaceMvuData(nextData, { type: 'message', message_id: 'latest' });
    lastCraftPreview = settlement;
    toast('success', '制造/改造结算已写入当前楼变量');
    renderPanel();
    return settlement;
  }
  // B17 变量微调工具：修一个错变量不必重 roll 整条消息——省一次正文生成成本，所有 MVU 卡通用。
  // 共用写回三段式：generateRaw 只生成变量 → Mvu.parseMessage 解析 <UpdateVariable> → replaceMvuData 只写当前楼，不改正文、不动历史楼。
  function variableGenerateRaw() {
    const helper = helperHost();
    const fn = helper?.generateRaw || window.generateRaw || hostWindow().generateRaw;
    if (typeof fn !== 'function') throw new Error('Tavern Helper generateRaw 不可用');
    return fn;
  }
  async function writeRawToCurrentFloor(raw) {
    const Mvu = mvuHost();
    if (!Mvu?.replaceMvuData) throw new Error('MVU 写入接口尚未就绪');
    if (!/<UpdateVariable/i.test(String(raw || ''))) throw new Error('结果未包含 <UpdateVariable> 块，已放弃写入');
    const oldData = getCurrentMvuData();
    let nextData = null;
    if (typeof Mvu.parseMessage === 'function') {
      try { nextData = await Mvu.parseMessage(String(raw), oldData); } catch (_) { nextData = null; }
    }
    if (!nextData) throw new Error('未能从结果解析出有效变量更新（格式不合规）');
    await Mvu.replaceMvuData(nextData, { type: 'message', message_id: 'latest' });
  }
  async function rerollCurrentVariables() {
    const generateRaw = variableGenerateRaw();
    const oldData = getCurrentMvuData();
    const root = statRoot(oldData);
    const message = currentMessageInfo();
    const prompt = [
      '当前楼正文：',
      (message.text || '（无法读取正文）').slice(0, 6000),
      '',
      '当前变量状态 stat_data（结构与字段以此为准）：',
      safeJson(root, '{}').slice(0, 6000),
      '',
      '请严格沿用上述变量结构与字段名，只为「当前楼正文」重新生成应有的变量更新，输出单个 <UpdateVariable> 块（内含 JSONPatch）。',
      '只改这一楼应当变化的变量；不要重新生成正文、不要输出世界书条目、cot 或给下一楼的提示词。',
    ].join('\n');
    const raw = String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.0.2 的当前楼变量重算器，只输出一个 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim();
    await writeRawToCurrentFloor(raw);
    lastVariableFix = { kind: 'reroll', instruction: '（整楼重算）', raw, at: new Date().toISOString() };
    toast('success', '当前楼变量已重算（正文未改、未消耗历史楼）');
    renderPanel();
    return lastVariableFix;
  }
  async function previewVariableCorrection(instruction) {
    instruction = String(instruction || '').trim();
    if (!instruction) throw new Error('请先用一句话写出要修正什么');
    const generateRaw = variableGenerateRaw();
    const oldData = getCurrentMvuData();
    const root = statRoot(oldData);
    const message = currentMessageInfo();
    const prompt = [
      '当前楼正文：',
      (message.text || '（无法读取正文）').slice(0, 4000),
      '',
      '当前变量状态 stat_data（结构与字段以此为准）：',
      safeJson(root, '{}').slice(0, 6000),
      '',
      '玩家要修正的内容：' + instruction,
      '',
      '请严格沿用上述变量结构与字段名，只为这条修正生成最小的变量更新，输出单个 <UpdateVariable> 块（内含 JSONPatch）。',
      '只改被要求的字段、其它一律不动；不要重新生成正文、不要输出世界书条目或下一楼提示词。',
    ].join('\n');
    const raw = String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.0.2 的变量定点修正器，只输出一个最小 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim();
    if (!/<UpdateVariable/i.test(raw)) throw new Error('修正结果未包含 <UpdateVariable> 块，请调整描述后重试');
    lastVariableFix = { kind: 'correct', instruction, raw, at: new Date().toISOString() };
    toast('info', '已生成修正预览，确认无误后点「写回当前楼」');
    renderPanel();
    return lastVariableFix;
  }
  async function applyVariableCorrection() {
    if (!lastVariableFix?.raw) throw new Error('请先生成修正预览');
    await writeRawToCurrentFloor(lastVariableFix.raw);
    toast('success', '变量修正已写回当前楼（正文未改）');
    lastVariableFix = null;
    renderPanel();
    renderVarTunePanel();
  }
  // B17(2.9.8) Panel A 变量预分析：楼层感知三段式（编辑 analysis 导向 → 按它整楼重算）。
  function getMvuDataAt(floorId) {
    const Mvu = mvuHost();
    if (!Mvu?.getMvuData) throw new Error('MVU 尚未就绪');
    return Mvu.getMvuData({ type: 'message', message_id: floorId == null ? 'latest' : floorId });
  }
  function messageInfoAt(floorId) {
    const helper = helperHost();
    const range = (floorId == null || floorId === 'latest') ? -1 : floorId;
    try {
      const msg = helper?.getChatMessages?.(range)?.[0];
      if (msg) return { id: msg.message_id ?? (floorId ?? 'latest'), text: String(msg.message || ''), role: msg.role || '' };
    } catch (_) {}
    return { id: floorId ?? 'latest', text: '', role: '' };
  }
  async function writeRawToFloor(raw, floorId) {
    const Mvu = mvuHost();
    if (!Mvu?.replaceMvuData) throw new Error('MVU 写入接口尚未就绪');
    if (!/<UpdateVariable/i.test(String(raw || ''))) throw new Error('结果未包含 <UpdateVariable> 块，已放弃写入');
    const oldData = getMvuDataAt(floorId);
    let nextData = null;
    if (typeof Mvu.parseMessage === 'function') {
      try { nextData = await Mvu.parseMessage(String(raw), oldData); } catch (_) { nextData = null; }
    }
    if (!nextData) throw new Error('未能从结果解析出有效变量更新（格式不合规）');
    await Mvu.replaceMvuData(nextData, { type: 'message', message_id: floorId == null ? 'latest' : floorId });
  }
  function extractAnalysis(text) {
    const m = String(text || '').match(/<analysis>\s*((?:(?!<\/?analysis>)[\s\S])*?)\s*<\/analysis>/i);
    return m ? m[1].trim() : '';
  }
  // 按（编辑后的）预分析重算整楼变量——预分析是权威导向，补足正文 LLM 写出的 analysis 不足。
  async function rerollFromAnalysis(analysisText, floorId) {
    const generateRaw = variableGenerateRaw();
    const oldData = getMvuDataAt(floorId);
    const root = statRoot(oldData);
    const message = messageInfoAt(floorId);
    const analysis = (String(analysisText || '').trim()) || extractAnalysis(message.text);
    const prompt = [
      '当前楼正文：',
      (message.text || '（无法读取正文）').slice(0, 6000),
      '',
      '本楼变量预分析（变量更新的权威导向，请严格据此推导本楼所有变量变化）：',
      analysis || '（正文未给出预分析，请直接依据正文推导）',
      '',
      '当前变量状态 stat_data（结构与字段名以此为准）：',
      safeJson(root, '{}').slice(0, 6000),
      '',
      '请严格沿用上述变量结构与字段名，依据预分析与正文，为「当前楼」重新生成应有的全部变量更新，输出单个 <UpdateVariable> 块（内含 JSONPatch）。',
      '只改这一楼应当变化的变量；不要重新生成正文、不要输出 <analysis>、世界书条目或给下一楼的提示词。',
    ].join('\n');
    const raw = String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.0.2 的当前楼变量重算器，依据玩家给定的变量预分析与正文，只输出一个 <UpdateVariable> 块，不生成正文、不输出 analysis。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim();
    await writeRawToFloor(raw, floorId);
    lastVariableFix = { kind: 'reroll-analysis', instruction: '（按预分析整楼重算）', raw, at: new Date().toISOString() };
    toast('success', '已按预分析重算该楼全部变量（正文未改、未消耗历史楼）');
    renderPanel();
    return lastVariableFix;
  }
  // B17(2.9.8) Panel B 一键修复变量格式：优先用卡内 zod schema 确定性 parse 回正，秒修不耗 LLM；取不到再退 LLM。
  function getMvuSchema() {
    try { const w = hostWindow(); if (w && w.__xingyueMvuSchema) return w.__xingyueMvuSchema; } catch (_) {}
    try { if (window.__xingyueMvuSchema) return window.__xingyueMvuSchema; } catch (_) {}
    // 任务4.10：补 window.parent/top 多层探测，覆盖嵌套 iframe 场景
    try { if (window.parent && window.parent.__xingyueMvuSchema) return window.parent.__xingyueMvuSchema; } catch (_) {}
    try { if (window.top && window.top.__xingyueMvuSchema) return window.top.__xingyueMvuSchema; } catch (_) {}
    return null;
  }
  function diffRepairRootOps(orig, repaired) {
    const ops = [];
    if (!repaired || typeof repaired !== 'object') return ops;
    for (const key of Object.keys(repaired)) {
      const before = orig ? orig[key] : undefined;
      if (JSON.stringify(before) !== JSON.stringify(repaired[key])) {
        const exists = orig && typeof orig === 'object' && Object.prototype.hasOwnProperty.call(orig, key);
        ops.push({ op: exists ? 'replace' : 'add', path: '/' + jsonPtrSeg(key), value: repaired[key] });
      }
    }
    return ops;
  }
  async function repairVariableFormat() {
    const data = getCurrentMvuData();
    const root = statRoot(data);
    if (!root || typeof root !== 'object') throw new Error('本楼暂无变量');
    const Schema = getMvuSchema();
    if (Schema && typeof Schema.parse === 'function') {
      let repaired = null;
      try { repaired = Schema.parse(JSON.parse(JSON.stringify(root))); } catch (_) {
        // 任务4.11：parse 失败时输出 warn 供调试
        try { console.warn('[xingyue][zod parse failed]', _); } catch (__) {}
        repaired = null;
      }
      if (repaired && typeof repaired === 'object') {
        const ops = diffRepairRootOps(root, repaired);
        if (!ops.length) { toast('info', '变量格式已合规，无需修复'); return; }
        const raw = '<UpdateVariable><JSONPatch>' + JSON.stringify(ops) + '</JSONPatch></UpdateVariable>';
        await writeRawToCurrentFloor(raw);
        lastVariableFix = { kind: 'repair', instruction: '（按 schema 修复 ' + ops.length + ' 处格式）', raw, at: new Date().toISOString() };
        toast('success', '已按 schema 一键修复变量格式（' + ops.length + ' 处，正文未改）');
        renderVarTunePanel();
        return;
      }
    }
    await repairVariableFormatViaLLM();
  }
  async function repairVariableFormatViaLLM() {
    const generateRaw = variableGenerateRaw();
    const root = statRoot(getCurrentMvuData());
    const prompt = [
      '当前变量状态 stat_data：',
      safeJson(root, '{}').slice(0, 8000),
      '',
      '请只修复其中不符合结构/格式的字段（类型错误、缺固定子字段、数值写成文本、对象写成字符串、错误嵌套等），把它们修回合规格式，语义值尽量保持不变。',
      '只为需要修复的字段生成最小的变量更新，输出单个 <UpdateVariable> 块（内含 JSONPatch）；不改语义、不重写正文、不输出 analysis。',
    ].join('\n');
    const raw = String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.0.2 的变量格式修复器，只输出一个最小 <UpdateVariable> 块，只修格式不改语义。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim();
    if (!/<UpdateVariable/i.test(raw)) throw new Error('修复结果未包含 <UpdateVariable> 块');
    await writeRawToCurrentFloor(raw);
    lastVariableFix = { kind: 'repair', instruction: '（LLM 修复格式）', raw, at: new Date().toISOString() };
    toast('success', '已用 LLM 修复变量格式（正文未改）');
    renderVarTunePanel();
  }
  function fixKindLabel(kind) {
    if (kind === 'reroll-analysis') return '按预分析重算结果';
    if (kind === 'repair') return '格式修复结果';
    if (kind === 'fields') return '逐字段修改结果';
    if (kind === 'reroll') return '整楼重算结果';
    return '修正预览';
  }
  // B17(2.9.8) Panel A 浮窗：编辑本楼预分析 → 按它整楼重算。独立于 Panel B（变量美化框）。
  let analysisPanel = null;
  let analysisFloorId = 'latest';
  function analysisPanelHtml() {
    const message = messageInfoAt(analysisFloorId);
    const analysis = extractAnalysis(message.text);
    return '<div class="xy-vt-head"><span>◆ 变量预分析 · 楼层 ' + escapeHtml(String(message.id)) + '</span><button type="button" data-xy-an="close" class="xy-vt-x">✕</button></div>'
      + '<div class="xy-vt-body">'
      + '<div class="xy-vt-hint">预分析是变量更新的导向。在这里补足/修正本楼预分析，再点下方按钮——只按预分析重算本楼变量，不改正文、不耗历史楼。</div>'
      + '<label class="xy-vt-field">本楼变量预分析<textarea data-xy-an-input rows="8" placeholder="正文未给出预分析时，可在此写下本楼应当发生的变量变化（按顶层根分条）">' + escapeHtml(analysis) + '</textarea></label>'
      + '<div class="xy-vt-row"><button type="button" data-xy-an="reroll">按预分析重算整楼变量</button><span class="xy-vt-muted">不改正文、只重生成变量</span></div>'
      + '</div>';
  }
  function renderAnalysisPanel() {
    if (analysisPanel && analysisPanel.isConnected) analysisPanel.innerHTML = analysisPanelHtml();
  }
  function openAnalysisPopover(floorId) {
    analysisFloorId = (floorId == null ? 'latest' : floorId);
    const doc = hostDocument();
    ensureVarTuneStyle(doc);
    if (!analysisPanel || !analysisPanel.isConnected) {
      analysisPanel = doc.createElement('div');
      analysisPanel.id = 'xingyue-analysis-pop';
      analysisPanel.className = 'xy-cc-pop xy-cc-pop-analysis';
      doc.body.appendChild(analysisPanel);
      makeCcPopDraggable(analysisPanel);
      analysisPanel.addEventListener('click', async (event) => {
        const act = event.target?.closest?.('[data-xy-an]')?.getAttribute?.('data-xy-an');
        if (!act) return;
        event.preventDefault(); event.stopPropagation();
        try {
          if (act === 'close') { analysisPanel.remove(); analysisPanel = null; return; }
          if (act === 'reroll') {
            const edited = analysisPanel.querySelector('[data-xy-an-input]')?.value || '';
            await rerollFromAnalysis(edited, analysisFloorId);
          }
        } catch (error) { toast('error', error.message || String(error)); }
      });
    }
    renderAnalysisPanel();
  }
  function resolveFloorFromEl(el) {
    try {
      const mes = el?.closest?.('.mes[mesid]') || el?.closest?.('[mesid]');
      const mid = mes?.getAttribute?.('mesid');
      if (mid != null && mid !== '') { const n = Number(mid); if (!Number.isNaN(n)) return n; }
    } catch (_) {}
    return 'latest';
  }
  function bindAnalysisEntries() {
    const doc = hostDocument();
    if (doc.__xyAnalysisBound) return;
    doc.__xyAnalysisBound = true;
    doc.addEventListener('click', (event) => {
      const editHook = event.target?.closest?.('[data-xy-analysis-edit]');
      const rerollHook = !editHook && event.target?.closest?.('[data-xy-analysis-reroll]');
      if (!editHook && !rerollHook) return;
      event.preventDefault(); event.stopPropagation();
      const floorId = resolveFloorFromEl(editHook || rerollHook);
      if (editHook) { openAnalysisPopover(floorId); return; }
      (async () => { try { await rerollFromAnalysis('', floorId); } catch (error) { toast('error', error.message || String(error)); } })();
    }, true);
  }
  // 由 media_library 就地绑定的 omni 面板按钮统一回调（绕过委托绑定的 doc/前缀不确定性）。
  function handleOmniButton(action, el) {
    try {
      const floorId = resolveFloorFromEl(el);
      if (action === 'analysis-edit') { openAnalysisPopover(floorId); return; }
      if (action === 'analysis-reroll') { rerollFromAnalysis('', floorId).catch(e => toast('error', e.message || String(e))); return; }
      if (action === 'var-tune') { openVariableTunePopover(); return; }
    } catch (error) { toast('error', error.message || String(error)); }
  }
  // B17 交互层：入口在红绿框（正则美化框），控制中心函数作后端代理。
  // 用事件委托 + data 钩子绑定 → 免 custom- 前缀、无视层级嵌套、capture 阶段 stopPropagation 阻 <details> 折叠。
  let varTunePanel = null;
  function getVariableValidationStatus() {
    const root = statRoot(getCurrentMvuData());
    if (!root || typeof root !== 'object') return { state: 'empty', text: '本楼暂无变量' };
    const Schema = getMvuSchema();
    if (!Schema || typeof Schema.parse !== 'function') return { state: 'unknown', text: '无法离线校验（schema 未就绪），可点修复走 LLM' };
    let repaired = null;
    try { repaired = Schema.parse(JSON.parse(JSON.stringify(root))); } catch (_) { repaired = null; }
    if (!repaired || typeof repaired !== 'object') return { state: 'error', text: '变量内容有错误：schema 无法解析，建议点一键修复' };
    const ops = diffRepairRootOps(root, repaired);
    if (!ops.length) return { state: 'ok', text: '变量内容无误（符合 schema）' };
    return { state: 'warn', text: '检出 ' + ops.length + ' 处格式问题，可一键修复' };
  }
  function varValidationStatusHtml() {
    const s = getVariableValidationStatus();
    const map = { ok: ['#4fd97a', '✓'], warn: ['#e0b27b', '!'], error: ['#e07b7b', '✕'], empty: ['#7d8a99', '—'], unknown: ['#7d8a99', '?'] };
    const pair = map[s.state] || map.unknown;
    const color = pair[0], icon = pair[1];
    return '<div class="xy-vt-row" style="border:1px solid ' + color + '55;border-left:3px solid ' + color + ';border-radius:5px;padding:6px 9px;background:' + color + '14;color:' + color + ';font-size:12px;">'
      + '<span style="font-weight:bold;">' + icon + '</span><span>' + escapeHtml(s.text) + '</span></div>';
  }
  function varTunePanelHtml() {
    const fix = lastVariableFix;
    const preview = (fix && fix.raw)
      ? '<div class="xy-vt-label">' + fixKindLabel(fix.kind) + '（写回前可再调整后重生成）</div><pre class="xy-vt-pre">' + escapeHtml(String(fix.raw).slice(0, 2000)) + '</pre><div class="xy-vt-row"><button type="button" data-xy-vt="apply">写回当前楼</button><button type="button" data-xy-vt="discard">丢弃</button></div>'
      : '<div class="xy-vt-hint">修错变量、改格式、只重 roll 不满意的那部分；整楼重算请用红框「变量预分析 ✎/⟳」。均不改正文、不动历史楼。</div>';
    return '<div class="xy-vt-head"><span>⚙ 微调当前楼变量</span><button type="button" data-xy-vt="close" class="xy-vt-x">✕</button></div>'
      + '<div class="xy-vt-body">'
      + varValidationStatusHtml()
      + '<div class="xy-vt-row"><button type="button" data-xy-vt="repair">一键修复变量格式</button><span class="xy-vt-muted">按 schema 把错误格式修回合规</span></div>'
      + '<label class="xy-vt-field">部分重 roll / 修正（一句话）<textarea data-xy-vt-input rows="2" placeholder="例：把星月的好感度改成 80；或 重算当前穿着">' + escapeHtml(fix && fix.kind === 'correct' ? (fix.instruction || '') : '') + '</textarea></label>'
      + '<div class="xy-vt-row"><button type="button" data-xy-vt="preview">生成修正预览</button><span class="xy-vt-muted">只重 roll 描述到的内容</span></div>'
      + preview
      + '<details class="xy-vt-adv"><summary>逐字段结构化编辑（傻瓜式）</summary>' + varTuneFieldsHtml() + '</details>'
      + '</div>';
  }
  function renderVarTunePanel() {
    if (varTunePanel && varTunePanel.isConnected) varTunePanel.innerHTML = varTunePanelHtml();
  }
  function ensureVarTuneStyle(doc) {
    if (doc.getElementById('xingyue-var-tune-style')) return;
    const css = [
      '.xy-cc-pop{position:fixed;z-index:2147483600;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:86vh;background:linear-gradient(180deg,#0a1422,#050912);color:#cdd7e2;border:1px solid #2a4858;border-left:3px solid #4fd97a;box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 18px rgba(80,217,122,.15);clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);font-family:Consolas,monospace;font-size:13px;}',
      '.xy-cc-pop .xy-vt-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-weight:bold;letter-spacing:2px;color:#d4dde2;border-bottom:1px solid rgba(42,72,88,.6);background:linear-gradient(90deg,rgba(80,217,122,.08),transparent);}',
      '.xy-cc-pop .xy-vt-x{background:none;border:1px solid rgba(224,178,123,.3);color:#cdbfa9;cursor:pointer;border-radius:4px;padding:1px 7px;}',
      '.xy-cc-pop .xy-vt-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto;}',
      '.xy-cc-pop .xy-vt-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.xy-cc-pop button{font:inherit;cursor:pointer;background:rgba(80,217,122,.1);color:#d4f5e0;border:1px solid rgba(80,217,122,.45);border-radius:5px;padding:6px 12px;}',
      '.xy-cc-pop button:hover{background:rgba(80,217,122,.2);}',
      '.xy-cc-pop .xy-vt-field{display:flex;flex-direction:column;gap:4px;color:#9fb0c2;}',
      '.xy-cc-pop textarea{font:inherit;background:#050912;color:#cdd7e2;border:1px solid #2a4858;border-radius:5px;padding:7px;resize:vertical;}',
      '.xy-cc-pop .xy-vt-pre{white-space:pre-wrap;background:#050912;border:1px solid rgba(42,72,88,.6);border-radius:5px;padding:8px;max-height:200px;overflow:auto;color:#8b9aac;}',
      '.xy-cc-pop .xy-vt-muted,.xy-cc-pop .xy-vt-hint,.xy-cc-pop .xy-vt-label{color:#7d8a99;font-size:12px;}',
      '.xy-cc-pop .xy-vt-adv>summary,.xy-cc-pop .xy-vt-group>summary{cursor:pointer;color:#9fb0c2;padding:4px 0;font-size:12px;letter-spacing:1px;}',
      '.xy-cc-pop .xy-vt-group{margin:4px 0 4px 6px;border-left:1px solid rgba(42,72,88,.5);padding-left:8px;}',
      '.xy-cc-pop .xy-vt-frow{display:flex;align-items:center;gap:8px;margin:3px 0;}',
      '.xy-cc-pop .xy-vt-frow>span{flex:0 0 42%;color:#8b9aac;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.xy-cc-pop .xy-vt-frow>input{flex:1;font:inherit;font-size:12px;background:#050912;color:#cdd7e2;border:1px solid #2a4858;border-radius:4px;padding:3px 6px;min-width:0;}',
      '.xy-cc-pop.xy-cc-pop-analysis{border-left-color:#4fd0e6;box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 18px rgba(79,208,230,.18);}',
      '.xy-cc-pop-analysis .xy-vt-head{background:linear-gradient(90deg,rgba(79,208,230,.1),transparent);}',
      '.xy-cc-pop-analysis button{background:rgba(79,208,230,.1);border-color:rgba(79,208,230,.5);color:#cdeef7;}',
      '.xy-cc-pop-analysis button:hover{background:rgba(79,208,230,.2);}',
    ].join('');
    const style = doc.createElement('style');
    style.id = 'xingyue-var-tune-style';
    style.textContent = css;
    (doc.head || doc.body).appendChild(style);
  }
  function makeCcPopDraggable(panel) {
    if (!panel || panel.__xyDragBound) return;
    panel.__xyDragBound = true;
    const pdoc = panel.ownerDocument || document;
    const pwin = pdoc.defaultView || window;
    panel.addEventListener('mousedown', (e) => {
      const head = e.target?.closest?.('.xy-vt-head');
      if (!head || !panel.contains(head) || e.target?.closest?.('button')) return;
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      panel.style.transform = 'none'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
      const sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top;
      e.preventDefault();
      const move = (ev) => {
        panel.style.left = Math.max(0, Math.min((pwin.innerWidth || 800) - 40, sl + ev.clientX - sx)) + 'px';
        panel.style.top = Math.max(0, Math.min((pwin.innerHeight || 600) - 40, st + ev.clientY - sy)) + 'px';
      };
      const up = () => { pdoc.removeEventListener('mousemove', move); pdoc.removeEventListener('mouseup', up); };
      pdoc.addEventListener('mousemove', move); pdoc.addEventListener('mouseup', up);
    });
  }
  function openVariableTunePopover() {
    const doc = hostDocument();
    ensureVarTuneStyle(doc);
    if (!varTunePanel || !varTunePanel.isConnected) {
      varTunePanel = doc.createElement('div');
      varTunePanel.id = 'xingyue-var-tune-pop';
      varTunePanel.className = 'xy-cc-pop';
      doc.body.appendChild(varTunePanel);
      makeCcPopDraggable(varTunePanel);
      varTunePanel.addEventListener('click', async (event) => {
        const act = event.target?.closest?.('[data-xy-vt]')?.getAttribute?.('data-xy-vt');
        if (!act) return;
        event.preventDefault(); event.stopPropagation();
        try {
          if (act === 'close') { varTunePanel.remove(); varTunePanel = null; return; }
          if (act === 'repair') await repairVariableFormat();
          if (act === 'preview') await previewVariableCorrection(varTunePanel.querySelector('[data-xy-vt-input]')?.value || '');
          if (act === 'apply') await applyVariableCorrection();
          if (act === 'apply-fields') await applyFieldEdits();
          if (act === 'discard') lastVariableFix = null;
        } catch (error) { toast('error', error.message || String(error)); }
        renderVarTunePanel();
      });
    }
    renderVarTunePanel();
  }
  function bindVariableTuneEntries() {
    const doc = hostDocument();
    if (doc.__xyVarTuneBound) return;
    doc.__xyVarTuneBound = true;
    doc.addEventListener('click', (event) => {
      const hook = event.target?.closest?.('[data-xy-var-tune]');
      if (!hook) return;
      event.preventDefault(); event.stopPropagation();
      openVariableTunePopover();
    }, true);
  }
  // B17 Phase 2：逐字段结构化编辑——把本楼 stat_data 拍平成可编辑字段，改哪个就生成 replace JSONPatch 写回当前楼。
  function jsonPtrSeg(s) { return String(s).replace(/~/g, '~0').replace(/\//g, '~1'); }
  function getByPointer(obj, ptr) {
    const segs = String(ptr).split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur = obj;
    for (const s of segs) { if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, s)) cur = cur[s]; else return undefined; }
    return cur;
  }
  function flattenStat(val, path, out) {
    if (val === null || val === undefined) { out.push({ path, value: '', kind: 'string' }); return; }
    if (Array.isArray(val)) { out.push({ path, value: JSON.stringify(val), kind: 'json' }); return; }
    if (typeof val === 'object') { Object.keys(val).forEach(k => flattenStat(val[k], path + '/' + jsonPtrSeg(k), out)); return; }
    out.push({ path, value: val, kind: typeof val === 'number' ? 'number' : (typeof val === 'boolean' ? 'boolean' : 'string') });
  }
  function varTuneFieldsHtml() {
    let root;
    try { root = statRoot(getCurrentMvuData()); } catch (_) { return '<div class="xy-vt-hint">MVU 未就绪，无法读取本楼变量。</div>'; }
    if (!root || typeof root !== 'object') return '<div class="xy-vt-hint">本楼暂无变量。</div>';
    const groups = Object.keys(root).map(rk => {
      const fields = [];
      flattenStat(root[rk], '/' + jsonPtrSeg(rk), fields);
      if (!fields.length) return '';
      const rows = fields.map(f => {
        const label = f.path.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')).join(' › ');
        return '<label class="xy-vt-frow"><span title="' + escapeHtml(f.path) + '">' + escapeHtml(label) + '</span><input data-xy-vt-field="' + escapeHtml(f.path) + '" data-xy-vt-kind="' + f.kind + '" value="' + escapeHtml(String(f.value)) + '"></label>';
      }).join('');
      return '<details class="xy-vt-group"><summary>' + escapeHtml(rk) + ' · ' + fields.length + '</summary>' + rows + '</details>';
    }).join('');
    return groups + '<div class="xy-vt-row"><button type="button" data-xy-vt="apply-fields">应用字段修改</button><span class="xy-vt-muted">改哪个写哪个，只写当前楼</span></div>';
  }
  async function applyFieldEdits() {
    if (!varTunePanel) return;
    let root;
    try { root = statRoot(getCurrentMvuData()); } catch (_) { throw new Error('MVU 未就绪'); }
    const ops = [];
    varTunePanel.querySelectorAll('[data-xy-vt-field]').forEach(input => {
      const path = input.getAttribute('data-xy-vt-field');
      const kind = input.getAttribute('data-xy-vt-kind');
      const orig = getByPointer(root, path);
      let next = input.value;
      if (kind === 'number') { const n = Number(next); if (!Number.isNaN(n)) next = n; }
      else if (kind === 'boolean') next = (next === 'true' || next === '1' || next === 'True');
      else if (kind === 'json') { try { next = JSON.parse(next); } catch (_) { return; } }
      if (JSON.stringify(orig) !== JSON.stringify(next)) ops.push({ op: 'replace', path, value: next });
    });
    if (!ops.length) { toast('info', '没有检测到字段改动'); return; }
    const raw = '<UpdateVariable><JSONPatch>' + JSON.stringify(ops) + '</JSONPatch></UpdateVariable>';
    await writeRawToCurrentFloor(raw);
    lastVariableFix = { kind: 'fields', instruction: '（逐字段修改 ' + ops.length + ' 处）', raw, at: new Date().toISOString() };
    toast('success', '字段修改已写回当前楼（' + ops.length + ' 处，正文未改）');
    renderVarTunePanel();
  }
  // B17 Phase 3：侧边吸附悬浮球——常驻、拖动吸附左右边、切角，展开菜单收纳 控制中心 / NPC视角 / 变量微调。
  let sidebarBall = null;
  const sidebarState = { side: 'right', top: 0.42, open: false };
  function loadSidebarState() { try { const s = JSON.parse(localStorage.getItem('xingyue-sidebar-v291') || '{}'); if (s.side === 'left' || s.side === 'right') sidebarState.side = s.side; if (typeof s.top === 'number') sidebarState.top = s.top; } catch (_) {} }
  function saveSidebarState() { try { localStorage.setItem('xingyue-sidebar-v291', JSON.stringify({ side: sidebarState.side, top: sidebarState.top })); } catch (_) {} }
  function ensureSidebarStyle(doc) {
    if (doc.getElementById('xingyue-sidebar-style')) return;
    const css = [
      '#xingyue-sidebar-ball{position:fixed;z-index:2147483500;width:34px;height:56px;cursor:pointer;user-select:none;touch-action:none;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;font-weight:700;letter-spacing:3px;color:#2a1c0e;background:linear-gradient(155deg,#f1c98c,#e0a96b);box-shadow:0 4px 16px rgba(0,0,0,.4),inset 0 0 0 1px rgba(255,255,255,.14);transition:width .15s,filter .15s,box-shadow .15s;}',
      '#xingyue-sidebar-ball:hover{filter:brightness(1.06);box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 14px rgba(224,169,107,.45);}',
      '#xingyue-sidebar-ball.dock-right{border-radius:15px 0 0 15px;}',
      '#xingyue-sidebar-ball.dock-left{border-radius:0 15px 15px 0;}',
      '#xingyue-sidebar-menu{position:fixed;z-index:2147483550;width:188px;background:linear-gradient(180deg,rgba(32,23,14,.98),rgba(18,12,7,.98));border:1px solid rgba(224,178,123,.3);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.55);overflow:hidden;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
      '#xingyue-sidebar-menu button{display:block;width:100%;text-align:left;font:inherit;font-size:13px;cursor:pointer;background:transparent;color:#e4d6c3;border:none;border-bottom:1px solid rgba(224,178,123,.14);padding:11px 15px;transition:background .12s,color .12s;}',
      '#xingyue-sidebar-menu button:last-child{border-bottom:none;}',
      '#xingyue-sidebar-menu button:hover{background:rgba(224,178,123,.14);color:#efc785;}',
    ].join('');
    const style = doc.createElement('style');
    style.id = 'xingyue-sidebar-style';
    style.textContent = css;
    (doc.head || doc.body).appendChild(style);
  }
  function positionSidebarBall() {
    if (!sidebarBall) return;
    const vh = hostWindow().innerHeight || 800;
    sidebarBall.style.top = Math.max(8, Math.min(vh - 56, (sidebarState.top || 0.42) * vh)) + 'px';
    sidebarBall.classList.toggle('dock-left', sidebarState.side === 'left');
    sidebarBall.classList.toggle('dock-right', sidebarState.side !== 'left');
    if (sidebarState.side === 'left') { sidebarBall.style.left = '0px'; sidebarBall.style.right = 'auto'; }
    else { sidebarBall.style.right = '0px'; sidebarBall.style.left = 'auto'; }
  }
  function closeSidebarMenu() { const m = hostDocument().getElementById('xingyue-sidebar-menu'); if (m) m.remove(); sidebarState.open = false; }
  function openSidebarMenu() {
    const doc = hostDocument();
    ensureSidebarStyle(doc);
    closeSidebarMenu();
    const menu = doc.createElement('div');
    menu.id = 'xingyue-sidebar-menu';
    menu.innerHTML = '<button type="button" data-xy-sb="cc">控制中心</button><button type="button" data-xy-sb="npc">NPC 视角</button><button type="button" data-xy-sb="analysis">变量预分析 / 重算</button><button type="button" data-xy-sb="vartune">变量微调 / 修复</button>';
    doc.body.appendChild(menu);
    const r = sidebarBall.getBoundingClientRect();
    const vw = hostWindow().innerWidth || 1200;
    const vh = hostWindow().innerHeight || 800;
    menu.style.top = Math.max(8, Math.min(vh - 150, r.top)) + 'px';
    if (sidebarState.side === 'left') { menu.style.left = (r.right + 6) + 'px'; menu.style.right = 'auto'; }
    else { menu.style.right = (vw - r.left + 6) + 'px'; menu.style.left = 'auto'; }
    menu.addEventListener('click', (event) => {
      const act = event.target?.closest?.('[data-xy-sb]')?.getAttribute?.('data-xy-sb');
      if (!act) return;
      event.preventDefault(); event.stopPropagation();
      closeSidebarMenu();
      try {
        if (act === 'cc') togglePanel(true);
        if (act === 'npc') openNpcPopover();
        if (act === 'analysis') openAnalysisPopover('latest');
        if (act === 'vartune') openVariableTunePopover();
      } catch (error) { toast('error', error.message || String(error)); }
    });
    sidebarState.open = true;
  }
  function ensureSidebar() {
    const doc = hostDocument();
    ensureSidebarStyle(doc);
    if (sidebarBall && sidebarBall.isConnected) { positionSidebarBall(); return; }
    sidebarBall = doc.createElement('div');
    sidebarBall.id = 'xingyue-sidebar-ball';
    sidebarBall.textContent = '星月';
    sidebarBall.title = '星月工具台（点开菜单 · 拖动吸附左右边）';
    doc.body.appendChild(sidebarBall);
    let dragging = false, moved = false, startY = 0, startTop = 0;
    sidebarBall.addEventListener('pointerdown', (e) => { dragging = true; moved = false; startY = e.clientY; startTop = sidebarBall.getBoundingClientRect().top; try { sidebarBall.setPointerCapture(e.pointerId); } catch (_) {} });
    sidebarBall.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientY - startY) > 4) moved = true;
      const vh = hostWindow().innerHeight || 800;
      sidebarBall.style.top = Math.max(8, Math.min(vh - 56, startTop + (e.clientY - startY))) + 'px';
      sidebarState.side = (e.clientX < (hostWindow().innerWidth || 1200) / 2) ? 'left' : 'right';
      positionSidebarBall();
    });
    sidebarBall.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { sidebarBall.releasePointerCapture(e.pointerId); } catch (_) {}
      sidebarState.top = sidebarBall.getBoundingClientRect().top / (hostWindow().innerHeight || 800);
      positionSidebarBall();
      saveSidebarState();
      if (!moved) { if (sidebarState.open) closeSidebarMenu(); else openSidebarMenu(); }
    });
    positionSidebarBall();
  }
  // NPC 视角浮窗（从控制中心挪出，复用 .xy-cc-pop 视觉）
  let npcPanel = null;
  function npcPanelHtml() {
    const root = readCurrentStatSafe();
    const npcs = root ? npcEntries(root) : [];
    const last = lastNpcPerspective;
    const list = npcs.length
      ? '<div class="xy-vt-row">' + npcs.map(n => '<button type="button" data-xy-npc-name="' + escapeHtml(n.name) + '">' + escapeHtml(n.name) + '</button>').join('') + '</div>'
      : '<div class="xy-vt-hint">本楼角色档案为空。</div>';
    const result = (last && last.result)
      ? '<div class="xy-vt-label">' + escapeHtml(last.targetName) + ' 对本楼的视角（仅缓存、不进上下文）</div><pre class="xy-vt-pre">' + escapeHtml(String(last.result).slice(0, 3000)) + '</pre>'
      : '<div class="xy-vt-hint">点角色名生成 TA 对本楼的视角与内心。</div>';
    return '<div class="xy-vt-head"><span>👁 NPC 视角</span><button type="button" data-xy-npc="close" class="xy-vt-x">✕</button></div><div class="xy-vt-body">' + list + result + '</div>';
  }
  function renderNpcPanel() { if (npcPanel && npcPanel.isConnected) npcPanel.innerHTML = npcPanelHtml(); }
  function openNpcPopover() {
    const doc = hostDocument();
    ensureVarTuneStyle(doc);
    if (!npcPanel || !npcPanel.isConnected) {
      npcPanel = doc.createElement('div');
      npcPanel.id = 'xingyue-npc-pop';
      npcPanel.className = 'xy-cc-pop';
      doc.body.appendChild(npcPanel);
      makeCcPopDraggable(npcPanel);
      npcPanel.addEventListener('click', async (event) => {
        if (event.target?.closest?.('[data-xy-npc="close"]')) { event.preventDefault(); event.stopPropagation(); npcPanel.remove(); npcPanel = null; return; }
        const nameBtn = event.target?.closest?.('[data-xy-npc-name]');
        if (!nameBtn) return;
        event.preventDefault(); event.stopPropagation();
        try { await generateNpcPerspective(nameBtn.getAttribute('data-xy-npc-name')); } catch (error) { toast('error', error.message || String(error)); }
        renderNpcPanel();
      });
    }
    renderNpcPanel();
  }
  function craftPreviewText(preview) {
    if (!preview) return '选择配方后可预览材料、成功率与将写入的 JSONPatch。';
    const lines = ['配方：' + preview.title];
    if (preview.requirements?.length) preview.requirements.forEach(item => lines.push('材料：' + item.id + ' x' + item.amount));
    if (preview.missing?.length) preview.missing.forEach(item => lines.push('缺口：' + item.id + ' ' + item.available + '/' + item.amount));
    if (preview.ok) {
      lines.push('成功率：' + Math.round((preview.chance ?? 1) * 100) + '%');
      if (preview.roll !== null && preview.roll !== undefined) lines.push('本次判定：' + (preview.success ? '成功' : '失败') + ' / roll ' + preview.roll.toFixed(3));
      if (preview.products?.length) preview.products.forEach(item => lines.push('产物：' + item.id + ' x' + item.amount));
      if (!preview.products?.length) lines.push('产物：无，只有流转记录');
      lines.push('JSONPatch：\n' + safeJson(preview.patch, '[]'));
    }
    return lines.join('\n');
  }
  function currentMessageInfo() {
    const helper = helperHost();
    try {
      const msg = helper?.getChatMessages?.(-1)?.[0];
      if (msg) return { id: msg.message_id ?? 'latest', text: String(msg.message || ''), role: msg.role || '' };
    } catch (_) {}
    return { id: 'latest', text: '', role: '' };
  }
  function npcEntries(root = readCurrentStatSafe()) {
    const chars = isObject(root?.角色档案) ? root.角色档案 : {};
    return Object.entries(chars).map(([name, value]) => ({ name, profile: isObject(value) ? value : {} }));
  }
  async function generateNpcPerspective(targetName) {
    const root = readCurrentStatSafe();
    if (!root) throw new Error('当前楼 MVU 变量不可读取');
    const npc = npcEntries(root).find(item => item.name === targetName);
    if (!npc) throw new Error('未选择有效角色');
    const helper = helperHost();
    const generateRaw = helper?.generateRaw || window.generateRaw || hostWindow().generateRaw;
    if (typeof generateRaw !== 'function') throw new Error('Tavern Helper generateRaw 不可用');
    const message = currentMessageInfo();
    const prompt = [
      '目标角色：' + npc.name,
      '角色档案：' + safeJson(npc.profile, '{}').slice(0, 4000),
      '当前楼正文：' + (message.text || '无法读取当前楼正文').slice(0, 5000),
      '',
      '请只生成该角色对当前楼事件的视角和内心活动。',
      '不要输出变量、JSONPatch、世界书条目或给下一楼使用的提示词。',
    ].join('\n');
    const result = String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.0.2 的楼层内临时旁观视角生成器。结果只供玩家娱乐阅读，不进入后续上下文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim();
    const cacheKey = String(message.id);
    npcPerspectiveCache[cacheKey] = npcPerspectiveCache[cacheKey] || {};
    npcPerspectiveCache[cacheKey][npc.name] = { targetName: npc.name, messageId: message.id, result, createdAt: new Date().toISOString() };
    lastNpcPerspective = npcPerspectiveCache[cacheKey][npc.name];
    toast('success', 'NPC 视角已生成，仅缓存于控制中心');
    renderPanel();
    return lastNpcPerspective;
  }
  function renderCraftTool(root) {
    const recipes = recipeEntries(root);
    if (!recipes.length) return '<div class="xy-muted">当前楼没有配方。导入或写入配方后，这里会出现制造/改造结算入口。</div>';
    if (!selectedRecipeId || !recipes.some(item => item.id === selectedRecipeId)) selectedRecipeId = recipes[0].id;
    let preview = lastCraftPreview && lastCraftPreview.recipeId === selectedRecipeId ? lastCraftPreview : null;
    if (!preview) {
      try { preview = buildCraftSettlement(selectedRecipeId, { commit: false }); } catch (_) {}
    }
    return '<label>配方<select data-xy-input="recipeId">' + recipes.map(item => '<option value="' + escapeHtml(item.id) + '"' + (item.id === selectedRecipeId ? ' selected' : '') + '>' + escapeHtml(item.title) + '</option>').join('') + '</select></label>' +
      '<div class="xy-actions"><button data-xy-action="preview-craft">预览结算</button><button data-xy-action="run-craft">写入当前楼</button></div>' +
      '<pre class="xy-pre">' + escapeHtml(craftPreviewText(preview)) + '</pre>';
  }
  function renderNpcPerspectiveTool(root) {
    const npcs = npcEntries(root);
    if (!npcs.length) return '<div class="xy-muted">当前楼没有角色档案，暂不能生成 NPC 视角。</div>';
    if (!selectedNpcName || !npcs.some(item => item.name === selectedNpcName)) selectedNpcName = npcs[0].name;
    const messageId = currentMessageInfo().id;
    const cached = lastNpcPerspective?.targetName === selectedNpcName ? lastNpcPerspective : npcPerspectiveCache[String(messageId)]?.[selectedNpcName];
    return '<label>目标角色<select data-xy-input="npcName">' + npcs.map(item => '<option value="' + escapeHtml(item.name) + '"' + (item.name === selectedNpcName ? ' selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('') + '</select></label>' +
      '<div class="xy-actions"><button data-xy-action="generate-npc-perspective">生成当前楼视角</button><button data-xy-action="clear-npc-perspective">清除缓存显示</button></div>' +
      '<pre class="xy-pre">' + escapeHtml(cached?.result || '生成结果只保存在控制中心内存缓存，不写入 stat_data、世界书或下一楼提示词。') + '</pre>';
  }
  async function publishPackage(pkg) {
    // 任务4.12：登录预检
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    pkg = validatePackage(pkg);
    const url = gatewayBaseUrl() + '/api/workshop/packages';
    // B21：更新已发布包时显式带 x-package-revision（与 withdraw 一致），让后端按预期 revision 校验、避免误判首发或偶发 409；首发无 revision 则不带
    const extra = pkg && pkg.revision ? { 'x-package-revision': String(pkg.revision) } : {};
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: authHeaders({ 'content-type': 'application/json', ...extra }), body: JSON.stringify(pkg) });
    if (!res.ok) throw new Error('发布失败 HTTP ' + res.status);
    return res.json();
  }
  async function myPackages() {
    await checkWorkshopAuth();
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录和服务器成员确认');
    return fetchJson(gatewayBaseUrl() + '/api/workshop/me/packages');
  }
  async function withdrawPackage(id, revision) {
    // 任务4.12：登录预检
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    const headers = revision ? { 'x-package-revision': String(revision) } : {};
    const res = await fetch(gatewayBaseUrl() + '/api/workshop/packages/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include', headers: authHeaders(headers) });
    if (!res.ok) throw new Error('撤回失败 HTTP ' + res.status);
    return res.json();
  }
  async function votePackage(id, vote) {
    // 任务4.12：登录预检
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    const res = await fetch(gatewayBaseUrl() + '/api/workshop/packages/' + encodeURIComponent(id) + '/vote', { method: 'POST', credentials: 'include', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ vote: vote }) });
    if (!res.ok) throw new Error('投票失败 HTTP ' + res.status);
    return res.json();
  }
  function renderWorkshopList(items) {
    if (!items.length) return '<div class="xy-muted">暂无公开包。离线时仍可本地导入 JSON。</div>';
    return items.slice(0, 12).map(pkg => '<div class="xy-card"><b>' + escapeHtml(pkg.title || pkg.id) + '</b><div class="xy-muted">' + escapeHtml(pkg.type || '') + ' / ' + escapeHtml(pkg.summary || '') + '</div><button data-xy-action="preview-package" data-id="' + escapeHtml(pkg.id) + '">详情/导入</button></div>').join('');
  }
  function ensurePanel() {
    const doc = hostDocument();
    stylePanel(doc);
    let panel = doc.getElementById(CONTROL_PANEL_ID);
    if (!panel) {
      panel = doc.createElement('div');
      panel.id = CONTROL_PANEL_ID;
      panel.hidden = true;
      doc.body.appendChild(panel);
      panel.addEventListener('click', async event => {
        const action = event.target?.getAttribute?.('data-xy-action');
        if (!action) return;
        if (action === 'close') togglePanel(false);
        if (action === 'refresh-workshop') {
          try { await refreshWorkshop(); toast('success', '工坊索引已刷新'); } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'scan-opening-pages') {
          const count = scanOpeningPages();
          toast(count ? 'success' : 'info', count ? '已接管开局页' : '尚未找到开局页');
          renderPanel();
        }
        if (action === 'toggle-setting') {
          const key = event.target?.closest?.('[data-key]')?.getAttribute?.('data-key');
          if (key && Object.prototype.hasOwnProperty.call(settings, key)) saveSettings({ [key]: !settings[key] });
        }
        if (action === 'preview-package') {
          const item = workshopCache.find(pkg => pkg.id === event.target.getAttribute('data-id'));
          try { const detail = await packageDetail(item); await importPackage(detail); } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'preview-craft') {
          try {
            selectedRecipeId = panel.querySelector('[data-xy-input="recipeId"]')?.value || selectedRecipeId;
            lastCraftPreview = buildCraftSettlement(selectedRecipeId, { commit: false });
            renderPanel();
          } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'run-craft') {
          try {
            selectedRecipeId = panel.querySelector('[data-xy-input="recipeId"]')?.value || selectedRecipeId;
            await applyCraftSettlement(selectedRecipeId);
          } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'generate-npc-perspective') {
          try {
            selectedNpcName = panel.querySelector('[data-xy-input="npcName"]')?.value || selectedNpcName;
            await generateNpcPerspective(selectedNpcName);
          } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'clear-npc-perspective') {
          const messageId = String(currentMessageInfo().id);
          if (selectedNpcName && npcPerspectiveCache[messageId]) delete npcPerspectiveCache[messageId][selectedNpcName];
          lastNpcPerspective = null;
          renderPanel();
        }
        if (action === 'reroll-variables') {
          try { await rerollCurrentVariables(); } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'preview-var-fix') {
          try { await previewVariableCorrection(panel.querySelector('[data-xy-input="varFix"]')?.value || ''); } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'apply-var-fix') {
          try { await applyVariableCorrection(); } catch (error) { toast('error', error.message || String(error)); }
        }
        if (action === 'export-media-library') {
          const lib = mediaLibrary();
          if (lib?.exportLibrary) { downloadJson('xingyue-media-library.json', lib.exportLibrary()); toast('success', '已导出媒体库'); }
          else toast('error', '媒体库脚本未就绪');
        }
        if (action === 'import-media-library') {
          panel.querySelector('[data-xy-media-import-file]')?.click();
        }
      });
      panel.addEventListener('change', event => {
        const input = event.target?.getAttribute?.('data-xy-input');
        if (input === 'recipeId') {
          selectedRecipeId = event.target.value || '';
          lastCraftPreview = null;
          renderPanel();
        }
        if (input === 'npcName') {
          selectedNpcName = event.target.value || '';
          renderPanel();
        }
        if (event.target?.matches?.('[data-xy-media-import-file]')) {
          const file = event.target.files && event.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              try { const lib = mediaLibrary(); if (lib?.importLibrary) lib.importLibrary(JSON.parse(reader.result)); toast('success', '已导入媒体库'); renderPanel(); }
              catch (err) { toast('error', '导入失败：' + (err.message || err)); }
            };
            reader.readAsText(file);
          }
          event.target.value = '';
        }
      });
      panel.addEventListener('pointerdown', event => {
        const target = event.target;
        const head = target?.closest?.('.xy-head');
        const resize = target?.closest?.('.xy-resize');
        if (!head && !resize) return;
        if (target?.closest?.('button,input,textarea,select')) return;
        event.preventDefault();
        const docWin = panel.ownerDocument?.defaultView || hostWindow();
        const box = panel.getBoundingClientRect ? panel.getBoundingClientRect() : { left: 22, top: 82, width: 520, height: 640 };
        const startX = event.clientX;
        const startY = event.clientY;
        const start = {
          left: parseFloat(panel.style.left) || box.left,
          top: parseFloat(panel.style.top) || box.top,
          width: parseFloat(panel.style.width) || box.width,
          height: parseFloat(panel.style.height) || box.height,
        };
        const move = moveEvent => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          const next = resize
            ? clampPanelRect({ ...start, width: start.width + dx, height: start.height + dy }, panel.ownerDocument)
            : clampPanelRect({ ...start, left: start.left + dx, top: start.top + dy }, panel.ownerDocument);
          panel.style.left = next.left + 'px';
          panel.style.top = next.top + 'px';
          panel.style.width = next.width + 'px';
          panel.style.height = next.height + 'px';
        };
        const up = () => {
          try { docWin.removeEventListener('pointermove', move); } catch (_) {}
          try { docWin.removeEventListener('pointerup', up); } catch (_) {}
          savePanelRect(panel);
        };
        try { docWin.addEventListener('pointermove', move); } catch (_) {}
        try { docWin.addEventListener('pointerup', up, { once: true }); } catch (_) {}
      });
    }
    applyPanelRect(panel);
    return panel;
  }
  function row(label, value) {
    return '<div class="xy-row"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(value) + '</span></div>';
  }
  function settingSwitch(label, key, note) {
    const enabled = settings[key] !== false;
    return '<button type="button" class="xy-switch ' + (enabled ? 'is-on' : '') + '" data-xy-action="toggle-setting" data-key="' + escapeHtml(key) + '"><span><b>' + escapeHtml(label) + '</b><span>' + escapeHtml(note || '') + '</span></span><i>' + (enabled ? 'ON' : 'OFF') + '</i></button>';
  }
  function renderPolicyControls() {
    return '<div class="xy-switch-grid">' +
      settingSwitch('头像立绘显示', 'mediaDisplayEnabled', '同步状态栏媒体显示') +
      settingSwitch('新闻策略', 'newsPolicyEnabled', '生成前策略开关') +
      settingSwitch('雷达清理', 'radarCleanupPolicyEnabled', '离场与临时目标清理') +
      settingSwitch('摘要更新', 'summaryUpdateEnabled', '近期记录更新策略') +
      settingSwitch('关系名册显示', 'showFrozenInteractiveCharacters', '保留羁绊/互动角色显示') +
      '</div>';
  }
  function playerWorkshopStatus() {
    if (!workshopAuth.checked) return '未检测';
    if (!workshopAuth.loggedIn) return '未登录';
    if (lastError) return '连接失败';
    return workshopCache.length ? '在线索引已缓存' : '未刷新';
  }
  function renderPanel() {
    const panel = ensurePanel();
    const currentRoot = readCurrentStatSafe();
    const openingCount = scanOpeningPages();
    // 每个分区独立兜底：任一分区渲染抛错时只显示该分区的错误提示，不再让整个控制中心空白
    //（历史 bug：renderPanel 是一次性 innerHTML 拼接，任一分区抛错就整面板空白 + hidden 不翻转）。
    const safe = (label, fn) => { try { return fn(); } catch (e) { return '<div class="xy-muted">【' + label + '】渲染失败：' + escapeHtml((e && e.message) || String(e)) + '</div>'; } };
    panel.innerHTML = '<div class="xy-head"><div class="xy-title">' + BUTTON_NAME + '</div><button class="xy-close" data-xy-action="close">关闭</button></div>' +
      '<div class="xy-grid">' +
      '<div class="xy-section"><h4>运行状态</h4>' + safe('运行状态', () => row('版本', VERSION) + row('开局页接管', openingCount ? '已接管' : '等待首条消息') + row('当前楼变量', currentRoot ? '可读取' : '不可读取') + row('工坊状态', playerWorkshopStatus()) + row('缓存包数', String(workshopCache.length))) + '</div>' +
      '<div class="xy-section"><h4>开局与状态栏</h4><div class="xy-actions"><button data-xy-action="scan-opening-pages">重新接管开局页</button><button data-xy-action="refresh-workshop">刷新工坊内容</button></div>' + safe('开局与状态栏', renderPolicyControls) + '</div>' +
      '<div class="xy-section"><h4>制造 / 改造</h4>' + safe('制造 / 改造', () => renderCraftTool(currentRoot)) + '</div>' +
      '<div class="xy-section"><h4>NPC 视角</h4><p class="xy-muted">已移至侧边悬浮球菜单 →「NPC 视角」，快速入口不必每次开控制中心。</p></div>' +
      '<div class="xy-section"><h4>创意工坊</h4><div class="xy-muted">在线内容只在主动刷新或开局页工坊中读取；离线时仍可本地开局和导入 JSON。</div><div class="xy-list">' + safe('创意工坊', () => renderWorkshopList(workshopCache)) + '</div></div>' +
      '<div class="xy-section"><h4>媒体库</h4>' + safe('媒体库', renderMediaLibrarySection) + '</div>' +
      '</div><div class="xy-resize" aria-hidden="true"></div>';
    applyPanelRect(panel);
    panel.hidden = !panelOpen;
  }
  function renderMediaLibrarySection() {
    const lib = mediaLibrary();
    if (!lib || !lib.exportLibrary) {
      return '<div class="xy-muted">媒体库脚本未就绪：状态栏会隐藏媒体功能，其余控制中心功能不受影响。</div>';
    }
    let count = 0;
    try { count = Object.keys((lib.exportLibrary() || {}).assets || {}).length; } catch (_) {}
    return '<div class="xy-muted">媒体库资产 ' + count + ' 项。媒体资产独立保存在媒体库脚本变量，不写入 HUD 设置、MVU 变量或模型可见规则。</div>' +
      '<div class="xy-actions"><button data-xy-action="import-media-library">导入媒体库</button><button data-xy-action="export-media-library">导出媒体库</button></div>' +
      '<input type="file" accept="application/json,.json" data-xy-media-import-file hidden>';
  }
  function togglePanel(force) {
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    renderPanel();
  }
  function ensureWandEntry() {
    const doc = hostDocument();
    try {
      const host = doc.querySelector('#extensionsMenu') || doc.querySelector('.extensionsMenu') || doc.body;
      let wrap = doc.getElementById(WAND_CONTAINER_ID);
      if (!wrap) {
        wrap = doc.createElement('span');
        wrap.id = WAND_CONTAINER_ID;
        wrap.className = 'native-wand-menu';
        const button = doc.createElement('button');
        button.id = WAND_BUTTON_ID;
        button.type = 'button';
        button.textContent = BUTTON_NAME;
        button.title = BUTTON_NAME;
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); togglePanel(); });
        wrap.appendChild(button);
      }
      if (wrap.parentNode !== host) host.appendChild(wrap);
      return true;
    } catch (error) {
      lastError = error.message || String(error);
      return false;
    }
  }

  let openingObserver = null;
  let openingScanTimer = null;
  function bindOpeningPage(root) {
    if (!root || root.dataset.xyOpeningBound === 'true') return false;
    root.dataset.xyOpeningBound = 'true';

    // —— ST 类名前缀兼容（详见记忆 xingyue-opening-class-prefix-constraint）——
    // ST 渲染消息时把静态 HTML 的 class 和 <style> 选择器一起加 custom- 前缀；
    // 但本函数后续用 innerHTML 注入的动态内容（依赖灯 / pill / 工坊 tab / 包卡…）是裸 xy-* 类，
    // 匹配不到 prefixed CSS 会丢样式（圆点透明无尺寸、描边/背景全无，只剩文字）。
    // 检测前缀后，对开局页根的已有及后续注入节点同步补 custom-+token。
    // 离线 _preview.html 无前缀 → XY_PX 为空 → 整块 no-op，两端都安全。
    try {
      const XY_PX = /(^|\s)custom-xy-/.test(root.className || '') ? 'custom-' : '';
      if (XY_PX) {
        const xyPrefixEl = (el) => {
          if (!el || el.nodeType !== 1 || typeof el.className !== 'string' || !el.className) return;
          el.className.split(/\s+/).forEach((t) => {
            if (!t || t.indexOf(XY_PX) === 0) return;
            const p = XY_PX + t;
            if (!el.classList.contains(p)) el.classList.add(p);
          });
        };
        const xyPrefixTree = (el) => {
          xyPrefixEl(el);
          if (el.querySelectorAll) el.querySelectorAll('[class]').forEach(xyPrefixEl);
        };
        xyPrefixTree(root);
        if (typeof MutationObserver === 'function' && !root.__xyPrefixObs) {
          root.__xyPrefixObs = new MutationObserver((muts) => {
            muts.forEach((m) => {
              if (m.type === 'attributes') { xyPrefixEl(m.target); return; }
              m.addedNodes.forEach((n) => { if (n.nodeType === 1) xyPrefixTree(n); });
            });
          });
          // 同时观察 childList（新增节点）与 class 属性变更（在已有元素上改 className 加 xy-* 的情况）
          root.__xyPrefixObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }
      }
    } catch (_xyPxErr) {}

  const STORAGE_KEY = 'xingyue-opening-draft-v291';
  const TYPE_LABELS = { character:'角色范本', user_identity:'身份模板', world_factor:'世界因子', shop_item:'商店道具', blueprint:'蓝图', recipe:'配方', skill:'技能', function:'功能' };
  const ATTRIBUTE_KEYS = ['格斗','平衡','反应','感知','技巧','精神'];
  const DEFAULT_ATTRIBUTES = { 格斗:0, 平衡:0, 反应:0, 感知:0, 技巧:0, 精神:0 };
  const IDENTITY_ATTRIBUTE_PRESETS = {
    '普通入学生': { ...DEFAULT_ATTRIBUTES },
    '交换生': { 格斗:3, 平衡:4, 反应:5, 感知:7, 技巧:7, 精神:4 },
    '赞助生': { 格斗:3, 平衡:4, 反应:7, 感知:4, 技巧:4, 精神:8 },
  };
  const EXTENSION_TYPES = ['shop_item','blueprint','recipe','skill','function'];
  const WORKSHOP_TABS = [
    { id:'character', label:'角色范本', desc:'人物、关系、媒体引用', types:['character'] },
    { id:'user_identity', label:'身份模板', desc:'{{user}} 设定', types:['user_identity'] },
    { id:'world_factor', label:'世界因子', desc:'世界规则与开局约束', types:['world_factor'] },
    { id:'shop_item', label:'商店道具', desc:'莉莉丝商店货架', types:['shop_item'] },
    { id:'craft', label:'蓝图 / 配方', desc:'制造与改造素材', types:['blueprint','recipe'] },
    { id:'extension', label:'技能 / 功能', desc:'技能、功能、道具合集', types:['skill','function','shop_item','blueprint','recipe'] },
    { id:'mine', label:'我的发布', desc:'更新、撤回、复用', types:[] },
  ];
  const WORKSHOP_SAMPLE_PACKAGES = [
    { packageVersion:'1.0.0', id:'sample-transfer-identity', type:'user_identity', cardScope:'xingyue', title:'本地示例：插班观察者', summary:'给 {{user}} 一个低侵入的插班身份，适合先观察校园结构。', authorName:'本地示例', tags:['身份','开局'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ identity:'插班观察者', callname:'转学生', background:'通过临时交换名额进入星月学园，对校园规则和腕表制度仍在适应。' } },
    { packageVersion:'1.0.0', id:'sample-club-senior', type:'character', cardScope:'xingyue', title:'本地示例：社团前辈范本', summary:'追加一名可作为引导者或竞争者的社团前辈，不包含变量写入。', authorName:'本地示例', tags:['角色','关系'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ name:'未命名前辈', role:'社团前辈', relationship:'可作为引导者、竞争者或传闻来源。', mediaRefs:{ normal:'media://character/senior/normal' } } },
    { packageVersion:'1.0.0', id:'sample-night-curfew', type:'world_factor', cardScope:'xingyue', title:'本地示例：夜间通行许可', summary:'让腕表权限影响夜间区域通行，适合都市异能与校园调查线。', authorName:'本地示例', tags:['世界因子','腕表'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ factors:['夜间校区分区开放，腕表权限决定可进入区域。','部分社团拥有临时通行权限。'] } },
    { packageVersion:'1.0.0', id:'sample-lilith-ticket', type:'shop_item', cardScope:'xingyue', title:'本地示例：莉莉丝折扣券', summary:'给莉莉丝商店添加一次性折扣券条目，仅作为世界书内容。', authorName:'本地示例', tags:['商店','道具'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ item:{ name:'莉莉丝折扣券', effect:'购买指定服务时减少一次资源消耗。', limit:'一次性' } } },
    { packageVersion:'1.0.0', id:'sample-watch-shell-blueprint', type:'blueprint', cardScope:'xingyue', title:'本地示例：腕表外壳蓝图', summary:'提供一个可供制造/改造系统读取的蓝图文本来源。', authorName:'本地示例', tags:['蓝图','制造'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ blueprint:{ name:'腕表保护外壳', materials:['通用聚合物','微型扣件'], result:'提升腕表耐久叙事表现。' } } },
    { packageVersion:'1.0.0', id:'sample-energy-gel-recipe', type:'recipe', cardScope:'xingyue', title:'本地示例：能量凝胶配方', summary:'演示配方包如何作为世界书条目进入制造/改造系统。', authorName:'本地示例', tags:['配方','资源'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ recipe:{ name:'能量凝胶', requires:{ 基础营养剂:1, 凝胶载体:1 }, products:{ 能量凝胶:1 } } } },
    { packageVersion:'1.0.0', id:'sample-campus-rumor-skill', type:'skill', cardScope:'xingyue', title:'本地示例：传言嗅探', summary:'追加一个偏调查向的技能说明，用于引导从 NPC 口中获取新闻/传言。', authorName:'本地示例', tags:['技能','传言'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ skill:{ name:'传言嗅探', trigger:'与 NPC 闲聊或调查社团公告时', effect:'更容易得到新闻类线索。' } } },
    { packageVersion:'1.0.0', id:'sample-roster-function', type:'function', cardScope:'xingyue', title:'本地示例：关系名册视图', summary:'作为功能包范例，描述关系网名册模式的启用规则。', authorName:'本地示例', tags:['功能','关系网'], rating:'general', language:'zh-CN', createdAt:'2026-06-23T00:00:00.000Z', updatedAt:'2026-06-23T00:00:00.000Z', payload:{ function:{ name:'关系名册视图', behavior:'以名册优先级展示互动角色、羁绊角色与关系网节点。' } } },
  ];
  const state = {
    view: root.dataset.xyOpeningView || 'boot',
    returnView: 'boot',
    step: Number(root.dataset.xyOpeningStep || 1) || 1,
    deps: [],
    depsReady: false,
    workshopTab: 'character',
    workshopQuery: '',
    workshopRating: '',
    workshopCatalog: [],
    myPackages: [],
    selectedPackage: null,
    selectedAllowedTypes: [],
    localImportTypes: [],
    workshopLoading: false,
    lastWorkshopError: '',
    workshopAuth: { checked: false, loggedIn: false, publisherId: '', error: '' },
    previewMode: false,
  };

  // 任务4.19：删除与顶层完全相同的 hostWindow/toast/escapeHtml 重复定义，直接引用外层
  // hostWindow/toast/escapeHtml 均来自外层闭包，无需在此重声明（遮蔽外层各自演化是屎山根因A）
  function controlCenter() { return window.XingyueControlCenter || hostWindow().XingyueControlCenter || null; }
  function readDraft() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function normalizeDraft(next) {
    const draft = next && typeof next === 'object' ? next : {};
    if (!draft.core_attributes || typeof draft.core_attributes !== 'object') draft.core_attributes = { ...DEFAULT_ATTRIBUTES };
    ATTRIBUTE_KEYS.forEach(key => { draft.core_attributes[key] = Math.max(0, Math.min(30, Number(draft.core_attributes[key] ?? DEFAULT_ATTRIBUTES[key]) || 0)); });
    if (!draft.enabledPackages || typeof draft.enabledPackages !== 'object') {
      draft.enabledPackages = {};
      (Array.isArray(draft.packages) ? draft.packages : []).forEach(pkg => {
        if (pkg?.id && pkg?.type) draft.enabledPackages[packageIdentity(pkg)] = true;
      });
    }
    return draft;
  }
  function writeDraft(next) { const draft = normalizeDraft(next || {}); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); } catch (_) {} return draft; }
  function saveDraft(patch) { return writeDraft({ ...readDraft(), ...(patch || {}) }); }
  function packages() { const draft = readDraft(); return Array.isArray(draft.packages) ? draft.packages : []; }
  function enabledPackageMap(draft = readDraft()) { return (draft.enabledPackages && typeof draft.enabledPackages === 'object') ? draft.enabledPackages : {}; }
  function enabledPackages(typeGroup) {
    const draft = readDraft();
    const enabled = enabledPackageMap(draft);
    return packages().filter(pkg => packageMatchesTypeGroup(pkg, typeGroup) && enabled[packageIdentity(pkg)] !== false);
  }
  function packageMatchesTypeGroup(pkg, typeGroup) {
    if (typeGroup === 'extension') return EXTENSION_TYPES.includes(pkg?.type);
    return !typeGroup || pkg?.type === typeGroup;
  }
  function packageTypeLabel(type) { return TYPE_LABELS[type] || type || '未知'; }
  function packageIdentity(pkg) { return String(pkg?.id || '') + '::' + String(pkg?.type || ''); }
  function safeSlug(value, fallback) {
    const slug = String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return slug || fallback;
  }
  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function publishForm() {
    return {
      title: root.querySelector('[data-xy-publish-title]')?.value?.trim() || '',
      summary: root.querySelector('[data-xy-publish-summary]')?.value?.trim() || '',
      rating: root.querySelector('[data-xy-publish-rating]')?.value || 'general',
    };
  }
  function currentPublishSourcePackage() {
    if (state.selectedPackage) return state.selectedPackage;
    const imported = packages();
    if (imported.length) return imported[0];
    const tabItems = (state.workshopTab === 'mine' ? state.myPackages : state.workshopCatalog).filter(pkg => packageMatchesTab(pkg)).filter(packageMatchesFilters);
    return tabItems[0] || null;
  }
  function buildPublishPackage(source) {
    if (!source) throw new Error('请先选择、导入或打开一个工坊包，再发布/导出。');
    const form = publishForm();
    const createdAt = new Date().toISOString();
    return {
      ...source,
      packageVersion: '1.0.0',
      id: source.id || safeSlug(form.title || source.title || 'package', 'package-' + Date.now()),
      type: source.type,
      cardScope: source.cardScope || 'xingyue',
      title: String(form.title || source.title || source.id).slice(0, 120),
      summary: form.summary || source.summary || '星月工坊内容包。导入前请查看影响预览。',
      authorName: source.authorName || '未署名',
      tags: Array.isArray(source.tags) ? source.tags : [],
      rating: form.rating,
      language: source.language || 'zh-CN',
      createdAt: source.createdAt || createdAt,
      updatedAt: createdAt,
      payload: source.payload,
    };
  }
  function identityDraftAsPackage() {
    const draft = readDraft();
    const identity = String(draft.player_identity || '').trim();
    if (!identity) return null;
    return {
      type: 'user_identity',
      id: 'identity-' + safeSlug(identity, 'template'),
      title: identity,
      summary: String(draft.player_background || '').slice(0, 120) || ('身份模板 · ' + identity),
      authorName: '未署名',
      tags: ['身份模板'],
      payload: {
        identity,
        callname: String(draft.player_callname || '').trim(),
        background: String(draft.player_background || '').trim(),
        avatar: String(draft.player_avatar || '').trim(),
        core_attributes: { ...(draft.core_attributes || {}) },
      },
    };
  }
  function identityPublishForm() {
    return {
      title: root.querySelector('[data-xy-idpub-title]')?.value?.trim() || '',
      summary: root.querySelector('[data-xy-idpub-summary]')?.value?.trim() || '',
      rating: root.querySelector('[data-xy-idpub-rating]')?.value || 'general',
    };
  }
  function buildIdentityPackage() {
    const source = identityDraftAsPackage();
    if (!source) return null;
    const form = identityPublishForm();
    const createdAt = new Date().toISOString();
    return {
      ...source,
      packageVersion: '1.0.0',
      cardScope: 'xingyue',
      title: String(form.title || source.title).slice(0, 120),
      summary: form.summary || source.summary,
      rating: form.rating,
      language: 'zh-CN',
      createdAt,
      updatedAt: createdAt,
    };
  }

  function readCharacterDraft() {
    const draft = readOpeningDraft();
    return (draft && isObject(draft.character_draft)) ? draft.character_draft : {};
  }
  function writeCharacterDraft(patch) {
    const next = { ...readCharacterDraft(), ...(patch || {}) };
    writeOpeningDraft({ character_draft: next });
    return next;
  }
  function collectCharacterFields() {
    const patch = {};
    root.querySelectorAll('[data-xy-char-field]').forEach(input => {
      patch[input.dataset.xyCharField] = input.value || '';
    });
    return writeCharacterDraft(patch);
  }
  const CHARACTER_MEDIA_SPECS = [
    { field: 'portrait_normal', slot: 'portrait', variant: 'normal' },
    { field: 'portrait_nude', slot: 'portrait', variant: 'nude' },
    { field: 'avatar', slot: 'avatar', variant: 'normal' },
  ];
  function characterMediaMeta(spec, name) {
    return { type: 'bond', name: name || '角色', slot: spec.slot, variant: spec.variant };
  }
  function updateCharacterMediaPreviews() {
    const modal = root.querySelector('[data-xy-character-editor-modal]');
    if (!modal) return;
    const cd = readCharacterDraft();
    const name = textOf(cd.name, '') || '角色';
    const lib = mediaLibrary();
    CHARACTER_MEDIA_SPECS.forEach(spec => {
      const img = modal.querySelector('[data-xy-char-media-preview="' + spec.field + '"]');
      if (!img) return;
      const val = textOf(cd[spec.field], '');
      let src = '';
      if (/^(https?:\/\/|data:)/i.test(val)) src = val;
      else if (val && lib && lib.getExactAsset) {
        const asset = lib.getExactAsset(characterMediaMeta(spec, name));
        src = (asset && asset.src) || '';
      }
      if (src) { img.src = src; img.hidden = false; }
      else { img.removeAttribute('src'); img.hidden = true; }
    });
  }
  function characterPublishForm() {
    const cd = readCharacterDraft();
    return {
      title: textOf(root.querySelector('[data-xy-charpub-title]')?.value, '') || textOf(cd.name, ''),
      summary: textOf(root.querySelector('[data-xy-charpub-summary]')?.value, ''),
      rating: root.querySelector('[data-xy-charpub-rating]')?.value || 'general',
    };
  }
  function characterDraftAsPackage() {
    const cd = readCharacterDraft();
    const name = textOf(cd.name, '');
    if (!name) return null;
    const profile = {};
    if (textOf(cd.profile_identity, '')) profile['身份'] = textOf(cd.profile_identity, '');
    if (textOf(cd.profile_relation, '')) profile['与user的关系'] = textOf(cd.profile_relation, '');
    const relationships = String(cd.relationships || '')
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .map(note => ({ target: '{{user}}', type: '', note: note }));
    const payload = { name: name };
    if (Object.keys(profile).length) payload.profile = profile;
    if (textOf(cd.appearance, '')) payload.appearance = { 描述: textOf(cd.appearance, '') };
    if (textOf(cd.personality, '')) payload.personality = textOf(cd.personality, '');
    if (textOf(cd.dialogue_style, '')) payload.dialogueStyle = textOf(cd.dialogue_style, '');
    const behavior = {};
    if (textOf(cd.behavior_style, '')) behavior['行事风格'] = textOf(cd.behavior_style, '');
    if (textOf(cd.behavior_response, '')) behavior['行为应对'] = textOf(cd.behavior_response, '');
    if (Object.keys(behavior).length) payload.behavior = behavior;
    if (relationships.length) payload.relationships = relationships;
    payload.media = {
      portraits: { normal: textOf(cd.portrait_normal, ''), nude: textOf(cd.portrait_nude, '') },
      avatar: textOf(cd.avatar, ''),
    };
    return {
      type: 'character',
      id: 'character-' + safeSlug(name, 'role'),
      title: name,
      summary: (textOf(cd.appearance, '') || textOf(cd.personality, '')).slice(0, 120) || ('角色范本 · ' + name),
      authorName: '未署名',
      tags: ['角色范本'],
      payload: payload,
    };
  }
  function buildCharacterPackage() {
    const source = characterDraftAsPackage();
    if (!source) return null;
    const form = characterPublishForm();
    const createdAt = new Date().toISOString();
    return {
      ...source,
      packageVersion: '1.0.0',
      cardScope: 'xingyue',
      title: String(form.title || source.title).slice(0, 120),
      summary: form.summary || source.summary,
      rating: form.rating,
      language: 'zh-CN',
      createdAt: createdAt,
      updatedAt: createdAt,
    };
  }

  function setView(view) {
    state.view = view;
    root.dataset.xyOpeningView = view;
    root.querySelectorAll('[data-xy-view]').forEach(node => { node.hidden = node.dataset.xyView !== view; });
    render();
  }

  function setStep(next) {
    state.step = Math.max(1, Math.min(6, Number(next) || 1));
    root.dataset.xyOpeningStep = String(state.step);
    saveDraft({ last_step: state.step });
    root.querySelectorAll('[data-xy-opening-pane]').forEach(pane => { pane.hidden = Number(pane.dataset.xyOpeningPane) !== state.step; });
    root.querySelectorAll('.xy-step').forEach(button => {
      const active = Number(button.dataset.xyStepTarget) === state.step;
      if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    const progress = root.querySelector('[data-xy-opening-progress]');
    if (progress) progress.style.width = String(state.step * 100 / 6) + '%';
    render();
  }

  function checkDep(id, label, required, test, fix) {
    let ok = false;
    let note = '';
    try {
      const result = test();
      ok = Boolean(result?.ok ?? result);
      note = String(result?.note || '');
    } catch (error) {
      note = error.message || String(error);
    }
    return { id, label, required, ok, note, fix };
  }
  // 任务4.19：删除与顶层完全相同的 mediaLibrary 重复定义，直接引用外层闭包
  function setAgreementState() {
    const agreed = !!root.querySelector('[data-xy-opening-agreement]')?.checked;
    root.querySelectorAll('[data-xy-requires-agreement]').forEach(button => { button.disabled = !agreed; });
    return agreed;
  }
  function updateWorkshopStatusPills() {
    const auth = state.workshopAuth || {};
    const connection = root.querySelector('[data-xy-workshop-connection]');
    const login = root.querySelector('[data-xy-workshop-login-pill]');
    if (connection) {
      const cls = auth.error ? 'xy-pill warn' : (auth.loggedIn ? 'xy-pill ok' : 'xy-pill warn');
      connection.className = cls;
      connection.textContent = auth.loggedIn ? '在线内容已连接' : (auth.error ? '在线内容连接失败' : '在线内容待登录');
    }
    if (login) {
      login.className = auth.loggedIn ? 'xy-pill ok' : 'xy-pill warn';
      const identity = controlCenter()?.getWorkshopIdentity?.();
      const who = (auth.loggedIn && identity && identity.name) ? (' · ' + identity.name) : '';
      login.textContent = (auth.loggedIn ? 'Discord 已确认' : 'Discord 未登录') + who;
    }
    root.querySelectorAll('[data-xy-login-button]').forEach(button => {
      button.textContent = auth.loggedIn ? '退出登录' : 'Discord 登录';
    });
  }
  async function refreshWorkshopAuth() {
    const cc = controlCenter();
    if (!cc?.checkWorkshopAuth) {
      state.workshopAuth = { checked: true, loggedIn: false, publisherId: '', error: '控制中心 API 未就绪' };
      updateWorkshopStatusPills();
      return state.workshopAuth;
    }
    state.workshopAuth = await cc.checkWorkshopAuth();
    updateWorkshopStatusPills();
    return state.workshopAuth;
  }
  function loginDiscord() {
    const cc = controlCenter();
    const url = cc?.workshopLoginUrl ? cc.workshopLoginUrl() : '';
    if (!url) throw new Error('创意工坊登录地址未就绪');
    // 具名窗口、保留 opener：登录成功交接页要 postMessage(token) 回 opener（不能 noopener，否则 opener 为 null）
    hostWindow().open(url, 'xy-workshop-login', 'width=520,height=720');
  }

  let depAutoTimer = null, depAutoLeft = 0;
  function scheduleDependencyAutoRefresh() {
    // #2：MVU 载入慢于开局页 → 依赖红绿灯停在「未就绪」。就绪前每 700ms 自动重检，命中或超时即停（≤14s，避免常驻空转）。
    if (depAutoTimer || state.depsReady) return;
    depAutoLeft = 20;
    depAutoTimer = setInterval(() => {
      depAutoLeft -= 1;
      runDependencyChecks();
      if (state.depsReady || depAutoLeft <= 0) { clearInterval(depAutoTimer); depAutoTimer = null; }
    }, 700);
  }
  function runDependencyChecks() {
    const win = hostWindow();
    const cc = controlCenter();
    state.deps = [
      checkDep('controlCenter', '星月控制中心', true, () => !!cc?.writeOpeningWorldbookEntries && !!cc?.previewOpeningWrites && !!cc?.installPackageToWorldbook, '确认控制中心脚本已加载。'),
      checkDep('mvu', 'MVU 变量系统', true, () => {
        const mvu = window.Mvu || win.Mvu;
        return !!(mvu && typeof mvu.getMvuData === 'function' && typeof mvu.replaceMvuData === 'function');
      }, '确认 MVU 扩展已启用并完成初始化。'),
      checkDep('helper', 'Tavern Helper 运行环境', true, () => {
        return !!(window.TavernHelper || win.TavernHelper || win.getChatMessages || win.generateRaw);
      }, '确认酒馆助手脚本环境可用。'),
      checkDep('worldbook', '世界书注入接口', true, () => {
        const candidates = [window, win, window.TavernHelper, win.TavernHelper].filter(Boolean);
        return candidates.some(target => target.updateWorldbookWith && (target.getCharWorldbookNames || target.getWorldbookNames));
      }, '确认 Tavern Helper 世界书 API 可用。'),
    ];
    state.depsReady = state.deps.filter(item => item.required).every(item => item.ok);
    renderDeps();
    renderEntryStatus();
    // 开局不主动探测工坊登录态：未登录会请求 /api/workshop/me 返回 401，污染控制台且无实际意义。
    // 工坊登录态改为惰性——用户进入工坊页（setView('workshop')→refreshWorkshop）或登录后再查。
    updateWorkshopStatusPills();
    return state.depsReady;
  }

  function renderDeps() {
    const list = root.querySelector('[data-xy-dep-list]');
    const summary = root.querySelector('[data-xy-dep-summary]');
    if (!list || !summary) return;
    list.innerHTML = state.deps.map(item => {
      const cls = item.ok ? 'ok' : (item.required ? 'fail' : 'warn');
      const tag = item.ok ? '已就绪' : (item.required ? '未通过' : '可选');
      return '<div class="xy-dep-item" title="' + escapeHtml(item.note || item.fix || '') + '"><span class="xy-dep-dot ' + cls + '"></span><span class="xy-dep-name">' + escapeHtml(item.label) + '</span><span class="xy-dep-tag ' + cls + '">' + tag + '</span></div>';
    }).join('');
    const requiredFail = state.deps.filter(item => item.required && !item.ok).length;
    const optionalFail = state.deps.filter(item => !item.required && !item.ok).length;
    const requiredTotal = state.deps.filter(item => item.required).length || 1;
    const requiredOk = requiredTotal - requiredFail;
    summary.innerHTML = [
      '<span class="xy-pill ' + (requiredFail ? 'warn' : 'ok') + '">' + (requiredFail ? ('请确认 ' + requiredFail + ' 项') : '核心环境就绪') + '</span>',
      state.previewMode ? '<span class="xy-pill warn">预览模式</span>' : '',
    ].join('');
    const readyCount = root.querySelector('[data-xy-ready-count]');
    const readyMeter = root.querySelector('[data-xy-ready-meter]');
    const requiredCount = root.querySelector('[data-xy-required-count]');
    const modeStrip = root.querySelector('[data-xy-mode-strip]');
    if (readyCount) readyCount.textContent = requiredOk + '/' + requiredTotal;
    if (readyMeter) readyMeter.style.width = String(requiredOk * 100 / requiredTotal) + '%';
    if (requiredCount) requiredCount.textContent = '必需 ' + requiredTotal + ' 项';
    if (modeStrip) {
      modeStrip.innerHTML = state.previewMode
        ? '<span class="xy-pill warn">预览模式</span><span class="xy-pill">真实写入待酒馆环境</span>'
        : (requiredFail ? '<span class="xy-pill warn">请确认依赖项已就位</span>' : '<span class="xy-pill ok">运行就绪</span><span class="xy-pill">可进入创建</span>');
    }
    setAgreementState();
    updateWorkshopStatusPills();
  }

  function collectFields() {
    const patch = {};
    root.querySelectorAll('[data-xy-opening-field]').forEach(input => { patch[input.dataset.xyOpeningField] = input.value || ''; });
    patch.core_attributes = {};
    root.querySelectorAll('[data-xy-attribute]').forEach(input => {
      patch.core_attributes[input.dataset.xyAttribute] = Number(input.value || 0);
    });
    root.querySelectorAll('[data-xy-choice-group]').forEach(group => {
      const key = group.dataset.xyChoiceGroup;
      const selected = group.querySelector('.xy-choice.selected');
      if (selected) patch[key] = selected.dataset.xyChoiceValue || '';
    });
    root.querySelectorAll('[data-xy-check-group]').forEach(group => {
      const key = group.dataset.xyCheckGroup;
      patch[key] = Array.from(group.querySelectorAll('.xy-choice.selected')).map(item => item.dataset.xyCheckValue).filter(Boolean);
    });
    return saveDraft(patch);
  }

  function applyDraftToFields() {
    const draft = normalizeDraft(readDraft());
    root.querySelectorAll('[data-xy-opening-field]').forEach(input => { if (draft[input.dataset.xyOpeningField] !== undefined) input.value = draft[input.dataset.xyOpeningField] || ''; });
    root.querySelectorAll('[data-xy-choice-group]').forEach(group => {
      const key = group.dataset.xyChoiceGroup;
      const value = draft[key] || (key === 'opening_mode' ? 'enrollment_day' : '');
      group.querySelectorAll('.xy-choice').forEach(button => button.classList.toggle('selected', value && button.dataset.xyChoiceValue === value));
    });
    root.querySelectorAll('[data-xy-check-group]').forEach(group => {
      const key = group.dataset.xyCheckGroup;
      const values = Array.isArray(draft[key]) ? draft[key] : [];
      group.querySelectorAll('.xy-choice').forEach(button => button.classList.toggle('selected', values.includes(button.dataset.xyCheckValue)));
    });
    renderAttributes(draft);
    renderAvatar(draft);
  }
  function attributeTotal(attrs) {
    return ATTRIBUTE_KEYS.reduce((sum, key) => sum + (Number(attrs?.[key]) || 0), 0);
  }
  function setAttributes(attrs) {
    const draft = readDraft();
    draft.core_attributes = {};
    ATTRIBUTE_KEYS.forEach(key => { draft.core_attributes[key] = Math.max(0, Math.min(30, Number(attrs?.[key] ?? 0) || 0)); });
    writeDraft(draft);
    renderAttributes(draft);
    renderWizard();
  }
  function renderAttributes(draft = readDraft()) {
    draft = normalizeDraft(draft);
    const list = root.querySelector('[data-xy-attribute-list]');
    if (!list) return;
    const attrs = draft.core_attributes || DEFAULT_ATTRIBUTES;
    const total = attributeTotal(attrs);
    list.innerHTML = ATTRIBUTE_KEYS.map(key => {
      const value = Number(attrs[key] || 0);
      return '<label class="xy-attribute-row"><span>' + escapeHtml(key) + '</span><input type="range" min="0" max="30" value="' + value + '" data-xy-attribute="' + escapeHtml(key) + '"><b>' + value + '</b></label>';
    }).join('');
    const totalNode = root.querySelector('[data-xy-attribute-total]');
    const leftNode = root.querySelector('[data-xy-attribute-left]');
    if (totalNode) totalNode.textContent = '已分配 ' + total + ' / 30';
    if (leftNode) {
      leftNode.textContent = '剩余 ' + Math.max(0, 30 - total);
      leftNode.className = total > 30 ? 'xy-pill fail' : 'xy-pill';
    }
    renderRadar(attrs);
  }
  function renderRadar(attrs) {
    const svg = root.querySelector('[data-xy-attribute-radar]');
    if (!svg) return;
    const cx = 80, cy = 80, radius = 58;
    const points = ATTRIBUTE_KEYS.map((key, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / ATTRIBUTE_KEYS.length;
      const ratio = Math.max(0, Math.min(1, (Number(attrs?.[key]) || 0) / 30));
      return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio];
    });
    const web = [10,20,30].map(level => {
      const r = radius * level / 30;
      return '<polygon points="' + ATTRIBUTE_KEYS.map((_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / ATTRIBUTE_KEYS.length;
        return (cx + Math.cos(angle) * r).toFixed(1) + ',' + (cy + Math.sin(angle) * r).toFixed(1);
      }).join(' ') + '" fill="none" stroke="rgba(103,200,239,.22)" stroke-width="1"/>';
    }).join('');
    const axes = ATTRIBUTE_KEYS.map((key, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / ATTRIBUTE_KEYS.length;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const lx = cx + Math.cos(angle) * (radius + 13);
      const ly = cy + Math.sin(angle) * (radius + 13);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(103,200,239,.18)"/><text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" fill="#9fc9d9" font-size="10">' + escapeHtml(key) + '</text>';
    }).join('');
    svg.innerHTML = web + axes + '<polygon points="' + points.map(point => point.map(n => n.toFixed(1)).join(',')).join(' ') + '" fill="rgba(244,165,215,.28)" stroke="#ffd47a" stroke-width="2"/><circle cx="' + cx + '" cy="' + cy + '" r="2" fill="#ffd47a"/>';
  }
  function renderAvatar(draft = readDraft()) {
    const preview = root.querySelector('[data-xy-avatar-preview]');
    const label = root.querySelector('[data-xy-avatar-label]');
    if (!preview) return;
    const avatar = String(draft.player_avatar || '').trim();
    if (!avatar) {
      preview.textContent = '未选择';
      if (label) label.textContent = '可使用媒体库、本地图片或图床 URL。';
      return;
    }
    // 任务4.1：非 URL 时按统一协议（bond/avatar/normal/{{user}}）查媒体库；取不到时显示占位文字，不贴裸 key
    let src = '';
    if (/^(https?:\/\/|data:image)/i.test(avatar)) {
      src = avatar;
    } else {
      try {
        const asset = mediaLibrary()?.getExactAsset({ type: 'bond', slot: 'avatar', name: '{{user}}', variant: 'normal' });
        src = (asset && (asset.dataUrl || asset.url || asset.src)) || '';
      } catch (_) {}
    }
    if (src) {
      preview.innerHTML = '<img src="' + escapeHtml(src) + '" alt="">';
    } else {
      preview.textContent = '已选头像（媒体库）';
    }
    if (label) label.textContent = avatar;
  }
  function renderEnableLists() {
    const draft = readDraft();
    const enabled = enabledPackageMap(draft);
    root.querySelectorAll('[data-xy-enable-list]').forEach(list => {
      const group = list.dataset.xyEnableList;
      const items = packages().filter(pkg => packageMatchesTypeGroup(pkg, group));
      if (!items.length) {
        list.innerHTML = '<div class="xy-empty">暂无已导入内容。使用工坊入口或本地 JSON 添加后，可在这里启用。</div>';
        return;
      }
      list.innerHTML = items.map(pkg => {
        const key = packageIdentity(pkg);
        const on = enabled[key] === true;
        const tags = (pkg.tags || []).slice(0, 5).map(tag => '<span class="xy-pill">' + escapeHtml(tag) + '</span>').join('');
        return '<article class="xy-enable-card"><div class="xy-enable-head"><div><strong>' + escapeHtml(pkg.title || pkg.id) + '</strong><p>' + escapeHtml(pkg.summary || '暂无摘要') + '</p></div><label class="xy-toggle"><input type="checkbox" data-xy-toggle-package="' + escapeHtml(key) + '"' + (on ? ' checked' : '') + '>启用</label></div><div class="xy-package-meta"><span class="xy-pill">' + escapeHtml(packageTypeLabel(pkg.type)) + '</span>' + tags + '</div></article>';
      }).join('');
    });
    root.querySelectorAll('[data-xy-enabled-preview]').forEach(node => {
      const group = node.dataset.xyEnabledPreview;
      const items = enabledPackages(group);
      node.textContent = items.length ? items.map(pkg => '[' + packageTypeLabel(pkg.type) + '] ' + pkg.title + '\n' + (pkg.summary || '')).join('\n\n') : '暂无启用内容。';
    });
    renderWorldFactorList();
  }
  function renderWorldFactorList() {
    const box = root.querySelector('[data-xy-world-factor-list]');
    if (!box) return;
    const draft = readOpeningDraft();
    const list = Array.isArray(draft.custom_world_factors) ? draft.custom_world_factors : [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map((f, i) => {
      const title = escapeHtml(String((f && f.title) || '未命名因子'));
      const content = escapeHtml(String((f && f.content) || ''));
      return '<div class="xy-card xy-wf-card"><div class="xy-wf-text"><strong>' + title + '</strong>' + (content ? '<span class="xy-muted">' + content + '</span>' : '') + '</div><button type="button" data-xy-opening-action="remove-world-factor" data-index="' + i + '">删除</button></div>';
    }).join('');
  }

  function summaryText(draft) {
    const lines = [];
    lines.push('身份：' + (draft.player_identity || '未填写'));
    if (draft.player_callname) lines.push('称呼：' + draft.player_callname);
    if (draft.player_avatar) lines.push('玩家头像：' + draft.player_avatar);
    if (draft.core_attributes) lines.push('核心属性：' + ATTRIBUTE_KEYS.map(key => key + ' ' + (draft.core_attributes[key] ?? 0)).join(' / '));
    if (draft.player_background) lines.push('背景：' + draft.player_background);
    if (draft.player_appearance) lines.push('外貌：' + draft.player_appearance);
    if (draft.player_skills) lines.push('技能/天赋：' + draft.player_skills);
    (draft.selected_world_factors || []).forEach(item => lines.push('世界因子：' + item));
    // 任务4.5：补 custom_world_factors（结构化世界因子数组）
    (Array.isArray(draft.custom_world_factors) ? draft.custom_world_factors : []).forEach(f => {
      const title = String((f && f.title) || '').trim();
      const content = String((f && f.content) || '').trim();
      if (title || content) lines.push('自定义世界因子：' + (title ? title + '：' : '') + content);
    });
    if (draft.custom_world_factor) lines.push('自定义世界因子：\n' + draft.custom_world_factor);
    if (draft.extension_notes) lines.push('扩展备注：' + draft.extension_notes);
    const enabled = enabledPackages();
    if (enabled.length) lines.push('已启用工坊包：' + enabled.map(pkg => '[' + packageTypeLabel(pkg.type) + ']' + pkg.title).join('、'));
    return lines.join('\n');
  }

  function writePreview(draft) {
    const cc = controlCenter();
    const preview = cc?.previewOpeningWrites ? cc.previewOpeningWrites(draft) : { identity: '', worldFactor: draft.custom_world_factor || '', workshopEntries: [] };
    const lines = [
      '写入目标：聊天世界书',
      '写入边界：--/星月工坊开始 与 --/星月工坊结束 之间',
      '写入方式：只整理开局与工坊条目，角色状态仍由正文与变量系统自然推进',
      '',
      '[星月开局]{{user}}身份设定',
      preview.identity || '（沿用角色卡默认身份）',
      '',
      '[世界因子]当前设定',
      preview.worldFactor || '无',
    ];
    if (preview.workshopEntries?.length) {
      lines.push('', '星月工坊世界书条目：');
      preview.workshopEntries.forEach(item => lines.push('- ' + item));
    }
    return lines.join('\n');
  }

  function draftImpactText() {
    const pkgs = packages();
    if (!pkgs.length) return '暂无导入包。';
    const enabled = enabledPackageMap();
    return pkgs.map(pkg => {
      const on = enabled[packageIdentity(pkg)] === true ? '已启用' : '未启用';
      return '[' + packageTypeLabel(pkg.type) + '] ' + pkg.title + '\n' +
        'id: ' + pkg.id + '\n' +
        '状态：' + on + '\n' +
        '写入：启用后进入聊天世界书 / 星月工坊边界内\n' +
        '摘要：' + (pkg.summary || '无');
    }).join('\n\n');
  }

  function renderEntryStatus() {
    const status = root.querySelector('[data-xy-draft-status]');
    const pills = root.querySelector('[data-xy-entry-draft-pills]');
    if (!status) return;
    const draft = readDraft();
    const count = packages().length;
    status.textContent = (Object.keys(draft).length ? '已保存草稿，含 ' + count + ' 个工坊包。' : '暂无草稿，进入后会自动保存。');
    if (pills) {
      const hasDraft = Object.keys(draft).length > 0;
      pills.innerHTML = hasDraft
        ? '<span class="xy-pill ok">草稿存在</span><span class="xy-pill">工坊包 ' + count + '</span>'
        : '<span class="xy-pill warn">暂无草稿</span><span class="xy-pill">可新建</span>';
    }
  }

  function renderDraftList() {
    const list = root.querySelector('[data-xy-opening-draft-list]');
    const impact = root.querySelector('[data-xy-package-impact]');
    if (impact) impact.textContent = draftImpactText();
    if (!list) return;
    const pkgs = packages();
    if (!pkgs.length) {
      list.innerHTML = '<div class="xy-empty">暂无已导入工坊包。</div>';
      return;
    }
    list.innerHTML = pkgs.map(pkg => '<div class="xy-draft-item"><span>' + escapeHtml('[' + packageTypeLabel(pkg.type) + '] ' + pkg.title) + '</span><button type="button" data-xy-opening-action="remove-workshop-package" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type) + '">移除</button></div>').join('');
  }

  function renderWizard() {
    const draft = collectFields();
    const summary = root.querySelector('[data-xy-opening-summary]');
    if (summary) summary.textContent = summaryText(draft);
    const preview = root.querySelector('[data-xy-opening-preview]');
    if (preview) preview.textContent = writePreview(draft);
    renderConfirmRail(draft);
    renderDraftList();
    renderAttributes(draft);
    renderAvatar(draft);
    renderEnableLists();
  }

  function renderConfirmRail(draft) {
    const rail = root.querySelector('[data-xy-confirm-rail]');
    if (!rail) return;
    const pkgCount = enabledPackages().length;
    // 任务4.6：世界因子计数补 custom_world_factors 结构化数组
    const worldFactorCount = (draft.selected_world_factors || []).length
      + String(draft.custom_world_factor || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).length
      + (Array.isArray(draft.custom_world_factors) ? draft.custom_world_factors.length : 0);
    const extensionCount = enabledPackages('extension').length;
    rail.innerHTML = [
      '<div class="xy-preview-card"><strong>身份</strong><span>' + escapeHtml(draft.player_identity || '未填写') + '</span></div>',
      '<div class="xy-preview-card"><strong>世界因子</strong><span>' + worldFactorCount + ' 条待写入/预览</span></div>',
      '<div class="xy-preview-card"><strong>工坊包</strong><span>' + pkgCount + ' 个已启用</span></div>',
      '<div class="xy-preview-card"><strong>扩展包</strong><span>' + extensionCount + ' 个已启用</span></div>',
      '<div class="xy-preview-card"><strong>写入方式</strong><span>最终确认后统一整理</span></div>',
      '<div class="xy-preview-card"><strong>当前模式</strong><span>' + (state.previewMode ? '预览模式' : '正式依赖检查') + '</span></div>',
    ].join('');
  }

  function activeTab() { return WORKSHOP_TABS.find(tab => tab.id === state.workshopTab) || WORKSHOP_TABS[0]; }
  function packageMatchesTab(pkg, tab = activeTab()) {
    if (tab.id === 'mine') return true;
    return tab.types.includes(pkg.type);
  }
  function packageMatchesFilters(pkg) {
    const q = state.workshopQuery.trim().toLowerCase();
    const rating = state.workshopRating;
    if (rating && String(pkg.rating || '').toLowerCase() !== rating) return false;
    if (!q) return true;
    return [pkg.title,pkg.summary,pkg.id,pkg.authorName,pkg.language,(pkg.tags||[]).join(' ')].join(' ').toLowerCase().includes(q);
  }
  function sampleItemsForActiveTab() {
    return WORKSHOP_SAMPLE_PACKAGES.filter(pkg => packageMatchesTab(pkg)).filter(packageMatchesFilters);
  }
  function renderEmptyWorkshopState(sourceLength, itemsLength) {
    const tab = activeTab();
    const isMine = state.workshopTab === 'mine';
    const samples = isMine ? [] : sampleItemsForActiveTab();
    const auth = state.workshopAuth || {};
    const reason = state.lastWorkshopError
      ? '创意工坊连接失败，请稍后重试。'
      : (sourceLength ? '当前筛选没有匹配内容。' : '当前分区暂无可展示内容。');
    const sampleCards = samples.slice(0, 3).map(pkg => (
      '<article class="xy-package"><h4>' + escapeHtml(pkg.title) + '</h4><p>' + escapeHtml(pkg.summary) + '</p>' +
      '<div class="xy-package-meta"><span class="xy-pill">' + escapeHtml(packageTypeLabel(pkg.type)) + '</span><span class="xy-pill">本地示例</span></div>' +
      '<div class="xy-package-actions"><button type="button" data-xy-opening-action="show-sample-package" data-id="' + escapeHtml(pkg.id) + '">详情</button></div></article>'
    )).join('');
    const title = isMine
      ? (auth.loggedIn ? '我的发布暂无内容' : '登录后查看我的发布')
      : (state.lastWorkshopError ? '创意工坊连接失败' : tab.label + '暂无在线内容');
    const copy = isMine
      ? (auth.loggedIn ? '这里仅管理你自己发布过的内容。' : '“我的发布”需登录并通过服务器成员确认后查看。你仍可浏览其他公开分区、使用本地 JSON 和本地示例继续创建。')
      : reason;
    const empty = '<div class="xy-empty-state"><h4>' + escapeHtml(title) + '</h4>' +
      '<p>' + escapeHtml(copy) + '</p>' +
      '<div class="xy-empty-actions"><button type="button" data-xy-opening-action="login-discord">Discord 登录</button><button type="button" data-xy-opening-action="import-local-package">本地 JSON</button><button type="button" data-xy-opening-action="refresh-workshop">刷新</button></div></div>';
    return empty + sampleCards;
  }
  function renderWorkshop() {
    const tabs = root.querySelector('[data-xy-workshop-tabs]');
    const grid = root.querySelector('[data-xy-workshop-grid]');
    const status = root.querySelector('[data-xy-workshop-status]');
    if (!tabs || !grid || !status) return;
    const auth = state.workshopAuth || {};
    const isMineTab = state.workshopTab === 'mine';
    root.querySelectorAll('[data-xy-publish-bar]').forEach(node => { node.hidden = !isMineTab; });
    root.querySelectorAll('[data-xy-publish-action]').forEach(node => { node.hidden = !isMineTab || !auth.loggedIn; });
    tabs.innerHTML = WORKSHOP_TABS.map(tab => '<button type="button" class="xy-workshop-tab ' + (tab.id === state.workshopTab ? 'active' : '') + '" data-xy-opening-action="switch-workshop-tab" data-tab="' + escapeHtml(tab.id) + '"><strong>' + escapeHtml(tab.label) + '</strong><span>' + escapeHtml(tab.desc || '') + '</span></button>').join('');
    // 公开分区未登录也能浏览缓存目录；仅“我的发布”需要登录态
    const source = isMineTab ? (auth.loggedIn ? state.myPackages : []) : state.workshopCatalog;
    const items = source.filter(pkg => packageMatchesTab(pkg)).filter(packageMatchesFilters);
    status.innerHTML = [
      '<span class="xy-pill">' + escapeHtml(activeTab().label) + '</span>',
      '<span class="xy-pill ' + (auth.loggedIn ? 'ok' : 'warn') + '">' + (auth.loggedIn ? 'Discord 已确认' : '未登录') + '</span>',
      '<span class="xy-pill ' + (state.lastWorkshopError ? 'warn' : 'ok') + '">' + (state.lastWorkshopError ? '连接失败' : (auth.loggedIn ? '工坊已连接' : '公开浏览')) + '</span>',
      '<span class="xy-pill">当前 ' + items.length + ' / 缓存 ' + source.length + '</span>',
      !source.length ? '<span class="xy-pill warn">可用本地示例</span>' : '',
    ].join('');
    grid.classList.toggle('single', state.workshopLoading || !items.length);
    if (state.workshopLoading) {
      grid.innerHTML = '<div class="xy-empty-state"><h4>正在读取创意工坊</h4><p>若连接暂时失败，可继续使用本地 JSON 或本地示例。</p></div>';
      return;
    }
    if (!items.length) {
      grid.innerHTML = renderEmptyWorkshopState(source.length, items.length);
      return;
    }
    grid.classList.remove('single');
    grid.innerHTML = items.map(pkg => {
      const meta = [packageTypeLabel(pkg.type), pkg.rating || 'general', pkg.language || 'zh-CN'].filter(Boolean).join(' / ');
      const tags = (pkg.tags || []).slice(0, 4).map(tag => '<span class="xy-pill">' + escapeHtml(tag) + '</span>').join('');
      const withdraw = state.workshopTab === 'mine' ? '<button type="button" data-xy-opening-action="withdraw-package" data-id="' + escapeHtml(pkg.id) + '" data-revision="' + escapeHtml(pkg.revision || '') + '">撤回</button>' : '';
      const votes = pkg.votes || { up: 0, down: 0 };
      const myVote = pkg.myVote || 'none';
      const voteBar = '<div class="xy-vote-bar"><button type="button" class="xy-vote' + (myVote === 'up' ? ' on' : '') + '" data-xy-opening-action="vote-package" data-id="' + escapeHtml(pkg.id) + '" data-vote="up" aria-label="点赞">▲ ' + (votes.up || 0) + '</button><button type="button" class="xy-vote' + (myVote === 'down' ? ' on' : '') + '" data-xy-opening-action="vote-package" data-id="' + escapeHtml(pkg.id) + '" data-vote="down" aria-label="点踩">▼ ' + (votes.down || 0) + '</button></div>';
      return '<article class="xy-package"><h4>' + escapeHtml(pkg.title || pkg.id) + '</h4><p>' + escapeHtml(pkg.summary || '暂无摘要') + '</p><div class="xy-package-meta"><span class="xy-pill">' + escapeHtml(meta) + '</span>' + tags + '</div><p>作者：' + escapeHtml(pkg.authorName || '未署名') + ' · 更新：' + escapeHtml(pkg.updatedAt || pkg.createdAt || '未知') + '</p>' + voteBar + '<div class="xy-package-actions"><button type="button" data-xy-opening-action="show-package-detail" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type || '') + '">详情</button><button type="button" data-xy-opening-action="download-package" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type || '') + '">下载缓存</button>' + withdraw + '</div></article>';
    }).join('');
  }

  function renderPackageDetail(pkg, detailText) {
    const modal = root.querySelector('[data-xy-package-modal]');
    if (!modal) return;
    root.querySelector('[data-xy-package-title]').textContent = pkg?.title || '工坊包详情';
    root.querySelector('[data-xy-package-subtitle]').textContent = '[' + packageTypeLabel(pkg?.type) + '] ' + (pkg?.summary || '');
    root.querySelector('[data-xy-package-detail]').textContent = detailText;
    modal.hidden = false;
  }

  function impactPreview(pkg) {
    const lines = [];
    lines.push('包 ID：' + (pkg.id || ''));
    lines.push('类型：' + packageTypeLabel(pkg.type));
    lines.push('评级：' + (pkg.rating || 'general'));
    lines.push('适用范围：' + (pkg.cardScope || 'xingyue'));
    lines.push('');
    lines.push('安装位置：聊天世界书');
    lines.push('重复导入：覆盖同 ID 的旧版本');
    lines.push('');
    lines.push('摘要：' + (pkg.summary || '无'));
    if (pkg.tags?.length) lines.push('标签：' + pkg.tags.join('、'));
    lines.push('');
    lines.push('payload 预览：');
    try { lines.push(JSON.stringify(pkg.payload || {}, null, 2).slice(0, 3600)); } catch (_) { lines.push('payload 无法序列化'); }
    return lines.join('\n');
  }

  async function getPackageDetailFromCatalog(id, type) {
    const source = state.workshopTab === 'mine' ? state.myPackages : state.workshopCatalog;
    const item = source.find(pkg => String(pkg.id) === String(id) && (!type || String(pkg.type || '') === String(type)));
    if (!item) throw new Error('未找到工坊包');
    const cc = controlCenter();
    const detail = cc?.packageDetail ? await cc.packageDetail(item) : item;
    return detail;
  }
  function getSamplePackage(id) {
    const item = WORKSHOP_SAMPLE_PACKAGES.find(pkg => String(pkg.id) === String(id));
    if (!item) throw new Error('未找到本地示例包');
    return item;
  }

  async function refreshWorkshop() {
    const cc = controlCenter();
    if (!cc?.refreshWorkshop) {
      state.workshopCatalog = [];
      state.myPackages = [];
      state.workshopLoading = false;
      state.lastWorkshopError = '控制中心工坊 API 未就绪';
      renderWorkshop();
      return [];
    }
    state.workshopLoading = true;
    state.lastWorkshopError = '';
    renderWorkshop();
    try {
      const items = await cc.refreshWorkshop();
      state.workshopCatalog = Array.isArray(items) ? items : [];
      if (state.workshopTab === 'mine' && cc.myPackages) {
        try {
          const mine = await cc.myPackages();
          state.myPackages = Array.isArray(mine) ? mine : (Array.isArray(mine?.packages) ? mine.packages : []);
        } catch (error) { state.lastWorkshopError = error.message || String(error); }
      }
    } catch (error) {
      state.lastWorkshopError = error.message || String(error);
      throw error;
    } finally {
      state.workshopLoading = false;
      renderWorkshop();
    }
    return state.workshopCatalog;
  }

  async function importPackageObject(pkg, allowedTypes) {
    const cc = controlCenter();
    const imported = cc?.importPackage ? await cc.importPackage(pkg, { allowedTypes: allowedTypes || [] }) : pkg;
    // 任务4.8：统一走 importPackageToDraft 的选择性启用逻辑（user_identity 自动启用，其余默认 false），
    // 删除原先强制 enabledPackages[key]=true（会绕过选择性策略导致所有类型包均强制启用）
    if (cc?.importPackageToDraft) {
      cc.importPackageToDraft(imported);
    } else {
      const draft = readDraft();
      const key = packageIdentity(imported);
      draft.packages = packages().filter(item => packageIdentity(item) !== key).concat([imported]);
      draft.enabledPackages = enabledPackageMap(draft);
      if (draft.enabledPackages[key] === undefined) draft.enabledPackages[key] = imported.type === 'user_identity';
      writeDraft(draft);
    }
    toast('success', '已导入：' + imported.title);
    render();
    return imported;
  }
  async function installPackageObject(pkg, allowedTypes) {
    const cc = controlCenter();
    if (!cc?.installPackageToWorldbook) throw new Error('控制中心世界书安装 API 未就绪');
    const result = await cc.installPackageToWorldbook(pkg, { allowedTypes: allowedTypes || [] });
    if (result?.warning) toast('info', result.warning);
    else toast('success', '已安装到聊天世界书：' + (pkg.title || pkg.id));
    return result;
  }

  async function importLocalPackage(allowedTypes) {
    state.localImportTypes = allowedTypes || activeTab().types || [];
    const input = root.querySelector('[data-xy-hidden-file]');
    if (!input) return;
    input.value = '';
    input.click();
  }
  async function previewLocalPackage(text) {
    const cc = controlCenter();
    const pkg = JSON.parse(text);
    const detail = cc?.validatePackage ? cc.validatePackage(pkg, state.localImportTypes || []) : pkg;
    state.selectedPackage = detail;
    state.selectedAllowedTypes = state.localImportTypes || [];
    renderPackageDetail(detail, '本地 JSON 预览\n\n' + impactPreview(detail));
  }

  function render() {
    renderDeps();
    setAgreementState();
    renderEntryStatus();
    updateWorkshopStatusPills();
    if (state.view === 'wizard') renderWizard();
    renderWorkshop();
  }

  root.addEventListener('input', event => {
    if (event.target.matches('[data-xy-opening-field]')) renderWizard();
    if (event.target.matches('[data-xy-attribute]')) {
      // #4：拖动时只做轻量更新（数值/总计/雷达），不调 setAttributes/renderAttributes——
      // 后者用 innerHTML 重建所有 range 元素、会打断正在进行的拖拽，导致「点多少给多少、无法连续滑」。
      const key = event.target.dataset.xyAttribute;
      const draft = readDraft();
      const attrs = { ...(draft.core_attributes || DEFAULT_ATTRIBUTES) };
      const previous = Number(attrs[key] || 0);
      let next = Number(event.target.value || 0);
      const totalWithout = attributeTotal(attrs) - previous;
      if (totalWithout + next > 30) next = Math.max(0, 30 - totalWithout); // 超 30 点预算钳到剩余
      attrs[key] = next;
      draft.core_attributes = attrs;
      writeDraft(draft);
      if (Number(event.target.value) !== next) event.target.value = next; // 仅钳值时回写，赋值不销毁元素
      const valLabel = event.target.parentElement && event.target.parentElement.querySelector('b');
      if (valLabel) valLabel.textContent = next;
      const total = attributeTotal(attrs);
      const totalNode = root.querySelector('[data-xy-attribute-total]');
      const leftNode = root.querySelector('[data-xy-attribute-left]');
      if (totalNode) totalNode.textContent = '已分配 ' + total + ' / 30';
      if (leftNode) { leftNode.textContent = '剩余 ' + Math.max(0, 30 - total); leftNode.className = total > 30 ? 'xy-pill fail' : 'xy-pill'; }
      renderRadar(attrs);
      return;
    }
    if (event.target.matches('[data-xy-workshop-search]')) {
      state.workshopQuery = event.target.value || '';
      renderWorkshop();
    }
  });

  root.addEventListener('change', event => {
    if (event.target.matches('[data-xy-attribute]')) {
      // #4：拖拽结束做一次完整同步（重建滑块反映钳值 + 刷新右侧预览）。
      renderAttributes(readDraft());
      renderWizard();
      return;
    }
    if (event.target.matches('[data-xy-opening-agreement]')) {
      setAgreementState();
      return;
    }
    if (event.target.matches('[data-xy-toggle-package]')) {
      const draft = readDraft();
      draft.enabledPackages = enabledPackageMap(draft);
      draft.enabledPackages[event.target.dataset.xyTogglePackage] = !!event.target.checked;
      writeDraft(draft);
      render();
      return;
    }
    if (event.target.matches('[data-xy-workshop-rating]')) {
      state.workshopRating = event.target.value || '';
      renderWorkshop();
    }
    if (event.target.matches('[data-xy-hidden-file]')) {
      const file = event.target.files?.[0];
      if (!file) return;
      file.text().then(text => previewLocalPackage(text)).catch(error => toast('error', error.message || String(error)));
    }
  });

  root.addEventListener('click', async event => {
    const choice = event.target.closest('.xy-choice');
    if (choice && root.contains(choice)) {
      const group = choice.closest('[data-xy-choice-group]');
      const checkGroup = choice.closest('[data-xy-check-group]');
      if (group) {
        group.querySelectorAll('.xy-choice').forEach(item => item.classList.remove('selected'));
        choice.classList.add('selected');
        const input = root.querySelector('[data-xy-opening-field="' + group.dataset.xyChoiceGroup + '"]');
        if (input && group.dataset.xyChoiceGroup === 'player_identity') input.value = choice.dataset.xyChoiceValue || '';
        if (group.dataset.xyChoiceGroup === 'player_identity' && IDENTITY_ATTRIBUTE_PRESETS[choice.dataset.xyChoiceValue]) {
          setAttributes(IDENTITY_ATTRIBUTE_PRESETS[choice.dataset.xyChoiceValue]);
        }
      }
      if (checkGroup) choice.classList.toggle('selected');
      renderWizard();
      return;
    }

    const button = event.target.closest('[data-xy-opening-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.xyOpeningAction;

    try {
      if (action === 'check-deps') runDependencyChecks();
      if (action === 'enter-entry') {
        if (!setAgreementState()) throw new Error('请先勾选协议确认');
        setView('wizard');
        setStep(1);
      }
      if (action === 'enter-preview') {
        state.previewMode = true;
        setView('wizard');
        setStep(1);
      }
      if (action === 'back-boot') setView('boot');
      if (action === 'back-entry') setView('boot');
      if (action === 'go-step') setStep(button.dataset.xyStepTarget);
      if (action === 'prev-step') setStep(state.step - 1);
      if (action === 'next-step') setStep(state.step + 1);
      if (action === 'open-workshop') {
        state.returnView = state.view === 'wizard' ? 'wizard' : 'boot';
        if (button.dataset.xyWorkshopTab) state.workshopTab = button.dataset.xyWorkshopTab;
        setView('workshop');
        refreshWorkshop().catch(error => toast('error', error.message || String(error)));
      }
      if (action === 'login-discord') {
        if (state.workshopAuth && state.workshopAuth.loggedIn) {
          Promise.resolve(controlCenter()?.logout?.()).finally(() => refreshWorkshopAuth().catch(() => updateWorkshopStatusPills()));
        } else {
          loginDiscord();
          // 任务4.14：删除冗余 setTimeout 轮询（登录成功由 postMessage → captureWorkshopLogin 回调刷新，无需此轮询）
        }
      }
      if (action === 'return-from-workshop') setView(state.returnView || 'boot');
      if (action === 'switch-workshop-tab') {
        state.workshopTab = button.dataset.tab || 'character';
        if (state.workshopTab === 'mine') {
          refreshWorkshop().catch(error => toast('error', error.message || String(error)));
        } else {
          renderWorkshop();
        }
      }
      if (action === 'refresh-workshop') await refreshWorkshop();
      if (action === 'open-identity-publish') {
        const src = identityDraftAsPackage();
        if (!src) throw new Error('请先填写身份补充，再发布身份模板');
        const modal = root.querySelector('[data-xy-identity-publish-modal]');
        if (modal) {
          const titleInput = modal.querySelector('[data-xy-idpub-title]');
          if (titleInput && !titleInput.value) titleInput.value = src.title || '';
          modal.hidden = false;
        }
      }
      if (action === 'close-identity-publish') {
        const modal = root.querySelector('[data-xy-identity-publish-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'export-identity-template') {
        const pkg = buildIdentityPackage();
        if (!pkg) throw new Error('请先填写身份补充，再导出身份模板');
        downloadJson(pkg.id + '.json', pkg);
        toast('success', '已导出身份模板 JSON');
      }
      if (action === 'publish-identity-template') {
        const cc = controlCenter();
        if (!cc?.publishPackage) throw new Error('控制中心发布 API 未就绪');
        const pkg = buildIdentityPackage();
        if (!pkg) throw new Error('请先填写身份补充，再发布身份模板');
        await cc.publishPackage(pkg);
        toast('success', '身份模板已提交发布');
        const modal = root.querySelector('[data-xy-identity-publish-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'open-character-editor') {
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        if (modal) {
          const cd = readCharacterDraft();
          modal.querySelectorAll('[data-xy-char-field]').forEach(input => {
            const k = input.dataset.xyCharField;
            input.value = cd[k] != null ? cd[k] : '';
          });
          modal.hidden = false;
          updateCharacterMediaPreviews();
        }
      }
      if (action === 'close-character-editor') {
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'save-character-draft') {
        collectCharacterFields();
        const pkg = buildCharacterPackage();
        if (!pkg) throw new Error('请先填写角色名称');
        importPackageToDraft(pkg);
        const map = enabledPackageMap();
        map[packageIdentity(pkg)] = true;
        saveDraft({ enabledPackages: map });
        renderEnableLists();
        toast('success', '已保存并启用角色：' + pkg.title);
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'export-character-package') {
        collectCharacterFields();
        const pkg = buildCharacterPackage();
        if (!pkg) throw new Error('请先填写角色名称');
        downloadJson(pkg.id + '.json', pkg);
        toast('success', '已导出角色范本 JSON');
      }
      if (action === 'publish-character-package') {
        collectCharacterFields();
        const cc = controlCenter();
        if (!cc?.publishPackage) throw new Error('控制中心发布 API 未就绪');
        const pkg = buildCharacterPackage();
        if (!pkg) throw new Error('请先填写角色名称');
        await cc.publishPackage(pkg);
        toast('success', '角色范本已提交发布');
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'import-char-media') {
        const lib = mediaLibrary();
        if (!lib?.requestLocalImport) throw new Error('媒体库导入 API 未就绪');
        collectCharacterFields();
        const name = textOf(readCharacterDraft().name, '') || '角色';
        const field = button.dataset.field;
        const item = await lib.requestLocalImport({ type: 'bond', name, slot: button.dataset.slot || 'avatar', variant: button.dataset.variant || 'normal' });
        if (item && item.key) {
          const modal = root.querySelector('[data-xy-character-editor-modal]');
          const input = modal?.querySelector('[data-xy-char-field="' + field + '"]');
          if (input) input.value = item.key;
          collectCharacterFields();
          updateCharacterMediaPreviews();
          toast('success', '已导入并存入媒体库');
        }
      }
      if (action === 'clear-char-media') {
        const field = button.dataset.field;
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        const input = modal?.querySelector('[data-xy-char-field="' + field + '"]');
        if (input) input.value = '';
        collectCharacterFields();
        updateCharacterMediaPreviews();
      }
      if (action === 'open-world-factor-editor') {
        const modal = root.querySelector('[data-xy-world-factor-modal]');
        if (modal) {
          modal.querySelectorAll('[data-xy-wf-field]').forEach(i => { i.value = ''; });
          modal.hidden = false;
        }
      }
      if (action === 'close-world-factor-editor') {
        const modal = root.querySelector('[data-xy-world-factor-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'add-world-factor') {
        const modal = root.querySelector('[data-xy-world-factor-modal]');
        const title = textOf(modal?.querySelector('[data-xy-wf-field="title"]')?.value, '');
        const content = textOf(modal?.querySelector('[data-xy-wf-field="content"]')?.value, '');
        if (!title && !content) throw new Error('请填写因子名称或内容');
        const draft = readOpeningDraft();
        const list = Array.isArray(draft.custom_world_factors) ? draft.custom_world_factors.slice() : [];
        list.push({ title, content });
        writeOpeningDraft({ custom_world_factors: list });
        renderEnableLists();
        if (modal) modal.hidden = true;
        toast('success', '已添加世界因子：' + (title || content).slice(0, 20));
      }
      if (action === 'remove-world-factor') {
        const idx = Number(button.dataset.index);
        const draft = readOpeningDraft();
        const list = Array.isArray(draft.custom_world_factors) ? draft.custom_world_factors.slice() : [];
        if (idx >= 0 && idx < list.length) {
          list.splice(idx, 1);
          writeOpeningDraft({ custom_world_factors: list });
          renderEnableLists();
        }
      }
      if (action === 'vote-package') {
        const cc = controlCenter();
        if (!cc?.votePackage) throw new Error('创意工坊投票 API 未就绪');
        const id = button.dataset.id;
        const current = button.dataset.vote;
        const source = state.workshopTab === 'mine' ? state.myPackages : state.workshopCatalog;
        const pkg = source.find(p => String(p.id) === String(id));
        const next = (pkg && pkg.myVote === current) ? 'none' : current;
        const result = await cc.votePackage(id, next);
        if (pkg) { pkg.votes = { up: result.up || 0, down: result.down || 0 }; pkg.myVote = result.myVote || 'none'; }
        renderWorkshop();
      }
      if (action === 'download-package') {
        const id = button.dataset.id;
        const type = button.dataset.type;
        const detail = await getPackageDetailFromCatalog(id, type);
        importPackageToDraft(detail);
        renderEnableLists();
        toast('success', '已下载并缓存到浏览器：' + (detail.title || id));
      }
      if (action === 'export-current-package') {
        const pkg = buildPublishPackage(currentPublishSourcePackage());
        downloadJson(pkg.id + '.json', pkg);
        toast('success', '已导出工坊包 JSON');
      }
      if (action === 'publish-current-package') {
        const cc = controlCenter();
        if (!cc?.publishPackage) throw new Error('控制中心发布 API 未就绪');
        const pkg = buildPublishPackage(currentPublishSourcePackage());
        await cc.publishPackage(pkg);
        toast('success', '工坊包已提交发布');
        state.workshopTab = 'mine';
        await refreshWorkshop();
      }
      if (action === 'import-local-package') {
        const allowed = String(button.dataset.xyWorkshopTypes || '').split(',').map(s => s.trim()).filter(Boolean);
        await importLocalPackage(allowed.length ? allowed : activeTab().types);
      }
      if (action === 'show-package-detail') {
        const detail = await getPackageDetailFromCatalog(button.dataset.id, button.dataset.type);
        state.selectedPackage = detail;
        state.selectedAllowedTypes = activeTab().types;
        renderPackageDetail(detail, impactPreview(detail));
      }
      if (action === 'show-sample-package') {
        const detail = getSamplePackage(button.dataset.id);
        state.selectedPackage = detail;
        state.selectedAllowedTypes = activeTab().types;
        renderPackageDetail(detail, '本地示例包\n\n' + impactPreview(detail));
      }
      if (action === 'withdraw-package') {
        const cc = controlCenter();
        if (!cc?.withdrawPackage) throw new Error('控制中心撤回 API 未就绪');
        if (!confirm('确认撤回这个工坊包？撤回只会影响云端发布，不会删除本地草稿。')) return;
        await cc.withdrawPackage(button.dataset.id, button.dataset.revision || undefined);
        toast('success', '已提交撤回');
        await refreshWorkshop();
      }
      if (action === 'close-package-detail') {
        root.querySelector('[data-xy-package-modal]').hidden = true;
      }
      if (action === 'import-selected-package') {
        if (!state.selectedPackage) throw new Error('未选择工坊包');
        await importPackageObject(state.selectedPackage, state.selectedAllowedTypes);
        root.querySelector('[data-xy-package-modal]').hidden = true;
      }
      if (action === 'open-avatar-modal') {
        root.querySelector('[data-xy-avatar-modal]').hidden = false;
      }
      if (action === 'close-avatar-modal') {
        root.querySelector('[data-xy-avatar-modal]').hidden = true;
      }
      if (action === 'clear-avatar') {
        saveDraft({ player_avatar: '' });
        const input = root.querySelector('[data-xy-opening-field="player_avatar"]');
        if (input) input.value = '';
        root.querySelector('[data-xy-avatar-modal]').hidden = true;
        render();
      }
      if (action === 'use-avatar-url') {
        const url = root.querySelector('[data-xy-avatar-url]')?.value?.trim();
        if (!url) throw new Error('请先输入头像 URL');
        saveDraft({ player_avatar: url });
        const input = root.querySelector('[data-xy-opening-field="player_avatar"]');
        if (input) input.value = url;
        root.querySelector('[data-xy-avatar-modal]').hidden = true;
        render();
      }
      if (action === 'use-avatar-key') {
        const key = root.querySelector('[data-xy-avatar-key]')?.value?.trim();
        if (!key) throw new Error('请先输入媒体库键');
        saveDraft({ player_avatar: key });
        const input = root.querySelector('[data-xy-opening-field="player_avatar"]');
        if (input) input.value = key;
        root.querySelector('[data-xy-avatar-modal]').hidden = true;
        render();
      }
      if (action === 'import-avatar-local') {
        const lib = mediaLibrary();
        if (!lib?.requestLocalImport) throw new Error('媒体库导入 API 未就绪');
        const item = await lib.requestLocalImport({ type: 'bond', slot: 'avatar', name: '{{user}}', variant: 'normal' });
        if (item?.dataUrl || item?.url || item?.key) {
          const value = item.key || item.url || item.dataUrl;
          saveDraft({ player_avatar: value });
          const input = root.querySelector('[data-xy-opening-field="player_avatar"]');
          if (input) input.value = value;
          root.querySelector('[data-xy-avatar-modal]').hidden = true;
          render();
        }
      }
      if (action === 'remove-workshop-package') {
        const id = button.dataset.id;
        const type = button.dataset.type;
        const draft = readDraft();
        draft.packages = packages().filter(pkg => !(String(pkg.id) === String(id) && (!type || String(pkg.type) === String(type))));
        writeDraft(draft);
        render();
      }
      if (action === 'export-opening-draft') {
        downloadJson('xingyue-opening-draft-v3.0.2.json', readDraft());
      }
      if (action === 'clear-opening-draft' && confirm('确认清空当前开局草稿？')) {
        localStorage.removeItem(STORAGE_KEY);
        applyDraftToFields();
        render();
      }
      if (action === 'preview-world-factors') render();
      if (action === 'open-control-center') controlCenter()?.togglePanel?.();
      if (action === 'inject-workshop') {
        // #2(2.9.8)：仅注入已启用的创意工坊内容到卡绑定世界书；不写身份、不生成楼层。
        const draft = collectFields();
        const cc = controlCenter();
        let writeResult = null;
        try { writeResult = await cc?.writeOpeningWorldbookEntries?.(draft, { scope: 'workshop' }); } catch (error) { toast('error', error.message || String(error)); return; }
        const resultNode = root.querySelector('[data-xy-opening-result]');
        if (writeResult?.warning) toast('info', writeResult.warning);
        else if (writeResult?.applied) toast('success', '创意工坊内容已注入世界书');
        if (resultNode) resultNode.textContent = writeResult?.applied ? ('工坊内容已写入：' + (writeResult.worldbookName || '卡绑定世界书')) : (writeResult?.warning || '没有已启用的工坊内容可注入。');
      }
      if (action === 'start-recall') {
        // 开始回忆(2.9.8 重做)：组装「入学日正文(1) + 身份设定(2)」(1前2后) → 填入 ST 聊天输入框 → 自动点发送，
        // 形成玩家真实开局发言(第二楼)；AI 据此写正文 + 初始化开局变量(第三楼)。
        // 不在开局页内执行、不写世界书、不直接 generate —— 走真实玩家输入链路。
        const draft = collectFields();
        // 组件1：入学日正文（从开局页 .xy-story-body 读，逐段取，保留 {{user}} 宏由 ST 发送时解析）
        let storyText = '';
        try {
          const ps = root.querySelectorAll('.xy-story-body p');
          if (ps.length) storyText = Array.from(ps).map(p => (p.textContent || '').trim()).filter(Boolean).join('\n');
          else { const s = root.querySelector('.xy-story-body'); if (s) storyText = (s.textContent || '').trim(); }
        } catch (_) {}
        // 组件2：身份设定
        const identity = identityContent(draft) || '';
        if (!storyText && !identity) { toast('warn', '没有可发送的开局内容（入学日正文与身份设定均为空）'); return; }
        const promptText = [storyText, identity].filter(Boolean).join('\n\n');
        if (!confirm('开始回忆：将把「入学日正文 + 身份设定」填入聊天输入框并自动发送，形成你的开局发言（AI 据此撰写正文并初始化开局变量）。确定？')) return;
        // B19：先把身份/世界因子持久化到卡绑定世界书（[星月开局]{{user}}身份设定 常驻条目），再走玩家输入链路；
        // 否则身份仅作为一次性开局发言、后续楼层无常驻引用，开局设定会丢。写失败不阻断发送。
        try {
          const ccWb = controlCenter();
          const wbResult = await ccWb?.writeOpeningWorldbookEntries?.(draft, { scope: 'identity' });
          if (wbResult?.applied) { const rn = root.querySelector('[data-xy-opening-result]'); if (rn) rn.textContent = '身份设定已写入世界书：' + (wbResult.worldbookName || '卡绑定世界书'); }
        } catch (wbErr) {
          // 任务4.7：世界书写入失败不阻断开局发言，但给出 toast 警告
          toast('warn', '身份世界书写入失败（开局仍继续）：' + ((wbErr && wbErr.message) || String(wbErr)));
        }
        try {
          const hdoc = hostDocument();
          const ta = hdoc.querySelector('#send_textarea');
          const btn = hdoc.querySelector('#send_but');
          if (!ta || !btn) throw new Error('未找到 ST 聊天输入框(#send_textarea)或发送按钮(#send_but)');
          ta.value = promptText;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          const resultNode = root.querySelector('[data-xy-opening-result]');
          if (resultNode) resultNode.textContent = '已将「入学日正文 + 身份设定」填入输入框并发送，等待 AI 生成开局正文…';
          setTimeout(() => { try { btn.click(); toast('success', '开局发言已发送，等待 AI 生成正文…'); } catch (e) { toast('error', '点击发送失败：' + (e && e.message || e) + '（可手动按一次发送）'); } }, 60);
        } catch (error) { toast('error', '开始回忆失败：' + (error.message || String(error))); }
      }
    } catch (error) {
      toast('error', error.message || String(error));
    }
  });

  applyDraftToFields();
  runDependencyChecks();
  scheduleDependencyAutoRefresh();
  setStep(Number(readDraft().last_step || 1) || 1);
  setView(state.view);
  // P5：封面入库——opening-page.html 内联 <script> 的 applyPortrait 经 innerHTML 注入不执行（HTML5 规范），
  // --xy-opening-cover 永不设置、封面只剩底色不显入库图。搬到这里由真正执行的 JS 调用（媒体库 scene/portrait 'opening' 资产）。
  try {
    const applyOpeningCover = () => {
      try {
        const ML = mediaLibrary();
        const asset = ML && typeof ML.getAsset === 'function' && (ML.getAsset({ type: 'scene', slot: 'portrait', name: 'opening' }) || ML.getAsset({ slot: 'portrait', name: 'opening' }) || ML.getAsset({ slot: 'portrait' }));
        const src = asset && (asset.dataUrl || asset.url || asset.src);
        if (src) root.style.setProperty('--xy-opening-cover', 'url("' + src + '")');
      } catch (_e) {}
    };
    applyOpeningCover();
    (hostWindow() || window).addEventListener('crossed-zone-media-library-updated', applyOpeningCover);
  } catch (_e) {}
  // 向导绑定就绪：移除 boot 载入遮罩。原淡出逻辑写在 first_message_opening.html 的楼层内联 <script>，
  // 而 ST 渲染消息楼层不执行该 script，导致遮罩永不消失、盖住整个封面（依赖项看不见、永远停在「载入中」）。
  try {
    const xyLoader = root.querySelector('[data-xy-loading]');
    if (xyLoader) { xyLoader.classList.add('done'); setTimeout(() => { try { xyLoader.remove(); } catch (_e) {} }, 650); }
  } catch (_e) {}
    return true;
  }
  // #1/#2(2.9.8) 核心修复：开局页不再塞进 first_mes（252KB→既发给 LLM 致上下文爆炸、又卡顿）。
  // first_mes 仅放 [data-xy-opening-remote] 短标记；控制中心 fetch 远程开局页 + 注入 + 绑定（display-only，绝不进 LLM）。
  // 整页由控制中心注入(全 bare 类) → custom- 前缀问题一并消失。fetch 失败有兜底提示、不 brick。
  // 任务2.2：opening-page 双源（cdn + testingcf 备源），与 loader 策略对称
  const OPENING_PAGE_SOURCES = [
    RUNTIME_BASE_URL + '/opening-page.html',
    'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.0.2/opening-page.html',
    'https://43-132-171-157.sslip.io/runtime/xingyue/3.0.2/opening-page.html',
  ];
  function loadRemoteOpeningPages(doc) {
    try {
      doc.querySelectorAll?.('[data-xy-opening-remote]:not([data-xy-remote-state])').forEach(mount => {
        mount.setAttribute('data-xy-remote-state', 'loading');
        // 顺序尝试多源，任一成功即停止
        const trySource = (sources) => {
          if (!sources.length) {
            mount.removeAttribute('data-xy-remote-state'); // 允许下次定时/事件重试
            try { const l = mount.querySelector('[data-xy-opening-loading]') || mount; l.textContent = '开局界面远程加载失败（所有源均不可达）。请检查网络后刷新本楼层重试。'; } catch (_) {}
            return;
          }
          const [url, ...rest] = sources;
          fetch(url, { cache: 'default' })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
            .then(html => {
              mount.innerHTML = html;
              mount.setAttribute('data-xy-remote-state', 'loaded');
              try { scanOpeningPages(); } catch (_) {}
            })
            .catch(() => trySource(rest));
        };
        trySource(OPENING_PAGE_SOURCES);
      });
    } catch (_) {}
  }
  function scanOpeningPages() {
    const docs = [];
    try { docs.push(document); } catch (_) {}
    try { const hostDoc = hostDocument(); if (hostDoc && !docs.includes(hostDoc)) docs.push(hostDoc); } catch (_) {}
    let count = 0;
    docs.forEach(doc => {
      try {
        loadRemoteOpeningPages(doc); // 先把远程开局页拉取注入到短标记
        doc.querySelectorAll?.('[data-xy-opening-page]').forEach(root => {  // 版本无关绑定（注入后的开局页带 data-xy-opening-page）
          if (bindOpeningPage(root)) count += 1;
        });
      } catch (_) {}
    });
    if (count > 0 && openingObserver) { try { openingObserver.disconnect(); } catch (_) {} openingObserver = null; }
    return count;
  }
  function scheduleOpeningPageScan(delay = 80) {
    if (openingScanTimer) clearTimeout(openingScanTimer);
    openingScanTimer = setTimeout(() => {
      openingScanTimer = null;
      scanOpeningPages();
    }, delay);
  }
  function ensureOpeningPageBinding() {
    scanOpeningPages();
    // #1(2.9.8)：移除对整个 doc.body 的常驻 subtree MutationObserver——它在「选卡→逐个确认导入」窗口里
    // 持续触发扫描，是卡顿次因（2.9.8 仅「绑定后断开」，但绑定发生在开局页渲染之后，导入期仍空转）。
    // 改纯靠定时兜底 + 下方 ST 事件捕获开局页（开局页只渲染一次，事件+定时足够）。
    [120, 350, 700, 1200, 2000, 3200, 5000, 8000].forEach(delay => setTimeout(scanOpeningPages, delay));
    try {
      const eventOnHost = window.eventOn || hostWindow().eventOn;
      const events = window.tavern_events || hostWindow().tavern_events || {};
      const eventNames = [events.CHAT_CHANGED, events.USER_MESSAGE_RENDERED, events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_UPDATED, events.MESSAGE_SWIPED].filter(Boolean);
      if (typeof eventOnHost === 'function') {
        eventNames.forEach(name => {
          try {
            const disposer = eventOnHost(name, () => scheduleOpeningPageScan(80));
            if (disposer?.stop) disposers.push(() => disposer.stop());
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function destroy() {
    try { openingObserver?.disconnect?.(); } catch (_) {}
    openingObserver = null;
    if (openingScanTimer) clearTimeout(openingScanTimer);
    openingScanTimer = null;
    while (disposers.length) {
      try { disposers.pop()?.(); } catch (_) {}
    }
    try { hostDocument().getElementById(CONTROL_PANEL_ID)?.remove(); } catch (_) {}
    try { hostDocument().getElementById(WAND_CONTAINER_ID)?.remove(); } catch (_) {}
    try { if (window.XingyueControlCenter === api) delete window.XingyueControlCenter; } catch (_) {}
    try { if (window.CrossedZoneControlCenter === api) delete window.CrossedZoneControlCenter; } catch (_) {}
    try { const host = hostWindow(); if (host && host !== window) { if (host.XingyueControlCenter === api) delete host.XingyueControlCenter; if (host.CrossedZoneControlCenter === api) delete host.CrossedZoneControlCenter; } } catch (_) {}
  }
  function status() {
    return { version: VERSION, settings: { ...settings }, workshopCacheCount: workshopCache.length, lastError };
  }
  const api = {
    version: VERSION,
    getSettings: () => ({ ...settings }),
    saveSettings,
    refreshWorkshop,
    importPackage,
    installPackageToWorldbook,
    validatePackage,
    packageDetail,
    checkWorkshopAuth,
    logout,
    getWorkshopIdentity,
    workshopLoginUrl,
    publishPackage,
    myPackages,
    withdrawPackage,
    votePackage,
    importPackageToDraft,
    readOpeningDraft,
    writeOpeningDraft,
    previewOpeningWrites,
    writeOpeningWorldbookEntries,
    worldFactorContent,
    recipeEntries,
    buildCraftSettlement,
    applyCraftSettlement,
    rerollCurrentVariables,
    previewVariableCorrection,
    applyVariableCorrection,
    openVariableTunePopover,
    openAnalysisPopover,
    rerollFromAnalysis,
    repairVariableFormat,
    handleOmniButton,
    npcEntries,
    generateNpcPerspective,
    getNpcPerspectiveCache: () => clone(npcPerspectiveCache),
    bindOpeningPage,
    scanOpeningPages,
    ensureOpeningPageBinding,
    ensureWandEntry,
    togglePanel,
    status,
    destroy,
  };
  window.XingyueControlCenter = api;
  window.CrossedZoneControlCenter = api;
  window.XingyueHudSettings = { getSettings: () => ({ ...settings }), saveSettings };
  window.CrossedZoneHudSettings = window.XingyueHudSettings;
  // 任务3.3：注入 RUNTIME_BASE_URL 为全局常量，media_library.js/status_bar_regex.html 从此读取（降级保留内联硬编码）
  window.XY_RT_BASE = RUNTIME_BASE_URL;
  // #3(2.9.8) 同步暴露到宿主窗口(top/parent)：媒体库等同级 iframe 的 cc() 经 hostWindow() 才能取到控制中心 API
  try {
    const host = hostWindow();
    if (host && host !== window) {
      host.XingyueControlCenter = api;
      host.CrossedZoneControlCenter = api;
      host.XingyueHudSettings = window.XingyueHudSettings;
      host.CrossedZoneHudSettings = window.XingyueHudSettings;
      // 同步 XY_RT_BASE 到宿主窗口
      host.XY_RT_BASE = RUNTIME_BASE_URL;
    }
  } catch (_) {}
  ensurePanel();
  ensureWandEntry();
  setTimeout(ensureWandEntry, 1000);
  ensureOpeningPageBinding();
  captureWorkshopLogin();
  bindVariableTuneEntries();
  bindAnalysisEntries();
  loadSidebarState();
  ensureSidebar();
  setTimeout(ensureSidebar, 1500);
})();
