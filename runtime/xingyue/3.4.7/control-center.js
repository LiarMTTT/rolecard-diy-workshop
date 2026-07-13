(() => {
  const VERSION = '3.4.7';
  const BUTTON_NAME = '星月私立高等学院 控制中心 v3.4.7';
  // 任务3.3：单一真相源 RUNTIME_BASE_URL；media_library.js/status_bar_regex.html 从 window.XY_RT_BASE 读（降级保留内联硬编码）
  const RUNTIME_BASE_URL = 'https://cdn.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.4.7';
  // OpeningDraftV2：旧 key 只作一次性迁移与回滚来源，新草稿按聊天 metadata UUID 分区。
  const OPENING_DRAFT_KEY = 'xingyue-opening-draft-v333';
  const OPENING_DRAFTS_V2_KEY = 'xingyue-opening-drafts-v2';
  const OPENING_DRAFT_UUID_METADATA_KEY = 'xingyue_opening_draft_uuid_v2';
  const OPENING_DRAFT_SCHEMA_VERSION = 2;
  const CONTROL_PANEL_ID = 'xingyue-control-center-panel';
  const CONTROL_PANEL_STYLE_ID = 'xingyue-control-center-style';
  const WAND_CONTAINER_ID = 'xingyue-control-center-wand-container';
  const WAND_BUTTON_ID = 'xingyue-control-center-wand-button';
  const STORAGE_KEY = 'xingyue-academy-control-center-settings-v333';
  const STATUS_HUD_DRAWER_ID = 'xingyue-hud-drawer';
  const STATUS_HUD_DRAWER_STYLE_ID = 'xingyue-hud-drawer-style';
  const STATUS_HUD_ENTRY_MODES = ['auto', 'drawer', 'orb'];
  const STATUS_HUD_DRAWER_PLACEMENTS = ['auto', 'top', 'bottom'];
  const STATIC_INDEX_URL = 'https://liarmttt.github.io/rolecard-diy-workshop/cards/xingyue/index.json';
  const DEFAULT_GATEWAY_URL = 'https://43-132-171-157.sslip.io';
  const SUPPORTED_TYPES = ['character','user_identity','world_factor','shop_item','blueprint','recipe','skill','function'];
  const BLOCKED_TYPES = ['opening_pack','prompt_patch','ui_theme'];
  const SUPPORTED_CARD_SCOPES = ['xingyue','shared','xingyue-opening-v1'];
  const OPENING_PACKAGE_SCOPE = 'xingyue-opening-v1';
  const OPENING_PACKAGE_TARGET = 'xingyue.opening_day_body';
  const SUPPORTED_RATINGS = ['general','mature','restricted'];
  const OPENING_SOURCE = 'xingyue-opening-wizard';
  const WORKSHOP_SOURCE = 'xingyue-workshop';
  const WORLD_FACTOR_COMMENT = '[世界因子]当前设定';
  const IDENTITY_COMMENT = '[星月开局]{{user}}身份设定';
  const WORKSHOP_START_COMMENT = '--/星月工坊开始';
  const WORKSHOP_END_COMMENT = '--/星月工坊结束';
  // 批C：生成前注入的提示词 id（新闻策略 / 雷达清理增强），uninjectPrompts 按这组 id 清理
  const NEWS_PROMPT_ID = 'xingyue-news-policy';
  const RADAR_PROMPT_ID = 'xingyue-radar-enhanced';
  const GENERATION_INJECTION_IDS = [NEWS_PROMPT_ID, RADAR_PROMPT_ID];
  const DEFAULT_SETTINGS = {
    gatewayUrl: DEFAULT_GATEWAY_URL,
    staticIndexUrl: STATIC_INDEX_URL,
    mediaDisplayEnabled: true,
    newsPolicyEnabled: true,
    newsRefreshMode: 'time',
    newsTimeIntervalHours: 6,
    newsPerRound: 1,
    radarCleanupPolicyEnabled: true,
    showFrozenInteractiveCharacters: false,
    statusHudEntryMode: 'auto',
    statusHudDrawerPlacement: 'auto',
    panelLeft: 0,
    panelTop: 82,
    panelWidth: 520,
    panelHeight: 640,
  };
  let panelOpen = false;
  let runtimeDestroyed = false;
  let hudSettingsApi = null;
  let workshopCache = [];
  let lastError = '';
  let selectedRecipeId = '';
  let selectedNpcName = '';
  let lastCraftPreview = null;
  let lastNpcPerspective = null;
  let lastVariableFix = null; // B17：当前楼变量重算/定点修正的最近一次结果（预览→写回）
  let workshopAuth = { checked: false, loggedIn: false, publisherId: '', error: '' };
  let workshopIdentity = null; // Discord 昵称/头像仅驻留当前 runtime 内存；不写 localStorage、不入库
  let workshopLoginPoll = null;
  let workshopLoginGeneration = 0;
  let workshopAuthEpoch = 0;
  const npcPerspectiveCache = {};
  const disposers = [];
  const runtimeOwner = {};
  function hostWindow() {
    try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (_) {}
    return window;
  }
  function hostDocument() {
    try { return hostWindow().document || document; } catch (_) { return document; }
  }
  (function destroyPreviousRuntime() {
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    const seen = new Set();
    targets.forEach(target => {
      const previous = target?.XingyueControlCenter || target?.CrossedZoneControlCenter;
      if (!previous || seen.has(previous) || typeof previous.destroy !== 'function') return;
      seen.add(previous);
      try { previous.destroy(); } catch (_) {}
    });
  })();
  // 控制中心主作用域的 mediaLibrary：renderPanel / renderMediaLibrarySection 等都在 bindOpeningPage 外，
  // 而原 mediaLibrary 只定义在 bindOpeningPage 内部（约 line 1371），导致这些主作用域调用抛
  // ReferenceError「mediaLibrary is not defined」→ 控制中心媒体库分区渲染失败、整面板空白。
  function mediaLibrary() {
    return window.XingyueMediaLibrary || hostWindow().XingyueMediaLibrary || window.CrossedZoneMediaLibrary || hostWindow().CrossedZoneMediaLibrary || null;
  }
  function toast(kind, message) {
    try { if (window.toastr && typeof window.toastr[kind] === 'function') window.toastr[kind](message); } catch (_) {}
  }
  function commitWorkshopAuth(next) {
    workshopAuth = {
      checked: next?.checked === true,
      loggedIn: next?.loggedIn === true,
      publisherId: String(next?.publisherId || ''),
      error: String(next?.error || ''),
    };
    return { ...workshopAuth };
  }
  const GIT_RUNTIME_REVISION = '3.4.7-stability-r38-20260713';
  function createRuntimeOwnerId() {
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    for (const target of targets) {
      try {
        const uuid = target?.crypto?.randomUUID?.();
        if (uuid) return GIT_RUNTIME_REVISION + ':' + uuid;
      } catch (_) {}
    }
    return GIT_RUNTIME_REVISION + ':' + Date.now().toString(36) + ':' + String(++createRuntimeOwnerId.fallbackCounter);
  }
  createRuntimeOwnerId.fallbackCounter = 0;
  runtimeOwner.id = createRuntimeOwnerId();
  const GIT_RUNTIME_REVISION_KEY = 'xingyue-control-center-runtime-revision';
  const OMNI_FLAT_STYLE_ID = 'xingyue-omni-flat-style';
  const OMNI_FLAT_CSS = [
    '[data-xy-omni="done"] .xy-omni-body{background:transparent!important;border:0!important;}',
    '[data-xy-omni="done"] .xy-omni-result,[data-xy-omni="done"] .xy-omni-stream,[data-xy-omni="done"] .xy-omni-analysis,[data-xy-omni="done"] .xy-omni-analysis-text,[data-xy-omni="done"] .xy-omni-result-head,[data-xy-omni="done"] .xy-omni-patch,[data-xy-omni="done"] .xy-omni-validation,[data-xy-omni="done"] .xy-omni-valid-note,[data-xy-omni="done"] .xy-omni-errors{background:transparent!important;border:0!important;box-shadow:none!important;outline:0!important;}',
    '[data-xy-omni="done"] .xy-omni-result,[data-xy-omni="done"] .xy-omni-stream,[data-xy-omni="done"] .xy-omni-analysis,[data-xy-omni="done"] .xy-omni-analysis-text,[data-xy-omni="done"] .xy-omni-patch,[data-xy-omni="done"] .xy-omni-validation,[data-xy-omni="done"] .xy-omni-complete{padding:0!important;}',
    '[data-xy-omni="done"] .xy-omni-stream{min-width:0!important;max-height:360px!important;overflow:auto!important;}',
    '[data-xy-omni="done"] .xy-omni-analysis{color:#a9c0cd!important;}',
    '[data-xy-omni="done"] .xy-omni-analysis-text,[data-xy-omni="done"] .xy-omni-patch{max-width:100%!important;max-height:none!important;overflow:visible!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important;}',
    '@media(max-width:620px){[data-xy-omni="done"] .xy-omni-stream{max-height:260px!important;}}',
    '[data-xy-omni="done"] .xy-omni-complete{background:transparent!important;border:0!important;box-shadow:none!important;}',
    '[data-xy-omni="done"] .xy-omni-grid{display:block!important;background:transparent!important;border:0!important;box-shadow:none!important;}',
    '[data-xy-omni="done"] .xy-omni-cell{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;}',
  ].join('');
  function omniFlatDocuments() {
    const docs = [];
    try { if (document) docs.push(document); } catch (_) {}
    try { const hostDoc = hostDocument(); if (hostDoc && !docs.includes(hostDoc)) docs.push(hostDoc); } catch (_) {}
    return docs;
  }
  function ensureOmniFlatStyle() {
    omniFlatDocuments().forEach(doc => {
      try {
        let style = doc.getElementById(OMNI_FLAT_STYLE_ID);
        if (!style) {
          style = doc.createElement('style');
          style.id = OMNI_FLAT_STYLE_ID;
          (doc.head || doc.body || doc.documentElement).appendChild(style);
        }
        if (style.textContent !== OMNI_FLAT_CSS) style.textContent = OMNI_FLAT_CSS;
      } catch (_) {}
    });
  }
  function removeOmniFlatStyle() {
    omniFlatDocuments().forEach(doc => { try { doc.getElementById(OMNI_FLAT_STYLE_ID)?.remove(); } catch (_) {} });
  }
  function notifyGitRuntimeRevision() {
    try {
      const host = hostWindow();
      const store = host.localStorage || window.localStorage;
      if (!store) return;
      const prev = store.getItem(GIT_RUNTIME_REVISION_KEY);
      if (prev && prev !== GIT_RUNTIME_REVISION) {
        setTimeout(() => toast('info', '星月控制中心组件已更新：' + GIT_RUNTIME_REVISION + '。刷新/重新打开后已生效。'), 600);
      }
      if (prev !== GIT_RUNTIME_REVISION) store.setItem(GIT_RUNTIME_REVISION_KEY, GIT_RUNTIME_REVISION);
    } catch (_) {}
  }
  function dispatchControlCenterReady() {
    const detail = { version: VERSION, revision: GIT_RUNTIME_REVISION };
    const targets = [window];
    try {
      const host = hostWindow();
      if (host && targets.indexOf(host) < 0) targets.push(host);
    } catch (_) {}
    targets.forEach(target => {
      try {
        const EventCtor = target.CustomEvent || CustomEvent;
        target.dispatchEvent(new EventCtor('xingyue-control-center-ready', { detail }));
      } catch (_) {}
    });
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
  const WORLDBOOK_AI_SESSION_KEY = 'xingyue.worldbook-ai-session.v1';
  let worldbookAiMemoryConfig = null;
  const worldbookAiActiveIds = new Set();
  function worldbookAiSessionStore() {
    const candidates = [hostWindow(),window];
    for (const target of candidates) { try { if (target?.sessionStorage) return target.sessionStorage; } catch (_) {} }
    return null;
  }
  function normalizeWorldbookAiRuntimeConfig(value = {}) {
    return {
      source:value?.source === 'custom' ? 'custom' : 'current',
      apiurl:String(value?.apiurl || '').trim().slice(0,2048),
      key:String(value?.key || '').slice(0,4096),
      model:String(value?.model || '').trim().slice(0,200),
      rememberKey:value?.rememberKey === true,
      allowLocalHttp:value?.allowLocalHttp === true,
    };
  }
  function isWorldbookAiLoopback(hostname) {
    const raw = String(hostname || '').toLowerCase();
    const host = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1,-1) : raw;
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
    const parts = host.split('.').map(Number);
    return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 127;
  }
  function normalizeWorldbookAiApiUrl(value, allowLocalHttp = false) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch (_) { throw new Error('自定义 API 地址无效'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('自定义 API 地址必须是不含凭据、query 或 fragment 的完整基础 URL');
    if (url.protocol === 'http:' && !(allowLocalHttp && isWorldbookAiLoopback(url.hostname))) throw new Error('自定义 API 默认要求 HTTPS；本机 HTTP 需显式开启开发模式');
    return url.href.replace(/\/$/,'');
  }
  function loadWorldbookAiSessionConfig() {
    if (worldbookAiMemoryConfig) return { ...worldbookAiMemoryConfig };
    let stored = {};
    try { stored = JSON.parse(worldbookAiSessionStore()?.getItem(WORLDBOOK_AI_SESSION_KEY) || '{}'); } catch (_) { stored = {}; }
    worldbookAiMemoryConfig = normalizeWorldbookAiRuntimeConfig(stored);
    if (!worldbookAiMemoryConfig.rememberKey) worldbookAiMemoryConfig.key = '';
    return { ...worldbookAiMemoryConfig };
  }
  function saveWorldbookAiSessionConfig(value) {
    const next = normalizeWorldbookAiRuntimeConfig(value);
    worldbookAiMemoryConfig = next;
    const sessionValue = { source:next.source, apiurl:next.apiurl, model:next.model, rememberKey:next.rememberKey, allowLocalHttp:next.allowLocalHttp };
    if (next.rememberKey) sessionValue.key = next.key;
    let sessionStored = false;
    try { const store = worldbookAiSessionStore(); if (store) { store.setItem(WORLDBOOK_AI_SESSION_KEY,JSON.stringify(sessionValue)); sessionStored = true; } } catch (_) {}
    return { ...next, sessionStored };
  }
  function clearWorldbookAiSessionConfig() {
    worldbookAiMemoryConfig = { source:'current', apiurl:'', key:'', model:'', rememberKey:false, allowLocalHttp:false };
    try { worldbookAiSessionStore()?.removeItem(WORLDBOOK_AI_SESSION_KEY); } catch (_) {}
    try { worldbookEditor?.clearAiConfig?.({ clearAdapter:false }); } catch (_) {}
    return true;
  }
  function assertWorldbookAiRequest(request) {
    if (!request || typeof request !== 'object') throw new Error('AI 请求不存在');
    if (!/^xingyue-p7-(?:keywords|compress|draft)-/.test(String(request.generationId || ''))) throw new Error('AI generation_id 无效');
    if (request.maxChatHistory !== 0) throw new Error('AI 请求必须禁用聊天历史');
    if (!Array.isArray(request.orderedPrompts) || request.orderedPrompts.length !== 2 || request.orderedPrompts[0]?.role !== 'system' || request.orderedPrompts[1] !== 'user_input') throw new Error('AI 提示词必须严格使用 system + user_input');
    if (typeof request.userInput !== 'string' || !request.userInput || request.userInput.length > 80000) throw new Error('AI 用户上下文为空或超限');
    if (!request.jsonSchema?.name || request.jsonSchema?.strict !== true || request.jsonSchema?.value?.additionalProperties !== false) throw new Error('AI JSON Schema 契约无效');
  }
  const worldbookAiAssistant = {
    loadSessionConfig:loadWorldbookAiSessionConfig,
    saveSessionConfig:saveWorldbookAiSessionConfig,
    clearSessionConfig:clearWorldbookAiSessionConfig,
    async generate(request, value) {
      assertWorldbookAiRequest(request);
      const config = normalizeWorldbookAiRuntimeConfig(value);
      const helper = helperHost();
      const fn = helper?.generateRaw || window.generateRaw || hostWindow().generateRaw;
      if (typeof fn !== 'function') throw new Error('Tavern Helper generateRaw 不可用');
      const generationId = String(request.generationId);
      const payload = {
        generation_id:generationId,
        user_input:request.userInput,
        should_silence:true,
        should_stream:false,
        max_chat_history:0,
        ordered_prompts:request.orderedPrompts,
        json_schema:{ name:request.jsonSchema.name, description:request.jsonSchema.description || '', value:request.jsonSchema.value, strict:true },
      };
      if (config.source === 'custom') {
        const apiurl = normalizeWorldbookAiApiUrl(config.apiurl,config.allowLocalHttp);
        if (!config.model) throw new Error('自定义 API 必须填写模型名称');
        payload.custom_api = { apiurl, key:config.key, model:config.model, source:'openai', max_tokens:request.task === 'keywords' ? 1200 : 4000 };
      }
      worldbookAiActiveIds.add(generationId);
      try { return await fn.call(helper || hostWindow(),payload); }
      finally { worldbookAiActiveIds.delete(generationId); }
    },
    cancel(generationId) {
      const id = String(generationId || '');
      const helper = helperHost();
      const stop = helper?.stopGenerationById || window.stopGenerationById || hostWindow().stopGenerationById;
      if (typeof stop !== 'function') return false;
      const result = stop.call(helper || hostWindow(),id);
      if (result !== false) worldbookAiActiveIds.delete(id);
      return result;
    },
    cancelAll() {
      const ids = [...worldbookAiActiveIds];
      ids.forEach(id => { try { this.cancel(id); } catch (_) {} });
      return ids.length;
    },
    status() {
      const config = loadWorldbookAiSessionConfig();
      return { source:config.source, apiurl:config.apiurl, model:config.model, rememberKey:config.rememberKey, allowLocalHttp:config.allowLocalHttp, hasKey:!!config.key, activeRequests:worldbookAiActiveIds.size };
    },
  };
  function getCurrentMvuData() {
    const Mvu = mvuHost();
    if (!Mvu?.getMvuData) throw new Error('MVU 尚未就绪');
    return Mvu.getMvuData({ type: 'message', message_id: 'latest' });
  }
  // reroll/变量修正走 generateRaw（LLM，慢）时的持续气泡：显示到完成/失败为止，提示不会改正文。返回关闭函数。
  function showRerollBubble(text) {
    try {
      const doc = hostDocument();
      if (!doc.getElementById('xy-reroll-bubble-style')) {
        const st = doc.createElement('style'); st.id = 'xy-reroll-bubble-style';
        st.textContent = '@keyframes xy-spin{to{transform:rotate(360deg)}}';
        (doc.head || doc.body).appendChild(st);
      }
      let el = doc.getElementById('xy-reroll-bubble');
      if (!el) {
        el = doc.createElement('div'); el.id = 'xy-reroll-bubble';
        el.style.cssText = 'position:fixed;z-index:2147483647;max-width:300px;padding:10px 14px;background:rgba(10,18,26,.95);color:#cfe;border:1px solid #4fd97a;border-radius:10px;font:13px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.45);display:flex;align-items:center;gap:9px';
        // K1：ST 顶层 <html> 带 transform,fixed 包含块被劫持成整页,right/bottom 会落到长页最底端视口外(3.3.0 真机实锤)
        // → 用视口坐标 left/top 正向定位到右下角
        const w = hostWindow();
        el.style.left = Math.max(8, (w.innerWidth || 800) - 316) + 'px';
        el.style.top = Math.max(8, (w.innerHeight || 600) - 76) + 'px';
        doc.body.appendChild(el);
      }
      el.innerHTML = '<span style="flex:0 0 auto;display:inline-block;width:13px;height:13px;border:2px solid #4fd97a;border-top-color:transparent;border-radius:50%;animation:xy-spin .8s linear infinite"></span><span>' + String(text || '正在重算变量…') + '</span>';
      let closed = false;
      return function close() { if (closed) return; closed = true; try { el.remove(); } catch (_) {} };
    } catch (_) { return function () {}; }
  }
  function statRoot(mvuData) {
    return (mvuData && isObject(mvuData.stat_data)) ? mvuData.stat_data : (mvuData || {});
  }
  function normalizeStatusHudEntryMode(mode) {
    return STATUS_HUD_ENTRY_MODES.includes(mode) ? mode : 'auto';
  }
  function normalizeStatusHudDrawerPlacement(placement) {
    return STATUS_HUD_DRAWER_PLACEMENTS.includes(placement) ? placement : 'auto';
  }
  function normalizeSettings(next) {
    const merged = { ...DEFAULT_SETTINGS, ...(next || {}) };
    delete merged.summaryUpdateEnabled;
    merged.statusHudEntryMode = normalizeStatusHudEntryMode(merged.statusHudEntryMode);
    merged.statusHudDrawerPlacement = normalizeStatusHudDrawerPlacement(merged.statusHudDrawerPlacement);
    return merged;
  }
  function readSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {});
    } catch (_) {
      return normalizeSettings();
    }
  }
  let settings = readSettings();
  function saveSettings(partial) {
    const oldStatusHudEntryMode = settings.statusHudEntryMode;
    const oldStatusHudDrawerPlacement = settings.statusHudDrawerPlacement;
    settings = normalizeSettings({ ...settings, ...(partial || {}) });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
    broadcastHudSettingsUpdate();
    if (
      Object.prototype.hasOwnProperty.call(partial || {}, 'statusHudEntryMode')
      || Object.prototype.hasOwnProperty.call(partial || {}, 'statusHudDrawerPlacement')
      || settings.statusHudEntryMode !== oldStatusHudEntryMode
      || settings.statusHudDrawerPlacement !== oldStatusHudDrawerPlacement
    ) {
      try { refreshStatusHudEntrySurface(); } catch (_) {}
    }
    renderPanel();
    return { ...settings };
  }
  function clampPanelRect(rect, doc = hostDocument()) {
    const win = doc.defaultView || hostWindow();
    const vw = Math.max(1, Number(win.innerWidth || 1280));
    const vh = Math.max(1, Number(win.innerHeight || 720));
    const maxWidth = Math.max(1, vw - 16);
    const maxHeight = Math.max(1, vh - 16);
    const width = Math.max(Math.min(320, maxWidth), Math.min(Number(rect.width || settings.panelWidth || 520), maxWidth));
    const height = Math.max(Math.min(260, maxHeight), Math.min(Number(rect.height || settings.panelHeight || 640), maxHeight));
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
  // 批C ⑥+⑤：生成前提示词注入基建。新闻策略 / 雷达清理增强双路独立开关，共用一次 injectPrompts；
  // 事件接线与注入模式移植交错宙域 2.6.0 control_center.js（AFTER_COMMANDS 主注入 + STARTED 兜底 + ENDED/STOPPED 清理）。
  let lastGenerationInjection = null;
  function buildNewsPolicyPrompt() {
    if (settings.newsPolicyEnabled === false) return '';
    const timeMode = settings.newsRefreshMode !== 'round';
    const modeLines = timeMode
      ? [
        '刷新模式: 按变量时间变化阈值刷新。',
        '变量内时间推进达到 ' + settings.newsTimeIntervalHours + ' 小时后，才允许主动刷新旧新闻；0 表示仅按公开事件必要性刷新旧新闻。',
        '时间阈值只作用于「主动刷新旧新闻」：达到阈值前不主动翻新旧新闻。',
        '「新增公开新闻」不受时间阈值限制；每轮新增以 1 条为宜，确属公开重大事件时可不受此上限。',
      ]
      : [
        '刷新模式: 按每轮新闻数刷新。',
        '每轮最多新增或刷新新闻: ' + settings.newsPerRound + ' 条。',
        '时间阈值设置在每轮模式下禁用，不作为本轮限制来源。',
      ];
    return [
      '<新闻刷新策略>',
      '本轮新闻更新由酒馆助手控制中心动态注入，静态 check 仍为兜底。',
      ...modeLines,
      '新增公开新闻只记录公开可知且具传播条件的重大事件；私密、无人知晓、无目击、封闭场景内容只能写入近期事件。',
      '若本策略缺失，则沿用角色卡静态新闻 check。',
      '</新闻刷新策略>',
    ].join('\n');
  }
  function buildRadarEnhancedPrompt() {
    if (settings.radarCleanupPolicyEnabled === false) return '';
    return [
      '<雷达清理增强>',
      '本轮 <analysis> 雷达部分额外执行三步，patch 并入 <UpdateVariable>：',
      '① 过时清除：满足以下任一时 remove 信号（有后续钩子先写近期事件，后 remove）：对应目标 3 轮以上未被提及且已超出感知范围；关联任务/活动已结束；描述状态与已知事实明显矛盾。证据不足则保留，可将备注改「待确认」。',
      '② 冗余合并：同一目标多条信号 → 保留编号最小或强度最高的一条，其余有效信息并入描述/备注后 remove。只使用合法字段：目标类型/名称/信号强度/方位/描述/归属/备注。',
      '③ 上限 8 条：超出时按优先级（当前互动→羁绊→危险→载具/居所→物品→其余按信号强度）保留前 8，remove 其余（有后续钩子先写近期事件）。',
      '<analysis> 末尾写一行：「雷达清理：保留 X / remove Y / 合并 Z，理由 [简述]」。',
      '</雷达清理增强>',
    ].join('\n');
  }
  function clearGenerationPrompts() {
    try { if (typeof uninjectPrompts === 'function') uninjectPrompts(GENERATION_INJECTION_IDS); } catch (_) {}
  }
  function injectGenerationPrompts(reason) {
    try {
      settings = readSettings();
      clearGenerationPrompts();
      const prompts = [];
      const news = buildNewsPolicyPrompt();
      if (news) {
        prompts.push({
          id: NEWS_PROMPT_ID,
          position: 'in_chat',
          depth: 0,
          role: 'system',
          content: news,
          should_scan: false,
        });
      }
      const radar = buildRadarEnhancedPrompt();
      if (radar) {
        prompts.push({
          id: RADAR_PROMPT_ID,
          position: 'in_chat',
          depth: 0,
          role: 'system',
          content: radar,
          should_scan: false,
        });
      }
      if (prompts.length && typeof injectPrompts === 'function') {
        injectPrompts(prompts, { once: true });
      }
      lastGenerationInjection = {
        at: Date.now(),
        reason: reason || 'generation',
        newsPolicy: !!news,
        radarEnhanced: !!radar,
        promptCount: prompts.length,
      };
    } catch (_) {}
  }
  function bindGenerationPromptInjection() {
    // TH 全局在 window 缺位时回退 hostWindow()（异构挂载防御，对齐同库 opening-scan 绑定写法）
    const hw = hostWindow();
    const on = typeof eventOn === 'function' ? eventOn : (hw && typeof hw.eventOn === 'function' ? hw.eventOn : null);
    const onFirst = typeof eventMakeFirst === 'function' ? eventMakeFirst : (hw && typeof hw.eventMakeFirst === 'function' ? hw.eventMakeFirst : on);
    const events = window.tavern_events || (hw && hw.tavern_events) || {};
    let bindCount = 0;
    // eventOn 新版返回 { stop() }、旧版返回 void；统一包一层函数进 disposers，destroy 批量清理
    const track = handle => disposers.push(() => {
      try { if (typeof handle === 'function') handle(); else handle?.stop?.(); } catch (_) {}
    });
    if (onFirst && events.GENERATION_AFTER_COMMANDS) { bindCount++; track(onFirst(events.GENERATION_AFTER_COMMANDS, () => {
      injectGenerationPrompts('GENERATION_AFTER_COMMANDS');
    })); }
    if (on && events.GENERATION_STARTED) { bindCount++; track(on(events.GENERATION_STARTED, () => {
      injectGenerationPrompts('GENERATION_STARTED');
    })); }
    if (on && events.GENERATION_ENDED) { bindCount++; track(on(events.GENERATION_ENDED, () => {
      clearGenerationPrompts();
    })); }
    if (on && events.GENERATION_STOPPED) { bindCount++; track(on(events.GENERATION_STOPPED, () => {
      clearGenerationPrompts();
    })); }
    if (!bindCount) lastGenerationInjection = { at: Date.now(), reason: 'bind-failed', bound: 0 };
    disposers.push(() => { clearGenerationPrompts(); });
  }
  function stylePanel(doc) {
    if (doc.getElementById(CONTROL_PANEL_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = CONTROL_PANEL_STYLE_ID;
    style.textContent =
      '#xingyue-control-center-panel,#xingyue-control-center-panel *{box-sizing:border-box}#xingyue-control-center-panel{position:fixed;z-index:2147483000;right:auto;top:82px;width:min(520px,calc(100vw - 28px));height:min(640px,78vh);overflow:auto;color:#d9f4ff;background:linear-gradient(180deg,rgba(12,28,44,.97),rgba(4,11,18,.99));border:1px solid rgba(107,199,242,.7);box-shadow:0 16px 46px rgba(0,0,0,.55),0 0 24px rgba(107,199,242,.22);font:12px/1.55 "Microsoft YaHei",sans-serif;padding:12px;resize:none}' +
      '#xingyue-control-center-panel[hidden]{display:none!important}#xingyue-control-center-panel button{background:rgba(107,199,242,.08);border:1px solid rgba(107,199,242,.45);color:#d9f4ff;padding:4px 8px;cursor:pointer}#xingyue-control-center-panel button:hover{background:rgba(107,199,242,.18)}' +
      '#xingyue-control-center-panel input,#xingyue-control-center-panel textarea,#xingyue-control-center-panel select{width:100%;min-width:0;background:rgba(3,8,13,.82);border:1px solid rgba(107,199,242,.35);color:#d9f4ff;padding:5px;font:inherit}#xingyue-control-center-panel textarea{min-height:72px;resize:vertical}' +
      '#xingyue-control-center-panel .xy-head{display:flex;gap:8px;align-items:center;margin:-4px -4px 10px;padding:4px;cursor:move;user-select:none}.xy-title{font-weight:700;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.xy-close{margin-left:auto;flex:0 0 auto}.xy-resize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;border-right:2px solid rgba(255,212,122,.72);border-bottom:2px solid rgba(255,212,122,.72);cursor:nwse-resize}.xy-grid{display:grid;gap:8px}.xy-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);padding:7px;background:rgba(255,255,255,.035)}.xy-section{border:1px solid rgba(107,199,242,.22);padding:8px;background:rgba(255,255,255,.025)}.xy-section h4{margin:0 0 6px;color:#fff}.xy-section label{display:grid;gap:4px;margin:6px 0;color:#9fc7d8}.xy-list{display:grid;gap:6px}.xy-card{border:1px solid rgba(107,199,242,.2);padding:7px;background:rgba(0,0,0,.18)}.xy-actions{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.xy-pre{white-space:pre-wrap;max-height:220px;overflow:auto;border:1px dashed rgba(107,199,242,.24);background:rgba(0,0,0,.22);padding:7px;color:#bfeaff}.xy-muted{color:#9fc7d8}.xy-switch-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.xy-switch{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);background:rgba(255,255,255,.025);padding:7px;text-align:left}.xy-switch b{display:block;color:#fff;font-weight:600}.xy-switch span{display:block;color:#9fc7d8;font-size:11px}.xy-switch *{pointer-events:none}.xy-sw{position:relative;display:inline-block;width:34px;height:18px;border-radius:9px;background:rgba(70,105,135,.3);border:1px solid rgba(107,199,242,.35)}.xy-sw-knob{position:absolute;left:2px;top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;background:#9fc7d8;transition:left .18s ease,background .18s}.xy-switch.is-on{border-color:rgba(115,226,189,.55);background:rgba(115,226,189,.08)}.xy-switch.is-on .xy-sw{background:rgba(115,226,189,.35);border-color:rgba(115,226,189,.7)}.xy-switch.is-on .xy-sw-knob{left:18px;background:#73e2bd}.xy-segment-row{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);background:rgba(0,0,0,.16);padding:7px}.xy-segment-row b{color:#fff}.xy-segment{display:inline-flex;gap:4px;flex-wrap:wrap}.xy-segment button{padding:4px 10px;color:#9fc7d8}.xy-segment button.is-on{background:rgba(115,226,189,.16);border-color:rgba(115,226,189,.65);color:#73e2bd}.native-wand-menu{display:inline-flex;align-items:center;margin-left:4px}#xingyue-control-center-wand-button{border:1px solid rgba(107,199,242,.45);background:rgba(107,199,242,.08);color:#d9f4ff;padding:2px 7px;cursor:pointer}@media(max-width:520px){#xingyue-control-center-panel .xy-switch-grid{grid-template-columns:1fr}.xy-segment-row{grid-template-columns:1fr}}' +
      '.xy-news-opts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;border:1px solid rgba(107,199,242,.22);background:rgba(0,0,0,.16);padding:6px 7px}.xy-news-opts label{display:grid;gap:3px;margin:0;color:#9fc7d8;font-size:11px;flex:1 1 96px;min-width:0}#xingyue-control-center-panel .xy-news-opts input{padding:3px 5px;font-size:11px}#xingyue-control-center-panel .xy-news-opts input:disabled{opacity:.45;cursor:not-allowed}.xy-news-mode{display:inline-flex;gap:4px;flex:0 0 auto;align-self:flex-end}#xingyue-control-center-panel .xy-news-mode button{padding:3px 9px;font-size:11px;color:#9fc7d8}#xingyue-control-center-panel .xy-news-mode button.is-on{background:rgba(115,226,189,.16);border-color:rgba(115,226,189,.65);color:#73e2bd}@media(prefers-reduced-motion:reduce){#xingyue-control-center-panel .xy-sw-knob{transition:none}}';
    (doc.head || doc.documentElement).appendChild(style);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function decodeHtmlEntities(value) {
    const fallback = () => String(value ?? '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    try {
      const box = hostDocument().createElement('textarea');
      box.innerHTML = String(value ?? '');
      return typeof box.value === 'string' ? box.value : fallback();
    } catch (_) {
      return fallback();
    }
  }
  function extractTagContent(text, tag) {
    const re = new RegExp('<' + tag + '\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/' + tag + '>', 'i');
    const m = String(text || '').match(re);
    return m ? m[1].trim() : '';
  }
  function extractUpdateBlocks(text) {
    return [...String(text || '').matchAll(/<UpdateVariable(?:variable)?>[\s\S]*?<\/UpdateVariable(?:variable)?>/gi)].map(match => match[0]);
  }
  function extractUpdateBlock(text) {
    const all = extractUpdateBlocks(text);
    return all.length ? all[all.length - 1] : '';
  }
  function rawUpdateBlockAt(floorId, blockIndex) {
    const message = messageInfoAt(floorId);
    const blocks = extractUpdateBlocks(message.text);
    if (!blocks.length) return '';
    const hasIndex = blockIndex !== null && blockIndex !== undefined && blockIndex !== '';
    if (!hasIndex) return blocks[blocks.length - 1];
    const index = Number(blockIndex);
    return Number.isInteger(index) && index >= 0 && index < blocks.length ? blocks[index] : '';
  }
  function extractJsonPatchText(text) {
    return extractTagContent(text, 'JSONPatch');
  }
  function parseJsonPatchOps(text) {
    const jsonText = extractJsonPatchText(text);
    if (!jsonText) return { ok: false, ops: [], jsonText: '', error: '缺少 <JSONPatch> 数组' };
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) return { ok: false, ops: [], jsonText, error: '<JSONPatch> 内必须是 JSON 数组' };
      return { ok: true, ops: parsed, jsonText, error: '' };
    } catch (error) {
      return { ok: false, ops: [], jsonText, error: 'JSONPatch 解析失败：' + (error && error.message || error) };
    }
  }
  function validatePatchOps(ops) {
    const allowed = { add: 1, replace: 1, remove: 1, move: 1 };
    const problems = [];
    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
      if (!op || typeof op !== 'object' || Array.isArray(op)) {
        problems.push('op #' + (index + 1) + ' 不是对象');
        return;
      }
      if (!allowed[op.op]) problems.push('op #' + (index + 1) + ' 操作非法：' + String(op.op || ''));
      if (typeof op.path !== 'string' || !op.path.startsWith('/')) problems.push('op #' + (index + 1) + ' path 必须以 / 开头');
      if ((op.op === 'add' || op.op === 'replace') && !Object.prototype.hasOwnProperty.call(op, 'value')) problems.push('op #' + (index + 1) + ' 缺少 value');
      if (op.op === 'move' && (typeof op.from !== 'string' || !op.from.startsWith('/'))) problems.push('op #' + (index + 1) + ' move 缺少 from');
    });
    return problems;
  }
  function validateUpdateBlockProtocol(block) {
    const text = String(block || '');
    const count = pattern => (text.match(pattern) || []).length;
    const analysisOpen = count(/<analysis\b[^>]*>/gi);
    const analysisClose = count(/<\/analysis>/gi);
    const patchOpen = count(/<JSONPatch\b[^>]*>/gi);
    const patchClose = count(/<\/JSONPatch>/gi);
    const problems = [];
    if (analysisOpen !== 1 || analysisClose !== 1) problems.push('<analysis> 标签必须且只能出现一次');
    if (patchOpen !== 1 || patchClose !== 1) problems.push('<JSONPatch> 标签必须且只能出现一次');
    if (!problems.length && !/^<UpdateVariable(?:variable)?\b[^>]*>\s*<analysis\b[^>]*>[\s\S]*?<\/analysis>\s*<JSONPatch\b[^>]*>[\s\S]*?<\/JSONPatch>\s*<\/UpdateVariable(?:variable)?>$/i.test(text)) {
      problems.push('标签顺序必须为 <analysis> 后接 <JSONPatch>，且块内不能夹带其它内容');
    }
    return problems;
  }
  function wrapUpdateVariableBlock(analysis, opsOrJsonText) {
    let jsonText;
    if (typeof opsOrJsonText === 'string') jsonText = opsOrJsonText.trim();
    else jsonText = JSON.stringify(Array.isArray(opsOrJsonText) ? opsOrJsonText : [], null, 2);
    return '<UpdateVariable>\n<analysis>\n' + String(analysis || '本轮变量更新按当前操作结算。').trim() + '\n</analysis>\n<JSONPatch>\n' + jsonText + '\n</JSONPatch>\n</UpdateVariable>';
  }
  function normalizeGeneratedUpdateBlock(raw, fallbackAnalysis) {
    const text = String(raw || '').trim();
    const block = extractUpdateBlock(text) || text;
    const analysis = extractTagContent(block, 'analysis') || fallbackAnalysis || '本轮变量更新按当前操作结算。';
    const parsed = parseJsonPatchOps(block);
    if (!parsed.ok) return text;
    return wrapUpdateVariableBlock(analysis, parsed.ops);
  }
  function analyzeOmniUpdateBlock(rawInput, floorId, blockIndex) {
    const authoritativeBlock = floorId == null ? '' : rawUpdateBlockAt(floorId, blockIndex);
    const raw = String(authoritativeBlock || decodeHtmlEntities(rawInput) || '').trim();
    const matchedBlock = extractUpdateBlock(raw);
    const hasWrapper = !!matchedBlock;
    const block = matchedBlock || (raw ? '<UpdateVariable>' + raw + '</UpdateVariable>' : '');
    const analysis = extractTagContent(block, 'analysis');
    const parsed = parseJsonPatchOps(block);
    const messages = [];
    if (!hasWrapper) messages.push('缺少完整 <UpdateVariable> 块');
    else messages.push(...validateUpdateBlockProtocol(block));
    if (!analysis) messages.push('缺少内置 <analysis>');
    if (!parsed.ok) messages.push(parsed.error);
    if (parsed.ok) messages.push(...validatePatchOps(parsed.ops));
    const state = messages.length ? 'error' : 'ok';
    const displayJson = parsed.ok ? JSON.stringify(parsed.ops, null, 2) : parsed.jsonText;
    return {
      raw,
      block,
      analysis,
      ops: parsed.ops,
      jsonText: parsed.jsonText,
      displayJson,
      state,
      messages,
      source: authoritativeBlock ? 'message' : 'rendered-fallback',
    };
  }
  function renderOmniDoneContent(rawInput, floorId, blockIndex) {
    const result = analyzeOmniUpdateBlock(rawInput, floorId, blockIndex);
    const valid = result.state === 'ok';
    const analysisText = result.analysis || '未解析到 <analysis> 内容';
    const patchText = result.displayJson || result.jsonText || '未解析到 <JSONPatch> 数组';
    const feedback = !valid && result.messages.length
      ? '<div class="xy-omni-errors"><ul>' + result.messages.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></div>'
      : '';
    return '<div class="xy-omni-result ' + (valid ? 'is-ok' : 'is-error') + '" data-xy-omni-state="' + result.state + '">'
      + '<div class="xy-omni-stream">'
      + '<pre class="xy-omni-analysis-text">' + escapeHtml(analysisText) + '</pre>'
      + '<pre class="xy-omni-patch">' + escapeHtml(patchText) + '</pre>'
      + '<span class="xy-omni-validation">' + (valid ? 'VALID' : 'INVALID') + '</span>'
      + feedback
      + '</div></div>';
  }
  function assertOptionalString(value, name, maxLength) {
    if (value === undefined) return;
    if (typeof value !== 'string') throw new Error(name + ' 必须是字符串');
    if (value.length > maxLength) throw new Error(name + ' 超过长度限制');
  }
  function validatePackage(pkg, allowedTypes) {
    const sharedContract = window.XingyueWorkshopPackageContract || hostWindow().XingyueWorkshopPackageContract;
    if (!sharedContract?.normalizePackage) throw new Error('创意工坊安全契约未加载；本地编辑仍可使用，但导入、发布与安装已停用');
    pkg = sharedContract.normalizePackage(pkg, { allowedTypes, runtimeVersion: VERSION, allowLegacyFactors: true });
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
    const openingByScope = pkg.cardScope === OPENING_PACKAGE_SCOPE;
    const openingByTarget = pkg.type === 'world_factor' && pkg.payload.target === OPENING_PACKAGE_TARGET;
    if (openingByScope !== openingByTarget) throw new Error('开局正文包的 scope 与 target 必须同时匹配');
    if (openingByScope) {
      if (pkg.payload.schemaVersion !== 1) throw new Error('开局正文包 schemaVersion 必须为 1');
      if (!['3.4.1', '3.4.2', '3.4.3', '3.4.4', '3.4.5', '3.4.7'].includes(pkg.payload.compatibility?.minRuntimeVersion)) throw new Error('开局正文包最低 runtime 必须为 3.4.1 至 3.4.7');
      const factors = Array.isArray(pkg.payload.worldFactors) ? pkg.payload.worldFactors : (Array.isArray(pkg.payload.factors) ? pkg.payload.factors : []);
      if (factors.length !== 1) throw new Error('开局正文包必须且只能包含一项 worldFactors');
      if (String(factors[0]?.title || '') !== pkg.title) throw new Error('开局正文包内外标题不一致');
      const gradeScope = pkg.payload.gradeScope;
      const allowedBands = ['primary','middle','high','university','none','custom','all'];
      if (!Array.isArray(gradeScope) || !gradeScope.length || new Set(gradeScope).size !== gradeScope.length || gradeScope.some(item => !allowedBands.includes(item)) || (gradeScope.includes('all') && gradeScope.length !== 1)) throw new Error('开局正文包适用年级无效');
      validateOpeningStory(String(factors[0]?.content || ''), { grade:'' });
      pkg.payload.worldFactors = factors.map(item => ({ ...item, title:pkg.title, content:String(item.content || '').replace(/\r\n?/g, '\n') }));
      delete pkg.payload.factors;
    }
    if (pkg.type === 'user_identity') {
      const allowedIdentityPayloadFields = new Set(['identity','grade','callname','background','appearance','skills','avatar','portrait','media','core_attributes']);
      Object.keys(pkg.payload).forEach(key => {
        if (!allowedIdentityPayloadFields.has(key)) throw new Error('身份模板包含未知 payload 字段：' + key);
      });
      ['identity','grade','callname','background','appearance','skills','avatar','portrait'].forEach(field => {
        const shortField = field === 'identity' || field === 'grade' || field === 'callname';
        assertOptionalString(pkg.payload[field], '身份模板 payload.' + field, shortField ? 80 : 12000);
      });
      if (pkg.payload.media !== undefined && !isObject(pkg.payload.media)) throw new Error('身份模板 payload.media 必须是对象');
      if (isObject(pkg.payload.media)) {
        Object.keys(pkg.payload.media).forEach(key => {
          if (key !== 'avatar' && key !== 'portrait') throw new Error('身份模板包含未知 media 字段：' + key);
        });
        assertOptionalString(pkg.payload.media.avatar, '身份模板 payload.media.avatar', 2048);
        assertOptionalString(pkg.payload.media.portrait, '身份模板 payload.media.portrait', 2048);
      }
      if (pkg.payload.core_attributes !== undefined && !isObject(pkg.payload.core_attributes)) throw new Error('身份模板 core_attributes 必须是对象');
      if (isObject(pkg.payload.core_attributes)) {
        Object.entries(pkg.payload.core_attributes).forEach(([key, value]) => {
          if (!IDENTITY_ATTRIBUTE_KEYS.includes(key)) throw new Error('身份模板包含未知核心属性：' + key);
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 30) {
            throw new Error('身份模板核心属性 ' + key + ' 必须是 0–30 的有限数值');
          }
        });
      }
      if (containsEmbeddedImageData(pkg.payload)) throw new Error('身份模板不能内嵌图片二进制，请改用媒体库 key 或 http(s) URL');
      const rawMedia = [pkg.payload.avatar, pkg.payload.portrait, pkg.payload.media?.avatar, pkg.payload.media?.portrait];
      rawMedia.filter(value => String(value ?? '').trim()).forEach(value => {
        if (!normalizeIdentityMediaReference(value)) throw new Error('身份模板媒体引用无效，请使用媒体库 key 或 http(s) URL');
      });
      if (!userIdentityPayloadHasContent(pkg.payload)) throw new Error('身份模板至少需要文字、六项属性或一项媒体引用');
    }
    return pkg;
  }
  // P8：无状态 Bearer 客户端。昵称与头像只保存在内存；跨域 API 不依赖第三方 Cookie。
  function getWorkshopToken() { try { return localStorage.getItem('xingyue-workshop-token') || ''; } catch (_) { return ''; } }
  function setWorkshopToken(token) { try { if (token) localStorage.setItem('xingyue-workshop-token', String(token)); else localStorage.removeItem('xingyue-workshop-token'); } catch (_) {} }
  function getWorkshopIdentity() { return workshopIdentity ? { ...workshopIdentity } : null; }
  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    const token = getWorkshopToken();
    if (token) headers.authorization = 'Bearer ' + token;
    return headers;
  }
  function gatewayBaseUrl() { return String(settings.gatewayUrl || DEFAULT_GATEWAY_URL || '').replace(/\/+$/, ''); }
  async function workshopResponse(res, action, requestToken = '') {
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const code = String(body.error || ('HTTP ' + res.status));
    if (res.status === 401 && String(requestToken || '') === getWorkshopToken()) commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:'login-required' });
    if (res.status === 409) throw new Error(action + '发生版本冲突，请刷新“我的发布”后重试（' + code + '）');
    if (res.status === 428) throw new Error(action + '缺少 revision，请先刷新包状态');
    throw new Error(action + '失败：' + code);
  }
  async function fetchJson(url, options) {
    const opt = options || {};
    const requestToken = getWorkshopToken();
    const headers = { ...(opt.headers || {}) };
    if (requestToken) headers.authorization = 'Bearer ' + requestToken;
    const res = await fetch(url, { credentials:'omit', ...opt, headers });
    return workshopResponse(res, '读取工坊', requestToken);
  }
  async function checkWorkshopAuth() {
    const epoch = ++workshopAuthEpoch;
    const base = gatewayBaseUrl();
    if (!base) return commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:'gateway-url-missing' });
    try {
      const res = await fetch(base + '/api/workshop/me', { credentials:'omit', headers:authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (epoch !== workshopAuthEpoch) return { ...workshopAuth };
      return commitWorkshopAuth({ checked:true, loggedIn:Boolean(res.ok && body.loggedIn), publisherId:String(body.publisherId || ''), error:res.ok || res.status === 401 ? '' : 'HTTP ' + res.status });
    } catch (error) {
      if (epoch !== workshopAuthEpoch) return { ...workshopAuth };
      return commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:error.message || String(error) });
    }
  }
  function workshopCryptoTargets() {
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    return targets;
  }
  function workshopRandomCrypto() {
    const targets = workshopCryptoTargets();
    for (const target of targets) {
      try { if (typeof target?.crypto?.getRandomValues === 'function') return target.crypto; } catch (_) {}
    }
    throw new Error('浏览器安全随机数 API 不可用，无法启动 Discord 登录');
  }
  function randomWorkshopHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    workshopRandomCrypto().getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  function createWorkshopHandoffCredentials() {
    return { handoffId:'xyh_' + randomWorkshopHex(24), secret:randomWorkshopHex(32) };
  }
  async function workshopHandoffChallenge(secret) {
    const value = String(secret || '');
    let Encoder = typeof TextEncoder === 'function' ? TextEncoder : null;
    for (const target of workshopCryptoTargets()) {
      try {
        const targetEncoder = typeof target?.TextEncoder === 'function' ? target.TextEncoder : Encoder;
        if (!Encoder && targetEncoder) Encoder = targetEncoder;
        const subtle = target?.crypto?.subtle;
        if (typeof subtle?.digest !== 'function' || !targetEncoder) continue;
        const digest = await subtle.digest('SHA-256', new targetEncoder().encode(value));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      } catch (_) {}
    }
    return sha256HexFallback(value, Encoder);
  }
  function workshopLoginUrl(handoffId = '') {
    let ret = '';
    try {
      const origin = String(hostWindow().location.origin || '');
      const parsed = new URL(origin);
      const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (local && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && origin === parsed.origin) ret = origin;
    } catch (_) {}
    const params = new URLSearchParams();
    if (ret) params.set('return', ret);
    if (handoffId) params.set('handoff', String(handoffId));
    const query = params.toString();
    return gatewayBaseUrl() + '/auth/discord/login' + (query ? ('?' + query) : '');
  }
  function emitWorkshopLoginState(status, detail = {}) {
    try {
      const target = hostWindow();
      const EventCtor = target.CustomEvent || CustomEvent;
      target.dispatchEvent(new EventCtor('xy-workshop-login-state', {
        detail:{ status:String(status || ''), ...detail },
      }));
    } catch (_) {}
  }
  function cancelWorkshopLoginPoll(options = {}) {
    const active = workshopLoginPoll;
    if (active?.timer) { try { clearTimeout(active.timer); } catch (_) {} }
    if (options.closePopup) { try { active?.popup?.close?.(); } catch (_) {} }
    workshopLoginPoll = null;
  }
  function cancelWorkshopLogin() {
    const active = Boolean(workshopLoginPoll);
    workshopLoginGeneration += 1;
    workshopAuthEpoch += 1;
    cancelWorkshopLoginPoll({ closePopup:true });
    setWorkshopToken('');
    workshopIdentity = null;
    commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:'' });
    if (active) emitWorkshopLoginState('cancelled', { message:'已取消 Discord 登录等待' });
    return active;
  }
  async function acceptWorkshopLogin(data, poll) {
    if (!data?.token) throw new Error('登录交接缺少 token');
    if (workshopLoginPoll !== poll || poll.generation !== workshopLoginGeneration) throw new Error('登录已取消或被新的登录替代');
    if (poll.timer) { try { clearTimeout(poll.timer); } catch (_) {} poll.timer = null; }
    const acceptedToken = String(data.token);
    setWorkshopToken(acceptedToken);
    workshopIdentity = data.name || data.avatar ? { name:String(data.name || ''), avatar:String(data.avatar || '') } : null;
    let auth = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      auth = await checkWorkshopAuth();
      if (auth.loggedIn || !auth.error) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
    if (workshopLoginPoll !== poll || poll.generation !== workshopLoginGeneration) {
      if (getWorkshopToken() === acceptedToken) { setWorkshopToken(''); workshopIdentity = null; commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:'' }); }
      throw new Error('登录已取消或被新的登录替代');
    }
    if (!auth?.loggedIn) {
      cancelWorkshopLoginPoll({ closePopup:true });
      if (getWorkshopToken() === acceptedToken) {
        setWorkshopToken('');
        workshopIdentity = null;
        commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:auth?.error || '登录 token 无效，请重新登录' });
      }
      emitWorkshopLoginState('error', { message:auth?.error ? ('登录态确认失败：' + auth.error) : '登录 token 无效，请重新登录' });
      throw new Error(auth?.error ? ('登录态确认失败：' + auth.error) : '登录 token 无效，请重新登录');
    }
    cancelWorkshopLoginPoll({ closePopup:true });
    emitWorkshopLoginState('ready', { identity:getWorkshopIdentity() });
    const openingRoots = currentOwnedOpeningRoots();
    const refreshes = openingRoots.map(root => root?.__xyOpeningRefreshWorkshop).filter(fn => typeof fn === 'function');
    if (refreshes.length) await Promise.allSettled(refreshes.map(refresh => refresh()));
    else await fetchWorkshopCatalog();
    toast('success', workshopIdentity?.name ? ('Discord 登录成功：' + workshopIdentity.name) : 'Discord 登录成功');
    return { ...workshopAuth };
  }
  function beginWorkshopLogin() {
    cancelWorkshopLoginPoll({ closePopup:true });
    const generation = ++workshopLoginGeneration;
    const base = gatewayBaseUrl();
    if (!base) throw new Error('创意工坊登录地址未就绪');
    const popup = hostWindow().open('about:blank', 'xy-workshop-login', 'width=520,height=720');
    if (!popup) throw new Error('浏览器阻止了登录窗口，请允许弹窗后重试');
    const { handoffId, secret } = createWorkshopHandoffCredentials();
    const poll = { handoffId, secret, popup, generation, deadlineAt:0, timer:null, inFlight:false, wakePending:false, run:null };
    workshopLoginPoll = poll;
    const pollOnce = async () => {
      if (workshopLoginPoll !== poll || poll.generation !== workshopLoginGeneration || runtimeDestroyed) return;
      if (poll.inFlight) { poll.wakePending = true; return; }
      if (!poll.deadlineAt) return;
      const finalClaim = Date.now() >= poll.deadlineAt;
      if (Date.now() > poll.deadlineAt + 2000) {
        cancelWorkshopLoginPoll({ closePopup:true });
        emitWorkshopLoginState('timeout', { message:'Discord 登录等待已超时，请重试' });
        toast('warn', 'Discord 登录等待已超时，请重试');
        return;
      }
      poll.inFlight = true;
      try {
        const res = await fetch(base + '/api/workshop/login-handoff', {
          method:'POST', credentials:'omit', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ handoffId, secret }),
        });
        const body = await res.json().catch(() => ({}));
        if (workshopLoginPoll !== poll || runtimeDestroyed) return;
        if (res.ok && body.status === 'ready' && body.token) {
          try { await acceptWorkshopLogin(body, poll); }
          catch (error) { toast('error', error.message || String(error)); }
          return;
        }
        if (res.status !== 202 && res.status !== 404) throw new Error(String(body.error || ('HTTP ' + res.status)));
      } catch (_) {
      } finally {
        poll.inFlight = false;
      }
      if (workshopLoginPoll !== poll || runtimeDestroyed) return;
      if (poll.wakePending) { poll.wakePending = false; poll.timer = setTimeout(pollOnce, 0); return; }
      if (finalClaim || Date.now() >= poll.deadlineAt + 2000) {
        cancelWorkshopLoginPoll({ closePopup:true });
        emitWorkshopLoginState('timeout', { message:'Discord 登录等待已超时，请重试' });
        toast('warn', 'Discord 登录等待已超时，请重试');
        return;
      }
      poll.timer = setTimeout(pollOnce, Math.min(800, Math.max(50, poll.deadlineAt - Date.now() + 25)));
    };
    poll.run = pollOnce;
    void (async () => {
      try {
        const challenge = await workshopHandoffChallenge(secret);
        const start = await fetch(base + '/api/workshop/login-handoff/start', {
          method:'POST', credentials:'omit', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ handoffId, challenge }),
        });
        const body = await start.json().catch(() => ({}));
        if (!start.ok) throw new Error(String(body.error || ('HTTP ' + start.status)));
        const expiresInMs = Number(body.expiresInMs);
        if (!Number.isFinite(expiresInMs) || expiresInMs < 1000 || expiresInMs > 10 * 60 * 1000) throw new Error('Gateway 未返回有效登录截止时间');
        if (workshopLoginPoll !== poll || poll.generation !== workshopLoginGeneration || runtimeDestroyed) return;
        poll.deadlineAt = Date.now() + expiresInMs;
        emitWorkshopLoginState('waiting', { deadlineAt:poll.deadlineAt, expiresInMs });
        popup.location.replace(workshopLoginUrl(handoffId));
        poll.timer = setTimeout(pollOnce, 500);
      } catch (error) {
        if (workshopLoginPoll !== poll || poll.generation !== workshopLoginGeneration || runtimeDestroyed) return;
        cancelWorkshopLoginPoll({ closePopup:true });
        emitWorkshopLoginState('error', { message:error.message || String(error) });
        toast('error', 'Discord 登录启动失败：' + (error.message || String(error)));
      }
    })();
    return handoffId;
  }
  function captureWorkshopLogin() {
    let hw;
    try { hw = hostWindow(); } catch (_) { return; }
    if (!hw) return;
    const previous = hw.__xyWorkshopLoginBinding;
    if (previous?.handler) { try { hw.removeEventListener('message', previous.handler); } catch (_) {} }
    const handler = event => {
      try {
        const gw = gatewayBaseUrl();
        if (!gw || new URL(gw).origin !== event.origin) return;
        const data = event.data;
        const poll = workshopLoginPoll;
        if (!data || data.type !== 'xy-workshop-handoff-ready' || !poll || data.handoffId !== poll.handoffId) return;
        if (typeof poll.run === 'function') void poll.run();
      } catch (_) {}
    };
    hw.addEventListener('message', handler);
    const binding = { owner:runtimeOwner, handler };
    hw.__xyWorkshopLoginBinding = binding;
    disposers.push(() => {
      cancelWorkshopLoginPoll({ closePopup:true });
      try { hw.removeEventListener('message', handler); } catch (_) {}
      try { if (hw.__xyWorkshopLoginBinding === binding) delete hw.__xyWorkshopLoginBinding; } catch (_) {}
    });
  }
  async function logout() {
    workshopLoginGeneration += 1;
    workshopAuthEpoch += 1;
    cancelWorkshopLoginPoll({ closePopup:true });
    try { await fetch(gatewayBaseUrl() + '/api/workshop/logout', { method:'POST', credentials:'omit', headers:authHeaders() }); } catch (_) {}
    setWorkshopToken('');
    commitWorkshopAuth({ checked:true, loggedIn:false, publisherId:'', error:'' });
    workshopIdentity = null;
    return { ...workshopAuth };
  }
  async function fetchWorkshopCatalog(options = {}) {
    const types = Array.isArray(options.types) ? options.types : [];
    lastError = '';
    if (options.skipAuthCheck !== true) await checkWorkshopAuth();
    const scopes = ['xingyue','shared',OPENING_PACKAGE_SCOPE];
    const settled = await Promise.allSettled(scopes.map(scope => fetchJson(gatewayBaseUrl() + '/api/workshop/packages?cardScope=' + encodeURIComponent(scope))));
    const ok = settled.filter(item => item.status === 'fulfilled');
    if (!ok.length) {
      const error = settled.find(item => item.status === 'rejected')?.reason || new Error('Gateway 不可用');
      lastError = 'gateway-index:' + (error.message || error);
      throw error;
    }
    const byId = new Map();
    ok.forEach(item => (item.value.packages || []).forEach(pkg => {
      if (!pkg?.id || (types.length && !types.includes(pkg.type))) return;
      byId.set(String(pkg.type || '') + ':' + String(pkg.id), pkg);
    }));
    workshopCache = [...byId.values()];
    try { renderPanel(); } catch (_) {}
    return workshopCache.slice();
  }
  function blobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取角色图片失败'));
      reader.readAsDataURL(blob);
    });
  }
  async function resolveCharacterUploadMedia(reference) {
    const key = String(reference || '').trim();
    if (!key) return { portableUrl:'', dataUrl:'' };
    if (/^https?:\/\//i.test(key)) return { portableUrl:key, dataUrl:'' };
    let source = /^data:image\//i.test(key) || /^blob:/i.test(key) ? key : '';
    if (!source) {
      const lib = mediaLibrary();
      const asset = lib?.getAssetByKey?.(key) || lib?.listManagedAssets?.().find(item => String(item?.key || '') === key);
      source = String(asset?.dataUrl || asset?.url || asset?.src || '');
    }
    if (/^https?:\/\//i.test(source)) return { portableUrl:source, dataUrl:'' };
    if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(source)) return { portableUrl:'', dataUrl:source };
    if (/^blob:/i.test(source)) {
      const response = await fetch(source);
      if (!response.ok) throw new Error('无法读取本地角色图片');
      const dataUrl = await blobAsDataUrl(await response.blob());
      if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) throw new Error('角色图片仅支持 PNG、JPEG 或 WebP');
      return { portableUrl:'', dataUrl };
    }
    throw new Error('找不到角色媒体库文件：' + key);
  }
  // D9：带上传进度的 POST。fetch 拿不到 upload 进度，改用 XMLHttpRequest 并包成 fetch-Response 兼容对象喂 workshopResponse。
  function xhrPostJson(url, headers, bodyText, onProgress) {
    return new Promise((resolve, reject) => {
      let xhr;
      try { xhr = new (window.XMLHttpRequest || hostWindow().XMLHttpRequest)(); } catch (_) { xhr = null; }
      if (!xhr) {
        fetch(url, { method:'POST', credentials:'omit', headers, body:bodyText }).then(resolve, reject);
        return;
      }
      xhr.open('POST', url);
      Object.entries(headers || {}).forEach(([key, value]) => { try { xhr.setRequestHeader(key, value); } catch (_) {} });
      if (xhr.upload && typeof onProgress === 'function') {
        xhr.upload.onprogress = event => {
          if (event.lengthComputable) { try { onProgress(event.loaded, event.total); } catch (_) {} }
        };
      }
      xhr.onerror = () => reject(new Error('网络错误，上传中断'));
      xhr.onabort = () => reject(new Error('上传已取消'));
      xhr.ontimeout = () => reject(new Error('上传超时'));
      xhr.onload = () => resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText || '{}'),
      });
      xhr.send(bodyText);
    });
  }
  async function uploadCharacterPackage(input, options = {}) {
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    const pkg = validatePackage(input);
    if (pkg.type !== 'character') throw new Error('只有角色包可以使用角色文件上传');
    const staged = clone(pkg);
    if (!isObject(staged.payload.media)) staged.payload.media = {};
    if (!isObject(staged.payload.media.portraits)) staged.payload.media.portraits = {};
    const assets = {};
    const specs = [
      { slot:'avatar', get:() => staged.payload.media.avatar, set:value => { staged.payload.media.avatar = value; } },
      { slot:'portraitNormal', get:() => staged.payload.media.portraits.normal, set:value => { staged.payload.media.portraits.normal = value; } },
      { slot:'portraitNude', get:() => staged.payload.media.portraits.nude, set:value => { staged.payload.media.portraits.nude = value; } },
      { slot:'portraitAftermath', get:() => staged.payload.media.portraits.aftermath, set:value => { staged.payload.media.portraits.aftermath = value; } },
    ];
    for (const spec of specs) {
      const resolved = await resolveCharacterUploadMedia(spec.get());
      spec.set(resolved.portableUrl);
      if (resolved.dataUrl) assets[spec.slot] = resolved.dataUrl;
    }
    const requestToken = getWorkshopToken();
    const res = await xhrPostJson(
      gatewayBaseUrl() + '/api/workshop/uploads/character',
      authHeaders({ 'content-type':'application/json' }),
      JSON.stringify({ package:staged, assets }),
      typeof options.onProgress === 'function' ? (loaded, total) => options.onProgress({ phase:'upload', loaded, total }) : null,
    );
    return workshopResponse(res, '上传角色文件', requestToken);
  }
  async function publishPackage(input, options = {}) {
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    let pkg = validatePackage(input);
    if (!Number.isInteger(Number(pkg.revision)) || Number(pkg.revision) < 1) {
      const owned = await fetchJson(gatewayBaseUrl() + '/api/workshop/me/packages');
      const existing = (owned.packages || []).find(item => String(item.id) === String(pkg.id) && String(item.type) === String(pkg.type));
      if (existing && Number.isInteger(Number(existing.revision)) && Number(existing.revision) >= 1) pkg = { ...pkg, revision:Number(existing.revision) };
    }
    const updating = Number.isInteger(Number(pkg.revision)) && Number(pkg.revision) >= 1;
    const upload = pkg.type === 'character' ? await uploadCharacterPackage(pkg, { onProgress }) : null;
    if (onProgress) { try { onProgress({ phase:'register', loaded:0, total:0 }); } catch (_) {} }
    const url = gatewayBaseUrl() + '/api/workshop/packages' + (updating ? '/' + encodeURIComponent(pkg.id) : '');
    const headers = authHeaders({ 'content-type':'application/json' });
    if (updating) headers['x-package-revision'] = String(pkg.revision);
    const requestToken = getWorkshopToken();
    const res = await fetch(url, { method:updating ? 'PUT' : 'POST', credentials:'omit', headers, body:JSON.stringify(upload?.uploadId ? { ...pkg, uploadId:upload.uploadId } : pkg) });
    return workshopResponse(res, updating ? '更新工坊包' : '发布工坊包', requestToken);
  }
  async function myPackages(options = {}) {
    if (options.skipAuthCheck !== true) await checkWorkshopAuth();
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录和服务器成员确认');
    return fetchJson(gatewayBaseUrl() + '/api/workshop/me/packages');
  }
  async function withdrawPackage(id, revision) {
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    if (!Number.isInteger(Number(revision)) || Number(revision) < 1) throw new Error('撤回前必须刷新并取得有效 revision');
    const requestToken = getWorkshopToken();
    const res = await fetch(gatewayBaseUrl() + '/api/workshop/packages/' + encodeURIComponent(id), { method:'DELETE', credentials:'omit', headers:authHeaders({ 'x-package-revision':String(revision) }) });
    return workshopResponse(res, '撤回工坊包', requestToken);
  }
  async function votePackage(id, vote) {
    if (!workshopAuth.loggedIn) throw new Error('请先完成 Discord 登录');
    const requestToken = getWorkshopToken();
    const res = await fetch(gatewayBaseUrl() + '/api/workshop/packages/' + encodeURIComponent(id) + '/vote', { method:'POST', credentials:'omit', headers:authHeaders({ 'content-type':'application/json' }), body:JSON.stringify({ vote }) });
    return workshopResponse(res, '工坊投票', requestToken);
  }
  async function packageDetail(pkg) {
    if (pkg.payload) return validatePackage(pkg);
    if (!pkg.manifestUrl) throw new Error('包缺少 manifestUrl');
    return validatePackage(await fetchJson(pkg.manifestUrl));
  }
  function packageToWorldbookText(pkg) {
    if (['shop_item','blueprint','recipe','skill','function'].includes(pkg?.type) && pkg?.payload?.schemaVersion === 1 && isObject(pkg.payload.worldbook)) {
      return String(pkg.payload.worldbook.content || '');
    }
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
  // <opening-draft-v2-core>
  const IDENTITY_ATTRIBUTE_KEYS = ['格斗','平衡','反应','感知','技巧','精神'];
  const IDENTITY_DEFAULT_ATTRIBUTES = Object.freeze({ 格斗:0, 平衡:0, 反应:0, 感知:0, 技巧:0, 精神:0 });
  const IDENTITY_TEXT_FIELDS = ['identity','grade','callname','background','appearance','skills'];
  const LEGACY_DEFAULT_GRADE = '初三';
  const GRADE_PRESET_VALUES = Object.freeze([
    '小学一年级','小学二年级','小学三年级','小学四年级','小学五年级','小学六年级',
    '初一','初二','初三','高一','高二','高三',
    '大学一年级','大学二年级','大学三年级','大学四年级','不适用',
  ]);
  const GRADE_ALIASES = Object.freeze({
    小一:'小学一年级', 小二:'小学二年级', 小三:'小学三年级', 小四:'小学四年级', 小五:'小学五年级', 小六:'小学六年级',
    初中一年级:'初一', 初中二年级:'初二', 初中三年级:'初三',
    高中一年级:'高一', 高中二年级:'高二', 高中三年级:'高三',
    大一:'大学一年级', 大二:'大学二年级', 大三:'大学三年级', 大四:'大学四年级',
    无:'不适用', 非学生:'不适用', 'N/A':'不适用', 'n/a':'不适用', 未提供年级:'',
  });
  function normalizeGrade(value) {
    const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    if (hasOwn(GRADE_ALIASES, raw)) return GRADE_ALIASES[raw];
    const compact = raw.replace(/\s+/g, '');
    const primary = compact.match(/^小学([1-6一二三四五六])年级$/);
    if (primary) {
      const map = { '1':'一','2':'二','3':'三','4':'四','5':'五','6':'六', 一:'一',二:'二',三:'三',四:'四',五:'五',六:'六' };
      return '小学' + map[primary[1]] + '年级';
    }
    const middle = compact.match(/^初中?([1-3一二三])年级?$/);
    if (middle) return '初' + ({ '1':'一','2':'二','3':'三',一:'一',二:'二',三:'三' })[middle[1]];
    const high = compact.match(/^高中?([1-3一二三])年级?$/);
    if (high) return '高' + ({ '1':'一','2':'二','3':'三',一:'一',二:'二',三:'三' })[high[1]];
    const university = compact.match(/^(?:大学|本科)([1-4一二三四])年级$/);
    if (university) return '大学' + ({ '1':'一','2':'二','3':'三','4':'四',一:'一',二:'二',三:'三',四:'四' })[university[1]] + '年级';
    return raw.slice(0, 80);
  }
  function gradeBand(value) {
    const grade = normalizeGrade(value);
    if (!grade || grade === '不适用') return grade === '不适用' ? 'none' : 'custom';
    if (/^小学[一二三四五六]年级$/.test(grade)) return 'primary';
    if (/^初[一二三]$/.test(grade)) return 'middle';
    if (/^高[一二三]$/.test(grade)) return 'high';
    if (/^大学[一二三四]年级$/.test(grade)) return 'university';
    return 'custom';
  }
  function hasOwn(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
  }
  function normalizeIdentityAttributes(value, fallback = IDENTITY_DEFAULT_ATTRIBUTES) {
    const source = isObject(value) ? value : {};
    const base = isObject(fallback) ? fallback : IDENTITY_DEFAULT_ATTRIBUTES;
    const normalized = {};
    IDENTITY_ATTRIBUTE_KEYS.forEach(key => {
      const raw = hasOwn(source, key) ? source[key] : base[key];
      normalized[key] = Math.max(0, Math.min(30, Number(raw) || 0));
    });
    return normalized;
  }
  function normalizeIdentityMediaReference(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 2048 || /[\u0000-\u001f\u007f]/.test(text)) return '';
    if (/^(?:data|blob|file|javascript):/i.test(text)) return '';
    return text;
  }
  function containsEmbeddedImageData(value, seen = new Set()) {
    if (typeof value === 'string') return /data:image\//i.test(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(item => containsEmbeddedImageData(item, seen));
    return Object.values(value).some(item => containsEmbeddedImageData(item, seen));
  }
  function normalizeUserIdentityPayload(payload) {
    const source = isObject(payload) ? payload : {};
    const media = isObject(source.media) ? source.media : {};
    const normalized = {
      identity: String(source.identity ?? '').trim(),
      grade: normalizeGrade(source.grade),
      callname: String(source.callname ?? '').trim(),
      background: String(source.background ?? '').trim(),
      appearance: String(source.appearance ?? '').trim(),
      skills: String(source.skills ?? '').trim(),
      core_attributes: normalizeIdentityAttributes(source.core_attributes),
      media: {
        avatar: normalizeIdentityMediaReference(hasOwn(media, 'avatar') ? media.avatar : source.avatar),
        portrait: normalizeIdentityMediaReference(hasOwn(media, 'portrait') ? media.portrait : source.portrait),
      },
    };
    return normalized;
  }
  function userIdentityPayloadHasContent(payload) {
    const normalized = normalizeUserIdentityPayload(payload);
    return IDENTITY_TEXT_FIELDS.some(field => !!normalized[field])
      || !!normalized.media.avatar
      || !!normalized.media.portrait
      || IDENTITY_ATTRIBUTE_KEYS.some(key => Number(normalized.core_attributes[key]) !== 0);
  }
  function userIdentityDraftHasContent(draft) {
    const source = isObject(draft) ? draft : {};
    return userIdentityPayloadHasContent({
      identity: source.player_identity,
      grade: source.player_grade,
      callname: source.player_callname,
      background: source.player_background,
      appearance: source.player_appearance,
      skills: source.player_skills,
      core_attributes: source.core_attributes,
      media: { avatar: source.player_avatar, portrait: source.player_portrait },
    });
  }
  function buildUserIdentityPayload(draft) {
    const source = isObject(draft) ? draft : {};
    return normalizeUserIdentityPayload({
      identity: source.player_identity,
      grade: source.player_grade,
      callname: source.player_callname,
      background: source.player_background,
      appearance: source.player_appearance,
      skills: source.player_skills,
      core_attributes: source.core_attributes,
      media: { avatar: source.player_avatar, portrait: source.player_portrait },
    });
  }
  function applyUserIdentityPayload(draft, payload) {
    const target = isObject(draft) ? draft : {};
    const source = isObject(payload) ? payload : {};
    const fieldMap = { identity:'player_identity', grade:'player_grade', callname:'player_callname', background:'player_background', appearance:'player_appearance', skills:'player_skills' };
    Object.entries(fieldMap).forEach(([field, draftField]) => {
      if (hasOwn(source, field)) target[draftField] = field === 'grade' ? normalizeGrade(source[field]) : String(source[field] ?? '').trim();
    });
    if (isObject(source.core_attributes)) {
      const current = normalizeIdentityAttributes(target.core_attributes);
      IDENTITY_ATTRIBUTE_KEYS.forEach(key => {
        if (hasOwn(source.core_attributes, key)) current[key] = Math.max(0, Math.min(30, Number(source.core_attributes[key]) || 0));
      });
      target.core_attributes = current;
    }
    const media = isObject(source.media) ? source.media : {};
    if (hasOwn(media, 'avatar')) target.player_avatar = normalizeIdentityMediaReference(media.avatar);
    else if (hasOwn(source, 'avatar')) target.player_avatar = normalizeIdentityMediaReference(source.avatar);
    if (hasOwn(media, 'portrait')) target.player_portrait = normalizeIdentityMediaReference(media.portrait);
    else if (hasOwn(source, 'portrait')) target.player_portrait = normalizeIdentityMediaReference(source.portrait);
    return target;
  }
  const PERSONA_IDENTITY_BLOCK_MAX_BYTES = 64 * 1024;
  const PERSONA_DESCRIPTION_DISABLED_POSITION = 9;
  function personaIdentityBlockRegex() {
    return /<xingyue_identity(?:\s+schema=["']?1["']?)?\s*>([\s\S]*?)<\/xingyue_identity>/gi;
  }
  function personaIdentityOpeningCount(value) {
    return (String(value ?? '').match(/<xingyue_identity(?:\s+schema=["']?1["']?)?\s*>/gi) || []).length;
  }
  function serializePersonaIdentityBlock(payload) {
    const normalized = normalizeUserIdentityPayload(payload);
    const stable = {
      identity: normalized.identity,
      callname: normalized.callname,
      grade: normalized.grade,
      background: normalized.background,
      appearance: normalized.appearance,
      skills: normalized.skills,
      core_attributes: normalizeIdentityAttributes(normalized.core_attributes),
      media: { avatar:normalized.media.avatar, portrait:normalized.media.portrait },
    };
    const block = '<xingyue_identity schema="1">\n' + JSON.stringify(stable, null, 2).replace(/</g, '\\u003c') + '\n</xingyue_identity>';
    const bytes = openingStoryUtf8Bytes(block);
    if (bytes > PERSONA_IDENTITY_BLOCK_MAX_BYTES) throw new Error('Persona 星月结构块超过 64KB 上限');
    return block;
  }
  function personaIdentityPayloadHash(payload) {
    return sha256HexFallback(serializePersonaIdentityBlock(payload), typeof TextEncoder === 'function' ? TextEncoder : null);
  }
  function parsePersonaIdentityBlock(value) {
    const source = String(value ?? '');
    const matches = Array.from(source.matchAll(personaIdentityBlockRegex()));
    const openingCount = personaIdentityOpeningCount(source);
    if (!openingCount && !matches.length) {
      return { found:false, count:0, matchedCount:0, valid:true, multiple:false, gradeProvided:false, gradeLabel:'未提供年级', payload:normalizeUserIdentityPayload({}), errors:[] };
    }
    const errors = [];
    if (openingCount !== matches.length) errors.push({ index:matches.length, message:'存在未闭合的 Persona 星月结构块' });
    const parsed = [];
    matches.forEach((match, index) => {
      const block = String(match[0] || '');
      const blockBytes = openingStoryUtf8Bytes(block);
      if (blockBytes > PERSONA_IDENTITY_BLOCK_MAX_BYTES) {
        errors.push({ index, message:'Persona 星月结构块超过 64KB 上限' });
        return;
      }
      try {
        const raw = JSON.parse(String(match[1] || '').trim());
        if (!isObject(raw)) throw new Error('结构块 JSON 必须是对象');
        const payload = normalizeUserIdentityPayload(raw);
        const canonicalBlock = serializePersonaIdentityBlock(payload);
        parsed.push({ index, raw, payload, canonicalBlock, contentHash:personaIdentityPayloadHash(payload), blockBytes, start:match.index, end:(match.index || 0) + block.length });
      } catch (error) {
        errors.push({ index, message:error?.message || String(error) });
      }
    });
    if (!parsed.length) {
      return { found:true, count:openingCount, matchedCount:matches.length, valid:false, multiple:openingCount > 1, errors, gradeProvided:false, gradeLabel:'未提供年级', payload:normalizeUserIdentityPayload({}) };
    }
    const first = parsed[0];
    const grade = normalizeGrade(first.raw.grade);
    const gradeProvided = hasOwn(first.raw, 'grade') && !!grade;
    const payload = normalizeUserIdentityPayload({ ...first.raw, ...(gradeProvided ? { grade } : {}) });
    return {
      found:true,
      count:openingCount,
      matchedCount:matches.length,
      valid:errors.length === 0,
      multiple:openingCount > 1,
      errors,
      gradeProvided,
      gradeLabel:grade || '未提供年级',
      payload,
      rawPayload:first.raw,
      canonicalBlock:first.canonicalBlock,
      contentHash:first.contentHash,
      blockBytes:first.blockBytes,
      blocks:parsed,
    };
  }
  function replacePersonaIdentityBlocks(description, payload) {
    const source = String(description ?? '');
    const parsed = parsePersonaIdentityBlock(source);
    if (parsed.found && (!parsed.valid || parsed.matchedCount !== parsed.count)) {
      throw new Error(parsed.errors?.[0]?.message || 'Persona 星月结构块无效，禁止写回');
    }
    const canonicalBlock = serializePersonaIdentityBlock(payload);
    if (!parsed.found) {
      const separator = source && !source.endsWith('\n') ? '\n\n' : (source ? '\n' : '');
      return { description:source + separator + canonicalBlock, mode:'append', replacedCount:0, canonicalBlock, contentHash:personaIdentityPayloadHash(payload) };
    }
    let replaced = false;
    const descriptionNext = source.replace(personaIdentityBlockRegex(), () => {
      if (replaced) return '';
      replaced = true;
      return canonicalBlock;
    });
    return { description:descriptionNext, mode:parsed.multiple ? 'merge' : 'replace', replacedCount:parsed.count, canonicalBlock, contentHash:personaIdentityPayloadHash(payload) };
  }
  function userIdentityPayloadDiff(draft, payload, rawPayload = payload) {
    const left = buildUserIdentityPayload(draft);
    const right = normalizeUserIdentityPayload(payload);
    const raw = isObject(rawPayload) ? rawPayload : {};
    const rows = [];
    const add = (label, a, b) => { if (String(a ?? '') !== String(b ?? '')) rows.push({ field:label, current:String(a ?? ''), persona:String(b ?? '') }); };
    add('身份', left.identity, right.identity);
    add('称呼', left.callname, right.callname);
    if (hasOwn(raw, 'grade')) add('年级', left.grade, right.grade);
    else rows.push({ field:'年级', current:left.grade, persona:'未提供（导入时保留当前）' });
    add('背景', left.background, right.background);
    add('外貌', left.appearance, right.appearance);
    add('技能', left.skills, right.skills);
    IDENTITY_ATTRIBUTE_KEYS.forEach(key => add('属性.' + key, left.core_attributes[key], right.core_attributes[key]));
    add('媒体.头像', left.media.avatar, right.media.avatar);
    add('媒体.立绘', left.media.portrait, right.media.portrait);
    return rows;
  }
  function mergePersonaIdentityIntoDraft(draft, parsedPersona, mode = 'replace') {
    const target = isObject(draft) ? clone(draft) : {};
    if (mode === 'cancel') return target;
    const parsed = isObject(parsedPersona) && hasOwn(parsedPersona, 'payload') ? parsedPersona : { payload:parsedPersona, rawPayload:parsedPersona };
    const payload = normalizeUserIdentityPayload(parsed.payload);
    const raw = isObject(parsed.rawPayload) ? parsed.rawPayload : {};
    if (mode === 'replace') {
      const incoming = { ...payload };
      if (!hasOwn(raw, 'grade')) delete incoming.grade;
      return applyUserIdentityPayload(target, incoming);
    }
    if (mode !== 'fill-empty') throw new Error('未知 Persona 导入模式：' + mode);
    const fieldMap = { identity:'player_identity', grade:'player_grade', callname:'player_callname', background:'player_background', appearance:'player_appearance', skills:'player_skills' };
    Object.entries(fieldMap).forEach(([field, draftField]) => {
      if (!String(target[draftField] ?? '').trim() && String(payload[field] ?? '').trim()) target[draftField] = payload[field];
    });
    target.core_attributes = normalizeIdentityAttributes(target.core_attributes);
    IDENTITY_ATTRIBUTE_KEYS.forEach(key => {
      if ((Number(target.core_attributes[key]) || 0) === 0 && (Number(payload.core_attributes[key]) || 0) !== 0) target.core_attributes[key] = payload.core_attributes[key];
    });
    if (!String(target.player_avatar ?? '').trim() && payload.media.avatar) target.player_avatar = payload.media.avatar;
    if (!String(target.player_portrait ?? '').trim() && payload.media.portrait) target.player_portrait = payload.media.portrait;
    return target;
  }
  function personaSnapshotFingerprint(snapshot) {
    if (!snapshot?.resolved) return 'unresolved|' + String(snapshot?.reason || '');
    return [snapshot.id, snapshot.name, snapshot.position, sha256HexFallback(snapshot.description || '', typeof TextEncoder === 'function' ? TextEncoder : null)].join('|');
  }
  function resolveActivePersonaSnapshot(context = getSillyTavernContext(), doc = hostDocument()) {
    const power = context?.powerUserSettings;
    const personas = isObject(power?.personas) ? power.personas : {};
    const descriptors = isObject(power?.persona_descriptions) ? power.persona_descriptions : {};
    const currentName = String(context?.name1 ?? '').trim();
    const activeDescription = String(power?.persona_description ?? '');
    const selectedIds = [];
    try {
      doc?.querySelectorAll?.('#user_avatar_block .avatar-container.selected[data-avatar-id]').forEach(node => {
        const id = String(node?.dataset?.avatarId || node?.getAttribute?.('data-avatar-id') || '');
        if (id && hasOwn(personas, id) && !selectedIds.includes(id)) selectedIds.push(id);
      });
    } catch (_) {}
    let id = '';
    let source = '';
    if (selectedIds.length === 1 && String(personas[selectedIds[0]] ?? '').trim() === currentName && String(descriptors[selectedIds[0]]?.description ?? '') === activeDescription) {
      id = selectedIds[0];
      source = 'selected-dom';
    } else if (selectedIds.length > 1) {
      return { resolved:false, ambiguous:true, reason:'检测到多个选中的 Persona，禁止写入', candidates:selectedIds, name:currentName, description:activeDescription };
    } else {
      const exact = Object.keys(personas).filter(key => String(personas[key] ?? '').trim() === currentName && String(descriptors[key]?.description ?? '') === activeDescription);
      if (exact.length === 1) {
        id = exact[0];
        source = 'name-description';
      } else {
        const byName = Object.keys(personas).filter(key => String(personas[key] ?? '').trim() === currentName);
        if (byName.length === 1) {
          id = byName[0];
          source = 'unique-name';
        } else {
          const candidates = exact.length > 1 ? exact : byName;
          return { resolved:false, ambiguous:candidates.length > 1, reason:candidates.length > 1 ? '当前 Persona 重名且无法唯一定位，禁止写入' : '未能定位当前活动 Persona', candidates, name:currentName, description:activeDescription };
        }
      }
    }
    const descriptor = descriptors[id];
    if (!isObject(descriptor)) return { resolved:false, ambiguous:false, reason:'当前 Persona 缺少 descriptor，禁止写入', candidates:[id], name:currentName, description:activeDescription };
    const description = String(descriptor.description ?? activeDescription);
    const position = Number(descriptor.position ?? power?.persona_description_position ?? 0);
    const snapshot = {
      resolved:true,
      ambiguous:false,
      id,
      source,
      name:String(personas[id] ?? currentName),
      description,
      position:Number.isFinite(position) ? position : 0,
      descriptor,
      avatarUrl:typeof context?.getThumbnailUrl === 'function' ? context.getThumbnailUrl('persona', id) : '',
    };
    snapshot.fingerprint = personaSnapshotFingerprint(snapshot);
    return snapshot;
  }
  async function writeActivePersonaDescription(snapshot, nextDescription) {
    if (!snapshot?.resolved) throw new Error(snapshot?.reason || '当前 Persona 无法唯一定位');
    const context = getSillyTavernContext();
    const current = resolveActivePersonaSnapshot(context, hostDocument());
    if (!current.resolved || current.id !== snapshot.id || current.fingerprint !== snapshot.fingerprint) throw new Error('Persona 已切换或内容已变化，请刷新后重试');
    const power = context?.powerUserSettings;
    const descriptor = power?.persona_descriptions?.[snapshot.id];
    if (!isObject(descriptor)) throw new Error('当前 Persona descriptor 不可写');
    const next = String(nextDescription ?? '');
    let nativeApplied = false;
    try {
      const doc = hostDocument();
      const input = doc?.querySelector?.('#persona_description');
      if (input) {
        input.value = next;
        const EventCtor = doc.defaultView?.Event || Event;
        input.dispatchEvent(new EventCtor('input', { bubbles:true }));
        nativeApplied = String(power.persona_descriptions?.[snapshot.id]?.description ?? '') === next;
      }
    } catch (_) {}
    if (!nativeApplied) {
      descriptor.description = next;
      power.persona_description = next;
      await Promise.resolve(context?.saveSettingsDebounced?.());
      const updatedEvent = context?.eventTypes?.PERSONA_UPDATED;
      if (updatedEvent && context?.eventSource?.emit) await Promise.resolve(context.eventSource.emit(updatedEvent, snapshot.id));
    }
    return resolveActivePersonaSnapshot(context, hostDocument());
  }
  function personaIdentityAuthority(draft, snapshot = resolveActivePersonaSnapshot()) {
    if (!userIdentityDraftHasContent(draft)) return { authoritative:false, suppressWorldbook:false, reason:'draft-empty' };
    if (!snapshot?.resolved) return { authoritative:false, suppressWorldbook:false, reason:snapshot?.reason || 'persona-unresolved' };
    const parsed = parsePersonaIdentityBlock(snapshot.description);
    if (!parsed.found || !parsed.valid || parsed.multiple || parsed.count !== 1) return { authoritative:false, suppressWorldbook:false, reason:!parsed.found ? 'block-missing' : 'block-invalid', snapshot, parsed };
    if (Number(snapshot.position) === PERSONA_DESCRIPTION_DISABLED_POSITION) return { authoritative:false, suppressWorldbook:false, reason:'persona-injection-disabled', snapshot, parsed };
    const draftHash = personaIdentityPayloadHash(buildUserIdentityPayload(draft));
    if (parsed.contentHash !== draftHash) return { authoritative:false, suppressWorldbook:false, reason:'payload-hash-mismatch', snapshot, parsed, draftHash };
    return { authoritative:true, suppressWorldbook:true, reason:'persona', snapshot, parsed, draftHash };
  }
  function explicitIdentityWithoutGrade(draft, options = {}) {
    const source = isObject(draft) ? draft : {};
    const persona = options.personaBlock === undefined ? null : parsePersonaIdentityBlock(options.personaBlock);
    if (persona?.found) return true;
    return ['player_identity','player_callname','player_background','player_appearance','player_skills','player_avatar','player_portrait']
      .some(key => !!String(source[key] ?? '').trim())
      || IDENTITY_ATTRIBUTE_KEYS.some(key => (Number(source.core_attributes?.[key]) || 0) !== 0);
  }
  function resolveEffectiveGrade(draft, options = {}) {
    const source = isObject(draft) ? draft : {};
    const explicit = normalizeGrade(hasOwn(options, 'grade') ? options.grade : source.player_grade);
    if (explicit) return { value:explicit, label:explicit, source:hasOwn(options, 'grade') ? 'option' : 'draft', fallback:false, band:gradeBand(explicit) };
    if (options.personaBlock !== undefined) {
      const persona = parsePersonaIdentityBlock(options.personaBlock);
      if (persona.gradeProvided) return { value:persona.payload.grade, label:persona.payload.grade, source:'persona', fallback:false, band:gradeBand(persona.payload.grade) };
      if (persona.found) return { value:'', label:'未提供年级', source:'persona-missing', fallback:false, band:'custom' };
    }
    if (explicitIdentityWithoutGrade(source, options) || options.allowLegacyFallback === false) {
      return { value:'', label:'未提供年级', source:'missing', fallback:false, band:'custom' };
    }
    return { value:LEGACY_DEFAULT_GRADE, label:LEGACY_DEFAULT_GRADE + '（旧版默认兜底）', source:'legacy-fallback', fallback:true, band:'middle' };
  }
  function openingStoryCompatibility(draft, options = {}) {
    const source = normalizeOpeningDraftData(draft);
    const grade = resolveEffectiveGrade(source, options);
    const scope = Array.isArray(source.openingDay?.gradeScope) ? source.openingDay.gradeScope : ['all'];
    const compatible = scope.includes('all') || scope.includes(grade.band);
    return { compatible, grade, gradeScope:scope.slice(), message:compatible ? '' : '当前正文不适用于“' + grade.label + '”。请先套用通用到访模板，再按需编辑后发送。' };
  }
  // OpeningDayDraftV1：正文只存模板与来源/hash，不持久化解析后的玩家名、年级、diff 或最终消息。
  const OPENING_DAY_SCHEMA_VERSION = 1;
  const OPENING_DAY_MAX_BYTES = 16 * 1024;
  const OPENING_DAY_SOURCE_REVISION = '20260711-340-opening-day-r1';
  const OFFICIAL_OPENING_DAY_BODY = [
    '『2025年-9月1日-星期一-12:00-星月私立学园大门口-晴』',
    '当{{player}}拎着行李箱站在私立星月学园的校门口，一座宏伟的庄园式校园便呈现在眼前。高耸的围墙上爬满了常青藤，金色的校徽在阳光下熠明。这里不像是一所小学、初中、高中全包的私立贵族学校，更像是一座戒备森严的贵族城堡。',
    '{{player}}没有在挂着“私立星月学园”牌匾的正门停留，而是从大校门旁的保安室小门进入，给安保人员检查完入学通知书后，沿着学校的主干道来到行政综合楼一楼的财务室办理入学。',
    '一名身着西装短裙的工作人员快速地为{{player}}办理了入学，并递过来一张校卡和三套校服，指了指北边的宿舍楼。{{player}}根据校卡上分配的班级和宿舍朝着男生宿舍前进，校园的全景如画卷般徐徐展开。',
  ].join('\n\n');
  const GENERIC_ARRIVAL_BODY = [
    '『2025年-9月1日-星期一-12:00-星月私立学园行政楼前-晴』',
    '{{player}}按当前身份来到星月私立学园，在行政楼前确认来访、任职、交流或其他到校安排。',
    '工作人员核对资料后说明了校内通行与联络方式。接下来的行动以{{player}}填写的身份、年级与背景为准，不预设其为在校学生。',
  ].join('\n\n');
  function canonicalizeOpeningStoryBody(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\{\{\s*user\s*\}\}/gi, '{{player}}');
  }
  function openingStoryUtf8Bytes(value) {
    const text = String(value ?? '');
    const Encoder = typeof TextEncoder === 'function' ? TextEncoder : null;
    if (Encoder) return new Encoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  }
  function openingStoryHash(value) {
    const Encoder = typeof TextEncoder === 'function' ? TextEncoder : null;
    return sha256HexFallback(canonicalizeOpeningStoryBody(value), Encoder);
  }
  const OFFICIAL_OPENING_DAY = Object.freeze({
    schemaVersion: OPENING_DAY_SCHEMA_VERSION,
    body: OFFICIAL_OPENING_DAY_BODY,
    origin: 'official',
    sourceRevision: OPENING_DAY_SOURCE_REVISION,
    baseHash: openingStoryHash(OFFICIAL_OPENING_DAY_BODY),
    bodyHash: openingStoryHash(OFFICIAL_OPENING_DAY_BODY),
    gradeScope: Object.freeze(['primary','middle','high']),
  });
  function copyOfficialOpeningDay(official = OFFICIAL_OPENING_DAY) {
    return {
      schemaVersion: OPENING_DAY_SCHEMA_VERSION,
      body: canonicalizeOpeningStoryBody(official.body),
      origin: 'official',
      sourceRevision: String(official.sourceRevision || OPENING_DAY_SOURCE_REVISION),
      baseHash: String(official.baseHash || openingStoryHash(official.body)).toLowerCase(),
      bodyHash: String(official.baseHash || openingStoryHash(official.body)).toLowerCase(),
      gradeScope: Array.isArray(official.gradeScope) ? official.gradeScope.slice() : ['primary','middle','high'],
    };
  }
  function normalizeOpeningDayDraft(value, official = OFFICIAL_OPENING_DAY) {
    if (!isObject(value)) return copyOfficialOpeningDay(official);
    const source = clone(value) || {};
    const body = canonicalizeOpeningStoryBody(source.body ?? official.body);
    const bodyHash = openingStoryHash(body);
    const recordedBaseHash = /^[0-9a-f]{64}$/i.test(String(source.baseHash || ''))
      ? String(source.baseHash).toLowerCase()
      : String(official.baseHash).toLowerCase();
    const recordedRevision = String(source.sourceRevision || official.sourceRevision || OPENING_DAY_SOURCE_REVISION);
    const explicitUserOrigin = String(source.origin || '').toLowerCase() === 'user';
    const cleanAgainstRecordedSource = !explicitUserOrigin && bodyHash === recordedBaseHash;
    const officialChanged = recordedBaseHash !== String(official.baseHash).toLowerCase()
      || recordedRevision !== String(official.sourceRevision);
    if (cleanAgainstRecordedSource && officialChanged) return copyOfficialOpeningDay(official);
    const matchesCurrentOfficial = !explicitUserOrigin && bodyHash === String(official.baseHash).toLowerCase();
    const normalized = {
      schemaVersion: OPENING_DAY_SCHEMA_VERSION,
      body,
      origin: matchesCurrentOfficial ? 'official' : 'user',
      sourceRevision: matchesCurrentOfficial ? String(official.sourceRevision) : recordedRevision,
      baseHash: matchesCurrentOfficial ? String(official.baseHash).toLowerCase() : recordedBaseHash,
      bodyHash,
      gradeScope: matchesCurrentOfficial
        ? (Array.isArray(official.gradeScope) ? official.gradeScope.slice() : ['primary','middle','high'])
        : (Array.isArray(source.gradeScope) && source.gradeScope.length ? source.gradeScope.map(String) : ['all']),
    };
    if (!matchesCurrentOfficial && isObject(source.sourcePackage)) normalized.sourcePackage = clone(source.sourcePackage);
    if (!matchesCurrentOfficial && source.localModifiedAt) normalized.localModifiedAt = String(source.localModifiedAt);
    return normalized;
  }
  function normalizeOpeningDraftData(value) {
    const draft = isObject(value) ? clone(value) : {};
    draft.openingDay = normalizeOpeningDayDraft(draft.openingDay);
    if (hasOwn(draft, 'player_grade')) draft.player_grade = normalizeGrade(draft.player_grade);
    if (hasOwn(draft, 'player_avatar')) draft.player_avatar = normalizeIdentityMediaReference(draft.player_avatar);
    if (hasOwn(draft, 'player_portrait')) draft.player_portrait = normalizeIdentityMediaReference(draft.player_portrait);
    if (isObject(draft.core_attributes)) draft.core_attributes = normalizeIdentityAttributes(draft.core_attributes);
    return draft;
  }
  function validateOpeningStory(body, context = {}) {
    const normalized = canonicalizeOpeningStoryBody(body);
    if (normalized.includes('\0')) throw new Error('入学日正文不能包含 NUL 字符');
    if (!normalized.trim()) throw new Error('入学日正文不能为空');
    const bytes = openingStoryUtf8Bytes(normalized);
    if (bytes > OPENING_DAY_MAX_BYTES) throw new Error('入学日正文超过 16 KiB 上限');
    const macros = Array.from(normalized.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), match => String(match[1] || '').trim().toLowerCase());
    const unknownMacros = Array.from(new Set(macros.filter(name => name !== 'player' && name !== 'grade')));
    if (unknownMacros.length) throw new Error('入学日正文包含不支持的占位符：' + unknownMacros.map(name => '{{' + name + '}}').join('、'));
    const hasPlayerToken = macros.includes('player');
    const hasGradeToken = macros.includes('grade');
    const grade = String(context.grade ?? '').trim();
    if (hasGradeToken && !grade) throw new Error('正文使用了 {{grade}}，但当前为“未提供年级”；请先选择或填写年级');
    return { body: normalized, bytes, hasPlayerToken, hasGradeToken };
  }
  function getSillyTavernContext() {
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    for (const target of targets) {
      try {
        const sillyTavern = target?.SillyTavern;
        if (typeof sillyTavern?.getContext === 'function') {
          const context = sillyTavern.getContext();
          if (context) return context;
        }
        if (sillyTavern && typeof sillyTavern.getCurrentChatId === 'function') return sillyTavern;
      } catch (_) {}
    }
    return null;
  }
  function isResolvedPlayerName(value) {
    const name = String(value ?? '').trim();
    return !!name && !/\{\{\s*user\s*\}\}/i.test(name);
  }
  function resolveCurrentPlayerName() {
    const context = getSillyTavernContext();
    if (isResolvedPlayerName(context?.name1)) return String(context.name1).trim();
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    for (const target of targets) {
      const candidates = [
        { owner: target, fn: target?.substitudeMacros },
        { owner: target?.builtin, fn: target?.builtin?.substitudeMacros },
        { owner: target?.TavernHelper, fn: target?.TavernHelper?.substitudeMacros },
        { owner: target?.TavernHelper?.builtin, fn: target?.TavernHelper?.builtin?.substitudeMacros },
      ];
      for (const candidate of candidates) {
        if (typeof candidate.fn !== 'function') continue;
        try {
          const resolved = candidate.fn.call(candidate.owner, '{{user}}');
          if (isResolvedPlayerName(resolved)) return String(resolved).trim();
        } catch (_) {}
      }
    }
    return '玩家';
  }
  function resolvePlayerText(value) {
    const playerName = resolveCurrentPlayerName();
    return String(value ?? '').replace(/\{\{\s*user\s*\}\}/gi, () => playerName);
  }
  function resolveOpeningStory(draft, options = {}) {
    const sourceDraft = normalizeOpeningDraftData(draft);
    const compatibility = openingStoryCompatibility(sourceDraft, options);
    if (!compatibility.compatible) throw new Error(compatibility.message);
    const grade = compatibility.grade.value;
    const validated = validateOpeningStory(sourceDraft.openingDay.body, { grade });
    const playerName = String(options.playerName ?? resolveCurrentPlayerName()).trim() || '玩家';
    return validated.body
      .replace(/\{\{\s*player\s*\}\}/gi, () => playerName)
      .replace(/\{\{\s*grade\s*\}\}/gi, () => grade);
  }
  function composeOpeningMessage(draft, options = {}) {
    const sourceDraft = normalizeOpeningDraftData(draft);
    const story = resolveOpeningStory(sourceDraft, options).trim();
    const identity = Object.prototype.hasOwnProperty.call(options, 'identity')
      ? String(options.identity ?? '').trim()
      : String(identityContent(sourceDraft) || '').trim();
    return [story, identity].filter(Boolean).join('\n\n');
  }
  function openingDraftStorage() {
    try { return hostWindow()?.localStorage || window.localStorage; } catch (_) {
      try { return window.localStorage; } catch (_error) { return null; }
    }
  }
  function isOpeningUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
  }
  function generateOpeningDraftUuid(injectedUuidv4) {
    if (typeof injectedUuidv4 === 'function') {
      const injected = injectedUuidv4();
      if (isOpeningUuid(injected)) return String(injected);
    }
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    for (const target of targets) {
      const candidates = [
        { owner: target?.builtin, fn: target?.builtin?.uuidv4 },
        { owner: target?.TavernHelper?.builtin, fn: target?.TavernHelper?.builtin?.uuidv4 },
      ];
      for (const candidate of candidates) {
        if (typeof candidate.fn !== 'function') continue;
        try {
          const uuid = candidate.fn.call(candidate.owner);
          if (isOpeningUuid(uuid)) return String(uuid);
        } catch (_) {}
      }
    }
    for (const target of targets) {
      try {
        const uuid = target?.crypto?.randomUUID?.();
        if (isOpeningUuid(uuid)) return String(uuid);
      } catch (_) {}
    }
    throw new Error('当前环境无法生成 OpeningDraftV2 UUID');
  }
  function normalizeOpeningScroll(value) {
    const source = isObject(value) ? value : {};
    const panes = isObject(source.panes) ? source.panes : {};
    const normalizedPanes = {};
    Object.keys(panes).forEach(key => {
      const step = String(Math.max(1, Math.min(6, Number(key) || 1)));
      normalizedPanes[step] = Math.max(0, Number(panes[key]) || 0);
    });
    return {
      root: Math.max(0, Number(source.root) || 0),
      workshop: Math.max(0, Number(source.workshop) || 0),
      panes: normalizedPanes,
    };
  }
  function normalizeOpeningUi(value) {
    const source = isObject(value) ? value : {};
    const view = ['boot', 'wizard', 'workshop'].includes(source.view) ? source.view : 'boot';
    const step = Math.max(1, Math.min(6, Number(source.step) || 1));
    return {
      step,
      maxStep: Math.max(step, Math.min(6, Number(source.maxStep) || 1)),
      view,
      scroll: normalizeOpeningScroll(source.scroll),
    };
  }
  function mergeOpeningUi(current, patch) {
    const base = normalizeOpeningUi(current);
    const next = { ...base, ...(isObject(patch) ? patch : {}) };
    if (isObject(patch?.scroll)) {
      next.scroll = {
        ...base.scroll,
        ...patch.scroll,
        panes: { ...base.scroll.panes, ...(isObject(patch.scroll.panes) ? patch.scroll.panes : {}) },
      };
    }
    return normalizeOpeningUi(next);
  }
  function createOpeningDraftService(options = {}) {
    const storage = options.storage || openingDraftStorage();
    const contextProvider = options.getContext || getSillyTavernContext;
    const nowIso = options.nowIso || (() => new Date().toISOString());
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const debounceMs = Math.max(40, Number(options.debounceMs) || 180);
    let activeChatId = '';
    let activeUuid = '';
    let activeRecord = null;
    let dirty = false;
    let saveTimer = null;
    let destroyed = false;
    let transitionGeneration = 0;
    let pendingDraftReplacement = null;
    let pendingDraftPatch = {};
    let pendingUiPatch = {};

    function blankContainer() {
      return { schemaVersion: OPENING_DRAFT_SCHEMA_VERSION, legacyMigration: null, records: {}, fallbackChatUuids: {}, quarantined: {} };
    }
    function normalizeContainer(value) {
      const source = isObject(value) ? value : {};
      return {
        ...source,
        schemaVersion: OPENING_DRAFT_SCHEMA_VERSION,
        legacyMigration: isObject(source.legacyMigration) ? source.legacyMigration : null,
        records: isObject(source.records) ? source.records : {},
        fallbackChatUuids: isObject(source.fallbackChatUuids) ? source.fallbackChatUuids : {},
        quarantined: isObject(source.quarantined) ? source.quarantined : {},
      };
    }
    function readContainer() {
      if (!storage) return blankContainer();
      const raw = storage.getItem(OPENING_DRAFTS_V2_KEY);
      if (!raw) return blankContainer();
      try { return normalizeContainer(JSON.parse(raw)); } catch (error) {
        try {
          storage.setItem(OPENING_DRAFTS_V2_KEY + '-quarantined-root', JSON.stringify({ raw, at: nowIso(), reason: error?.message || String(error) }));
        } catch (_) {}
        return blankContainer();
      }
    }
    function writeContainer(container) {
      if (!storage) return false;
      try {
        storage.setItem(OPENING_DRAFTS_V2_KEY, JSON.stringify(normalizeContainer(container)));
        return true;
      } catch (_) { return false; }
    }
    function normalizeRecord(value, chatUuid) {
      if (!isObject(value)) throw new Error('OpeningDraftV2 record 不是对象');
      return {
        ...value,
        schemaVersion: OPENING_DRAFT_SCHEMA_VERSION,
        chatUuid,
        draft: normalizeOpeningDraftData(value.draft),
        ui: normalizeOpeningUi(value.ui),
      };
    }
    function readRecord(container, chatUuid) {
      const raw = container.records[chatUuid];
      if (raw === undefined) return { record: null, changed: false, corrupted: false };
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { record: normalizeRecord(parsed, chatUuid), changed: false, corrupted: false };
      } catch (error) {
        const quarantineId = chatUuid + '::' + String(Object.keys(container.quarantined).length + 1);
        container.quarantined[quarantineId] = { chatUuid, raw: typeof raw === 'string' ? raw : safeJson(raw, ''), at: nowIso(), reason: error?.message || String(error) };
        delete container.records[chatUuid];
        return { record: null, changed: true, corrupted: true };
      }
    }
    function makeRecord(chatUuid, draft, ui, extra = {}) {
      return {
        schemaVersion: OPENING_DRAFT_SCHEMA_VERSION,
        chatUuid,
        ...extra,
        draft: normalizeOpeningDraftData(draft),
        ui: normalizeOpeningUi(ui),
        updatedAt: nowIso(),
      };
    }
    function legacyDraftAndUi() {
      let legacy = {};
      let hadLegacy = false;
      if (storage) {
        const raw = storage.getItem(OPENING_DRAFT_KEY);
        if (raw) {
          hadLegacy = true;
          try { legacy = isObject(JSON.parse(raw)) ? JSON.parse(raw) : {}; } catch (_) { legacy = {}; }
        }
      }
      const draft = clone(legacy) || {};
      const ui = {
        step: Math.max(1, Math.min(6, Number(draft.last_step) || 1)),
        view: ['boot', 'wizard', 'workshop'].includes(draft.view) ? draft.view : 'boot',
        scroll: draft.scroll,
      };
      delete draft.last_step;
      delete draft.view;
      delete draft.scroll;
      return { draft, ui, hadLegacy };
    }
    function looksLikeSillyTavernHost() {
      if (options.assumeSillyTavern === true) return true;
      if (options.assumeSillyTavern === false) return false;
      try { return !!hostDocument()?.querySelector?.('#send_textarea,#chat'); } catch (_) { return false; }
    }
    async function resolveContextSnapshot() {
      const shouldWait = looksLikeSillyTavernHost();
      const maxAttempts = shouldWait ? 30 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const context = contextProvider?.() || null;
        let chatId = '';
        try { chatId = String(context?.getCurrentChatId?.() || '').trim(); } catch (_) {}
        if (context && chatId) return { context, chatId };
        if (!shouldWait) return { context, chatId: '__preview__' };
        await new Promise(resolve => setTimer(resolve, 100));
      }
      throw new Error('SillyTavern 聊天上下文尚未就绪，OpeningDraftV2 未启动');
    }
    function transitionContextCurrent(generation, context, chatId) {
      if (destroyed || generation !== transitionGeneration) return false;
      try { return String(context?.getCurrentChatId?.() || '').trim() === String(chatId || '').trim(); } catch (_) { return false; }
    }
    async function persistContextDraftUuid(context, uuid, generation, chatId) {
      if (typeof context?.updateChatMetadata !== 'function' || typeof context?.saveMetadata !== 'function') {
        throw new Error('SillyTavern chat metadata 写入接口不可用');
      }
      if (!transitionContextCurrent(generation, context, chatId)) return false;
      await Promise.resolve(context.updateChatMetadata({ [OPENING_DRAFT_UUID_METADATA_KEY]: uuid }, false));
      if (!transitionContextCurrent(generation, context, chatId)) return false;
      await Promise.resolve(context.saveMetadata());
      if (!transitionContextCurrent(generation, context, chatId)) return false;
      try {
        if (isObject(context.chatMetadata)) context.chatMetadata[OPENING_DRAFT_UUID_METADATA_KEY] = uuid;
      } catch (_) {}
      return true;
    }
    async function resolveChatIdentity(generation) {
      const snapshot = await resolveContextSnapshot();
      const context = snapshot.context;
      const chatId = snapshot.chatId;
      if (destroyed || generation !== transitionGeneration) return null;
      const metadataUuid = context?.chatMetadata?.[OPENING_DRAFT_UUID_METADATA_KEY];
      if (isOpeningUuid(metadataUuid)) return { context, chatId, uuid: String(metadataUuid) };

      const container = readContainer();
      const canPersistMetadata = typeof context?.updateChatMetadata === 'function' && typeof context?.saveMetadata === 'function' && chatId !== '__preview__';
      if (!canPersistMetadata && isOpeningUuid(container.fallbackChatUuids[chatId])) {
        return { context, chatId, uuid: String(container.fallbackChatUuids[chatId]) };
      }
      const uuid = generateOpeningDraftUuid(options.uuidv4);
      if (canPersistMetadata) {
        if (!await persistContextDraftUuid(context, uuid, generation, chatId)) return null;
      } else {
        if (destroyed || generation !== transitionGeneration) return null;
        container.fallbackChatUuids[chatId] = uuid;
        writeContainer(container);
      }
      return { context, chatId, uuid };
    }
    async function forkInheritedRecord(identity, container, loaded, generation) {
      const record = loaded.record;
      if (!record) return { identity, loaded };
      const originChatId = String(record.originChatId || '').trim();
      const lastSeenChatId = String(record.lastSeenChatId || '').trim();
      const mainChatId = String(identity.context?.chatMetadata?.main_chat || '').trim();
      const hasBranchEvidence = !!mainChatId && mainChatId !== identity.chatId;
      const inheritedUuid = hasBranchEvidence
        && (!originChatId || originChatId === mainChatId || lastSeenChatId === mainChatId);
      if (!inheritedUuid) {
        if (!originChatId || record.lastSeenChatId !== identity.chatId) {
          if (!originChatId) record.originChatId = identity.chatId;
          record.lastSeenChatId = identity.chatId;
          record.updatedAt = nowIso();
          container.records[identity.uuid] = JSON.stringify(normalizeRecord(record, identity.uuid));
          writeContainer(container);
        }
        return { identity, loaded: { ...loaded, record } };
      }
      const forkedAt = nowIso();
      const forkUuid = generateOpeningDraftUuid(options.uuidv4);
      if (!await persistContextDraftUuid(identity.context, forkUuid, generation, identity.chatId)) return null;
      if (destroyed || generation !== transitionGeneration) return null;
      const forkRecord = makeRecord(forkUuid, record.draft, record.ui, {
        originChatId: identity.chatId,
        lastSeenChatId: identity.chatId,
        forkedFromUuid: identity.uuid,
        forkedFromChatId: originChatId || mainChatId || '',
        forkedAt,
      });
      container.records[forkUuid] = JSON.stringify(forkRecord);
      writeContainer(container);
      return {
        identity: { ...identity, uuid: forkUuid },
        loaded: { record: forkRecord, changed: false, corrupted: false },
      };
    }
    function applyPending() {
      if (!activeRecord) return;
      let changed = false;
      if (pendingDraftReplacement !== null) {
        activeRecord.draft = normalizeOpeningDraftData(pendingDraftReplacement);
        pendingDraftReplacement = null;
        changed = true;
      }
      if (Object.keys(pendingDraftPatch).length) {
        activeRecord.draft = normalizeOpeningDraftData({ ...activeRecord.draft, ...clone(pendingDraftPatch) });
        pendingDraftPatch = {};
        changed = true;
      }
      if (Object.keys(pendingUiPatch).length) {
        activeRecord.ui = mergeOpeningUi(activeRecord.ui, pendingUiPatch);
        pendingUiPatch = {};
        changed = true;
      }
      if (changed) dirty = true;
    }
    function flushSync() {
      if (saveTimer) { clearTimer(saveTimer); saveTimer = null; }
      if (!activeRecord || !activeUuid || !dirty) return false;
      activeRecord.updatedAt = nowIso();
      const container = readContainer();
      const existing = readRecord(container, activeUuid);
      if (existing.changed) writeContainer(container);
      container.records[activeUuid] = JSON.stringify(normalizeRecord(activeRecord, activeUuid));
      const saved = writeContainer(container);
      if (saved) dirty = false;
      return saved;
    }
    function scheduleSave(immediate) {
      if (immediate) return flushSync();
      if (saveTimer) clearTimer(saveTimer);
      saveTimer = setTimer(() => { saveTimer = null; flushSync(); }, debounceMs);
      return true;
    }
    async function activate(generation) {
      let identity = await resolveChatIdentity(generation);
      if (!identity) return null;
      if (destroyed || generation !== transitionGeneration) return null;
      const container = readContainer();
      let loaded = readRecord(container, identity.uuid);
      const forked = await forkInheritedRecord(identity, container, loaded, generation);
      if (!forked) return null;
      identity = forked.identity;
      loaded = forked.loaded;
      if (destroyed || generation !== transitionGeneration) return null;
      let record = loaded.record;
      if (!record) {
        const createdAt = nowIso();
        let extra = loaded.corrupted ? { recoveredFromCorruptionAt: createdAt } : {};
        let draft = {};
        let ui = {};
        if (!container.legacyMigration) {
          const legacy = legacyDraftAndUi();
          draft = legacy.draft;
          ui = legacy.ui;
          container.legacyMigration = { key: OPENING_DRAFT_KEY, claimedByUuid: identity.uuid, at: createdAt };
          if (legacy.hadLegacy) extra = { ...extra, migratedFrom: OPENING_DRAFT_KEY, migratedAt: createdAt };
        }
        record = makeRecord(identity.uuid, draft, ui, { originChatId: identity.chatId, ...extra });
        container.records[identity.uuid] = JSON.stringify(record);
        writeContainer(container);
      } else if (loaded.changed) {
        writeContainer(container);
      }
      activeChatId = identity.chatId;
      activeUuid = identity.uuid;
      activeRecord = record;
      applyPending();
      if (dirty) flushSync();
      return { chatId: activeChatId, uuid: activeUuid, record: clone(activeRecord) };
    }
    function readDraft() {
      if (activeRecord) return clone(activeRecord.draft) || {};
      if (pendingDraftReplacement !== null) return { ...(clone(pendingDraftReplacement) || {}), ...(clone(pendingDraftPatch) || {}) };
      return clone(pendingDraftPatch) || {};
    }
    function replaceDraft(next, options = {}) {
      const draft = normalizeOpeningDraftData(next);
      if (!activeRecord) {
        pendingDraftReplacement = draft;
        pendingDraftPatch = {};
        return clone(draft);
      }
      activeRecord.draft = draft;
      dirty = true;
      scheduleSave(options.immediate === true);
      return clone(activeRecord.draft);
    }
    function patchDraft(patch, options = {}) {
      const safePatch = isObject(patch) ? clone(patch) : {};
      if (!activeRecord) {
        pendingDraftPatch = { ...pendingDraftPatch, ...safePatch };
        return readDraft();
      }
      activeRecord.draft = normalizeOpeningDraftData({ ...activeRecord.draft, ...safePatch });
      dirty = true;
      scheduleSave(options.immediate === true);
      return clone(activeRecord.draft);
    }
    function readUi() {
      return activeRecord ? clone(activeRecord.ui) : mergeOpeningUi({}, pendingUiPatch);
    }
    function patchUi(patch, options = {}) {
      const safePatch = isObject(patch) ? clone(patch) : {};
      if (!activeRecord) {
        pendingUiPatch = mergeOpeningUi(pendingUiPatch, safePatch);
        return readUi();
      }
      activeRecord.ui = mergeOpeningUi(activeRecord.ui, safePatch);
      dirty = true;
      scheduleSave(options.immediate === true);
      return clone(activeRecord.ui);
    }
    function clearDraft() {
      return replaceDraft({}, { immediate: true });
    }
    async function flush() {
      await transition.catch(() => null);
      return flushSync();
    }
    function switchChat() {
      if (destroyed) return Promise.resolve(null);
      const requestedGeneration = ++transitionGeneration;
      transition = transition.catch(() => null).then(() => {
        flushSync();
        if (destroyed || requestedGeneration !== transitionGeneration) return null;
        return activate(requestedGeneration);
      });
      return transition;
    }
    function destroyService() {
      flushSync();
      destroyed = true;
      transitionGeneration += 1;
      if (saveTimer) { clearTimer(saveTimer); saveTimer = null; }
    }
    function status() {
      return { ready: !!activeRecord, chatId: activeChatId, uuid: activeUuid, originChatId: activeRecord?.originChatId || '', dirty, destroyed, ui: readUi() };
    }

    transitionGeneration += 1;
    let transition = activate(transitionGeneration);
    return { ready: () => transition, readDraft, replaceDraft, patchDraft, clearDraft, readUi, patchUi, flush, flushSync, switchChat, destroy: destroyService, status };
  }
  // </opening-draft-v2-core>
  const openingDraftService = createOpeningDraftService();
  const openingDraftReady = openingDraftService.ready().catch(error => {
    lastError = error?.message || String(error);
    return null;
  });
  function readOpeningDraft() {
    return normalizeOpeningDraftData(openingDraftService.readDraft());
  }
  function writeOpeningDraft(patch, options = {}) {
    const safePatch = isObject(patch) ? clone(patch) : {};
    if (!openingDraftService.status().ready) {
      return normalizeOpeningDraftData(openingDraftService.patchDraft(safePatch, { immediate: options.immediate !== false }));
    }
    const next = normalizeOpeningDraftData({ ...openingDraftService.readDraft(), ...safePatch });
    return openingDraftService.replaceDraft(next, { immediate: options.immediate !== false });
  }
  function downloadBlob(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // D11：STORE（无压缩）zip 读写。角色包带媒体时导出 zip（package.json + media/*），
  // 手写实现避免外部依赖；只支持本卡导出的 STORE 条目，deflate 包导入时明确报错。
  const ZIP_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function zipCrc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zipWriteU16(view, offset, value) { view.setUint16(offset, value & 0xFFFF, true); }
  function zipWriteU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function buildStoreZip(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach(file => {
      const nameBytes = encoder.encode(String(file.name));
      const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []);
      const crc = zipCrc32(data);
      const local = new Uint8Array(30 + nameBytes.length + data.length);
      const lv = new DataView(local.buffer);
      zipWriteU32(lv, 0, 0x04034B50); zipWriteU16(lv, 4, 20); zipWriteU16(lv, 6, 0x0800);
      zipWriteU16(lv, 8, 0); zipWriteU16(lv, 10, 0); zipWriteU16(lv, 12, 0);
      zipWriteU32(lv, 14, crc); zipWriteU32(lv, 18, data.length); zipWriteU32(lv, 22, data.length);
      zipWriteU16(lv, 26, nameBytes.length); zipWriteU16(lv, 28, 0);
      local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      zipWriteU32(cv, 0, 0x02014B50); zipWriteU16(cv, 4, 20); zipWriteU16(cv, 6, 20); zipWriteU16(cv, 8, 0x0800);
      zipWriteU16(cv, 10, 0); zipWriteU16(cv, 12, 0); zipWriteU16(cv, 14, 0);
      zipWriteU32(cv, 16, crc); zipWriteU32(cv, 20, data.length); zipWriteU32(cv, 24, data.length);
      zipWriteU16(cv, 28, nameBytes.length); zipWriteU16(cv, 30, 0); zipWriteU16(cv, 32, 0);
      zipWriteU16(cv, 34, 0); zipWriteU16(cv, 36, 0); zipWriteU32(cv, 38, 0); zipWriteU32(cv, 42, offset);
      central.set(nameBytes, 46);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    zipWriteU32(ev, 0, 0x06054B50); zipWriteU16(ev, 4, 0); zipWriteU16(ev, 6, 0);
    zipWriteU16(ev, 8, files.length); zipWriteU16(ev, 10, files.length);
    zipWriteU32(ev, 12, centralSize); zipWriteU32(ev, 16, offset); zipWriteU16(ev, 20, 0);
    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let cursor = 0;
    locals.forEach(part => { out.set(part, cursor); cursor += part.length; });
    centrals.forEach(part => { out.set(part, cursor); cursor += part.length; });
    out.set(eocd, cursor);
    return out;
  }
  function parseStoreZip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
      if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件');
    const count = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const files = new Map();
    for (let i = 0; i < count; i += 1) {
      if (view.getUint32(cursor, true) !== 0x02014B50) throw new Error('zip 中央目录损坏');
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (method !== 0) throw new Error('仅支持本卡导出的无压缩 zip（含 deflate 条目：' + name + '）');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      files.set(name, bytes.subarray(dataStart, dataStart + compressedSize));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }
  function dataUrlToBytes(dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) throw new Error('媒体不是 base64 data URL');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime: match[1].toLowerCase(), bytes };
  }
  function bytesToDataUrl(mime, bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return 'data:' + mime + ';base64,' + btoa(binary);
  }
  function mediaFileExtension(mime) {
    if (/png/i.test(mime)) return 'png';
    if (/jpe?g/i.test(mime)) return 'jpg';
    if (/gif/i.test(mime)) return 'gif';
    return 'webp';
  }
  function mediaExtensionMime(name) {
    const text = String(name || '').toLowerCase();
    if (text.endsWith('.png')) return 'image/png';
    if (text.endsWith('.jpg') || text.endsWith('.jpeg')) return 'image/jpeg';
    if (text.endsWith('.gif')) return 'image/gif';
    if (text.endsWith('.webp')) return 'image/webp';
    return '';
  }
  // D11：角色包带媒体 → 导出 zip（package.json 内媒体字段改 media/ 相对路径）；无媒体保持纯 JSON。
  async function exportCharacterPackageArchive(input) {
    const pkg = validatePackage(input);
    if (pkg.type !== 'character') throw new Error('只有角色包支持压缩包导出');
    const staged = clone(pkg);
    if (!isObject(staged.payload.media)) staged.payload.media = {};
    if (!isObject(staged.payload.media.portraits)) staged.payload.media.portraits = {};
    const media = staged.payload.media;
    const specs = [
      { file:'avatar', get:() => media.avatar, set:value => { media.avatar = value; } },
      { file:'portrait-normal', get:() => media.portraits.normal, set:value => { media.portraits.normal = value; } },
      { file:'portrait-nude', get:() => media.portraits.nude, set:value => { media.portraits.nude = value; } },
      { file:'portrait-aftermath', get:() => media.portraits.aftermath, set:value => { media.portraits.aftermath = value; } },
    ];
    const mediaFiles = [];
    for (const spec of specs) {
      const reference = String(spec.get() || '').trim();
      if (!reference) { spec.set(''); continue; }
      const resolved = await resolveCharacterUploadMedia(reference);
      if (resolved.dataUrl) {
        const { mime, bytes } = dataUrlToBytes(resolved.dataUrl);
        const filename = 'media/' + spec.file + '.' + mediaFileExtension(mime);
        mediaFiles.push({ name: filename, bytes });
        spec.set(filename);
      } else {
        spec.set(resolved.portableUrl || '');
      }
    }
    if (!mediaFiles.length) return { kind:'json', package: staged };
    const zipBytes = buildStoreZip([
      { name:'package.json', bytes: new TextEncoder().encode(JSON.stringify(staged, null, 2)) },
      ...mediaFiles,
    ]);
    downloadBlob(String(staged.id || 'character-package') + '.zip', new Blob([zipBytes], { type:'application/zip' }));
    return { kind:'zip', mediaCount: mediaFiles.length, package: staged };
  }
  // D11：导入本卡导出的角色包 zip。media/ 相对引用的文件走媒体库压缩管线入库（name=角色名），
  // 字段回填库 key 后返回包对象，交调用方 validate + 预览/导入。
  async function importCharacterPackageArchive(buffer) {
    const files = parseStoreZip(buffer);
    const manifestBytes = files.get('package.json');
    if (!manifestBytes) throw new Error('压缩包缺少 package.json，不是本卡导出的角色包');
    let pkg;
    try { pkg = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch (_) { throw new Error('压缩包内 package.json 不是有效 JSON'); }
    if (pkg?.type === 'character' && isObject(pkg.payload)) {
      if (!isObject(pkg.payload.media)) pkg.payload.media = {};
      if (!isObject(pkg.payload.media.portraits)) pkg.payload.media.portraits = {};
      const media = pkg.payload.media;
      const name = String(pkg.payload?.name || pkg.title || '').trim() || '角色';
      const lib = mediaLibrary();
      const jobs = [
        { get:() => media.avatar, set:value => { media.avatar = value; }, slot:'avatar', variant:'normal' },
        { get:() => media.portraits.normal, set:value => { media.portraits.normal = value; }, slot:'portrait', variant:'normal' },
        { get:() => media.portraits.nude, set:value => { media.portraits.nude = value; }, slot:'portrait', variant:'nude' },
        { get:() => media.portraits.aftermath, set:value => { media.portraits.aftermath = value; }, slot:'portrait', variant:'aftermath' },
      ];
      for (const job of jobs) {
        const reference = String(job.get() || '').trim();
        if (!reference || !/^media\//i.test(reference)) continue;
        const bytes = files.get(reference);
        if (!bytes) throw new Error('压缩包缺少媒体文件：' + reference);
        const mime = mediaExtensionMime(reference) || 'image/webp';
        if (lib?.importLocalAsset) {
          const item = await lib.importLocalAsset({ type:'bond', name, slot:job.slot, variant:job.variant }, new Blob([bytes], { type: mime }));
          job.set(item?.key || bytesToDataUrl(mime, bytes));
        } else {
          job.set(bytesToDataUrl(mime, bytes));
        }
      }
    }
    return pkg;
  }
  // D10：角色包媒体注册进媒体库。气泡按「说话者名」查 bond/avatar 资产，
  // 导入的角色包若不注册，头像/立绘永远查不到——注册键 name 必须用角色名（payload.name / title）。
  // 异步且逐槽容错：单张图解析失败不阻塞导入，也不影响其它槽位。
  async function registerCharacterPackageMedia(pkg) {
    if (!pkg || pkg.type !== 'character') return { registered: 0 };
    const lib = mediaLibrary();
    if (!lib?.upsertAsset) return { registered: 0 };
    const name = String(pkg.payload?.name || pkg.title || '').trim();
    if (!name) return { registered: 0 };
    const media = isObject(pkg.payload?.media) ? pkg.payload.media : {};
    const portraits = isObject(media.portraits) ? media.portraits : {};
    const specs = [
      { slot:'avatar', variant:'normal', value: media.avatar },
      { slot:'portrait', variant:'normal', value: portraits.normal },
      { slot:'portrait', variant:'nude', value: portraits.nude },
      { slot:'portrait', variant:'aftermath', value: portraits.aftermath },
    ];
    let registered = 0;
    for (const spec of specs) {
      const reference = String(spec.value || '').trim();
      if (!reference) continue;
      try {
        const resolved = await resolveCharacterUploadMedia(reference);
        const source = resolved.dataUrl ? { dataUrl: resolved.dataUrl } : (resolved.portableUrl ? { url: resolved.portableUrl, external: true } : null);
        if (!source) continue;
        const existing = lib.getExactAsset?.({ type:'bond', name, slot:spec.slot, variant:spec.variant });
        if (existing && ((source.dataUrl && existing.dataUrl === source.dataUrl) || (source.url && existing.url === source.url))) continue;
        lib.upsertAsset({ type:'bond', name, slot:spec.slot, variant:spec.variant }, { ...source, source:'workshop-package' });
        registered += 1;
      } catch (error) {
        try { console.warn('[星月控制中心] 角色包媒体注册跳过', name, spec.slot, error?.message || error); } catch (_) {}
      }
    }
    if (registered) { try { lib.renderDialogBubbles?.({ force: true }); } catch (_) {} }
    return { registered };
  }
  function importPackageToDraft(pkg) {
    if (!openingDraftService.status().ready) throw new Error('开局草稿仍在初始化，请稍后重试');
    pkg = validatePackage(pkg);
    const draft = readOpeningDraft();
    draft.packages = Array.isArray(draft.packages) ? draft.packages : [];
    const key = packageKey(pkg);
    draft.packages = draft.packages.filter(item => packageKey(item) !== key).concat([pkg]);
    draft.enabledPackages = (draft.enabledPackages && typeof draft.enabledPackages === 'object') ? draft.enabledPackages : {};
    if (draft.enabledPackages[key] === undefined) draft.enabledPackages[key] = false;
    if (pkg.type === 'user_identity') {
      applyUserIdentityPayload(draft, pkg.payload);
      draft.enabledPackages[key] = true;
    }
    if (pkg.type === 'world_factor') {
      draft.worldFactors = Array.isArray(draft.worldFactors) ? draft.worldFactors : [];
      draft.worldFactors = draft.worldFactors.filter(item => packageKey(item) !== key).concat([pkg]);
    }
    void registerCharacterPackageMedia(pkg);
    return openingDraftService.replaceDraft(draft, { immediate: true });
  }
  async function importPackage(pkg, options = {}) {
    pkg = validatePackage(pkg, options.allowedTypes || []);
    importPackageToDraft(pkg);
    toast('success', '已导入工坊包：' + pkg.title);
    return pkg;
  }
  async function installPackageToWorldbook(pkg, options = {}) {
    pkg = validatePackage(pkg, options.allowedTypes || []);
    const result = await installOrUpdateWorkshopPackage(pkg, options);
    if (result?.applied) toast('success', '已安装到角色卡绑定世界书：' + pkg.title);
    else if (result?.kept) toast('info', '已保留本地修改，未覆盖来源记录');
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
        packageTarget: pkg?.payload?.target || pkg.packageTarget || pkg.type,
        programOnly: pkg?.payload?.target === 'xingyue.opening_day_body' || pkg.programOnly === true,
        enabled: pkg?.payload?.target === 'xingyue.opening_day_body' ? false : true,
        revision: packageRevision(pkg),
      }));
  }
  function identityContent(draft = readOpeningDraft()) {
    if (!userIdentityDraftHasContent(draft)) return '';
    const payload = buildUserIdentityPayload(draft);
    const lines = [];
    if (payload.identity) lines.push('    - 身份: ' + payload.identity);
    if (payload.grade) lines.push('    - 年级: ' + payload.grade);
    if (payload.callname) lines.push('    - 称呼: ' + payload.callname);
    if (IDENTITY_ATTRIBUTE_KEYS.some(key => Number(payload.core_attributes[key]) !== 0)) {
      const parts = IDENTITY_ATTRIBUTE_KEYS.map(key => key + ' ' + payload.core_attributes[key]);
      lines.push('    - 核心属性: ' + parts.join(' / '));
    }
    if (payload.appearance) lines.push('    - 外貌: ' + payload.appearance);
    if (payload.skills) lines.push('    - 技能与天赋: ' + payload.skills.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join('；'));
    if (payload.background) lines.push('    - 背景: ' + payload.background);
    if (payload.media.avatar) lines.push('    - 头像: ' + payload.media.avatar);
    if (payload.media.portrait) lines.push('    - 立绘: ' + payload.media.portrait);
    return '<user_roles>\n' + lines.join('\n') + '\n</user_roles>';
  }
  function resolvePlayerAvatarSrc(rawReference = '') {
    const reference = normalizeIdentityMediaReference(rawReference)
      || normalizeIdentityMediaReference(readOpeningDraft().player_avatar);
    if (/^https?:\/\//i.test(reference)) return reference;
    try {
      const lib = mediaLibrary();
      const exact = lib?.listManagedAssets?.().find(item => String(item?.key || '') === reference);
      if (exact) return exact.dataUrl || exact.url || exact.src || '';
      const fallback = lib?.getExactAsset?.({ type:'bond', slot:'avatar', name:'{{user}}', variant:'normal' });
      return fallback?.dataUrl || fallback?.url || fallback?.src || '';
    } catch (_) { return ''; }
  }
  function openingWorldbookPayload(draft = readOpeningDraft()) {
    const authority = personaIdentityAuthority(draft);
    const identityAuthority = {
      authoritative: authority.authoritative === true,
      suppressWorldbook: authority.suppressWorldbook === true,
      reason: authority.reason || '',
      personaId: authority.snapshot?.id || '',
      fingerprint: authority.snapshot?.fingerprint || '',
      contentHash: authority.parsed?.contentHash || '',
      draftHash: authority.draftHash || '',
    };
    return {
      identity: identityAuthority.suppressWorldbook ? '' : identityContent(draft),
      identitySuppressedByPersona: identityAuthority.suppressWorldbook,
      identityAuthority,
      worldFactor: worldFactorContent(draft),
      workshopEntries: workshopWorldbookEntries(draft),
      worldbookName: null,
      applied: false,
      warning: '',
    };
  }
  function openingChatContextSnapshot() {
    const serviceStatus = openingDraftService.status();
    const context = getSillyTavernContext();
    let chatId = '';
    try { chatId = String(context?.getCurrentChatId?.() || '').trim(); } catch (_) {}
    if (!chatId) chatId = String(serviceStatus.chatId || '');
    const metadataUuid = context?.chatMetadata?.[OPENING_DRAFT_UUID_METADATA_KEY];
    const uuid = isOpeningUuid(metadataUuid)
      ? String(metadataUuid)
      : (String(serviceStatus.chatId || '') === chatId ? String(serviceStatus.uuid || '') : '');
    return { chatId, uuid };
  }
  function assertOpeningChatContext(expected, message = '聊天已切换，已取消本次开局操作') {
    if (!expected) return openingChatContextSnapshot();
    const current = openingChatContextSnapshot();
    if ((expected.chatId && current.chatId !== expected.chatId) || (expected.uuid && current.uuid && current.uuid !== expected.uuid)) {
      throw new Error(message);
    }
    return current;
  }
  function captureOpeningActionContext(root) {
    return { chat:openingChatContextSnapshot(), root };
  }
  function assertOpeningActionContext(captured, message = '聊天或开局页已切换，已取消迟到操作') {
    if (runtimeDestroyed || !captured?.root?.isConnected) throw new Error(message);
    return assertOpeningChatContext(captured.chat, message);
  }
  function dispatchOpeningWorldbookPreview(payload) {
    try {
      window.dispatchEvent(new CustomEvent('xingyue-opening-worldbook-preview', { detail: payload }));
      hostWindow().dispatchEvent(new CustomEvent('xingyue-opening-worldbook-preview', { detail: payload }));
    } catch (_) {}
  }
  // <shared-worldbook-manager-v0.4.0 source-sha256="d781c79426c9584a3b80aa579586e9dee9aae14a842638f22290cae30a6a1874">
  const SHARED_WORLDBOOK_MANAGER_SOURCE_SHA256 = 'd781c79426c9584a3b80aa579586e9dee9aae14a842638f22290cae30a6a1874';
  const sharedWorldbookManager = (() => {
    // ============ 0. 常量与映射（grounded：A3 §6.2 / §5.1 + @types.txt 权威）============

    const POSITION_NUM_TO_TYPE = Object.freeze({
      0: 'before_character_definition',
      1: 'after_character_definition',
      2: 'before_example_messages',
      3: 'after_example_messages',
      4: 'at_depth',
      5: 'before_author_note', // Top of AN
      6: 'after_author_note', // Bottom of AN
      7: 'outlet',
    });
    const ROLE_NUM_TO_STR = Object.freeze({ 0: 'system', 1: 'user', 2: 'assistant' });
    const SELECTIVE_LOGIC_NUM_TO_STR = Object.freeze({ 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' });

    function invertNumKeyed(map) {
      const out = {};
      for (const key of Object.keys(map)) out[map[key]] = Number(key);
      return out;
    }
    const POSITION_TYPE_TO_NUM = Object.freeze(invertNumKeyed(POSITION_NUM_TO_TYPE));
    const ROLE_STR_TO_NUM = Object.freeze(invertNumKeyed(ROLE_NUM_TO_STR));
    const SELECTIVE_LOGIC_STR_TO_NUM = Object.freeze(invertNumKeyed(SELECTIVE_LOGIC_NUM_TO_STR));

    const VALID_POSITION_TYPES = new Set(Object.values(POSITION_NUM_TO_TYPE));
    const VALID_SECONDARY_LOGIC = new Set(Object.values(SELECTIVE_LOGIC_NUM_TO_STR));
    const VALID_STRATEGY_TYPES = new Set(['constant', 'selective', 'vectorized']);
    const VALID_ROLES = new Set(Object.values(ROLE_NUM_TO_STR));
    const AN_POSITIONS = new Set(['before_author_note', 'after_author_note']); // V7 warn：AN 频率=0 静默跳过

    // 受管条目 kind（来源双标记 extra.kind）
    const KIND = Object.freeze({
      IDENTITY: 'identity',
      WORLD_FACTOR: 'world_factor',
      WORKSHOP_PACKAGE: 'workshop_package',
      BOUNDARY_START: 'workshop_boundary_start',
      BOUNDARY_END: 'workshop_boundary_end',
    });

    // 来源后缀（与 sourcePrefix 拼成 extra.source，内核不含任何卡名）
    const SOURCE_SUFFIX = Object.freeze({ OPENING: 'opening-wizard', WORKSHOP: 'workshop' });

    class WorldbookValidationError extends Error {
      constructor(errors) {
        super(`世界书条目校验未通过（${errors.length} 项）：` + errors.map(e => e.message).join('；'));
        this.name = 'WorldbookValidationError';
        this.errors = errors;
      }
    }

    class WorldbookRevisionConflictError extends Error {
      constructor(expectedRevision, actualRevision, worldbookName) {
        super('世界书版本冲突：保存前内容已变化，请重新载入差异后再试');
        this.name = 'WorldbookRevisionConflictError';
        this.expectedRevision = expectedRevision;
        this.actualRevision = actualRevision;
        this.worldbookName = worldbookName || '';
      }
    }

    // ============ 1. Canonical Entry（中间富表示 · 治「两套字段名」核心坑）============

    /**
     * @typedef {Object} CanonicalEntry
     * @property {string}  name           条目名（卡内 comment ⇄ 运行期 name）
     * @property {boolean} enabled        启用（卡内 !disable ⇄ 运行期 enabled）
     * @property {'constant'|'selective'|'vectorized'} strategyType
     * @property {string[]} keys          主关键字
     * @property {string[]} secondaryKeys 次级关键字
     * @property {'and_any'|'and_all'|'not_all'|'not_any'} secondaryLogic
     * @property {boolean} selective      是否启用次级逻辑
     * @property {'same_as_global'|number} scanDepth
     * @property {null|boolean} caseSensitive
     * @property {null|boolean} matchWholeWords  null=继承全局（中文 key 必须显式 false，见 V3）
     * @property {string}  positionType   8 串之一
     * @property {'system'|'user'|'assistant'} role  仅 at_depth 有效
     * @property {number}  depth          仅 at_depth 有效
     * @property {number}  order
     * @property {string}  content
     * @property {number}  probability
     * @property {string}  group          Inclusion Group 标签
     * @property {boolean} groupOverride
     * @property {number}  groupWeight
     * @property {boolean} useGroupScoring
     * @property {null|number} sticky
     * @property {null|number} cooldown
     * @property {null|number} delay
     * @property {{prevent_incoming:boolean,prevent_outgoing:boolean,delay_until:null|number}} recursion
     * @property {boolean} vectorized
     * @property {Object}  meta           source/kind/packageId/packageType/revision/installedAt/version 等
     * @property {number=} uid            保留旧 uid（preserveUid 用）
     */

    function makeCanonical(overrides = {}) {
      return {
        name: '',
        enabled: true,
        strategyType: 'constant',
        keys: [],
        secondaryKeys: [],
        secondaryLogic: 'and_any',
        selective: false,
        scanDepth: 'same_as_global',
        caseSensitive: null,
        matchWholeWords: null,
        positionType: 'before_character_definition',
        role: 'system',
        depth: 4,
        order: 100,
        content: '',
        probability: 100,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        useGroupScoring: false,
        sticky: null,
        cooldown: null,
        delay: null,
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        vectorized: false,
        meta: {},
        ...overrides,
      };
    }

    // ---- runtimeAdapter：Canonical ⇄ 运行期新 API WorldbookEntry（有损子集：无 group/mww）----
    const runtimeAdapter = {
      toRuntime(c) {
        const entry = {
          name: c.name,
          enabled: c.enabled,
          strategy: {
            type: c.strategyType,
            keys: [...c.keys],
            keys_secondary: { logic: c.secondaryLogic, keys: [...c.secondaryKeys] },
            scan_depth: c.scanDepth,
          },
          position: { type: c.positionType, role: c.role, depth: c.depth, order: c.order },
          content: c.content,
          probability: c.probability,
          recursion: { ...c.recursion },
          effect: { sticky: c.sticky, cooldown: c.cooldown, delay: c.delay },
          extra: { ...c.meta },
        };
        if (c.uid != null) entry.uid = c.uid;
        return entry;
      },
      fromRuntime(e) {
        const pos = e.position || {};
        const strat = e.strategy || {};
        const ks = strat.keys_secondary || {};
        const eff = e.effect || {};
        return makeCanonical({
          name: e.name || '',
          enabled: e.enabled !== false,
          strategyType: VALID_STRATEGY_TYPES.has(strat.type) ? strat.type : 'constant',
          keys: Array.isArray(strat.keys) ? [...strat.keys] : [],
          secondaryKeys: Array.isArray(ks.keys) ? [...ks.keys] : [],
          secondaryLogic: VALID_SECONDARY_LOGIC.has(ks.logic) ? ks.logic : 'and_any',
          selective: strat.type === 'selective',
          scanDepth: strat.scan_depth ?? 'same_as_global',
          positionType: VALID_POSITION_TYPES.has(pos.type) ? pos.type : 'before_character_definition',
          role: VALID_ROLES.has(pos.role) ? pos.role : 'system',
          depth: typeof pos.depth === 'number' ? pos.depth : 4,
          order: typeof pos.order === 'number' ? pos.order : 100,
          content: e.content || '',
          probability: typeof e.probability === 'number' ? e.probability : 100,
          recursion: {
            prevent_incoming: Boolean(e.recursion?.prevent_incoming),
            prevent_outgoing: Boolean(e.recursion?.prevent_outgoing),
            delay_until: e.recursion?.delay_until ?? null,
          },
          sticky: eff.sticky ?? null,
          cooldown: eff.cooldown ?? null,
          delay: eff.delay ?? null,
          meta: { ...(e.extra || {}) },
          ...(e.uid != null ? { uid: e.uid } : {}),
        });
      },
    };

    // ---- cardAdapter：Canonical ⇄ 卡内 v2 JSON（富格式 · group/mww 全在 extensions）----
    const cardAdapter = {
      toCanonical(entry) {
        const ext = entry.extensions || {};
        const posNum = typeof ext.position === 'number' ? ext.position : 1;
        return makeCanonical({
          name: entry.comment || '',
          enabled: entry.disable !== true && entry.enabled !== false,
          strategyType: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective',
          keys: normKeys(entry.key ?? entry.keys),
          secondaryKeys: normKeys(entry.keysecondary ?? entry.secondary_keys),
          secondaryLogic: SELECTIVE_LOGIC_NUM_TO_STR[Number(entry.selectiveLogic ?? 0)] || 'and_any',
          selective: Boolean(entry.selective),
          scanDepth: entry.scanDepth ?? ext.scan_depth ?? 'same_as_global',
          caseSensitive: entry.caseSensitive ?? ext.case_sensitive ?? null,
          matchWholeWords: entry.matchWholeWords ?? ext.match_whole_words ?? null,
          positionType: POSITION_NUM_TO_TYPE[posNum] || 'after_character_definition',
          role: ROLE_NUM_TO_STR[Number(ext.role) || 0] || 'system',
          depth: typeof ext.depth === 'number' ? ext.depth : 4,
          order: typeof entry.order === 'number' ? entry.order : 100,
          content: entry.content || '',
          probability: typeof entry.probability === 'number' ? entry.probability : 100,
          group: entry.group ?? ext.group ?? '',
          groupOverride: Boolean(entry.groupOverride ?? ext.group_override),
          groupWeight: typeof (entry.groupWeight ?? ext.group_weight) === 'number' ? (entry.groupWeight ?? ext.group_weight) : 100,
          useGroupScoring: Boolean(entry.useGroupScoring ?? ext.use_group_scoring),
          sticky: entry.sticky ?? null,
          cooldown: entry.cooldown ?? null,
          delay: entry.delay ?? null,
          vectorized: Boolean(entry.vectorized),
          meta: { ...(ext.worldbookManager || {}) },
          ...(entry.uid != null ? { uid: entry.uid } : {}),
        });
      },
      fromCanonical(c) {
        const entry = {
          comment: c.name,
          key: [...c.keys],
          keysecondary: [...c.secondaryKeys],
          selective: c.selective,
          selectiveLogic: SELECTIVE_LOGIC_STR_TO_NUM[c.secondaryLogic] ?? 0,
          content: c.content,
          constant: c.strategyType === 'constant',
          vectorized: c.strategyType === 'vectorized',
          disable: !c.enabled,
          order: c.order,
          group: c.group,
          groupOverride: c.groupOverride,
          groupWeight: c.groupWeight,
          useGroupScoring: c.useGroupScoring,
          probability: c.probability,
          sticky: c.sticky ?? null,
          cooldown: c.cooldown ?? null,
          delay: c.delay ?? null,
          extensions: {
            position: POSITION_TYPE_TO_NUM[c.positionType] ?? 1,
            depth: c.depth,
            role: ROLE_STR_TO_NUM[c.role] ?? 0,
            group: c.group,
            group_override: c.groupOverride,
            group_weight: c.groupWeight,
            use_group_scoring: c.useGroupScoring,
            case_sensitive: c.caseSensitive,
            match_whole_words: c.matchWholeWords,
            worldbookManager: { ...c.meta },
          },
        };
        if (c.uid != null) entry.uid = c.uid;
        return entry;
      },
    };

    function normKeys(value) {
      if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
      if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
      return [];
    }

    // ============ 2. 校验器 V1-V7（写前闸门 · 违一即 reject，V7 仅 warn）============

    function validateCanonical(entries, options = {}) {
      const errors = [];
      const warnings = [];
      const seenNames = new Map();
      const list = Array.isArray(entries) ? entries : [];

      for (const c of list) {
        const tag = c?.name ? `「${c.name}」` : '(无名条目)';

        // V1：position.type 只许合法枚举串
        if (!VALID_POSITION_TYPES.has(c.positionType)) {
          errors.push({ rule: 'V1', message: `${tag} position.type 非法：${c.positionType}` });
        }
        // V2：卡内 extensions.position 必须落在 0-7（经映射等价于 positionType 合法）
        if (POSITION_TYPE_TO_NUM[c.positionType] == null) {
          errors.push({ rule: 'V2', message: `${tag} position 越界（须 0-7）` });
        }
        // V3：中文 key 的选择性条目，matchWholeWords 必须显式 false（null=继承全局 ON → 中文永远匹配不上）
        //     仅对选择性(绿灯/向量)且含 CJK key 的条目生效；constant(蓝灯)无 key 扫描不受影响
        if (c.strategyType !== 'constant' && hasCjkKey(c.keys) && c.matchWholeWords !== false) {
          const finding = { rule: 'V3', message: `${tag} 含中文 key 但 matchWholeWords 未显式 false（当前=${String(c.matchWholeWords)}），中文将匹配不上` };
          // Tavern Helper 的运行期 WorldbookEntry 不暴露 matchWholeWords；运行期编辑不能把
          // “API 没给这个字段”误判成脏数据。卡包/导入面仍维持硬错误，运行期只保留能力告警。
          if (options.surface === 'runtime') warnings.push(finding);
          else errors.push(finding);
        }
        // V6：at_depth 时 depth 必须为非负整数
        if (c.positionType === 'at_depth' && !(Number.isInteger(c.depth) && c.depth >= 0)) {
          errors.push({ rule: 'V6', message: `${tag} position=at_depth 但 depth 非非负整数：${c.depth}` });
        }
        // V5：普通条目按 name、managed 工坊包按三元组检查批次内重复；name 不再充当运行期主键。
        const meta = c && c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta) ? c.meta : {};
        const managedIdentity = meta.kind === KIND.WORKSHOP_PACKAGE
          ? [meta.source, meta.kind, meta.packageId, meta.packageType, meta.packageTarget].map(value => String(value || '')).join('|')
          : (meta.source && meta.kind ? [meta.source, meta.kind].join('|') : String(c.name || ''));
        if (managedIdentity) {
          if (seenNames.has(managedIdentity)) errors.push({ rule: 'V5', message: `${tag} 业务主键在本批次内重复` });
          else seenNames.set(managedIdentity, true);
        }
        // V8：受管元数据固定校验；program-only 条目必须禁用且递归双禁。
        ['source','kind','packageId','packageType','packageTarget'].forEach(key => {
          if (meta[key] !== undefined && (typeof meta[key] !== 'string' || !meta[key].trim())) {
            errors.push({ rule: 'V8', message: `${tag} extra.${key} 必须是非空字符串` });
          }
        });
        if (meta.kind === KIND.WORKSHOP_PACKAGE) {
          ['source','packageId','packageType','packageTarget'].forEach(key => {
            if (typeof meta[key] !== 'string' || !meta[key].trim()) errors.push({ rule: 'V8', message: `${tag} 工坊条目缺少 extra.${key}` });
          });
        }
        if (meta.programOnly !== undefined && typeof meta.programOnly !== 'boolean') {
          errors.push({ rule: 'V8', message: `${tag} extra.programOnly 必须是 boolean` });
        }
        if (meta.programOnly === true) {
          ['source','kind','packageId','packageType','packageTarget'].forEach(key => {
            if (typeof meta[key] !== 'string' || !meta[key].trim()) errors.push({ rule: 'V9', message: `${tag} programOnly 条目缺少 extra.${key}` });
          });
          if (meta.kind !== KIND.WORKSHOP_PACKAGE) errors.push({ rule: 'V9', message: `${tag} programOnly 条目 kind 必须是 ${KIND.WORKSHOP_PACKAGE}` });
          if (c.strategyType !== 'constant') errors.push({ rule: 'V9', message: `${tag} programOnly 条目 strategy 必须是 constant` });
          if (c.enabled !== false || c.recursion?.prevent_incoming !== true || c.recursion?.prevent_outgoing !== true || c.recursion?.delay_until !== null) {
            errors.push({ rule: 'V9', message: `${tag} programOnly 条目必须 enabled=false 且递归双禁` });
          }
          if (!/^[a-f0-9]{64}$/.test(String(meta.contentHash || ''))) errors.push({ rule: 'V9', message: `${tag} programOnly 条目 contentHash 必须是 64 位小写 SHA-256` });
          if (meta.revision === undefined || meta.revision === null || !String(meta.revision).trim()) errors.push({ rule: 'V9', message: `${tag} programOnly 条目缺少 extra.revision` });
          if (typeof meta.installedAt !== 'string' || !meta.installedAt.trim() || Number.isNaN(Date.parse(meta.installedAt))) errors.push({ rule: 'V9', message: `${tag} programOnly 条目 installedAt 必须是合法时间` });
        }
        // V7（warn）：Top/Bottom of AN 在 AN 频率=0 时被静默跳过
        if (AN_POSITIONS.has(c.positionType)) {
          warnings.push({ rule: 'V7', message: `${tag} 位于 ${c.positionType}(AN)，AN 频率=0 时将被静默跳过、不注入 prompt` });
        }
      }
      return { ok: errors.length === 0, errors, warnings };
    }

    function hasCjkKey(keys) {
      return (keys || []).some(k => /[一-鿿぀-ヿ]/.test(String(k)));
    }

    function stableNormalize(value) {
      if (value instanceof RegExp) return { source: value.source, flags: value.flags };
      if (Array.isArray(value)) return value.map(item => item === undefined ? null : stableNormalize(item));
      if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key] = stableNormalize(value[key]); });
        return out;
      }
      return value;
    }
    function stableStringify(value) { return JSON.stringify(stableNormalize(value)); }
    function worldbookSha256Hex(value) {
      let bytes;
      if (typeof TextEncoder === 'function') bytes = new TextEncoder().encode(String(value));
      else {
        const encoded = unescape(encodeURIComponent(String(value)));
        bytes = Uint8Array.from(encoded, char => char.charCodeAt(0));
      }
      const bitLength = bytes.length * 8;
      const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
      const padded = new Uint8Array(paddedLength);
      padded.set(bytes); padded[bytes.length] = 0x80;
      const view = new DataView(padded.buffer);
      view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
      view.setUint32(paddedLength - 4, bitLength >>> 0, false);
      const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
      const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
      const words = new Uint32Array(64);
      const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));
      for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
        for (let i = 16; i < 64; i += 1) {
          const a = words[i - 15], b = words[i - 2];
          words[i] = (words[i - 16] + (rotate(a,7)^rotate(a,18)^(a>>>3)) + words[i - 7] + (rotate(b,17)^rotate(b,19)^(b>>>10))) >>> 0;
        }
        let [a,b,c,d,e,f,g,h] = state;
        for (let i = 0; i < 64; i += 1) {
          const t1 = (h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + constants[i] + words[i]) >>> 0;
          const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
          h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
        }
        state[0]=(state[0]+a)>>>0;state[1]=(state[1]+b)>>>0;state[2]=(state[2]+c)>>>0;state[3]=(state[3]+d)>>>0;
        state[4]=(state[4]+e)>>>0;state[5]=(state[5]+f)>>>0;state[6]=(state[6]+g)>>>0;state[7]=(state[7]+h)>>>0;
      }
      return state.map(word => word.toString(16).padStart(8,'0')).join('');
    }
    function worldbookRevision(entries) { return 'wb1:' + worldbookSha256Hex(stableStringify(Array.isArray(entries) ? entries : [])); }
    function worldbookContentHash(content) { return worldbookSha256Hex(String(content || '')); }

    function mergeRuntimeEntry(previous, updated) {
      if (!previous) return cloneSnapshotValue(updated);
      const next = { ...cloneSnapshotValue(previous), ...cloneSnapshotValue(updated) };
      ['strategy','position','recursion','effect','extra'].forEach(key => {
        const before = previous?.[key];
        const after = updated?.[key];
        if (before && typeof before === 'object' && !Array.isArray(before) && after && typeof after === 'object' && !Array.isArray(after)) {
          next[key] = { ...cloneSnapshotValue(before), ...cloneSnapshotValue(after) };
        }
      });
      if (previous?.strategy?.keys_secondary && updated?.strategy?.keys_secondary) {
        next.strategy.keys_secondary = {
          ...cloneSnapshotValue(previous.strategy.keys_secondary),
          ...cloneSnapshotValue(updated.strategy.keys_secondary),
        };
      }
      return next;
    }

    class WorldbookSnapshotError extends Error {
      constructor(message, cause = null) {
        super(message);
        this.name = 'WorldbookSnapshotError';
        this.cause = cause || undefined;
      }
    }

    function cloneSnapshotValue(value) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch (_) { /* fall through */ }
      }
      if (value instanceof RegExp) return new RegExp(value.source, value.flags);
      if (Array.isArray(value)) return value.map(cloneSnapshotValue);
      if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach(key => { out[key] = cloneSnapshotValue(value[key]); });
        return out;
      }
      return value;
    }

    function snapshotChecksum(record) {
      return worldbookSha256Hex(stableStringify({
        schema: record.schema,
        id: record.id,
        worldbookName: record.worldbookName,
        createdAt: record.createdAt,
        createdAtMs: record.createdAtMs,
        reason: record.reason,
        beforeRevision: record.beforeRevision,
        entries: record.entries,
      }));
    }

    function createWorldbookSnapshotStore(config = {}) {
      const indexedDb = config.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);
      const localStore = config.localStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
      const maxPerWorldbook = Math.max(1, Number(config.maxPerWorldbook) || 10);
      const now = config.now || (() => new Date().toISOString());
      const randomUUID = config.randomUUID || (() => {
        try { return crypto.randomUUID(); } catch (_) { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
      });
      const dbName = config.dbName || 'worldbook-manager-snapshots-v1';
      const objectStoreName = config.objectStoreName || 'snapshots';
      const metadataStoreName = config.metadataStoreName || 'snapshot_metadata';
      const fallbackKey = config.fallbackKey || 'worldbook-manager:snapshot:fallback:v1';
      const openTimeoutMs = Math.max(250, Number(config.openTimeoutMs) || 1500);
      let idbDisabled = !indexedDb;
      let dbPromise = null;
      let activeBackend = idbDisabled ? 'localStorage' : 'indexedDB';

      function requestResult(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
      }
      function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
          transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
        });
      }
      function openDatabase() {
        if (idbDisabled) return Promise.reject(new Error('IndexedDB unavailable'));
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('IndexedDB open timeout')), openTimeoutMs);
          let request;
          try { request = indexedDb.open(dbName, 2); } catch (error) { clearTimeout(timer); reject(error); return; }
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(objectStoreName)) db.createObjectStore(objectStoreName, { keyPath: 'id' });
            const metadata = db.objectStoreNames.contains(metadataStoreName)
              ? request.transaction.objectStore(metadataStoreName)
              : db.createObjectStore(metadataStoreName, { keyPath:'id' });
            if (!metadata.indexNames.contains('worldbookName')) metadata.createIndex('worldbookName', 'worldbookName', { unique:false });
          };
          request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
          request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('IndexedDB open failed')); };
          request.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB open blocked')); };
        }).catch(error => { dbPromise = null; throw error; });
        return dbPromise;
      }
      function stringifySnapshot(record) {
        return JSON.stringify(record, (_key, value) => value instanceof RegExp
          ? { __worldbookManagerRegExpV1: true, source: value.source, flags: value.flags }
          : value);
      }
      function parseSnapshot(text) {
        return JSON.parse(text, (_key, value) => value?.__worldbookManagerRegExpV1 === true
          ? new RegExp(value.source, value.flags)
          : value);
      }
      function assertSnapshot(record, expectedWorldbookName = '') {
        if (!record || record.schema !== 'worldbook-snapshot-v1' || !Array.isArray(record.entries)) throw new WorldbookSnapshotError('快照格式无效');
        if (expectedWorldbookName && record.worldbookName !== expectedWorldbookName) throw new WorldbookSnapshotError('快照不属于当前世界书');
        if (record.entriesRevision !== worldbookRevision(record.entries)) throw new WorldbookSnapshotError('快照条目 revision 校验失败');
        if (record.checksum !== snapshotChecksum(record)) throw new WorldbookSnapshotError('快照 checksum 校验失败');
        return record;
      }
      function snapshotMetadata(record) {
        return {
          schema:record.schema, id:record.id, worldbookName:record.worldbookName,
          createdAt:record.createdAt, createdAtMs:record.createdAtMs, reason:record.reason,
          beforeRevision:record.beforeRevision, entriesRevision:record.entriesRevision,
          entryCount:Array.isArray(record.entries) ? record.entries.length : Number(record.entryCount) || 0,
          checksum:record.checksum, managerVersion:record.managerVersion,
        };
      }
      function assertSnapshotMetadata(record, expectedWorldbookName = '') {
        if (!record || record.schema !== 'worldbook-snapshot-v1' || !record.id || !/^[a-f0-9]{64}$/.test(String(record.checksum || ''))) throw new WorldbookSnapshotError('快照元数据无效');
        if (expectedWorldbookName && record.worldbookName !== expectedWorldbookName) throw new WorldbookSnapshotError('快照不属于当前世界书');
        return record;
      }
      async function saveToIndexedDb(record) {
        const db = await openDatabase();
        const transaction = db.transaction([objectStoreName, metadataStoreName], 'readwrite');
        const done = transactionDone(transaction);
        const store = transaction.objectStore(objectStoreName);
        const metadata = transaction.objectStore(metadataStoreName);
        await requestResult(store.put(record));
        await requestResult(metadata.put(snapshotMetadata(record)));
        const sameBook = (await requestResult(metadata.index('worldbookName').getAll(record.worldbookName))).sort((a, b) => b.createdAtMs - a.createdAtMs || String(b.id).localeCompare(String(a.id)));
        for (const stale of sameBook.slice(maxPerWorldbook)) { store.delete(stale.id); metadata.delete(stale.id); }
        await done;
      }
      function readFallback() {
        if (!localStore) return null;
        const raw = localStore.getItem(fallbackKey);
        return raw ? parseSnapshot(raw) : null;
      }
      function saveFallback(record) {
        if (!localStore) throw new Error('localStorage unavailable');
        localStore.setItem(fallbackKey, stringifySnapshot(record));
      }
      async function save({ worldbookName, entries, reason = 'before-save' } = {}) {
        if (!worldbookName || !Array.isArray(entries)) throw new WorldbookSnapshotError('保存快照需要 worldbookName 与完整 entries');
        const createdAt = now();
        const record = {
          schema: 'worldbook-snapshot-v1',
          id: randomUUID(),
          worldbookName,
          createdAt,
          createdAtMs: Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : Date.now(),
          reason,
          beforeRevision: worldbookRevision(entries),
          entriesRevision: worldbookRevision(entries),
          entries: cloneSnapshotValue(entries),
          checksum: '',
          managerVersion: '0.3.0',
        };
        record.checksum = snapshotChecksum(record);
        if (!idbDisabled) {
          try { await saveToIndexedDb(record); activeBackend = 'indexedDB'; return cloneSnapshotValue(record); }
          catch (_) { idbDisabled = true; activeBackend = 'localStorage'; }
        }
        try { saveFallback(record); return cloneSnapshotValue(record); }
        catch (error) { throw new WorldbookSnapshotError('无法建立强制世界书备份，已中止写入', error); }
      }
      async function list(worldbookName) {
        if (!worldbookName) return [];
        if (!idbDisabled) {
          let merged = null;
          try {
            const db = await openDatabase();
            const transaction = db.transaction(metadataStoreName, 'readonly');
            const done = transactionDone(transaction);
            const all = await requestResult(transaction.objectStore(metadataStoreName).index('worldbookName').getAll(worldbookName));
            await done;
            activeBackend = 'indexedDB';
            merged = all.map(item => cloneSnapshotValue(assertSnapshotMetadata(item, worldbookName)));
          } catch (_) { idbDisabled = true; activeBackend = 'localStorage'; }
          if (merged) {
            let fallback = null;
            try { fallback = readFallback(); } catch (_) { fallback = null; }
            if (fallback && fallback.worldbookName === worldbookName && !merged.some(item => item.id === fallback.id)) {
              try {
                merged.push(snapshotMetadata(assertSnapshot(fallback, worldbookName)));
                activeBackend = 'indexedDB+localStorage';
              } catch (_) { /* 损坏的降级快照不得拖垮正常 IndexedDB 列表。 */ }
            }
            return merged.sort((a, b) => b.createdAtMs - a.createdAtMs || String(b.id).localeCompare(String(a.id))).slice(0, maxPerWorldbook);
          }
        }
        try {
          const item = readFallback();
          return item && item.worldbookName === worldbookName ? [cloneSnapshotValue(assertSnapshot(item, worldbookName))] : [];
        } catch (error) { throw new WorldbookSnapshotError('读取世界书快照失败', error); }
      }
      async function get(id, worldbookName = '') {
        if (!id) throw new WorldbookSnapshotError('缺少 snapshot id');
        if (!idbDisabled) {
          try {
            const db = await openDatabase();
            const transaction = db.transaction(objectStoreName, 'readonly');
            const done = transactionDone(transaction);
            const item = await requestResult(transaction.objectStore(objectStoreName).get(id));
            await done;
            if (item) return cloneSnapshotValue(assertSnapshot(item, worldbookName));
          } catch (_) { idbDisabled = true; activeBackend = 'localStorage'; }
        }
        const item = readFallback();
        if (!item || item.id !== id) throw new WorldbookSnapshotError('未找到指定世界书快照');
        return cloneSnapshotValue(assertSnapshot(item, worldbookName));
      }
      return { save, list, get, backend: () => activeBackend, maxPerWorldbook };
    }
    function entryUid(entry) { return Number.isInteger(entry?.uid) && entry.uid >= 0 ? entry.uid : null; }
    function entryMeta(entry) { return entry?.extra || entry?.meta || {}; }
    function managedEntryKey(entry) {
      const meta = entryMeta(entry);
      if (!meta.source || !meta.kind) return '';
      if (meta.kind === KIND.WORKSHOP_PACKAGE) return ['package',meta.source,meta.kind,meta.packageId,meta.packageType,meta.packageTarget].map(v => String(v || '')).join('|');
      return ['managed',meta.source,meta.kind].join('|');
    }
    function diffValue(before, after, path, changes) {
      if (stableStringify(before) === stableStringify(after)) return;
      const beforeObject = before && typeof before === 'object' && !Array.isArray(before);
      const afterObject = after && typeof after === 'object' && !Array.isArray(after);
      if (beforeObject && afterObject) {
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        [...keys].sort().forEach(key => diffValue(before[key], after[key], path + '/' + String(key).replace(/~/g,'~0').replace(/\//g,'~1'), changes));
        return;
      }
      changes.push({ path: path || '/', before, after });
    }
    function diffWorldbookEntries({ before = [], after = [], draft } = {}) {
      if (draft !== undefined) after = draft;
      const oldList = Array.isArray(before) ? before : [];
      const newList = Array.isArray(after) ? after : [];
      const oldByUid = new Map(oldList.filter(e => entryUid(e) !== null).map(e => [entryUid(e), e]));
      const newByUid = new Map(newList.filter(e => entryUid(e) !== null).map(e => [entryUid(e), e]));
      const added = [], deleted = [], updated = [], moved = []; let unchanged = 0;
      oldByUid.forEach((entry, uid) => { if (!newByUid.has(uid)) deleted.push({ uid, entry }); });
      newList.forEach(entry => {
        const uid = entryUid(entry);
        if (uid === null || !oldByUid.has(uid)) { added.push({ uid, entry }); return; }
        const previous = oldByUid.get(uid);
        const changes = []; diffValue(previous, entry, '', changes);
        if (changes.length) updated.push({ uid, nameBefore: previous.name || previous.comment || '', nameAfter: entry.name || entry.comment || '', changes, before: previous, after: entry });
        else unchanged += 1;
      });
      const commonOld = oldList.map(entryUid).filter(uid => uid !== null && newByUid.has(uid));
      const commonNew = newList.map(entryUid).filter(uid => uid !== null && oldByUid.has(uid));
      const oldRank = new Map(commonOld.map((uid, index) => [uid, index]));
      commonNew.forEach((uid, index) => {
        if (oldRank.get(uid) !== index) moved.push({ uid, fromIndex:oldList.findIndex(entry => entryUid(entry) === uid), toIndex:newList.findIndex(entry => entryUid(entry) === uid) });
      });
      return { added, deleted, updated, moved, unchanged, summary: { added: added.length, deleted: deleted.length, updated: updated.length, moved: moved.length, unchanged } };
    }
    function previewActivation(entries = [], context = {}) {
      const initialText = String(context.text || '');
      const maxDepth = Math.max(0, Math.min(16, Number.isInteger(context.maxRecursionDepth) ? context.maxRecursionDepth : 4));
      const active = [], inactive = [], indeterminate = [], pending = [];
      const matches = (key, text, caseSensitive, wholeWords) => {
        if (key instanceof RegExp) {
          try { return new RegExp(key.source, key.flags.replace(/[gy]/g, '')).test(text); } catch (_) { return false; }
        }
        const needle = String(key || '');
        if (!needle) return false;
        if (!wholeWords) return caseSensitive ? text.includes(needle) : text.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
        const haystack = caseSensitive ? text : text.toLocaleLowerCase();
        const token = caseSensitive ? needle : needle.toLocaleLowerCase();
        const isWord = char => Boolean(char) && /[0-9A-Za-z_]/.test(char);
        let offset = 0;
        while (offset <= haystack.length) {
          const index = haystack.indexOf(token, offset);
          if (index < 0) return false;
          if (!isWord(haystack[index - 1]) && !isWord(haystack[index + token.length])) return true;
          offset = index + Math.max(1, token.length);
        }
        return false;
      };
      const eligibleIn = (c, text) => {
        if (c.strategyType === 'constant') return true;
        if (c.strategyType !== 'selective') return false;
        const primary = (c.keys || []).some(key => matches(key, text, c.caseSensitive === true, c.matchWholeWords === true));
        const secondary = (c.secondaryKeys || []).map(key => matches(key, text, c.caseSensitive === true, c.matchWholeWords === true));
        const logic = c.secondaryLogic || 'and_any';
        const secondaryOk = !secondary.length || (logic === 'and_any' ? secondary.some(Boolean) : logic === 'and_all' ? secondary.every(Boolean) : logic === 'not_any' ? secondary.every(value => !value) : !secondary.every(Boolean));
        return primary && secondaryOk;
      };
      (Array.isArray(entries) ? entries : []).forEach((raw, index) => {
        const c = raw?.strategyType ? raw : runtimeAdapter.fromRuntime(raw || {});
        const item = { entry:c, uid:entryUid(c), name:c.name, reason:'', depth:null, inputIndex:index };
        if (c.meta?.programOnly === true) { item.reason='program_only'; inactive.push(item); return; }
        if (c.enabled === false) { item.reason='disabled'; inactive.push(item); return; }
        if (c.strategyType === 'vectorized') { item.reason='vectorized_requires_st'; indeterminate.push(item); return; }
        if (Number(c.probability) <= 0) { item.reason='probability_zero'; inactive.push(item); return; }
        pending.push({ c, item, index, done:false });
      });
      let scanText = initialText;
      for (let depth = 0; depth <= maxDepth; depth += 1) {
        let propagated = '';
        pending.forEach(candidate => {
          if (candidate.done) return;
          const delay = Number.isInteger(candidate.c.recursion?.delay_until) ? candidate.c.recursion.delay_until : 0;
          if (depth < delay) return;
          const basis = depth > 0 && candidate.c.recursion?.prevent_incoming === true ? initialText : scanText;
          if (!eligibleIn(candidate.c, basis)) return;
          candidate.done = true;
          candidate.item.depth = depth;
          if (Number(candidate.c.probability) < 100) { candidate.item.reason='probabilistic'; indeterminate.push(candidate.item); return; }
          candidate.item.reason = depth === 0 ? 'eligible' : 'eligible_recursive';
          active.push(candidate.item);
          if (candidate.c.recursion?.prevent_outgoing !== true && String(candidate.c.content || '').trim()) propagated += '\n' + candidate.c.content;
        });
        if (propagated) scanText += propagated;
        const waitingForDelay = pending.some(candidate => !candidate.done && Number.isInteger(candidate.c.recursion?.delay_until) && candidate.c.recursion.delay_until > depth && candidate.c.recursion.delay_until <= maxDepth);
        if (!propagated && !waitingForDelay) break;
      }
      pending.filter(candidate => !candidate.done).forEach(candidate => {
        const delay = Number.isInteger(candidate.c.recursion?.delay_until) ? candidate.c.recursion.delay_until : 0;
        candidate.item.reason = delay > maxDepth ? 'recursion_delay' : 'keys_not_matched';
        inactive.push(candidate.item);
      });
      const byInputOrder = (a, b) => a.inputIndex - b.inputIndex;
      active.sort(byInputOrder); inactive.sort(byInputOrder); indeterminate.sort(byInputOrder);
      return { active, inactive, indeterminate, approximate:true, maxRecursionDepth:maxDepth };
    }

    // ============ 3. 受管判定 / upsert 幂等 / scope 三态 / 边界块整替 ============
    //   （提取自雏形 isOpeningManagedEntry/isWorkshopManagedEntry/upsertEntries，去硬编码为 sourcePrefix）

    function makeSourceTags(sourcePrefix) {
      return {
        opening: `${sourcePrefix}-${SOURCE_SUFFIX.OPENING}`,
        workshop: `${sourcePrefix}-${SOURCE_SUFFIX.WORKSHOP}`,
      };
    }

    function isOpeningManaged(entry, tags, scheme) {
      const src = entry?.extra?.source ?? entry?.meta?.source;
      const kind = entry?.extra?.kind ?? entry?.meta?.kind;
      const name = entry?.name;
      return src === tags.opening && (name === scheme.identity || name === scheme.worldFactor || kind === KIND.IDENTITY || kind === KIND.WORLD_FACTOR);
    }

    function isWorkshopManaged(entry, tags, scheme = {}) {
      const src = entry?.extra?.source ?? entry?.meta?.source;
      const kind = entry?.extra?.kind ?? entry?.meta?.kind;
      if (src === tags.workshop) {
        if ([KIND.WORKSHOP_PACKAGE, KIND.BOUNDARY_START, KIND.BOUNDARY_END].includes(kind)) return true;
        if (!kind && (entry?.name === scheme.workshopStart || entry?.name === scheme.workshopEnd)) return true;
        if (!kind && entry?.extra?.packageId && entry?.extra?.packageType) return true;
        return false;
      }
      return src === tags.opening && kind === KIND.WORKSHOP_PACKAGE;
    }

    /**
     * upsert：分拣三类（受 opening 管理 / 受 workshop 管理 / 非受管），preserveUid，按 scope 决定重建哪类。
     * 运行期新 API 无 group → 工坊覆盖用「边界块整替」（boundary 对包裹），雏形已验证。
     * @param existing  现有运行期 entry 数组
     * @param finalOpening   本次要落的 opening 运行期 entry（scope!=workshop 时）
     * @param finalWorkshop  本次要落的 workshop 运行期 entry（scope!=identity 时）
     */
    function upsertRuntime(existing, finalOpening, finalWorkshop, ctx) {
      const { tags, scheme, boundaryStart, boundaryEnd } = ctx;
      const cur = Array.isArray(existing) ? existing : [];
      const preservedByName = new Map();
      for (const e of cur) {
        if (isOpeningManaged(e, tags, scheme) || isWorkshopManaged(e, tags, scheme)) preservedByName.set(e.name, e);
      }
      const preserveUid = e => {
        const prev = preservedByName.get(e.name);
        return prev?.uid != null ? { ...e, uid: prev.uid } : e;
      };
      const base = cur.filter(e => !isOpeningManaged(e, tags, scheme) && !isWorkshopManaged(e, tags, scheme));
      const workshopBlock = finalWorkshop.length
        ? [boundaryStart, ...finalWorkshop, boundaryEnd].map(preserveUid)
        : [];
      return [...base, ...finalOpening.map(preserveUid), ...workshopBlock];
    }

    // ============ 4. createWorldbookManager 工厂（可移植内核 · 卡配置注入）============

    /**
     * @param {Object} config
     * @param {RegExp[]} config.nameMatchers   卡名匹配候选正则（按优先级），解析绑定世界书名用
     * @param {string}   config.sourcePrefix   来源命名空间前缀（如 'xingyue' / 'crossed'），内核拼 `${prefix}-*`
     * @param {Object}   config.entryNameScheme {identity, worldFactor, workshopStart, workshopEnd}
     * @param {Object=}  config.registry       type 注册表实例（getPositionDefaults/getLabel/validate），可选
     * @param {Object=}  config.tavernHelper   运行期 TH（含 updateWorldbookWith + getCharWorldbookNames/getWorldbookNames）；无则降级 dry-run
     * @param {string=}  config.version        写入 extra.version（调用方从 manifest 取）
     * @param {Function=} config.now           时间戳工厂（默认 () => new Date().toISOString()），便于测试注入
     * @param {EventTarget=} config.eventTarget 预览事件派发目标（默认 globalThis）
     * @param {Object=} config.programOnlyPolicy 卡级 program-only 策略：detect(item) 与 validate(canonical)
     * @param {Object=} config.snapshotStore   createWorldbookSnapshotStore() 或同构实现
     * @param {boolean=} config.snapshotRequired 非空事务是否强制先建立完整原始快照
     * @param {Function=} config.protectedEntryClassifier 可信卡级分类器：(uid) => core|variable|''，可返回 Promise
     */
    function createWorldbookManager(config = {}) {
      const {
        nameMatchers = [],
        sourcePrefix,
        entryNameScheme,
        registry = null,
        tavernHelper = null,
        version = '0.0.0',
        now = () => new Date().toISOString(),
        eventTarget = typeof globalThis !== 'undefined' ? globalThis : null,
        programOnlyPolicy = null,
        snapshotStore = null,
        snapshotRequired = false,
        protectedEntryClassifier = null,
        restorePlanTtlMs = 5 * 60 * 1000,
        editorPlanTtlMs = 10 * 60 * 1000,
      } = config;

      if (!sourcePrefix) throw new Error('createWorldbookManager: 缺少 sourcePrefix');
      if (!entryNameScheme || !entryNameScheme.identity) throw new Error('createWorldbookManager: 缺少 entryNameScheme');

      const tags = makeSourceTags(sourcePrefix);
      const scheme = entryNameScheme;
      let transactionTail = Promise.resolve();
      const restorePlans = new Map();
      const editorSessions = new Map();
      const editorPlans = new Map();
      function validateEntries(entries, options = {}) {
        const list = Array.isArray(entries) ? entries : [];
        const base = validateCanonical(list, options);
        const errors = base.errors.slice();
        if (programOnlyPolicy) {
          list.forEach(entry => {
            const required = typeof programOnlyPolicy.requires === 'function' && programOnlyPolicy.requires(entry) === true;
            if (required && entry?.meta?.programOnly !== true) {
              errors.push({ rule:'V9P', message:`「${entry.name || '无名条目'}」命中卡级 programOnly 目标但未声明 programOnly=true` });
              return;
            }
            if (entry?.meta?.programOnly === true && typeof programOnlyPolicy.validate === 'function') {
              const verdict = programOnlyPolicy.validate(entry);
              if (verdict !== true) errors.push({ rule:'V9P', message:typeof verdict === 'string' ? verdict : `「${entry.name || '无名条目'}」不符合卡级 programOnly 策略` });
            }
          });
        }
        return { ok:errors.length === 0, errors, warnings:base.warnings };
      }

      // ---- 内部：探测运行期 API host ----
      //   注入优先：config.tavernHelper 一旦提供就只认它、不回退全局（防「看似参数化、实则走全局」RISK-1）。
      //   未注入时才探测 window / window.parent（iframe 宿主）链上的 TavernHelper。
      function apiHost() {
        if (tavernHelper) {
          return tavernHelper.updateWorldbookWith && (tavernHelper.getCharWorldbookNames || tavernHelper.getWorldbookNames) ? tavernHelper : null;
        }
        const probes = [];
        if (typeof window !== 'undefined') {
          probes.push(window, window.TavernHelper);
          try { if (window.parent && window.parent !== window) probes.push(window.parent, window.parent.TavernHelper); } catch (_) { /* 跨源 parent 访问抛错，忽略 */ }
        }
        for (const t of probes) {
          if (t && t.updateWorldbookWith && (t.getCharWorldbookNames || t.getWorldbookNames)) return t;
        }
        return null;
      }

      async function resolveWorldbookName(host) {
        try {
          const c = await host?.getCharWorldbookNames?.('current'); // 可能返回 Promise，必须 await（B-BUG1）
          if (c && c.primary) return c.primary;
        } catch (_) { /* noop */ }
        try {
          const all = await host?.getWorldbookNames?.();
          if (Array.isArray(all)) {
            for (const re of nameMatchers) {
              const hit = all.find(n => re.test(String(n)));
              if (hit) return hit;
            }
          }
        } catch (_) { /* noop */ }
        return ''; // 未匹配返回空、由调用方收「未定位」警告；不盲取 all[0]（可能是别卡的世界书，RISK-2）
      }

      // ---- 内部：构造受管 Canonical 条目 ----
      function makeConstantCanonical(name, content, kind, extraMeta = {}, order = 100) {
        return makeCanonical({
          name,
          content: String(content || ''),
          enabled: extraMeta.enabled ?? Boolean(String(content || '').trim()),
          strategyType: 'constant',
          // 同雏形：开局/工坊条目落 before_author_note(Top of AN)；role/depth 惰性（仅 at_depth 有效）
          positionType: 'before_author_note',
          role: 'system',
          depth: 4,
          order,
          meta: { source: extraMeta.source || tags.opening, kind, version, ...stripMeta(extraMeta) },
        });
      }

      function stripMeta(m) {
        const { enabled, source, order, ...rest } = m; // 这几个已单独消费
        return rest;
      }

      function boundaryCanonical(which) {
        const isStart = which === 'start';
        return makeConstantCanonical(
          isStart ? scheme.workshopStart : scheme.workshopEnd,
          '',
          isStart ? KIND.BOUNDARY_START : KIND.BOUNDARY_END,
          { source: tags.workshop, enabled: false },
          isStart ? 101 : 199,
        );
      }

      function workshopPackageCanonical(item, installedAt) {
        const packageId = item.packageId ?? item.id;
        const packageType = item.packageType ?? item.type;
        const packageTarget = item.packageTarget ?? item.target ?? packageType ?? 'generic';
        const content = String(item.content || '');
        const programOnly = item.programOnly === true || Boolean(programOnlyPolicy && typeof programOnlyPolicy.detect === 'function' && programOnlyPolicy.detect({ item, packageId, packageType, packageTarget }) === true);
        const explicitEnabled = item.enabled !== undefined ? item.enabled === true : Boolean(content.trim());
        const comment = item.comment || (registry?.workshopComment?.(packageType, item.title)) || `[${sourcePrefix}-工坊][${packageType || ''}]${item.title || ''}`;
        return makeCanonical({
          name: comment,
          content,
          enabled: programOnly ? false : explicitEnabled,
          strategyType: 'constant',
          positionType: 'before_author_note',
          role: 'system',
          depth: 4,
          order: 110,
          group: `${sourcePrefix}-override-${packageId}`,
          groupOverride: true,
          groupWeight: 100,
          probability: 100,
          recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
          meta: {
            source: tags.workshop,
            kind: KIND.WORKSHOP_PACKAGE,
            programOnly,
            packageId,
            packageType,
            packageTarget,
            revision: item.revision,
            contentHash: item.contentHash || worldbookContentHash(content),
            installedAt: item.installedAt || installedAt,
            version,
          },
        });
      }

      // ---- 内部：payload → opening/workshop Canonical ----
      function buildCanonical(payload) {
        const opening = [];
        if (payload.identity) opening.push(makeConstantCanonical(scheme.identity, payload.identity, KIND.IDENTITY));
        if (payload.worldFactor) opening.push(makeConstantCanonical(scheme.worldFactor, payload.worldFactor, KIND.WORLD_FACTOR));
        const installedAt = now();
        const workshop = (payload.workshopEntries || []).map(item => workshopPackageCanonical(item, installedAt));
        return { opening, workshop };
      }

      function dispatchPreview(detail) {
        try {
          eventTarget?.dispatchEvent?.(new CustomEvent('worldbook-manager:preview', { detail }));
        } catch (_) { /* 非浏览器环境无 CustomEvent，静默 */ }
      }

      function duplicateUidErrors(entries) {
        const seen = new Set(), errors = [];
        (Array.isArray(entries) ? entries : []).forEach(entry => {
          const uid = entryUid(entry);
          if (uid === null) return;
          if (seen.has(uid)) errors.push({ rule:'V10', message:'世界书存在重复 UID：' + uid });
          seen.add(uid);
        });
        return errors;
      }
      function sameManagedEntry(existing, incoming) {
        const a = entryMeta(existing), b = entryMeta(incoming);
        if (!a.source || !a.kind || a.source !== b.source || a.kind !== b.kind) return false;
        if (b.kind !== KIND.WORKSHOP_PACKAGE) return true;
        if (String(a.packageId || '') !== String(b.packageId || '') || String(a.packageType || '') !== String(b.packageType || '')) return false;
        if (!a.packageTarget) return true;
        return String(a.packageTarget) === String(b.packageTarget || '');
      }
      function managedDelete(scope, entry) {
        if (scope === 'opening') return isOpeningManaged(entry, tags, scheme);
        if (scope === 'workshop') return isWorkshopManaged(entry, tags, scheme);
        return false;
      }
      async function getRevision() {
        await transactionTail;
        const host = apiHost();
        if (!host?.getWorldbook) return null;
        const name = await resolveWorldbookName(host);
        if (!name) return null;
        const entries = await host.getWorldbook(name);
        return worldbookRevision(entries);
      }
      function freshPlanId(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      }
      function pruneEditorState() {
        const time = Date.now();
        for (const [id, session] of editorSessions) if (time > session.expiresAt) editorSessions.delete(id);
        for (const [id, plan] of editorPlans) if (time > plan.expiresAt) editorPlans.delete(id);
      }
      async function currentEditorSnapshot() {
        await transactionTail;
        const host = apiHost();
        if (!host?.getWorldbook) throw new WorldbookSnapshotError('未检测到 Tavern Helper 世界书 API');
        const worldbookName = await resolveWorldbookName(host);
        if (!worldbookName) throw new WorldbookSnapshotError('未能定位角色卡绑定的世界书');
        const rawEntries = await host.getWorldbook(worldbookName);
        const entries = Array.isArray(rawEntries) ? cloneSnapshotValue(rawEntries) : [];
        return { worldbookName, revision:worldbookRevision(entries), rawEntries:entries };
      }
      async function openEditorSession() {
        pruneEditorState();
        const snapshot = await currentEditorSnapshot();
        const sessionId = freshPlanId('editor-session');
        const expiresAt = Date.now() + Math.max(1000, Number(editorPlanTtlMs) || 600000);
        editorSessions.set(sessionId, { ...snapshot, sessionId, expiresAt });
        return {
          sessionId,
          worldbookName:snapshot.worldbookName,
          revision:snapshot.revision,
          entries:snapshot.rawEntries.map(runtimeAdapter.fromRuntime),
          expiresAt,
        };
      }
      async function requireFreshEditorSession(sessionId) {
        pruneEditorState();
        const session = editorSessions.get(sessionId);
        if (!session) throw new WorldbookSnapshotError('编辑会话不存在或已过期，请重新载入');
        const snapshot = await currentEditorSnapshot();
        if (snapshot.worldbookName !== session.worldbookName) throw new WorldbookSnapshotError('绑定世界书已切换，请重新载入编辑器');
        if (snapshot.revision !== session.revision) throw new WorldbookRevisionConflictError(session.revision, snapshot.revision, snapshot.worldbookName);
        return { session, snapshot };
      }
      async function protectedCategory(uid) {
        if (typeof protectedEntryClassifier !== 'function') return '';
        const category = await protectedEntryClassifier(uid);
        return category === 'core' || category === 'variable' ? category : '';
      }
      function publicEditorPlan(plan) {
        return {
          planId:plan.planId,
          kind:plan.kind,
          worldbookName:plan.worldbookName,
          expectedRevision:plan.expectedRevision,
          uid:plan.uid,
          category:plan.category,
          requiresProtectedConfirmation:plan.requiresProtectedConfirmation,
          diff:plan.diff,
          validation:plan.validation,
          activation:plan.activation,
          expiresAt:plan.expiresAt,
          noop:false,
        };
      }
      function managedIdentityChanged(beforeMeta, afterMeta) {
        return ['source','kind','packageId','packageType','packageTarget','programOnly'].some(key => stableStringify(beforeMeta?.[key]) !== stableStringify(afterMeta?.[key]));
      }
      function isWorkshopPackageMeta(meta) { return meta?.kind === KIND.WORKSHOP_PACKAGE && meta?.source === tags.workshop; }
      function isBoundaryMeta(meta) { return meta?.kind === KIND.BOUNDARY_START || meta?.kind === KIND.BOUNDARY_END; }
      async function prepareEntryEdit({ sessionId, uid, draft } = {}) {
        if (!Number.isInteger(uid) || uid < 0) throw new WorldbookValidationError([{ rule:'V14', message:'编辑目标 UID 无效' }]);
        const { session, snapshot } = await requireFreshEditorSession(sessionId);
        const previousRaw = snapshot.rawEntries.find(entry => entryUid(entry) === uid);
        if (!previousRaw) throw new WorldbookValidationError([{ rule:'V14', message:'编辑目标 UID 不存在：' + uid }]);
        const previous = runtimeAdapter.fromRuntime(previousRaw);
        if (isBoundaryMeta(previous.meta)) throw new WorldbookValidationError([{ rule:'V14', message:'工坊边界条目为内部结构，不能作为正文编辑' }]);
        const incomingMeta = draft?.meta && typeof draft.meta === 'object' ? draft.meta : previous.meta;
        if (managedIdentityChanged(previous.meta, incomingMeta) || stableStringify(incomingMeta) !== stableStringify(previous.meta)) {
          throw new WorldbookValidationError([{ rule:'V14', message:'编辑器不得直接修改受管元数据' }]);
        }
        const next = makeCanonical({ ...previous, ...(draft || {}), uid, meta:{ ...previous.meta } });
        if (previous.meta?.programOnly === true && (next.enabled !== false || next.strategyType !== 'constant'
          || next.recursion?.prevent_incoming !== true || next.recursion?.prevent_outgoing !== true || next.recursion?.delay_until !== null)) {
          throw new WorldbookValidationError([{ rule:'V14', message:'programOnly 条目必须保持禁用、constant 与递归双禁；如需启用请先脱离为用户副本' }]);
        }
        let nextRaw = mergeRuntimeEntry(previousRaw, runtimeAdapter.toRuntime(next));
        if (worldbookRevision([previousRaw]) === worldbookRevision([nextRaw])) {
          const validation = validateEntries(snapshot.rawEntries.map(runtimeAdapter.fromRuntime), { surface:'runtime' });
          return { noop:true, worldbookName:session.worldbookName, expectedRevision:session.revision, uid, diff:diffWorldbookEntries({ before:[previousRaw], after:[nextRaw] }), validation };
        }
        if (isWorkshopPackageMeta(previous.meta)) {
          next.meta = { ...previous.meta, localModifiedAt:now() };
          nextRaw = mergeRuntimeEntry(previousRaw, runtimeAdapter.toRuntime(next));
        }
        const category = await protectedCategory(uid);
        const allAfter = snapshot.rawEntries.map(entry => entryUid(entry) === uid ? nextRaw : entry);
        const validation = validateEntries(allAfter.map(runtimeAdapter.fromRuntime), { surface:'runtime' });
        if (!validation.ok) throw new WorldbookValidationError(validation.errors);
        const planId = freshPlanId('editor-save');
        const plan = {
          planId,
          kind:'edit',
          worldbookName:session.worldbookName,
          expectedRevision:session.revision,
          uid,
          category,
          requiresProtectedConfirmation:category === 'core' || category === 'variable',
          canonical:next,
          validation,
          diff:diffWorldbookEntries({ before:[previousRaw], after:[nextRaw] }),
          activation:previewActivation(allAfter.map(runtimeAdapter.fromRuntime), { text:next.content }),
          expiresAt:Date.now() + Math.max(1000, Number(editorPlanTtlMs) || 600000),
        };
        editorPlans.set(planId, plan);
        return publicEditorPlan(plan);
      }
      async function prepareDetachProgramOnly({ sessionId, uid, name = '' } = {}) {
        if (!Number.isInteger(uid) || uid < 0) throw new WorldbookValidationError([{ rule:'V14', message:'脱离目标 UID 无效' }]);
        const { session, snapshot } = await requireFreshEditorSession(sessionId);
        const previousRaw = snapshot.rawEntries.find(entry => entryUid(entry) === uid);
        if (!previousRaw) throw new WorldbookValidationError([{ rule:'V14', message:'脱离目标 UID 不存在：' + uid }]);
        const previous = runtimeAdapter.fromRuntime(previousRaw);
        if (previous.meta?.programOnly !== true || !isWorkshopPackageMeta(previous.meta)) {
          throw new WorldbookValidationError([{ rule:'V14', message:'只有受管 programOnly 工坊记录可脱离为用户副本' }]);
        }
        const occupied = new Set(snapshot.rawEntries.map(entry => String(entry?.name || '')));
        const stem = String(name || `${previous.name}（用户副本）`).trim() || `${previous.name}（用户副本）`;
        let uniqueName = stem, suffix = 2;
        while (occupied.has(uniqueName)) uniqueName = `${stem} ${suffix++}`;
        const detachedMeta = { ...previous.meta };
        ['source','kind','packageId','packageType','packageTarget','programOnly','revision','contentHash','installedAt','localModifiedAt','version'].forEach(key => { delete detachedMeta[key]; });
        let nextUid = Math.max(-1, ...snapshot.rawEntries.map(entryUid).filter(value => value !== null)) + 1;
        while (await protectedCategory(nextUid)) nextUid += 1;
        const detached = makeCanonical({ ...previous, uid:nextUid, name:uniqueName, enabled:false, meta:detachedMeta });
        const detachedRaw = mergeRuntimeEntry(previousRaw, runtimeAdapter.toRuntime(detached));
        detachedRaw.uid = nextUid;
        detachedRaw.extra = cloneSnapshotValue(detachedMeta);
        const allAfter = [...snapshot.rawEntries, detachedRaw];
        const planId = freshPlanId('editor-detach');
        const validation = validateEntries(allAfter.map(runtimeAdapter.fromRuntime), { surface:'runtime' });
        if (!validation.ok) throw new WorldbookValidationError(validation.errors);
        const plan = {
          planId,
          kind:'detach',
          worldbookName:session.worldbookName,
          expectedRevision:session.revision,
          uid,
          category:'programOnly',
          requiresProtectedConfirmation:true,
          canonical:detached,
          replacement:allAfter,
          validation,
          diff:diffWorldbookEntries({ before:snapshot.rawEntries, after:allAfter }),
          activation:previewActivation(allAfter.map(runtimeAdapter.fromRuntime), { text:detached.content }),
          expiresAt:Date.now() + Math.max(1000, Number(editorPlanTtlMs) || 600000),
        };
        editorPlans.set(planId, plan);
        return publicEditorPlan(plan);
      }
      async function commitPreparedEditorPlan(planId, { confirmProtected = false } = {}) {
        pruneEditorState();
        const plan = editorPlans.get(planId);
        if (!plan) throw new WorldbookSnapshotError('编辑保存计划不存在或已使用');
        if (plan.requiresProtectedConfirmation && confirmProtected !== true) {
          throw new WorldbookValidationError([{ rule:'V14', message:'核心、变量或脱离操作需要额外确认' }]);
        }
        try {
          return await commitTransaction({
            upserts:plan.kind === 'detach' ? [] : [plan.canonical],
            replacement:plan.kind === 'detach' ? plan.replacement : null,
            expectedRevision:plan.expectedRevision,
            expectedWorldbookName:plan.worldbookName,
            validationSurface:'runtime',
            reason:plan.kind === 'detach' ? 'before-editor-detach' : (plan.requiresProtectedConfirmation ? 'before-editor-save-protected' : 'before-editor-save'),
          });
        } finally { editorPlans.delete(planId); }
      }
      function discardPreparedEditorPlan(planId) { return editorPlans.delete(planId); }
      function normalizeWorkshopBlock(entries) {
        const list = Array.isArray(entries) ? entries : [];
        const managed = list.filter(entry => isWorkshopManaged(entry, tags, scheme));
        const packages = managed.filter(entry => entryMeta(entry).kind === KIND.WORKSHOP_PACKAGE);
        if (!packages.length) return list;
        const start = managed.find(entry => entryMeta(entry).kind === KIND.BOUNDARY_START);
        const end = managed.find(entry => entryMeta(entry).kind === KIND.BOUNDARY_END);
        if (!start || !end) throw new WorldbookValidationError([{ rule:'V12', message:'工坊条目必须由唯一边界完整包裹' }]);
        const base = list.filter(entry => !isWorkshopManaged(entry, tags, scheme));
        return [...base, start, ...packages, end];
      }
      function runtimeSafetyErrors(entries) {
        const canonical = (Array.isArray(entries) ? entries : []).map(runtimeAdapter.fromRuntime).filter(entry => entry?.meta?.programOnly === true
          || (programOnlyPolicy && typeof programOnlyPolicy.requires === 'function' && programOnlyPolicy.requires(entry) === true));
        if (!canonical.length) return [];
        return validateEntries(canonical).errors;
      }
      async function saveRequiredSnapshot(worldbookName, entries, reason) {
        if (!snapshotStore?.save) {
          if (snapshotRequired) throw new WorldbookSnapshotError('世界书写入要求强制备份，但快照存储未配置');
          return null;
        }
        return snapshotStore.save({ worldbookName, entries:cloneSnapshotValue(entries), reason });
      }
      function baselineHash(entries) { return worldbookSha256Hex(JSON.stringify(entries)); }
      function validateFactoryBaseline(baseline) {
        if (!baseline || baseline.schema !== 'worldbook-factory-baseline-v1' || !Array.isArray(baseline.entries)) throw new WorldbookSnapshotError('出厂基线格式无效');
        if (!/^[a-f0-9]{64}$/.test(String(baseline.sha256 || '')) || baseline.sha256 !== baselineHash(baseline.entries)) throw new WorldbookSnapshotError('出厂基线 SHA-256 校验失败');
        const seen = new Set();
        baseline.entries.forEach(record => {
          if (!['core','variable'].includes(record?.category) || !Number.isInteger(record?.uid) || !record?.entry) throw new WorldbookSnapshotError('出厂基线条目分类或 UID 无效');
          if (seen.has(record.uid)) throw new WorldbookSnapshotError('出厂基线存在重复 UID：' + record.uid);
          seen.add(record.uid);
          if (entryUid(record.entry) !== record.uid) throw new WorldbookSnapshotError('出厂基线 UID 与条目不一致：' + record.uid);
          if (record.uid === 68 || isOpeningManaged(record.entry, tags, scheme) || isWorkshopManaged(record.entry, tags, scheme) || entryMeta(record.entry).programOnly === true) {
            throw new WorldbookSnapshotError('出厂基线包含受保护的动态/工坊条目：' + record.uid);
          }
        });
        return baseline;
      }
      function mergeFactoryEntries(current, baseline, categories) {
        const selected = baseline.entries.filter(record => categories.includes(record.category));
        const selectedByUid = new Map(selected.map(record => [record.uid, record]));
        (Array.isArray(current) ? current : []).forEach(entry => {
          if (!selectedByUid.has(entryUid(entry))) return;
          const factoryEntry = selectedByUid.get(entryUid(entry)).entry;
          if (isOpeningManaged(entry, tags, scheme) || isWorkshopManaged(entry, tags, scheme) || entryMeta(entry).programOnly === true) {
            throw new WorldbookSnapshotError('出厂 UID 与受保护的 opening/workshop 条目冲突：' + entryUid(entry));
          }
          if (String(entry?.name || '') !== String(factoryEntry?.name || '')) throw new WorldbookSnapshotError('出厂 UID 与非出厂条目名称冲突：' + entryUid(entry));
        });
        const output = (Array.isArray(current) ? current : []).map(entry => selectedByUid.has(entryUid(entry)) ? cloneSnapshotValue(selectedByUid.get(entryUid(entry)).entry) : cloneSnapshotValue(entry));
        const present = new Set(output.map(entryUid));
        selected.forEach((record, index) => {
          if (present.has(record.uid)) return;
          const nextRecord = selected.slice(index + 1).find(item => present.has(item.uid));
          const previousRecord = selected.slice(0, index).reverse().find(item => present.has(item.uid));
          const insertion = cloneSnapshotValue(record.entry);
          if (nextRecord) output.splice(output.findIndex(entry => entryUid(entry) === nextRecord.uid), 0, insertion);
          else if (previousRecord) output.splice(output.findIndex(entry => entryUid(entry) === previousRecord.uid) + 1, 0, insertion);
          else output.unshift(insertion);
          present.add(record.uid);
        });
        return output;
      }
      function publicRestorePlan(plan) {
        return {
          planId: plan.planId,
          kind: plan.kind,
          worldbookName: plan.worldbookName,
          expectedRevision: plan.expectedRevision,
          targetRevision: worldbookRevision(plan.entries),
          diff: plan.diff,
          expiresAt: plan.expiresAt,
          baselineSha256: plan.baselineSha256 || '',
          snapshotId: plan.snapshotId || '',
        };
      }
      async function prepareRestore({ kind, baseline = null, snapshotId = '' } = {}) {
        await transactionTail;
        for (const [id, plan] of restorePlans) if (Date.now() > plan.expiresAt) restorePlans.delete(id);
        const host = apiHost();
        if (!host?.getWorldbook) throw new WorldbookSnapshotError('未检测到 Tavern Helper 世界书 API');
        const worldbookName = await resolveWorldbookName(host);
        if (!worldbookName) throw new WorldbookSnapshotError('未能定位角色卡绑定的世界书');
        const current = await host.getWorldbook(worldbookName);
        const before = Array.isArray(current) ? cloneSnapshotValue(current) : [];
        let candidate;
        let baselineSha256 = '';
        if (kind === 'core' || kind === 'core-variable') {
          const validBaseline = validateFactoryBaseline(baseline);
          baselineSha256 = validBaseline.sha256;
          candidate = mergeFactoryEntries(before, validBaseline, kind === 'core' ? ['core'] : ['core','variable']);
        } else if (kind === 'snapshot') {
          if (!snapshotStore?.get) throw new WorldbookSnapshotError('历史快照存储未配置');
          const snapshot = await snapshotStore.get(snapshotId, worldbookName);
          candidate = cloneSnapshotValue(snapshot.entries);
        } else throw new WorldbookSnapshotError('未知恢复类型：' + String(kind || ''));
        const safetyErrors = runtimeSafetyErrors(candidate);
        if (safetyErrors.length) throw new WorldbookValidationError(safetyErrors);
        const expectedRevision = worldbookRevision(before);
        const planId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const plan = {
          planId,
          kind,
          worldbookName,
          expectedRevision,
          entries:candidate,
          diff:diffWorldbookEntries({ before, after:candidate }),
          expiresAt:Date.now() + Math.max(1000, Number(restorePlanTtlMs) || 300000),
          baselineSha256,
          snapshotId,
        };
        restorePlans.set(planId, plan);
        return publicRestorePlan(plan);
      }
      async function commitPreparedRestore(planId) {
        const plan = restorePlans.get(planId);
        if (!plan) throw new WorldbookSnapshotError('恢复计划不存在或已使用');
        if (Date.now() > plan.expiresAt) { restorePlans.delete(planId); throw new WorldbookSnapshotError('恢复计划已过期，请重新预览 diff'); }
        try {
          return await commitTransaction({ replacement:plan.entries, expectedRevision:plan.expectedRevision, expectedWorldbookName:plan.worldbookName, reason:`before-restore-${plan.kind}` });
        } finally { restorePlans.delete(planId); }
      }
      function discardPreparedRestore(planId) { return restorePlans.delete(planId); }
      async function listSnapshots() {
        await transactionTail;
        const host = apiHost();
        if (!host) return { backend:snapshotStore?.backend?.() || 'unavailable', worldbookName:'', snapshots:[] };
        const worldbookName = await resolveWorldbookName(host);
        if (!worldbookName || !snapshotStore?.list) return { backend:snapshotStore?.backend?.() || 'unavailable', worldbookName, snapshots:[] };
        const records = await snapshotStore.list(worldbookName);
        return {
          backend:snapshotStore.backend?.() || 'custom',
          worldbookName,
          snapshots:records.map(record => ({ id:record.id, createdAt:record.createdAt, createdAtMs:record.createdAtMs, reason:record.reason, beforeRevision:record.beforeRevision, entryCount:Number(record.entryCount ?? record.entries?.length ?? 0), checksum:record.checksum })),
        };
      }
      async function commitTransactionNow({ upserts = [], deletes = [], expectedRevision, expectedWorldbookName = '', render = 'debounced', deleteScopes = [], matchManaged = false, normalizeWorkshop = false, guard = null, replacement = null, reason = 'before-save', validationSurface = 'canonical', publicMode = false } = {}) {
        const list = Array.isArray(upserts) ? upserts : [];
        const ids = Array.isArray(deletes) ? deletes : [];
        const validation = validateEntries(list, { surface:validationSurface });
        if (!validation.ok) throw new WorldbookValidationError(validation.errors);
        if (ids.some(uid => !Number.isInteger(uid) || uid < 0)) throw new WorldbookValidationError([{ rule:'V10', message:'deletes 只接受非负整数 UID' }]);
        if (new Set(ids).size !== ids.length) throw new WorldbookValidationError([{ rule:'V10', message:'deletes 含重复 UID' }]);
        const upsertUids = list.map(entryUid).filter(uid => uid !== null);
        if (new Set(upsertUids).size !== upsertUids.length) throw new WorldbookValidationError([{ rule:'V10', message:'upserts 含重复 UID' }]);
        const overlap = upsertUids.find(uid => ids.includes(uid));
        if (overlap !== undefined) throw new WorldbookValidationError([{ rule:'V10', message:'同一 UID 不能同时 delete 与 upsert：' + overlap }]);
        const host = apiHost();
        const dry = { applied:false, worldbookName:null, beforeRevision:null, afterRevision:null, entries:[], diff:diffWorldbookEntries(), warnings:validation.warnings };
        if (!host) { dry.warning='未检测到 Tavern Helper 世界书 API，已仅生成预览事件（dry-run）。'; dispatchPreview({ ...dry, dryRun:true }); return dry; }
        const worldbookName = await resolveWorldbookName(host);
        if (!worldbookName) { dry.warning='未能定位角色卡绑定的世界书。'; dispatchPreview({ ...dry, dryRun:true }); return dry; }
        if (expectedWorldbookName && worldbookName !== expectedWorldbookName) throw new WorldbookSnapshotError('绑定世界书已切换，请重新预览恢复 diff');
        if (!list.length && !ids.length && !deleteScopes.length && replacement === null) {
          const current = host.getWorldbook ? await host.getWorldbook(worldbookName) : [];
          const revision = worldbookRevision(current);
          return { ...dry, worldbookName, beforeRevision:revision, afterRevision:revision, entries:(current || []).map(runtimeAdapter.fromRuntime) };
        }
        let before = [], candidate = [], beforeRevision = null;
        const saved = await host.updateWorldbookWith(worldbookName, async current => {
          before = Array.isArray(current) ? cloneSnapshotValue(current) : [];
          const uidErrors = duplicateUidErrors(before);
          if (uidErrors.length) throw new WorldbookValidationError(uidErrors);
          beforeRevision = worldbookRevision(before);
          if (typeof guard === 'function') guard({ current:before, revision:beforeRevision, worldbookName });
          if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== beforeRevision) {
            throw new WorldbookRevisionConflictError(expectedRevision, beforeRevision, worldbookName);
          }
          const existingUids = new Set(before.map(entryUid).filter(uid => uid !== null));
          ids.forEach(uid => { if (!existingUids.has(uid)) throw new WorldbookValidationError([{ rule:'V10', message:'删除目标 UID 不存在：' + uid }]); });
          if (publicMode) {
            ids.forEach(uid => {
              const previous = before.find(entry => entryUid(entry) === uid);
              const meta = entryMeta(previous);
              if (meta.programOnly === true || isWorkshopPackageMeta(meta) || isBoundaryMeta(meta)) {
                throw new WorldbookValidationError([{ rule:'V14', message:'公开事务不得删除受管工坊/programOnly 条目，请使用专用卸载或脱离流程' }]);
              }
            });
          }
          const protectedPublicUids = new Map();
          if (publicMode) {
            for (const uid of ids) {
              const category = await protectedCategory(uid);
              if (category) throw new WorldbookValidationError([{ rule:'V14', message:`公开事务不得直接删除${category === 'core' ? '核心' : '变量'}条目，请使用受保护编辑计划` }]);
            }
            for (const canonical of list) {
              const uid = entryUid(canonical);
              if (uid === null) continue;
              const category = await protectedCategory(uid);
              if (category) protectedPublicUids.set(uid, category);
            }
          }
          let next;
          if (replacement !== null) {
            if (!Array.isArray(replacement)) throw new WorldbookValidationError([{ rule:'V13', message:'replacement 必须是完整世界书条目数组' }]);
            next = cloneSnapshotValue(replacement);
          } else {
            next = before.filter(entry => !ids.includes(entryUid(entry)) && !deleteScopes.some(scope => managedDelete(scope, entry)));
            let nextUid = Math.max(-1, ...before.map(entryUid).filter(uid => uid !== null)) + 1;
            const claimedManagedUids = new Set(upsertUids);
            for (const canonical of list) {
              let uid = entryUid(canonical);
              let previous = uid === null ? null : before.find(entry => entryUid(entry) === uid);
              if (uid !== null && !previous) throw new WorldbookValidationError([{ rule:'V10', message:'更新目标 UID 不存在：' + uid }]);
              if (!previous && matchManaged && managedEntryKey(canonical)) {
                const matches = before.filter(entry => sameManagedEntry(entry, canonical) && !claimedManagedUids.has(entryUid(entry)));
                if (matches.length > 1) throw new WorldbookValidationError([{ rule:'V11', message:'受管业务键匹配到多个旧条目：' + managedEntryKey(canonical) }]);
                previous = matches[0] || null; uid = previous ? entryUid(previous) : null;
                if (uid !== null) claimedManagedUids.add(uid);
              }
              if (uid === null) {
                while (await protectedCategory(nextUid)) nextUid += 1;
                uid = nextUid++;
              }
              if (publicMode && previous) {
                const previousCanonical = runtimeAdapter.fromRuntime(previous);
                const protectedClass = protectedPublicUids.get(uid);
                if (protectedClass) throw new WorldbookValidationError([{ rule:'V14', message:`公开事务不得直接修改${protectedClass === 'core' ? '核心' : '变量'}条目，请使用受保护编辑计划` }]);
                if (isBoundaryMeta(previousCanonical.meta)) throw new WorldbookValidationError([{ rule:'V14', message:'公开事务不得编辑工坊边界条目' }]);
                if (isWorkshopPackageMeta(previousCanonical.meta) || previousCanonical.meta?.programOnly === true) {
                  if (managedIdentityChanged(previousCanonical.meta, canonical?.meta)) throw new WorldbookValidationError([{ rule:'V14', message:'公开事务不得剥离或改写受管工坊身份' }]);
                  if (stableStringify(previousCanonical.meta) !== stableStringify(canonical?.meta || {})) throw new WorldbookValidationError([{ rule:'V14', message:'公开事务不得改写工坊上游元数据；本地修改时间由内核维护' }]);
                  if (previousCanonical.meta?.programOnly === true && (canonical.enabled !== false || canonical.strategyType !== 'constant'
                    || canonical.recursion?.prevent_incoming !== true || canonical.recursion?.prevent_outgoing !== true || canonical.recursion?.delay_until !== null)) {
                    throw new WorldbookValidationError([{ rule:'V14', message:'公开事务不得直接启用或放宽 programOnly 条目' }]);
                  }
                }
              }
              const previousInstalledAt = previous?.extra?.installedAt;
              const previousLocalModifiedAt = previous?.extra?.localModifiedAt;
              let nextCanonical = previousInstalledAt && canonical?.meta?.kind === KIND.WORKSHOP_PACKAGE
                ? { ...canonical, meta:{ ...canonical.meta, installedAt:previousInstalledAt, ...(previousLocalModifiedAt ? { localModifiedAt:previousLocalModifiedAt } : {}) } }
                : canonical;
              if (publicMode && previous && isWorkshopPackageMeta(runtimeAdapter.fromRuntime(previous).meta)) {
                const withoutDirty = { ...nextCanonical, meta:{ ...runtimeAdapter.fromRuntime(previous).meta } };
                const rawWithoutDirty = mergeRuntimeEntry(previous, runtimeAdapter.toRuntime({ ...withoutDirty, uid }));
                if (worldbookRevision([rawWithoutDirty]) !== worldbookRevision([previous])) {
                  nextCanonical = { ...withoutDirty, meta:{ ...withoutDirty.meta, localModifiedAt:now() } };
                }
              }
              const runtime = mergeRuntimeEntry(previous, runtimeAdapter.toRuntime({ ...nextCanonical, uid }));
              const index = next.findIndex(entry => entryUid(entry) === uid);
              if (index >= 0) next[index] = runtime; else next.push(runtime);
            }
            if (normalizeWorkshop) next = normalizeWorkshopBlock(next);
          }
          const nextUidErrors = duplicateUidErrors(next);
          if (nextUidErrors.length) throw new WorldbookValidationError(nextUidErrors);
          const fullValidation = validateEntries(next.map(runtimeAdapter.fromRuntime), { surface:'runtime' });
          if (!fullValidation.ok) throw new WorldbookValidationError(fullValidation.errors);
          const safetyErrors = runtimeSafetyErrors(next);
          if (safetyErrors.length) throw new WorldbookValidationError(safetyErrors);
          if (worldbookRevision(next) !== beforeRevision) await saveRequiredSnapshot(worldbookName, before, reason);
          candidate = next;
          return next;
        }, { render });
        const actual = Array.isArray(saved) ? saved : candidate;
        const afterRevision = worldbookRevision(actual);
        const diff = diffWorldbookEntries({ before, after:actual });
        const result = { applied:afterRevision !== beforeRevision, worldbookName, beforeRevision, afterRevision, entries:actual.map(runtimeAdapter.fromRuntime), added:diff.added, updated:diff.updated, deleted:diff.deleted, diff, warnings:validation.warnings };
        dispatchPreview(result);
        return result;
      }
      function commitTransaction(transaction = {}) {
        const scheduled = transactionTail.then(() => commitTransactionNow(transaction));
        transactionTail = scheduled.then(() => undefined, () => undefined);
        return scheduled;
      }
      async function applyTransaction(transaction = {}) {
        const forbidden = ['replacement','reason','expectedWorldbookName','deleteScopes','matchManaged','normalizeWorkshop'].find(key => Object.prototype.hasOwnProperty.call(transaction, key));
        if (forbidden) throw new WorldbookValidationError([{ rule:'V13', message:'公开事务不接受内部字段：' + forbidden }]);
        const { upserts = [], deletes = [], expectedRevision, render = 'debounced', guard = null } = transaction;
        return commitTransaction({ upserts, deletes, expectedRevision, render, guard, matchManaged:false, publicMode:true });
      }
      async function write(payload = {}) {
        const scope = payload.scope || 'all';
        const { opening, workshop } = buildCanonical(payload);
        const toValidate = scope === 'identity' ? opening : scope === 'workshop' ? workshop : [...opening, ...workshop];
        const validation = validateEntries(toValidate);
        if (!validation.ok) throw new WorldbookValidationError(validation.errors);
        const summary = { scope, applied:false, warnings:validation.warnings, worldbookName:null, preview:toValidate.map(c => c.name) };
        if (scope === 'identity' && !opening.length && payload.allowEmptyIdentity !== true) { summary.warning='没有可写入的身份/世界因子内容。'; dispatchPreview({ ...summary, dryRun:true }); return summary; }
        if (scope === 'workshop' && !workshop.length) { summary.warning='没有已启用的工坊内容可注入。'; dispatchPreview({ ...summary, dryRun:true }); return summary; }
        const upserts = scope === 'identity' ? opening.slice() : scope === 'workshop' ? workshop.slice() : [...opening, ...workshop];
        if (scope !== 'identity' && workshop.length) upserts.push(boundaryCanonical('start'), boundaryCanonical('end'));
        const deleteScopes = scope === 'identity' ? ['opening'] : scope === 'workshop' ? ['workshop'] : ['opening','workshop'];
        const tx = await commitTransaction({ upserts, deleteScopes, expectedRevision:payload.expectedRevision, matchManaged:true, normalizeWorkshop:scope !== 'identity' && workshop.length > 0, guard:payload.guard });
        return { ...summary, ...tx, scope, warnings:[...validation.warnings, ...(tx.warnings || [])] };
      }
      async function writeBatch(canonicalEntries = [], options = {}) {
        const list = Array.isArray(canonicalEntries) ? canonicalEntries.slice() : [];
        if (list.some(entry => entry?.meta?.kind === KIND.WORKSHOP_PACKAGE)) list.push(boundaryCanonical('start'), boundaryCanonical('end'));
        const tx = await commitTransaction({ upserts:list, expectedRevision:options.expectedRevision, matchManaged:true, normalizeWorkshop:list.some(entry => entry?.meta?.kind === KIND.WORKSHOP_PACKAGE) });
        return { ...tx, count:canonicalEntries.length };
      }
      async function uninstallWorkshop(options = {}) {
        const tx = await commitTransaction({ deleteScopes:['workshop'], expectedRevision:options.expectedRevision, matchManaged:true });
        return { ...tx, scope:'workshop', uninstalled:true };
      }

      // ---- 对外：preview（dry-run，返回预期 Canonical 条目，不落盘）----
      function preview(payload = {}) {
        const { opening, workshop } = buildCanonical(payload);
        return [...opening, ...workshop];
      }

      // ---- 对外：readManaged / readAll ----
      async function readManaged(scopeFilter) {
        await transactionTail;
        const host = apiHost();
        if (!host) return [];
        const worldbookName = await resolveWorldbookName(host);
        if (!worldbookName || !host.getWorldbook) return [];
        const all = await host.getWorldbook(worldbookName);
        return (Array.isArray(all) ? all : [])
          .filter(e => {
            if (scopeFilter === 'identity') return isOpeningManaged(e, tags, scheme);
            if (scopeFilter === 'workshop') return isWorkshopManaged(e, tags, scheme);
            return isOpeningManaged(e, tags, scheme) || isWorkshopManaged(e, tags, scheme);
          })
          .map(runtimeAdapter.fromRuntime);
      }

      async function readAll() {
        await transactionTail;
        const host = apiHost();
        if (!host || !host.getWorldbook) return [];
        const worldbookName = await resolveWorldbookName(host);
        if (!worldbookName) return [];
        const all = await host.getWorldbook(worldbookName);
        return (Array.isArray(all) ? all : []).map(runtimeAdapter.fromRuntime);
      }

      return {
        write,
        writeBatch,
        uninstallWorkshop,
        applyTransaction,
        getRevision,
        openEditorSession,
        prepareEntryEdit,
        prepareDetachProgramOnly,
        commitPreparedEditorPlan,
        discardPreparedEditorPlan,
        diff: diffWorldbookEntries,
        previewActivation,
        prepareRestore,
        commitPreparedRestore,
        discardPreparedRestore,
        listSnapshots,
        preview,
        readManaged,
        readAll,
        validate: validateEntries,
        // 工具暴露（仿真器 / 创作平台 adapter 往返用）
        toCanonicalFromCard: cardAdapter.toCanonical,
        toCardFromCanonical: cardAdapter.fromCanonical,
        toRuntimeFromCanonical: runtimeAdapter.toRuntime,
        fromRuntimeToCanonical: runtimeAdapter.fromRuntime,
        _config: { sourcePrefix, tags, scheme },
      };
    }
    return { createWorldbookManager, createWorldbookSnapshotStore, WorldbookRevisionConflictError, WorldbookSnapshotError, diffWorldbookEntries, previewActivation };
  })();
  // </shared-worldbook-manager-v0.4.0>
  // <shared-worldbook-manager-ui-v0.1.0 source-sha256="ac66658e36062b280be4b9cdac81191ab17b5e597412d803404cab239a75b047">
  const SHARED_WORLDBOOK_MANAGER_UI_SOURCE_SHA256 = 'ac66658e36062b280be4b9cdac81191ab17b5e597412d803404cab239a75b047';
  const sharedWorldbookManagerUI = (() => {
    const WBM_UI_STYLE_ID = 'worldbook-manager-ui-v0-1-0-style';

    function createWorldbookManagerUI(options = {}) {
      const manager = options.manager;
      const hostDocument = options.hostDocument || (typeof document !== 'undefined' ? document : null);
      const baselineProvider = options.baselineProvider;
      const previewOpeningBodyRestore = options.previewOpeningBodyRestore;
      const restoreOpeningBody = options.restoreOpeningBody;
      const undoOpeningBodyRestore = options.undoOpeningBodyRestore;
      if (!manager || !hostDocument) throw new Error('createWorldbookManagerUI 需要 manager 与 hostDocument');

      let root = null;
      let baseline = null;
      let pendingPlan = null;
      let loading = false;
      let destroyed = false;
      let openingUndoAvailable = false;
      let view = { entries:[], revision:'', snapshotInfo:{ backend:'unavailable', worldbookName:'', snapshots:[] }, message:'' };

      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
      const shortHash = value => value ? `${String(value).slice(0, 12)}…` : '未载入';
      const diffCount = diff => Number(diff?.summary?.added || 0) + Number(diff?.summary?.deleted || 0) + Number(diff?.summary?.updated || 0) + Number(diff?.summary?.moved || 0);
      const baselineCounts = () => {
        const core = Number.isFinite(Number(baseline?.counts?.core)) ? Math.max(0, Number(baseline.counts.core)) : 0;
        const variable = Number.isFinite(Number(baseline?.counts?.variable)) ? Math.max(0, Number(baseline.counts.variable)) : 0;
        return { core, variable, total:core + variable };
      };

      function ensureStyle() {
        if (hostDocument.getElementById(WBM_UI_STYLE_ID)) return;
        const style = hostDocument.createElement('style');
        style.id = WBM_UI_STYLE_ID;
        style.textContent = `
          .wbm-shell{position:fixed;inset:0;z-index:2147482500;background:rgba(5,9,18,.82);backdrop-filter:blur(14px);display:grid;place-items:center;padding:18px;color:#eaf2ff;font-family:Inter,"Microsoft YaHei",sans-serif}.wbm-shell[hidden]{display:none!important}
          .wbm-panel{width:min(1120px,100%);height:min(820px,100%);background:linear-gradient(160deg,#111c2c,#0a111d 62%);border:1px solid rgba(132,181,255,.28);border-radius:22px;box-shadow:0 30px 90px rgba(0,0,0,.55);display:grid;grid-template-rows:auto 1fr;overflow:hidden}
          .wbm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px 22px;border-bottom:1px solid rgba(132,181,255,.16)}
          .wbm-head h2{margin:2px 0 5px;font-size:22px}.wbm-head p{margin:0;color:#9fb1c9;font-size:13px}.wbm-kicker{font-size:11px;letter-spacing:.14em;color:#76c9ff}.wbm-close{border:1px solid rgba(255,255,255,.2);background:#121d2d;color:#dcecff;border-radius:12px;padding:8px 12px;cursor:pointer}
          .wbm-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);min-height:0}.wbm-col{min-height:0;overflow:auto;padding:18px}.wbm-col+.wbm-col{border-left:1px solid rgba(132,181,255,.14)}
          .wbm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:14px}.wbm-stat{background:rgba(91,138,190,.1);border:1px solid rgba(130,179,235,.16);border-radius:14px;padding:10px}.wbm-stat span{display:block;color:#8fa6c0;font-size:11px}.wbm-stat b{display:block;margin-top:5px;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .wbm-section{background:rgba(5,11,20,.38);border:1px solid rgba(130,179,235,.14);border-radius:16px;padding:14px;margin-bottom:12px}.wbm-section h3{font-size:14px;margin:0 0 10px}.wbm-actions{display:flex;flex-wrap:wrap;gap:8px}.wbm-button{border:1px solid rgba(119,182,255,.28);background:#14253b;color:#dfefff;border-radius:11px;padding:9px 11px;cursor:pointer;font-size:12px}.wbm-button:hover{background:#1b3351}.wbm-button.primary{background:#17659a;border-color:#48a9e7}.wbm-button.danger{background:#6b2934;border-color:#d16778}.wbm-button:disabled{opacity:.45;cursor:not-allowed}
          .wbm-note{font-size:12px;line-height:1.6;color:#9eb0c7;margin:8px 0 0}.wbm-safe{color:#8ee6b0}.wbm-warning{color:#ffcc82}.wbm-error{color:#ff8b9a}.wbm-message{min-height:20px;margin:8px 0;color:#b9cae0;font-size:12px}
          .wbm-list{display:grid;gap:7px}.wbm-entry,.wbm-snapshot{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:center;border:1px solid rgba(132,181,255,.12);background:rgba(19,32,49,.7);border-radius:11px;padding:9px 10px}.wbm-uid{font:11px ui-monospace,monospace;color:#7f9bb8}.wbm-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wbm-badge{font-size:10px;padding:3px 7px;border-radius:999px;background:#203a54;color:#a8d8ff}.wbm-badge.variable{background:#463b70;color:#d7c9ff}.wbm-badge.workshop{background:#603846;color:#ffc1d1}.wbm-badge.user{background:#2c4d3c;color:#a8ecc8}
          .wbm-diff{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:9px 0}.wbm-diff span{border-radius:10px;background:#131f30;padding:8px;text-align:center;font-size:11px}.wbm-confirm{border:1px solid rgba(255,196,112,.35);background:rgba(94,59,23,.35);border-radius:13px;padding:11px;margin-top:10px}.wbm-confirm strong{display:block;font-size:13px;margin-bottom:6px}.wbm-select{width:100%;border:1px solid rgba(132,181,255,.22);background:#0e1927;color:#e4efff;border-radius:10px;padding:9px;margin:7px 0 10px}
          .wbm-diff-detail{margin:8px 0;border:1px solid rgba(255,196,112,.18);border-radius:10px;padding:7px}.wbm-diff-detail summary{cursor:pointer;color:#ffd29a;font-size:11px}.wbm-diff-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;padding:6px 2px;border-top:1px solid rgba(255,255,255,.07);font-size:10px}.wbm-diff-row:first-of-type{margin-top:6px}.wbm-diff-kind{color:#82cfff}.wbm-diff-paths{color:#aebfd3;overflow-wrap:anywhere}
          @media(max-width:760px){.wbm-shell{padding:0}.wbm-panel{height:100%;border-radius:0}.wbm-main{grid-template-columns:1fr;overflow:auto}.wbm-col{overflow:visible}.wbm-col+.wbm-col{border-left:0;border-top:1px solid rgba(132,181,255,.14)}.wbm-stats{grid-template-columns:repeat(2,1fr)}.wbm-head{padding:15px}.wbm-col{padding:13px}.wbm-entry{grid-template-columns:auto minmax(0,1fr)}}
        `;
        (hostDocument.head || hostDocument.documentElement).appendChild(style);
      }

      function entryRole(entry) {
        const uid = Number(entry?.uid);
        const factory = baseline?.entries?.find(record => record.uid === uid);
        if (factory) return factory.category;
        if (entry?.meta?.programOnly === true || entry?.meta?.source?.includes('workshop')) return 'workshop';
        return 'user';
      }

      function renderEntries() {
        if (!view.entries.length) return '<p class="wbm-note">当前未读取到世界书条目。</p>';
        return `<div class="wbm-list">${view.entries.map(entry => {
          const role = entryRole(entry);
          const label = role === 'core' ? '核心' : role === 'variable' ? '变量' : role === 'workshop' ? (entry.meta?.programOnly ? '工坊·锁定' : '工坊') : '用户';
          return `<div class="wbm-entry"><span class="wbm-uid">UID ${escapeHtml(entry.uid ?? '—')}</span><span class="wbm-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name || '无名条目')}</span><span class="wbm-badge ${role}">${label}</span></div>`;
        }).join('')}</div>`;
      }

      function renderSnapshots() {
        const snapshots = view.snapshotInfo.snapshots || [];
        if (!snapshots.length) return '<p class="wbm-note">尚无历史快照；下一次保存或恢复前会自动建立。</p>';
        const optionsHtml = snapshots.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.createdAt)} · ${escapeHtml(item.reason)} · ${item.entryCount} 条</option>`).join('');
        return `<select class="wbm-select" data-wbm-snapshot>${optionsHtml}</select><div class="wbm-actions"><button class="wbm-button danger" data-wbm-action="preview-snapshot">预览完整历史恢复</button></div><p class="wbm-note wbm-warning">历史快照会恢复完整世界书，可能回退用户与工坊条目；提交前仍会再建一份当前快照。</p>`;
      }

      function renderDiffDetails(diff) {
        const rows = [];
        (diff?.added || []).forEach(item => rows.push({ kind:'新增', uid:item.uid, name:item.entry?.name || '无名条目', paths:[] }));
        (diff?.deleted || []).forEach(item => rows.push({ kind:'删除', uid:item.uid, name:item.entry?.name || '无名条目', paths:[] }));
        (diff?.updated || []).forEach(item => rows.push({ kind:'更新', uid:item.uid, name:item.nameAfter || item.nameBefore || '无名条目', paths:(item.changes || []).map(change => change.path).slice(0, 8) }));
        (diff?.moved || []).forEach(item => rows.push({ kind:'移动', uid:item.uid, name:`索引 ${item.fromIndex} → ${item.toIndex}`, paths:[] }));
        if (!rows.length) return '<p class="wbm-note">没有字段差异；确认后仍会建立恢复前快照。</p>';
        const visible = rows.slice(0, 16);
        return `<details class="wbm-diff-detail" open><summary>受影响条目 ${rows.length} 项${rows.length > visible.length ? `（显示前 ${visible.length} 项）` : ''}</summary>${visible.map(row => `<div class="wbm-diff-row"><span class="wbm-diff-kind">${escapeHtml(row.kind)} · UID ${escapeHtml(row.uid ?? '—')}</span><span><b>${escapeHtml(row.name)}</b>${row.paths.length ? `<br><span class="wbm-diff-paths">${row.paths.map(escapeHtml).join(' · ')}</span>` : ''}</span></div>`).join('')}</details>`;
      }

      function renderPending() {
        if (!pendingPlan) return '';
        const summary = pendingPlan.diff?.summary || {};
        const counts = baselineCounts();
        const label = pendingPlan.kind === 'core' ? `恢复核心 ${counts.core} 条` : pendingPlan.kind === 'core-variable' ? `恢复核心 + 变量 ${counts.total} 条` : pendingPlan.kind === 'opening-body' ? '恢复开局正文出厂模板' : '恢复完整历史快照';
        const openingDetail = pendingPlan.kind === 'opening-body'
          ? `<details class="wbm-diff-detail" open><summary>正文草稿变化</summary><div class="wbm-diff-row"><span class="wbm-diff-kind">更新 · /openingDay/body</span><span>当前 ${escapeHtml(shortHash(pendingPlan.openingPreview?.currentHash))}<br>出厂 ${escapeHtml(shortHash(pendingPlan.openingPreview?.factoryHash))}</span></div></details><p class="wbm-note">此动作不修改世界书；执行前会在当前聊天内保留一份可撤销正文。</p>`
          : renderDiffDetails(pendingPlan.diff);
        const revisionNote = pendingPlan.kind === 'opening-body' ? '' : `<p class="wbm-note">计划基于 ${escapeHtml(shortHash(pendingPlan.expectedRevision))}；若世界书已变化，提交会被 revision 冲突门拒绝。</p>`;
        return `<div class="wbm-confirm"><strong>${escapeHtml(label)} · 请再次确认</strong><div class="wbm-diff"><span>新增 ${Number(summary.added || 0)}</span><span>更新 ${Number(summary.updated || 0)}</span><span>删除 ${Number(summary.deleted || 0)}</span><span>移动 ${Number(summary.moved || 0)}</span></div>${openingDetail}${revisionNote}<div class="wbm-actions"><button class="wbm-button danger" data-wbm-action="commit-restore">确认执行恢复</button><button class="wbm-button" data-wbm-action="cancel-restore">取消</button></div></div>`;
      }

      function render() {
        if (!root) return;
        const counts = baselineCounts();
        root.innerHTML = `<div class="wbm-panel" role="dialog" aria-modal="true" aria-label="世界书备份与恢复">
          <header class="wbm-head"><div><div class="wbm-kicker">WORLDBOOK MANAGER · P5</div><h2>世界书备份与恢复</h2><p>只读列表与可回滚恢复；条目正文编辑将在 P6 独立页面提供。</p></div><button class="wbm-close" data-wbm-action="close">关闭</button></header>
          <main class="wbm-main"><section class="wbm-col"><div class="wbm-stats">
            <div class="wbm-stat"><span>绑定世界书</span><b title="${escapeHtml(view.snapshotInfo.worldbookName)}">${escapeHtml(view.snapshotInfo.worldbookName || '未定位')}</b></div>
            <div class="wbm-stat"><span>当前 revision</span><b>${escapeHtml(shortHash(view.revision))}</b></div>
            <div class="wbm-stat"><span>出厂基线 SHA</span><b>${escapeHtml(shortHash(baseline?.sha256))}</b></div>
            <div class="wbm-stat"><span>备份后端</span><b>${escapeHtml(view.snapshotInfo.backend || 'unavailable')}</b></div>
          </div>
          <div class="wbm-section"><h3>出厂恢复</h3><div class="wbm-actions"><button class="wbm-button primary" data-wbm-action="preview-core" ${loading || !baseline ? 'disabled' : ''}>恢复核心 ${counts.core}</button><button class="wbm-button" data-wbm-action="preview-all" ${loading || !baseline ? 'disabled' : ''}>恢复核心 + 变量 ${counts.total}</button></div><p class="wbm-note wbm-safe">不会删除或启用：用户条目、当前身份/世界因子、工坊包与 program-only 开局模板。</p>${renderPending()}</div>
          <div class="wbm-section"><h3>当前条目 · 只读</h3>${renderEntries()}</div></section>
          <aside class="wbm-col"><div class="wbm-section"><h3>历史快照 · 最近 ${view.snapshotInfo.snapshots?.length || 0} / 10</h3>${renderSnapshots()}</div>
          <div class="wbm-section"><h3>开局正文出厂模板</h3><p class="wbm-note">这是当前聊天的开局正文草稿，不属于世界书核心恢复。</p><div class="wbm-actions"><button class="wbm-button" data-wbm-action="restore-opening" ${typeof restoreOpeningBody === 'function' ? '' : 'disabled'}>单独恢复开局正文</button>${openingUndoAvailable && typeof undoOpeningBodyRestore === 'function' ? '<button class="wbm-button" data-wbm-action="undo-opening">撤销刚才的正文恢复</button>' : ''}</div></div>
          <div class="wbm-section"><h3>状态</h3><div class="wbm-message ${view.message.startsWith('错误：') ? 'wbm-error' : ''}">${escapeHtml(view.message || '就绪')}</div><div class="wbm-actions"><button class="wbm-button" data-wbm-action="refresh">刷新</button></div></div></aside></main></div>`;
      }

      async function refresh() {
        if (loading || destroyed) return;
        loading = true;
        view.message = '正在读取世界书与快照…';
        render();
        try {
          let baselineError = null;
          if (!baseline && typeof baselineProvider === 'function') {
            try { baseline = await baselineProvider(); } catch (error) { baselineError = error; }
          }
          const [entries, revision, snapshotInfo] = await Promise.all([manager.readAll(), manager.getRevision(), manager.listSnapshots()]);
          view = { ...view, entries, revision, snapshotInfo, message:baselineError
            ? `已读取 ${entries.length} 条与本地历史快照；出厂基线暂不可用：${baselineError?.message || String(baselineError)}`
            : `已读取 ${entries.length} 条；出厂恢复集 ${baselineCounts().total} 条。` };
        } catch (error) { view.message = '错误：' + (error?.message || String(error)); }
        finally { loading = false; render(); }
      }

      async function previewRestore(kind, snapshotId = '') {
        if (loading) return;
        loading = true;
        pendingPlan = null;
        view.message = '正在生成恢复 diff…';
        render();
        try {
          pendingPlan = await manager.prepareRestore({ kind, baseline:kind === 'snapshot' ? null : baseline, snapshotId });
          view.message = diffCount(pendingPlan.diff) ? '恢复计划已生成，请检查 diff 后再次确认。' : '当前内容已与目标一致；仍可确认执行并留下恢复前快照。';
        } catch (error) { view.message = '错误：' + (error?.message || String(error)); }
        finally { loading = false; render(); }
      }

      async function commitRestore() {
        if (!pendingPlan || loading) return;
        loading = true;
        if (pendingPlan.kind === 'opening-body') {
          view.message = '正在保存当前正文并恢复出厂模板…';
          render();
          try {
            const result = await restoreOpeningBody(pendingPlan.openingPreview);
            openingUndoAvailable = result?.undoAvailable !== false;
            pendingPlan = null;
            view.message = '开局正文已恢复；世界书未改动，可用“撤销刚才的正文恢复”回退。';
          } catch (error) { view.message = '错误：' + (error?.message || String(error)); }
          finally { loading = false; render(); }
          return;
        }
        const planId = pendingPlan.planId;
        view.message = '正在建立恢复前快照并提交…';
        render();
        try {
          await manager.commitPreparedRestore(planId);
          pendingPlan = null;
          view.message = '恢复完成；恢复前状态已进入历史快照，可立即回退。';
          loading = false;
          await refresh();
        } catch (error) { view.message = '错误：' + (error?.message || String(error)); loading = false; render(); }
      }

      async function onClick(event) {
        const button = event.target.closest('[data-wbm-action]');
        if (!button || !root?.contains(button)) return;
        const action = button.dataset.wbmAction;
        if (action === 'close') close();
        else if (action === 'refresh') await refresh();
        else if (action === 'preview-core') await previewRestore('core');
        else if (action === 'preview-all') await previewRestore('core-variable');
        else if (action === 'preview-snapshot') await previewRestore('snapshot', root.querySelector('[data-wbm-snapshot]')?.value || '');
        else if (action === 'commit-restore') await commitRestore();
        else if (action === 'cancel-restore') { if (pendingPlan?.kind !== 'opening-body') manager.discardPreparedRestore?.(pendingPlan?.planId); pendingPlan = null; view.message = '已取消，世界书未改动。'; render(); }
        else if (action === 'restore-opening' && typeof restoreOpeningBody === 'function') {
          try {
            const openingPreview = typeof previewOpeningBodyRestore === 'function' ? await previewOpeningBodyRestore() : {};
            if (openingPreview?.changed === false) {
              pendingPlan = null;
              view.message = '当前开局正文已经是出厂模板；未执行重复恢复，原撤销点保持不变。';
              render();
              return;
            }
            pendingPlan = { planId:'opening-body', kind:'opening-body', openingPreview, diff:{ summary:{ added:0, updated:openingPreview?.changed === false ? 0 : 1, deleted:0, moved:0 } } };
            view.message = '开局正文恢复预览已生成，请检查 hash 后再次确认。';
          } catch (error) { view.message = '错误：' + (error?.message || String(error)); }
          render();
        } else if (action === 'undo-opening' && typeof undoOpeningBodyRestore === 'function') {
          try { await undoOpeningBodyRestore(); openingUndoAvailable = false; view.message = '已撤销刚才的开局正文恢复；世界书未改动。'; }
          catch (error) { view.message = '错误：' + (error?.message || String(error)); }
          render();
        }
      }

      function mount() {
        if (destroyed) throw new Error('worldbook manager UI 已销毁');
        if (root?.isConnected) return root;
        ensureStyle();
        root = hostDocument.createElement('div');
        root.className = 'wbm-shell';
        root.hidden = true;
        root.addEventListener('click', onClick);
        (hostDocument.body || hostDocument.documentElement).appendChild(root);
        render();
        return root;
      }
      async function open() { mount(); root.hidden = false; await refresh(); return root; }
      function close() { if (root) root.hidden = true; if (pendingPlan?.kind !== 'opening-body') manager.discardPreparedRestore?.(pendingPlan?.planId); pendingPlan = null; }
      function destroy() { if (destroyed) return; destroyed = true; if (pendingPlan?.kind !== 'opening-body') manager.discardPreparedRestore?.(pendingPlan?.planId); if (root) { root.removeEventListener('click', onClick); root.remove(); } root = null; pendingPlan = null; }

      return { mount, open, close, refresh, destroy, get root() { return root; }, get pendingPlan() { return pendingPlan; } };
    }
    return { createWorldbookManagerUI };
  })();
  // </shared-worldbook-manager-ui-v0.1.0>
  function worldbookStorageCapability(name) {
    try { return hostWindow()?.[name] || window?.[name] || null; } catch (_) { return null; }
  }
  const worldbookSnapshotStore = sharedWorldbookManager.createWorldbookSnapshotStore({
    indexedDB:worldbookStorageCapability('indexedDB'),
    localStorage:worldbookStorageCapability('localStorage'),
    maxPerWorldbook:10,
    now:() => new Date().toISOString(),
    randomUUID:() => {
      try { return hostWindow()?.crypto?.randomUUID?.() || window?.crypto?.randomUUID?.() || createRuntimeOwnerId(); }
      catch (_) { return createRuntimeOwnerId(); }
    },
  });
  const WORLDBOOK_FACTORY_PROTECTED_UIDS = Object.freeze({
    0:'core', 1:'core', 9:'core', 10:'core', 11:'core', 12:'core', 13:'core', 14:'core',
    27:'variable', 30:'core', 31:'core', 32:'core', 33:'core', 34:'core', 35:'core', 36:'core', 37:'core', 38:'core', 39:'core', 40:'core', 41:'core', 42:'core', 43:'core', 44:'core', 45:'core', 46:'core', 47:'core',
    55:'variable', 56:'variable', 57:'variable', 58:'variable', 61:'core', 62:'core', 63:'core', 64:'core', 65:'core', 66:'core', 67:'core', 69:'core',
  });
  const worldbookManager = sharedWorldbookManager.createWorldbookManager({
    nameMatchers: [/星月私立高等学院\s*ver/],
    sourcePrefix: 'xingyue',
    entryNameScheme: {
      identity: IDENTITY_COMMENT,
      worldFactor: WORLD_FACTOR_COMMENT,
      workshopStart: WORKSHOP_START_COMMENT,
      workshopEnd: WORKSHOP_END_COMMENT,
    },
    version: VERSION,
    now: () => new Date().toISOString(),
    eventTarget: window,
    snapshotStore:worldbookSnapshotStore,
    snapshotRequired:true,
    protectedEntryClassifier:uid => WORLDBOOK_FACTORY_PROTECTED_UIDS[uid] || '',
    programOnlyPolicy: {
      detect: ({ packageType, packageTarget }) => packageType === 'world_factor' && packageTarget === 'xingyue.opening_day_body',
      requires: entry => entry?.meta?.packageTarget === 'xingyue.opening_day_body',
      validate: entry => entry?.meta?.source === WORKSHOP_SOURCE && entry?.meta?.kind === 'workshop_package'
        && entry?.meta?.packageType === 'world_factor' && entry?.meta?.packageTarget === 'xingyue.opening_day_body'
        ? true
        : '星月 programOnly 条目必须来自 xingyue-workshop 且是 world_factor + xingyue.opening_day_body',
    },
  });
  const WORLDBOOK_FACTORY_BASELINE_URLS = [
    RUNTIME_BASE_URL + '/worldbook-factory-baseline.json?v=p9-r1',
    'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.4.7/worldbook-factory-baseline.json?v=p9-r1',
    'https://raw.githubusercontent.com/LiarMTTT/rolecard-diy-workshop/main/runtime/xingyue/3.4.7/worldbook-factory-baseline.json?v=p9-r1',
  ];
  const WORLDBOOK_FACTORY_BASELINE_SHA256 = '3fa604942c018c9aca2a5106d371f0f272cf404fa23383f1be2a034d91e65108';
  let worldbookFactoryBaselinePromise = null;
  async function loadWorldbookFactoryBaseline() {
    if (worldbookFactoryBaselinePromise) return worldbookFactoryBaselinePromise;
    worldbookFactoryBaselinePromise = (async () => {
      let lastError = null;
      for (const url of WORLDBOOK_FACTORY_BASELINE_URLS) {
        try {
          const response = await fetch(url, { cache:'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          if (data?.schema !== 'worldbook-factory-baseline-v1' || data?.cardVersion !== VERSION || data?.sha256 !== WORLDBOOK_FACTORY_BASELINE_SHA256 || data?.counts?.core !== 34 || data?.counts?.variable !== 5 || data?.counts?.total !== 39) throw new Error('3.4.7 出厂基线契约或固定 SHA-256 不匹配');
          return data;
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error('无法加载 3.4.7 世界书出厂基线');
    })().catch(error => { worldbookFactoryBaselinePromise = null; throw error; });
    return worldbookFactoryBaselinePromise;
  }
  let openingDayFactoryUndo = null;
  function openingDayFactoryRestoreFingerprint(value) {
    const normalized = normalizeOpeningDayDraft(value);
    const Encoder = typeof TextEncoder === 'function' ? TextEncoder : null;
    return sha256HexFallback(JSON.stringify(normalized), Encoder);
  }
  function previewOpeningDayFactoryRestore() {
    const status = openingDraftService.status();
    if (!status.ready) throw new Error('开局草稿仍在初始化，请稍后重试');
    const current = normalizeOpeningDayDraft(readOpeningDraft().openingDay);
    const factory = copyOfficialOpeningDay();
    return {
      schema:'xingyue-opening-factory-restore-v1',
      chatId:status.chatId,
      uuid:status.uuid,
      changed:current.bodyHash !== factory.bodyHash || current.origin !== factory.origin || current.sourceRevision !== factory.sourceRevision,
      currentHash:current.bodyHash,
      currentFingerprint:openingDayFactoryRestoreFingerprint(current),
      factoryHash:factory.bodyHash,
      factoryFingerprint:openingDayFactoryRestoreFingerprint(factory),
      currentOrigin:current.origin,
      currentBytes:openingStoryUtf8Bytes(current.body),
      factoryBytes:openingStoryUtf8Bytes(factory.body),
    };
  }
  function restoreOpeningDayFactoryDraft(plan) {
    if (!plan || plan.schema !== 'xingyue-opening-factory-restore-v1') throw new Error('开局正文恢复计划无效，请重新预览');
    const status = openingDraftService.status();
    if (!status.ready) throw new Error('开局草稿仍在初始化，请稍后重试');
    if (status.chatId !== plan.chatId || status.uuid !== plan.uuid) throw new Error('聊天已切换，请在当前聊天重新预览开局正文恢复');
    const current = normalizeOpeningDayDraft(readOpeningDraft().openingDay);
    const currentFingerprint = openingDayFactoryRestoreFingerprint(current);
    if (current.bodyHash !== plan.currentHash || currentFingerprint !== plan.currentFingerprint) throw new Error('开局正文已在预览后变化，请重新预览 diff');
    const factory = copyOfficialOpeningDay();
    const factoryFingerprint = openingDayFactoryRestoreFingerprint(factory);
    if (plan.factoryHash !== factory.bodyHash || plan.factoryFingerprint !== factoryFingerprint) throw new Error('出厂正文已更新，请重新预览 diff');
    const sameUndo = openingDayFactoryUndo && openingDayFactoryUndo.chatId === status.chatId && openingDayFactoryUndo.uuid === status.uuid;
    if (currentFingerprint === factoryFingerprint) return { changed:false, undoAvailable:!!sameUndo, draft:readOpeningDraft() };
    if (!sameUndo) {
      openingDayFactoryUndo = {
        chatId:status.chatId,
        uuid:status.uuid,
        openingDay:clone(current),
        restoredFingerprint:factoryFingerprint,
      };
    }
    const draft = writeOpeningDraft({ openingDay:factory }, { immediate:true });
    return { changed:true, undoAvailable:true, draft };
  }
  function undoOpeningDayFactoryRestore() {
    if (!openingDayFactoryUndo) throw new Error('没有可撤销的开局正文恢复');
    const status = openingDraftService.status();
    if (status.chatId !== openingDayFactoryUndo.chatId || status.uuid !== openingDayFactoryUndo.uuid) throw new Error('聊天已切换，不能把上一聊天的正文恢复到当前聊天');
    const currentFingerprint = openingDayFactoryRestoreFingerprint(readOpeningDraft().openingDay);
    if (currentFingerprint !== openingDayFactoryUndo.restoredFingerprint) throw new Error('开局正文已在恢复后再次编辑，拒绝用旧撤销点覆盖新内容');
    const previous = openingDayFactoryUndo;
    const draft = writeOpeningDraft({ openingDay:previous.openingDay }, { immediate:true });
    openingDayFactoryUndo = null;
    return { changed:true, draft };
  }
  let worldbookManagerUi = null;
  function ensureWorldbookManagerUi() {
    if (worldbookManagerUi) return worldbookManagerUi;
    worldbookManagerUi = sharedWorldbookManagerUI.createWorldbookManagerUI({
      manager:worldbookManager,
      hostDocument:hostDocument(),
      baselineProvider:loadWorldbookFactoryBaseline,
      previewOpeningBodyRestore:async () => previewOpeningDayFactoryRestore(),
      restoreOpeningBody:async plan => restoreOpeningDayFactoryDraft(plan),
      undoOpeningBodyRestore:async () => undoOpeningDayFactoryRestore(),
    });
    return worldbookManagerUi;
  }
  async function openWorldbookManager() { return ensureWorldbookManagerUi().open(); }
  function closeWorldbookManager() { worldbookManagerUi?.close(); }
  const WORLDBOOK_EDITOR_SOURCE_SHA256 = 'c4e22c2761f4c848bb38d25493820dec91cca1960e7a2f6734124a15873b0195';
  const WORLDBOOK_EDITOR_URLS = [
    RUNTIME_BASE_URL + '/worldbook-editor.js?v=p7-r1',
    'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.4.7/worldbook-editor.js?v=p7-r1',
    'https://raw.githubusercontent.com/LiarMTTT/rolecard-diy-workshop/main/runtime/xingyue/3.4.7/worldbook-editor.js?v=p7-r1',
  ];
  let worldbookEditorModulePromise = null;
  let worldbookEditor = null;
  async function loadWorldbookEditorModule() {
    if (worldbookEditorModulePromise) return worldbookEditorModulePromise;
    worldbookEditorModulePromise = (async () => {
      let lastError = null;
      for (const url of WORLDBOOK_EDITOR_URLS) {
        try {
          const response = await fetch(url, { cache:'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const code = await response.text();
          const digest = sha256HexFallback(code, typeof TextEncoder === 'function' ? TextEncoder : null);
          if (digest !== WORLDBOOK_EDITOR_SOURCE_SHA256) throw new Error('P7 编辑器 SHA-256 不匹配');
          const blobUrl = URL.createObjectURL(new Blob([code], { type:'text/javascript' }));
          try {
            const module = await import(blobUrl);
            if (module?.WORLDBOOK_EDITOR_VERSION !== '0.2.0' || module?.WORLDBOOK_EDITOR_BUILD !== 'xingyue-p7-r1' || typeof module?.createWorldbookEditor !== 'function') throw new Error('P7 编辑器版本或导出契约不匹配');
            return module;
          } finally { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error('无法加载 P7 世界书编辑器');
    })().catch(error => { worldbookEditorModulePromise = null; throw error; });
    return worldbookEditorModulePromise;
  }
  function focusCurrentChatOpeningEditor() {
    const doc = hostDocument();
    const input = doc.querySelector?.('[data-xy-opening-story-body]');
    if (!input) throw new Error('当前聊天未找到开局正文编辑框');
    try { input.closest?.('details')?.setAttribute?.('open',''); } catch (_) {}
    try { input.scrollIntoView?.({ block:'center', behavior:'smooth' }); } catch (_) {}
    input.focus?.();
    return true;
  }
  async function ensureWorldbookEditor() {
    if (runtimeDestroyed) throw new Error('控制中心已销毁，不能打开世界书编辑器');
    if (worldbookEditor) return worldbookEditor;
    const module = await loadWorldbookEditorModule();
    if (runtimeDestroyed) throw new Error('控制中心已销毁，已放弃迟到的编辑器模块');
    const editor = module.createWorldbookEditor({
      manager:worldbookManager,
      hostDocument:hostDocument(),
      baselineProvider:loadWorldbookFactoryBaseline,
      aiAssistant:worldbookAiAssistant,
      openRecovery:async () => { worldbookEditor?.close?.(); return openWorldbookManager(); },
      openCurrentChatOpeningEditor:async () => { worldbookEditor?.close?.(); return focusCurrentChatOpeningEditor(); },
    });
    if (runtimeDestroyed) { try { editor.destroy?.(); } catch (_) {} throw new Error('控制中心已销毁，已清理迟到的编辑器实例'); }
    worldbookEditor = editor;
    return worldbookEditor;
  }
  async function openWorldbookEditor() {
    try { const editor = await ensureWorldbookEditor(); if (runtimeDestroyed) throw new Error('控制中心已销毁，不能打开世界书编辑器'); return await editor.open(); }
    catch (error) { if (!runtimeDestroyed) toast('error', '世界书编辑器加载失败，可重试：' + (error?.message || String(error))); throw error; }
  }
  function closeWorldbookEditor() { worldbookEditor?.close?.(); }
  async function previewWorldbookRestore(options = {}) {
    const kind = options.kind;
    const baseline = kind === 'snapshot' ? null : await loadWorldbookFactoryBaseline();
    return worldbookManager.prepareRestore({ kind, baseline, snapshotId:options.snapshotId || '' });
  }
  function commitWorldbookRestore(planId) { return worldbookManager.commitPreparedRestore(planId); }
  function workshopBusinessItem(pkg, item = null) {
    const target = String(item?.packageTarget || pkg?.payload?.target || pkg?.packageTarget || pkg?.type || item?.packageType || 'generic');
    const programOnly = item?.programOnly === true || pkg?.programOnly === true || target === 'xingyue.opening_day_body';
    return {
      comment: item?.comment || '[星月工坊][' + pkg.type + ']' + pkg.title,
      title: pkg.title,
      content: item?.content || packageToWorldbookText(pkg),
      packageId: item?.packageId || pkg.id,
      packageType: item?.packageType || pkg.type,
      packageTarget: target,
      programOnly,
      enabled: programOnly ? false : (item?.enabled !== false),
      revision: item?.revision || packageRevision(pkg),
      contentHash: item?.contentHash,
      installedAt: item?.installedAt,
    };
  }
  async function writeOpeningWorldbookEntries(draft = readOpeningDraft(), options = {}) {
    const scope = options.scope || 'all';
    assertOpeningChatContext(options.expectedContext);
    const payload = openingWorldbookPayload(draft);
    const workshopEntries = payload.workshopEntries.map(item => workshopBusinessItem({
      id:item.packageId, type:item.packageType, title:String(item.comment || '').replace(/^.*?]/, ''),
      payload:{ target:item.packageTarget }, revision:item.revision,
    }, item));
    const guard = () => {
      assertOpeningChatContext(options.expectedContext);
      if (payload.identitySuppressedByPersona) {
        const latestAuthority = personaIdentityAuthority(draft);
        if (!latestAuthority.suppressWorldbook || latestAuthority.snapshot?.fingerprint !== payload.identityAuthority.fingerprint) {
          throw new Error('Persona 已切换或内容已变化，取消身份世界书去重');
        }
      }
    };
    const result = await worldbookManager.write({
      scope,
      identity:payload.identity,
      worldFactor:payload.worldFactor,
      workshopEntries,
      allowEmptyIdentity:payload.identitySuppressedByPersona,
      expectedRevision:options.expectedRevision,
      guard,
    });
    payload.worldbookName = result.worldbookName;
    payload.applied = result.applied === true;
    payload.warning = result.warning || '';
    payload.scope = scope;
    payload.beforeRevision = result.beforeRevision || null;
    payload.revision = result.afterRevision || null;
    payload.diff = result.diff || null;
    dispatchOpeningWorldbookPreview(payload);
    return payload;
  }
  async function installWorkshopPackageEntries(pkg, options = {}) {
    const item = workshopBusinessItem(pkg);
    const payload = { worldFactor:'', workshopEntries:[item], worldbookName:null, applied:false, warning:'' };
    const canonical = worldbookManager.preview({ workshopEntries:[item] });
    const result = await worldbookManager.writeBatch(canonical, { expectedRevision:options.expectedRevision });
    payload.worldbookName = result.worldbookName;
    payload.applied = result.applied === true;
    payload.warning = result.warning || '';
    payload.beforeRevision = result.beforeRevision || null;
    payload.revision = result.afterRevision || null;
    payload.diff = result.diff || null;
    dispatchOpeningWorldbookPreview(payload);
    return payload;
  }
  function workshopEntryMatchesPackage(entry, pkg) {
    const meta = entry?.meta || {};
    const target = String(pkg?.payload?.target || pkg?.packageTarget || pkg?.type || 'generic');
    return meta.kind === 'workshop_package' && meta.source === WORKSHOP_SOURCE
      && String(meta.packageId || '') === String(pkg?.id || '')
      && String(meta.packageType || '') === String(pkg?.type || '')
      && String(meta.packageTarget || '') === target;
  }
  function installedEntryContentHash(entry) {
    return sha256HexFallback(String(entry?.content || ''), typeof TextEncoder === 'function' ? TextEncoder : null);
  }
  function workshopEntryBehaviorSignature(entry) {
    const keys = ['enabled','strategyType','positionType','role','depth','order','group','groupOverride','groupWeight','probability','recursion','primaryKeys','secondaryKeys'];
    return stableStringify(Object.fromEntries(keys.map(key => [key, entry?.[key]])));
  }
  function expectedWorkshopEntry(pkg) {
    return worldbookManager.preview({ workshopEntries:[workshopBusinessItem(pkg)] })[0];
  }
  async function inspectWorkshopPackage(pkg) {
    pkg = validatePackage(pkg);
    const managed = await worldbookManager.readManaged('workshop');
    const entry = managed.find(item => workshopEntryMatchesPackage(item, pkg)) || null;
    const recordedHash = String(entry?.meta?.contentHash || '');
    const actualHash = entry ? installedEntryContentHash(entry) : '';
    const expected = expectedWorkshopEntry(pkg);
    const expectedHash = installedEntryContentHash(expected);
    const contentDirty = !!entry && (!/^[a-f0-9]{64}$/.test(recordedHash) || actualHash !== recordedHash);
    const behaviorDirty = !!entry?.meta?.localModifiedAt && workshopEntryBehaviorSignature(entry) !== workshopEntryBehaviorSignature(expected);
    return {
      installed:!!entry,
      dirty:contentDirty || behaviorDirty,
      contentDirty,
      behaviorDirty,
      expectedHash,
      uid:entry?.uid ?? null,
      title:entry?.name || pkg.title,
      recordedHash,
      actualHash,
      localModifiedAt:String(entry?.meta?.localModifiedAt || ''),
      revision:entry?.meta?.revision ?? null,
      entry:entry ? clone(entry) : null,
    };
  }
  function detachedWorkshopCopy(entry) {
    const copyEntry = clone(entry);
    delete copyEntry.uid;
    copyEntry.name = String(copyEntry.name || '工坊条目') + '（用户副本 ' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '）';
    const meta = { ...(copyEntry.meta || {}) };
    ['source','kind','packageId','packageType','packageTarget','programOnly','revision','contentHash','installedAt','localModifiedAt','version'].forEach(key => { delete meta[key]; });
    meta.detachedFromPackageId = String(entry?.meta?.packageId || '');
    meta.detachedFromPackageType = String(entry?.meta?.packageType || '');
    meta.detachedFromPackageTarget = String(entry?.meta?.packageTarget || '');
    meta.detachedFromContentHash = installedEntryContentHash(entry);
    copyEntry.meta = meta;
    if (entry?.meta?.programOnly === true) copyEntry.enabled = false;
    return copyEntry;
  }
  async function installOrUpdateWorkshopPackage(pkg, options = {}) {
    pkg = validatePackage(pkg);
    const opening = pkg.cardScope === OPENING_PACKAGE_SCOPE;
    if (opening && (!Number.isInteger(Number(pkg.revision)) || Number(pkg.revision) < 1)) {
      throw new Error('开局正文包必须来自带有效 revision 的工坊详情；本地 JSON 可预览或导入，但不能伪装为已安装来源');
    }
    const inspected = await inspectWorkshopPackage(pkg);
    const incomingRevision = Number(pkg.revision);
    const installedRevision = Number(inspected.revision);
    if (inspected.installed && Number.isInteger(incomingRevision) && Number.isInteger(installedRevision)) {
      if (incomingRevision < installedRevision) throw new Error('拒绝用旧 revision 回滚已安装工坊包');
      if (incomingRevision === installedRevision && inspected.expectedHash !== inspected.recordedHash) throw new Error('同 revision 的包正文与已安装来源不一致，请刷新工坊详情');
    }
    const decision = String(options.dirtyDecision || '').toLowerCase();
    if (inspected.dirty && !['overwrite','keep','detach'].includes(decision)) {
      const error = new Error('本地工坊条目已修改，更新前必须选择：覆盖 / 保留当前 / 脱离为用户副本');
      error.code = 'workshop-dirty-decision-required';
      error.inspection = inspected;
      throw error;
    }
    if (inspected.dirty && decision === 'keep') return { applied:false, kept:true, inspection:inspected };
    const incoming = worldbookManager.preview({ workshopEntries:[workshopBusinessItem(pkg)] });
    const upserts = inspected.dirty && decision === 'detach' ? [detachedWorkshopCopy(inspected.entry), ...incoming] : incoming;
    const result = await worldbookManager.writeBatch(upserts, { expectedRevision:options.expectedRevision });
    return { ...result, updated:inspected.installed, detached:inspected.dirty && decision === 'detach', inspection:inspected };
  }
  async function uninstallWorkshopPackage(pkg, options = {}) {
    pkg = validatePackage(pkg);
    const baseRevision = options.expectedRevision ?? await worldbookManager.getRevision();
    const managed = await worldbookManager.readManaged('workshop');
    const target = managed.find(item => workshopEntryMatchesPackage(item, pkg));
    if (!target) return { applied:false, uninstalled:false, warning:'该包尚未安装到世界书' };
    const allEntries = await worldbookManager.readAll();
    const alreadyPreserved = allEntries.some(entry => entry?.meta?.detachedFromPackageId === String(target.meta.packageId || '')
      && entry?.meta?.detachedFromPackageType === String(target.meta.packageType || '')
      && entry?.meta?.detachedFromPackageTarget === String(target.meta.packageTarget || '')
      && entry?.meta?.detachedFromContentHash === installedEntryContentHash(target));
    const currentRevision = await worldbookManager.getRevision();
    if (alreadyPreserved && baseRevision !== null && baseRevision !== undefined && currentRevision !== baseRevision) throw new Error('世界书已在卸载预览后变化，请重新执行卸载');
    const preserved = alreadyPreserved
      ? { applied:false, afterRevision:currentRevision, reused:true }
      : await worldbookManager.writeBatch([detachedWorkshopCopy(target)], { expectedRevision:baseRevision });
    const removalRevision = preserved.afterRevision || options.expectedRevision;
    const latestManaged = await worldbookManager.readManaged('workshop');
    const remaining = latestManaged.filter(item => item?.meta?.kind === 'workshop_package' && !workshopEntryMatchesPackage(item, pkg));
    let result;
    if (remaining.length) {
      result = await worldbookManager.write({
        scope:'workshop',
        expectedRevision:removalRevision,
        workshopEntries:remaining.map(entry => ({
          comment:entry.name, content:entry.content, enabled:entry.enabled,
          packageId:entry.meta.packageId, packageType:entry.meta.packageType, packageTarget:entry.meta.packageTarget,
          programOnly:entry.meta.programOnly === true, revision:entry.meta.revision, contentHash:entry.meta.contentHash, installedAt:entry.meta.installedAt,
        })),
      });
    } else result = await worldbookManager.uninstallWorkshop({ expectedRevision:removalRevision });
    const draft = readOpeningDraft();
    const source = draft.openingDay?.sourcePackage;
    if (source && String(source.id) === String(pkg.id) && String(source.type || 'world_factor') === String(pkg.type)) {
      const openingDay = normalizeOpeningDayDraft(draft.openingDay);
      delete openingDay.sourcePackage;
      openingDay.origin = 'user';
      openingDay.localModifiedAt = new Date().toISOString();
      writeOpeningDraft({ openingDay }, { immediate:true });
    }
    return { ...result, uninstalled:true, preservedOpeningDraft:true, preservedUserCopy:true, preserveResult:preserved };
  }
  async function previewApplyOpeningPackage(pkg) {
    pkg = validatePackage(pkg, ['world_factor']);
    if (pkg.cardScope !== OPENING_PACKAGE_SCOPE || pkg.payload?.target !== OPENING_PACKAGE_TARGET) throw new Error('该包不是 3.4.7 开局正文模板');
    const inspected = await inspectWorkshopPackage(pkg);
    if (!inspected.installed) throw new Error('请先把正文模板安装为禁用来源，再应用到本局');
    if (inspected.dirty) throw new Error('已安装来源存在本地修改，请先完成覆盖 / 保留 / 脱离更新决策');
    if (Number(inspected.revision) !== Number(pkg.revision) || inspected.actualHash !== inspected.expectedHash || inspected.recordedHash !== inspected.expectedHash) throw new Error('当前详情不是已安装的同一 revision，请先安装或更新来源');
    const body = String(pkg.payload.worldFactors?.[0]?.content || '');
    validateOpeningStory(body, { grade:resolveEffectiveGrade(readOpeningDraft()).value });
    const effectiveGrade = resolveEffectiveGrade(readOpeningDraft());
    const band = gradeBand(effectiveGrade.value);
    const scope = pkg.payload.gradeScope || [];
    if (!scope.includes('all') && !scope.includes(band)) throw new Error('当前年级（' + (effectiveGrade.value || '未填写') + '）不在模板适用范围：' + scope.join(' / '));
    const current = normalizeOpeningDayDraft(readOpeningDraft().openingDay);
    return {
      schema:'xingyue-opening-package-apply-v1',
      package:clone(pkg),
      currentHash:current.bodyHash,
      nextHash:openingStoryHash(body),
      currentBody:current.body,
      nextBody:body,
      gradeScope:pkg.payload.gradeScope.slice(),
      expectedContext:openingChatContextSnapshot(),
      gradeValue:effectiveGrade.value,
      gradeBand:band,
      changed:current.bodyHash !== openingStoryHash(body),
    };
  }
  async function applyOpeningPackageToDraft(plan) {
    if (!plan || plan.schema !== 'xingyue-opening-package-apply-v1') throw new Error('开局正文应用计划无效，请重新预览');
    const pkg = validatePackage(plan.package, ['world_factor']);
    assertOpeningChatContext(plan.expectedContext);
    const latestDraft = readOpeningDraft();
    const latestGrade = resolveEffectiveGrade(latestDraft);
    const latestBand = gradeBand(latestGrade.value);
    if (latestGrade.value !== plan.gradeValue || latestBand !== plan.gradeBand) throw new Error('年级已在预览后变化，请重新检查模板适用范围');
    if (!plan.gradeScope.includes('all') && !plan.gradeScope.includes(latestBand)) throw new Error('当前年级已不在模板适用范围');
    const current = normalizeOpeningDayDraft(latestDraft.openingDay);
    if (current.bodyHash !== plan.currentHash) throw new Error('当前正文已在预览后变化，请重新查看 diff');
    const inspected = await inspectWorkshopPackage(pkg);
    if (!inspected.installed) throw new Error('模板来源已被卸载，不能应用');
    if (inspected.dirty || Number(inspected.revision) !== Number(pkg.revision) || inspected.actualHash !== inspected.expectedHash || inspected.recordedHash !== inspected.expectedHash) throw new Error('模板来源已变化，请重新安装并预览');
    const body = String(pkg.payload.worldFactors[0].content);
    validateOpeningStory(body, { grade:latestGrade.value });
    if (openingStoryHash(body) !== plan.nextHash) throw new Error('模板正文已变化，请重新预览');
    const next = normalizeOpeningDayDraft({
      body, origin:'workshop', sourceRevision:String(pkg.revision), baseHash:openingStoryHash(body), bodyHash:openingStoryHash(body),
      gradeScope:pkg.payload.gradeScope,
      sourcePackage:{ id:pkg.id, type:pkg.type, target:OPENING_PACKAGE_TARGET, title:pkg.title, revision:Number(pkg.revision), contentHash:String(pkg.contentHash || '') },
    });
    assertOpeningChatContext(plan.expectedContext);
    const draft = writeOpeningDraft({ openingDay:next }, { immediate:true });
    return { applied:true, draft, openingDay:next };
  }
  function previewOpeningWrites(draft = readOpeningDraft()) {
    const payload = openingWorldbookPayload(draft);
    worldbookManager.preview({
      scope:'all', identity:payload.identity, worldFactor:payload.worldFactor,
      workshopEntries:payload.workshopEntries.map(item => ({ ...item, packageTarget:item.packageTarget || item.packageType })),
    });
    return { identity:payload.identity, worldFactor:payload.worldFactor, workshopEntries:payload.workshopEntries.map(item => item.comment) };
  }

  function readCurrentStatSafe() {
    try { return statRoot(getCurrentMvuData()); } catch (_) { return null; }
  }
  function recipeEntries(root = readCurrentStatSafe()) {
    const recipes = isObject(root?.配方) ? root.配方 : {};
    return Object.entries(recipes).map(([id, value]) => ({
      id,
      title: textOf(value?.名称, id),
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
    return normalizeQuantityRecord(recipe?.输入?.材料, 1).filter(item => item.amount > 0);
  }
  function recipeProducts(recipe, branch) {
    const output = isObject(recipe?.输出) ? recipe.输出 : {};
    if (branch === 'failure') return normalizeQuantityRecord(output.失败副产物, 1);
    if (branch !== 'success') return [];
    return [
      ...normalizeQuantityRecord(output.产物, 1),
      ...normalizeQuantityRecord(output.副产物, 1),
      ...pickWeighted(normalizeQuantityRecord(output.随机产物, 1)),
    ];
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
    const settle = isObject(recipe?.结算) ? recipe.结算 : {};
    let chance = numberOf(settle.成功率, 1);
    if (chance > 1) chance /= 100;
    const check = settle.检定;
    if (isObject(check)) {
      const key = textOf(check.属性 || check.技能);
      const difficulty = numberOf(check.难度, 0);
      const bonus = numberOf(check.加成, 0);
      const attr = numberOf(root?.user?.核心属性?.[key], 0);
      const skillText = root?.天赋与技能?.技能?.[key]?.技能等级 || root?.天赋与技能?.技能?.[key]?.等级;
      const skill = numberOf(skillText, 0);
      if (key) chance += Math.max(attr, skill) * 0.03 + bonus * 0.01 - difficulty * 0.01;
    }
    return Math.max(0, Math.min(1, chance));
  }
  function failureRequirements(recipe, baseRequirements) {
    const source = recipe?.结算?.失败消耗;
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
  function assetExists(root, id) {
    return isObject(root?.资产库?.物品) && Object.prototype.hasOwnProperty.call(root.资产库.物品, id);
  }
  function stripAssetId(list, id) {
    return Array.isArray(list) ? list.filter(item => String(item) !== String(id)) : list;
  }
  function cleanAssetContainerOps(root, ops, id) {
    const containers = root?.资产库?.容器;
    if (!isObject(containers)) return;
    if (Array.isArray(containers.随身)) {
      const next = stripAssetId(containers.随身, id);
      if (next.length !== containers.随身.length) ops.push(opForPath(root, ['资产库', '容器', '随身'], next));
    }
    ['仓储', '放置'].forEach(bucket => {
      const group = containers[bucket];
      if (!isObject(group) || Array.isArray(group)) return;
      Object.keys(group).forEach(place => {
        const current = group[place];
        const next = stripAssetId(current, id);
        if (Array.isArray(current) && next.length !== current.length) {
          ops.push(opForPath(root, ['资产库', '容器', bucket, place], next));
        }
      });
    });
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
    const consumedAmounts = new Map();
    const removedAssets = new Set();
    ensureAssetPatch(root, ops);
    consume.forEach(req => {
      const item = inventoryItem(root, req.id);
      const current = inventoryAmount(root, req.id);
      const nextAmount = Math.max(0, current - req.amount);
      consumedAmounts.set(req.id, (consumedAmounts.get(req.id) || 0) + req.amount);
      if (nextAmount <= 0) {
        if (assetExists(root, req.id)) {
          ops.push({ op: 'remove', path: '/资产库/物品/' + pointerEscape(req.id) });
          removedAssets.add(req.id);
        }
        cleanAssetContainerOps(root, ops, req.id);
      } else if (isObject(item)) {
        ops.push(opForPath(root, ['资产库', '物品', req.id], { ...clone(item), 数量: nextAmount }));
      } else {
        ops.push(opForPath(root, ['资产库', '物品', req.id], { 名称: req.id, 数量: nextAmount }));
      }
    });
    products.forEach(product => {
      const existing = inventoryItem(root, product.id);
      const current = Math.max(0, inventoryAmount(root, product.id) - (consumedAmounts.get(product.id) || 0));
      const value = isObject(existing)
        ? { ...clone(existing), 数量: current + product.amount }
        : { 名称: product.data?.名称 || product.id, 数量: product.amount, 来源: '配方制造' };
      ops.push(removedAssets.has(product.id)
        ? { op: 'add', path: '/资产库/物品/' + pointerEscape(product.id), value }
        : opForPath(root, ['资产库', '物品', product.id], value));
    });
    if (products.length) {
      const carried = Array.isArray(root?.资产库?.容器?.随身)
        ? root.资产库.容器.随身.filter(id => !removedAssets.has(String(id)))
        : [];
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
  async function applyCraftSettlement(recipeId, options = {}) {
    const expectedContextKey = String(options.expectedContextKey || hudCurrentContextKey());
    const expectedContextRevision = hudSession.contextRevision;
    assertHudExpectedContext(expectedContextKey, expectedContextRevision);
    const messageId = hudCurrentMsgId();
    const settlement = buildCraftSettlement(recipeId, { commit: true });
    if (!settlement.ok) throw new Error(settlement.message + '：' + settlement.missing.map(item => item.id + ' ' + item.available + '/' + item.amount).join('，'));
    const Mvu = mvuHost();
    if (!Mvu?.replaceMvuData) throw new Error('MVU 写入接口尚未就绪');
    assertHudExpectedContext(expectedContextKey, expectedContextRevision);
    const mvuOptions = { type: 'message', message_id: messageId };
    const oldData = clone(Mvu.getMvuData(mvuOptions) || { stat_data: {} });
    const message = wrapUpdateVariableBlock('制造/改造结算：扣除材料、写入产物、同步容器列表并追加流转记录。', settlement.patch);
    let nextData = null;
    if (typeof Mvu.parseMessage === 'function') {
      try { nextData = await Mvu.parseMessage(message, oldData); } catch (_) { nextData = null; }
    }
    if (!nextData) {
      nextData = clone(oldData);
      applyPatchObject(statRoot(nextData), settlement.patch);
    }
    nextData = validateHudMvuData(nextData);
    assertHudExpectedContext(expectedContextKey, expectedContextRevision);
    await Mvu.replaceMvuData(nextData, mvuOptions);
    emitHudSignal('data-changed', { force: true });
    lastCraftPreview = settlement;
    toast('success', '制造/改造结算已写入当前楼变量');
    renderPanel();
    return settlement;
  }
  // B17 变量微调工具：修一个错变量不必重 roll 整条消息——省一次正文生成成本，所有 MVU 卡通用。
  // 共用写回三段式：generateRaw 只生成变量 → Mvu.parseMessage 解析 <UpdateVariable> → replaceMvuData 只写当前楼，不改正文、不动历史楼。
  let variableGenerationInFlight = false;
  async function withBusyButton(button, busyText, task) {
    const oldText = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = busyText || '正在重算…';
    }
    try { return await task(); }
    finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = oldText;
      }
    }
  }
  function captureVariableOperationContext(floorId) {
    const requestedFloor = floorId == null ? 'latest' : floorId;
    const requestedMessage = messageInfoAt(requestedFloor);
    const latestId = hudCurrentMsgId();
    const resolvedFloor = requestedFloor === 'latest'
      ? (requestedMessage.id != null && String(requestedMessage.id) !== 'latest' ? requestedMessage.id : latestId)
      : requestedFloor;
    if (resolvedFloor == null || String(resolvedFloor) === 'latest') throw new Error('无法锁定目标楼层，已取消变量重算');
    const message = messageInfoAt(resolvedFloor);
    return { floorId: resolvedFloor, messageText: String(message.text || ''), chatId: hudCurrentChatId() };
  }
  function assertVariableOperationContext(context) {
    if (!context) return;
    if (runtimeDestroyed) throw new Error('控制中心已重载，已取消本次变量写入');
    if (String(context.chatId) !== hudCurrentChatId()) throw new Error('聊天已切换，已取消本次变量写入');
    const current = messageInfoAt(context.floorId);
    if (String(current.text || '') !== context.messageText) throw new Error('目标楼层或 swipe 已变化，已取消本次变量写入');
  }
  async function runVariableGenerationTransaction(floorId, task) {
    if (variableGenerationInFlight) throw new Error('已有变量重算正在进行，请等待完成');
    const context = captureVariableOperationContext(floorId);
    variableGenerationInFlight = true;
    const done = showRerollBubble('正在重算变量，请稍候…（只改变量、不动正文）');
    try {
      assertVariableOperationContext(context);
      return await task(context);
    } finally {
      variableGenerationInFlight = false;
      done();
    }
  }
  function variableGenerateRaw(operationContext) {
    const helper = helperHost();
    const fn = helper?.generateRaw || window.generateRaw || hostWindow().generateRaw;
    if (typeof fn !== 'function') throw new Error('Tavern Helper generateRaw 不可用');
    return async function (opts) {
      assertVariableOperationContext(operationContext);
      const result = await fn.call(helper || hostWindow(), opts);
      assertVariableOperationContext(operationContext);
      return result;
    };
  }
  async function rerollCurrentVariables() {
    return runVariableGenerationTransaction('latest', async operationContext => {
      const generateRaw = variableGenerateRaw(operationContext);
      const oldData = getMvuDataAt(operationContext.floorId);
      const root = statRoot(oldData);
      const message = { text: operationContext.messageText };
    const prompt = [
      '当前楼正文：',
      (message.text || '（无法读取正文）').slice(0, 6000),
      '',
      '当前变量状态 stat_data（结构与字段以此为准）：',
      safeJson(root, '{}').slice(0, 6000),
      '',
      '请严格沿用上述变量结构与字段名，只为「当前楼正文」重新生成应有的变量更新，输出单个 <UpdateVariable> 块。',
      '<UpdateVariable> 内必须先写 <analysis> 变量预分析，再写 <JSONPatch> 数组；不要在变量块外输出 analysis。',
      '只改这一楼应当变化的变量；不要重新生成正文、不要输出世界书条目、cot 或给下一楼的提示词。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.4.7 的当前楼变量重算器，只输出一个内含 <analysis> 和 <JSONPatch> 的 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), '整楼重算：依据当前楼正文重新推导本楼变量变化。');
      await writeRawToFloor(raw, operationContext.floorId, operationContext);
      lastVariableFix = { kind: 'reroll', instruction: '（整楼重算）', raw, floorId: operationContext.floorId, chatId: operationContext.chatId, at: new Date().toISOString() };
      toast('success', '当前楼变量已重算（正文未改、未消耗历史楼）');
      renderPanel();
      return lastVariableFix;
    });
  }
  async function previewVariableCorrection(instruction, floorId = 'latest') {
    instruction = String(instruction || '').trim();
    if (!instruction) throw new Error('请先用一句话写出要修正什么');
    return runVariableGenerationTransaction(floorId, async operationContext => {
      const targetFloor = operationContext.floorId;
      const generateRaw = variableGenerateRaw(operationContext);
      const oldData = getMvuDataAt(targetFloor);
      const root = statRoot(oldData);
      const message = { text: operationContext.messageText };
    const prompt = [
      '当前楼正文：',
      (message.text || '（无法读取正文）').slice(0, 4000),
      '',
      '当前变量状态 stat_data（结构与字段以此为准）：',
      safeJson(root, '{}').slice(0, 6000),
      '',
      '玩家要修正的内容：' + instruction,
      '',
      '请严格沿用上述变量结构与字段名，只为这条修正生成最小的变量更新，输出单个 <UpdateVariable> 块。',
      '<UpdateVariable> 内必须先写 <analysis> 修正依据，再写 <JSONPatch> 数组；不要在变量块外输出 analysis。',
      '只改被要求的字段、其它一律不动；不要重新生成正文、不要输出世界书条目或下一楼提示词。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.4.7 的变量定点修正器，只输出一个内含 <analysis> 和 <JSONPatch> 的最小 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), '定点修正：按玩家要求只更新指定变量。');
    if (!/<UpdateVariable/i.test(raw)) throw new Error('修正结果未包含 <UpdateVariable> 块，请调整描述后重试');
      await writeRawToFloor(raw, targetFloor, operationContext);
      let mergedIntoFloor = false;
      try { mergedIntoFloor = await mergeUpdateBlockInFloor(raw, targetFloor, operationContext); } catch (error) {
        if (/已取消本次变量写入/.test(String(error?.message || error))) throw error;
      }
      lastVariableFix = { kind: 'correct', instruction, raw, floorId: targetFloor, chatId: operationContext.chatId, at: new Date().toISOString() };
      toast('success', mergedIntoFloor ? '已重新生成并写入对应变量（目标楼正文变量块已同步）' : '已重新生成并写入对应变量');
      renderPanel();
      return lastVariableFix;
    });
  }
  async function applyVariableCorrection() {
    // 3.3.1 起修正已自动写入；本函数保留作 api 兼容/手动兜底。
    if (!lastVariableFix?.raw) throw new Error('没有可写回的修正结果');
    await writeRawToFloor(lastVariableFix.raw, lastVariableFix.floorId ?? 'latest');
    toast('success', '变量修正已写回目标楼（正文未改）');
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
      const msg = helper?.getChatMessages?.(range, { include_swipes: false })?.[0];
      if (msg) {
        const text = msg.message ?? msg.mes ?? msg.text ?? '';
        return { id: msg.message_id ?? (floorId ?? 'latest'), text: String(text), role: msg.role || '' };
      }
    } catch (_) {}
    return { id: floorId ?? 'latest', text: '', role: '' };
  }
  async function writeRawToFloor(raw, floorId, operationContext) {
    assertVariableOperationContext(operationContext);
    const Mvu = mvuHost();
    if (!Mvu?.replaceMvuData) throw new Error('MVU 写入接口尚未就绪');
    if (!/<UpdateVariable/i.test(String(raw || ''))) throw new Error('结果未包含 <UpdateVariable> 块，已放弃写入');
    const oldData = getMvuDataAt(floorId);
    let nextData = null;
    if (typeof Mvu.parseMessage === 'function') {
      try { nextData = await Mvu.parseMessage(String(raw), oldData); } catch (_) { nextData = null; }
    }
    if (!nextData) throw new Error('未能从结果解析出有效变量更新（格式不合规）');
    nextData = validateHudMvuData(nextData);
    assertVariableOperationContext(operationContext);
    await Mvu.replaceMvuData(nextData, { type: 'message', message_id: floorId == null ? 'latest' : floorId });
    assertVariableOperationContext(operationContext);
    emitHudSignal('data-changed', { force: true });
  }
  // ── 楼层正文变量块读写（3.3.1 总监拍板语义;CDP 实验证实 setChatMessages 编辑不触发 MVU 重处理,变量写入仍由 replaceMvuData 负责）──
  function floorMessageApi() {
    const helper = helperHost();
    const get = helper?.getChatMessages || window.getChatMessages || hostWindow().getChatMessages;
    const set = helper?.setChatMessages || window.setChatMessages || hostWindow().setChatMessages;
    return (typeof get === 'function' && typeof set === 'function') ? { get, set } : null;
  }
  // 按预分析重算：把新 <UpdateVariable> 块追加到楼层正文底部（旧块保留,读数以最新为准）
  async function appendUpdateBlockToFloor(raw, floorId, operationContext) {
    assertVariableOperationContext(operationContext);
    const api = floorMessageApi();
    if (!api) return false;
    const block = String(raw).match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/i)?.[0];
    if (!block) return false;
    const range = (floorId == null || floorId === 'latest') ? -1 : floorId;
    const msg = api.get(range)?.[0];
    if (!msg) return false;
    const text = msg.message ?? msg.mes ?? msg.text ?? '';
    assertVariableOperationContext(operationContext);
    await api.set([{ message_id: msg.message_id, message: String(text) + '\n\n' + block }], { refresh: 'affected' });
    return true;
  }
  // 定点修正：正文原块内「相同 path 条目」替换为新值,块内没有的追加;楼内无块则整块追加
  async function mergeUpdateBlockInFloor(raw, floorId, operationContext) {
    assertVariableOperationContext(operationContext);
    const api = floorMessageApi();
    if (!api) return false;
    const newBlock = String(raw).match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i);
    if (!newBlock) return false;
    let newPatch = null;
    try { const parsedNew = parseJsonPatchOps(newBlock[0]); newPatch = parsedNew.ok ? parsedNew.ops : null; } catch (_) { newPatch = null; }
    if (!Array.isArray(newPatch)) return appendUpdateBlockToFloor(raw, floorId, operationContext);
    const range = (floorId == null || floorId === 'latest') ? -1 : floorId;
    const msg = api.get(range)?.[0];
    if (!msg) return false;
    const messageText = msg.message ?? msg.mes ?? msg.text ?? '';
    const text = String(messageText);
    // 以最后一个块为主块（读数以最新为准的语义，与「按预分析重算」append 的新块自洽——审查 minor 修复）
    const all = [...text.matchAll(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi)];
    if (!all.length) return appendUpdateBlockToFloor(raw, floorId, operationContext);
    const m = all[all.length - 1];
    let oldPatch = null;
    try { const parsedOld = parseJsonPatchOps(m[0]); oldPatch = parsedOld.ok ? parsedOld.ops : null; } catch (_) { oldPatch = null; }
    if (!Array.isArray(oldPatch)) return appendUpdateBlockToFloor(raw, floorId, operationContext);
    const merged = oldPatch.slice();
    for (const entry of newPatch) {
      if (!entry || typeof entry.path !== 'string') continue;
      const i = merged.findIndex(p => p && p.path === entry.path);
      if (i >= 0) merged[i] = entry; else merged.push(entry);
    }
    const mergedAnalysis = extractTagContent(newBlock[0], 'analysis') || extractTagContent(m[0], 'analysis') || '定点修正：合并相同 path 的变量更新。';
    const mergedBlock = wrapUpdateVariableBlock(mergedAnalysis, merged);
    // 按 index 精确替换（多块下 String.replace 会误中第一处同文块）
    const newText = text.slice(0, m.index) + mergedBlock + text.slice(m.index + m[0].length);
    assertVariableOperationContext(operationContext);
    await api.set([{ message_id: msg.message_id, message: newText }], { refresh: 'affected' });
    return true;
  }
  function extractAnalysis(text) {
    const block = extractUpdateBlock(text) || String(text || '');
    return extractTagContent(block, 'analysis');
  }
  // 按（编辑后的）预分析重算整楼变量——预分析是权威导向，补足正文 LLM 写出的 analysis 不足。
  async function rerollFromAnalysis(analysisText, floorId) {
    return runVariableGenerationTransaction(floorId, async operationContext => {
      const targetFloor = operationContext.floorId;
      const generateRaw = variableGenerateRaw(operationContext);
      const oldData = getMvuDataAt(targetFloor);
      const root = statRoot(oldData);
      const message = { text: operationContext.messageText };
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
      '请严格沿用上述变量结构与字段名，依据预分析与正文，为「当前楼」重新生成应有的全部变量更新，输出单个 <UpdateVariable> 块。',
      '<UpdateVariable> 内必须先写 <analysis>，再写 <JSONPatch> 数组；不要在变量块外输出 analysis。',
      '只改这一楼应当变化的变量；不要重新生成正文、不要输出世界书条目或给下一楼的提示词。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.4.7 的当前楼变量重算器，依据玩家给定的变量预分析与正文，只输出一个内含 <analysis> 和 <JSONPatch> 的 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), analysis || '按玩家编辑后的预分析重算本楼变量。');
      await writeRawToFloor(raw, targetFloor, operationContext);
      // 3.3.1 总监拍板：完成时把新变量块追加到本楼正文底部（旧块保留，读数以最新为准）
      let appendedToFloor = false;
      try { appendedToFloor = await appendUpdateBlockToFloor(raw, targetFloor, operationContext); } catch (error) {
        if (/已取消本次变量写入/.test(String(error?.message || error))) throw error;
      }
      lastVariableFix = { kind: 'reroll-analysis', instruction: '（按预分析整楼重算）', raw, floorId: targetFloor, chatId: operationContext.chatId, at: new Date().toISOString() };
      toast('success', appendedToFloor ? '已按预分析重算全部变量，新变量块已写入本楼正文底部' : '已按预分析重算该楼全部变量（正文块追加失败，变量已写入）');
      renderPanel();
      return lastVariableFix;
    });
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
  async function repairVariableFormat(floorId = 'latest') {
    const targetFloor = floorId == null ? 'latest' : floorId;
    const data = getMvuDataAt(targetFloor);
    const root = statRoot(data);
    if (!root || typeof root !== 'object') throw new Error('本楼暂无变量');
    const Schema = getMvuSchema();
    if (Schema && typeof Schema.parse === 'function') {
      let repaired = null;
      try { repaired = Schema.parse(JSON.parse(JSON.stringify(root))); } catch (_) {
        try { console.warn('[xingyue][zod parse failed]', _); } catch (__) {}
        repaired = null;
      }
      if (repaired && typeof repaired === 'object') {
        const ops = diffRepairRootOps(root, repaired);
        if (!ops.length) { toast('info', '变量格式已合规，无需修复'); return; }
        const raw = wrapUpdateVariableBlock('schema 修复：将不合规字段回正为当前变量结构可接受的格式。', ops);
        await writeRawToFloor(raw, targetFloor);
        lastVariableFix = { kind: 'repair', instruction: '（按 schema 修复 ' + ops.length + ' 处格式）', raw, floorId: targetFloor, at: new Date().toISOString() };
        toast('success', '已按 schema 一键修复变量格式（' + ops.length + ' 处，正文未改）');
        renderVarTunePanel();
        return;
      }
    }
    await repairVariableFormatViaLLM(targetFloor);
  }
  async function repairVariableFormatViaLLM(floorId = 'latest') {
    return runVariableGenerationTransaction(floorId, async operationContext => {
      const targetFloor = operationContext.floorId;
      const generateRaw = variableGenerateRaw(operationContext);
      const root = statRoot(getMvuDataAt(targetFloor));
    const prompt = [
      '当前变量状态 stat_data：',
      safeJson(root, '{}').slice(0, 8000),
      '',
      '请只修复其中不符合结构/格式的字段（类型错误、缺固定子字段、数值写成文本、对象写成字符串、错误嵌套等），把它们修回合规格式，语义值尽量保持不变。',
      '只为需要修复的字段生成最小的变量更新，输出单个 <UpdateVariable> 块；块内先写 <analysis> 修复依据，再写 <JSONPatch> 数组。不改语义、不重写正文。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.4.7 的变量格式修复器，只输出一个内含 <analysis> 和 <JSONPatch> 的最小 <UpdateVariable> 块，只修格式不改语义。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), 'LLM 格式修复：只修正变量结构和类型问题，不改变语义。');
    if (!/<UpdateVariable/i.test(raw)) throw new Error('修复结果未包含 <UpdateVariable> 块');
      await writeRawToFloor(raw, targetFloor, operationContext);
      lastVariableFix = { kind: 'repair', instruction: '（LLM 修复格式）', raw, floorId: targetFloor, chatId: operationContext.chatId, at: new Date().toISOString() };
      toast('success', '已用 LLM 修复变量格式（正文未改）');
      renderVarTunePanel();
    });
  }
  function fixKindLabel(kind) {
    if (kind === 'reroll-analysis') return '按预分析重算结果';
    if (kind === 'repair') return '格式修复结果';
    if (kind === 'fields') return '逐字段修改结果';
    if (kind === 'reroll') return '整楼重算结果';
    return '修正预览';
  }
  // 预分析与变量微调保留为两个专用浮窗，但共用楼层上下文并互斥显示。
  let analysisPanel = null;
  let analysisFloorId = 'latest';
  let varTunePanel = null;
  let varTuneTab = 'fix';
  let varTuneFloorId = 'latest';
  function normalizeToolFloorId(floorId) { return floorId == null ? 'latest' : floorId; }
  function sameToolFloor(a, b) { return String(normalizeToolFloorId(a)) === String(normalizeToolFloorId(b)); }
  function closeAnalysisPopover() {
    try { analysisPanel?.remove?.(); } catch (_) {}
    analysisPanel = null;
  }
  function closeVariableTunePopover() {
    try { varTunePanel?.remove?.(); } catch (_) {}
    varTunePanel = null;
  }
  function analysisPanelHtml() {
    const message = messageInfoAt(analysisFloorId);
    const analysis = extractAnalysis(message.text);
    return '<div class="xy-vt-head"><span>◆ 变量预分析 · 楼层 ' + escapeHtml(String(message.id)) + '</span><button type="button" data-xy-an="close" class="xy-vt-x">✕</button></div>'
      + '<div class="xy-vt-body">'
      + '<div class="xy-vt-hint">预分析是变量更新的导向。在这里补足或修正本楼预分析，再按它重算本楼变量；完成后新变量块写入目标楼正文底部。</div>'
      + '<label class="xy-vt-field">本楼变量预分析<textarea data-xy-an-input rows="8" placeholder="正文未给出预分析时，可在此写下本楼应当发生的变量变化（按顶层根分条）">' + escapeHtml(analysis) + '</textarea></label>'
      + '<div class="xy-vt-row"><button type="button" data-xy-an="reroll">按预分析重算整楼变量</button><span class="xy-vt-muted">只重算变量，不重新生成正文</span></div>'
      + '</div>';
  }
  function renderAnalysisPanel() {
    if (analysisPanel && analysisPanel.isConnected) analysisPanel.innerHTML = analysisPanelHtml();
  }
  function openAnalysisPopover(floorId) {
    analysisFloorId = normalizeToolFloorId(floorId);
    closeVariableTunePopover();
    const doc = hostDocument();
    ensureVarTuneStyle(doc);
    if (!analysisPanel || !analysisPanel.isConnected) {
      analysisPanel = doc.createElement('div');
      analysisPanel.id = 'xingyue-analysis-pop';
      analysisPanel.className = 'xy-cc-pop xy-cc-pop-analysis';
      doc.body.appendChild(analysisPanel);
      makeCcPopDraggable(analysisPanel);
      analysisPanel.addEventListener('click', async (event) => {
        const actionButton = event.target?.closest?.('[data-xy-an]');
        const act = actionButton?.getAttribute?.('data-xy-an');
        if (!act) return;
        event.preventDefault(); event.stopPropagation();
        try {
          if (act === 'close') { closeAnalysisPopover(); return; }
          if (act === 'reroll') {
            const edited = analysisPanel.querySelector('[data-xy-an-input]')?.value || '';
            await withBusyButton(actionButton, '正在重算…', () => rerollFromAnalysis(edited, analysisFloorId));
            renderAnalysisPanel();
          }
        } catch (error) { toast('error', error.message || String(error)); }
      });
    }
    renderAnalysisPanel();
    if (!analysisPanel.__centered) { centerCcPop(analysisPanel); analysisPanel.__centered = true; }
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
    if (doc.__xyAnalysisBound?.owner === runtimeOwner) return;
    try { doc.__xyAnalysisBound?.dispose?.(); } catch (_) {}
    const handler = (event) => {
      const editHook = event.target?.closest?.('[data-xy-analysis-edit]');
      const rerollHook = !editHook && event.target?.closest?.('[data-xy-analysis-reroll]');
      if (!editHook && !rerollHook) return;
      event.preventDefault(); event.stopPropagation();
      const floorId = resolveFloorFromEl(editHook || rerollHook);
      if (editHook) { openAnalysisPopover(floorId); return; }
      (async () => { try { await rerollFromAnalysis('', floorId); } catch (error) { toast('error', error.message || String(error)); } })();
    };
    const dispose = () => {
      try { doc.removeEventListener('click', handler, true); } catch (_) {}
      try { if (doc.__xyAnalysisBound?.owner === runtimeOwner) delete doc.__xyAnalysisBound; } catch (_) {}
    };
    doc.addEventListener('click', handler, true);
    doc.__xyAnalysisBound = { owner: runtimeOwner, dispose };
    disposers.push(dispose);
  }
  function handleOmniButton(action, el) {
    try {
      const floorId = resolveFloorFromEl(el);
      if (action === 'analysis-edit') { openAnalysisPopover(floorId); return; }
      if (action === 'analysis-reroll') { rerollFromAnalysis('', floorId).catch(e => toast('error', e.message || String(e))); return; }
      if (action === 'var-tune') { openVariableTunePopover(floorId); return; }
    } catch (error) { toast('error', error.message || String(error)); }
  }
  function getVariableValidationStatus(floorId = varTuneFloorId) {
    let root;
    try { root = statRoot(getMvuDataAt(floorId)); } catch (_) { return { state: 'unknown', text: 'MVU 未就绪，无法校验' }; }
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
  function varValidationStatusHtml(floorId = varTuneFloorId) {
    const s = getVariableValidationStatus(floorId);
    const map = { ok: ['#4fd97a', '✓'], warn: ['#e0b27b', '!'], error: ['#e07b7b', '✕'], empty: ['#7d8a99', '—'], unknown: ['#7d8a99', '?'] };
    const pair = map[s.state] || map.unknown;
    const color = pair[0], icon = pair[1];
    return '<div class="xy-vt-row" style="border:1px solid ' + color + '55;border-left:3px solid ' + color + ';border-radius:5px;padding:6px 9px;background:' + color + '14;color:' + color + ';font-size:12px;">'
      + '<span style="font-weight:bold;">' + icon + '</span><span>' + escapeHtml(s.text) + '</span></div>';
  }
  function varTunePanelHtml() {
    const fix = lastVariableFix && sameToolFloor(lastVariableFix.floorId, varTuneFloorId) ? lastVariableFix : null;
    const tab = varTuneTab;
    const preview = (fix && fix.raw)
      ? '<div class="xy-vt-label">' + fixKindLabel(fix.kind) + '（已自动写入目标楼）</div><pre class="xy-vt-pre">' + escapeHtml(String(fix.raw).slice(0, 2000)) + '</pre>'
      : '';
    const tabBtn = (id, label) => '<button type="button" class="xy-vt-tab' + (tab === id ? ' is-on' : '') + '" data-xy-vt-tab="' + id + '">' + label + '</button>';
    let body;
    if (tab === 'reroll') {
      body = '<label class="xy-vt-field">重新生成哪些变量（一句话）<textarea data-xy-vt-input rows="2" placeholder="例：把星月的好感度改成 80；或 重算当前穿着">' + escapeHtml(fix && fix.kind === 'correct' ? (fix.instruction || '') : '') + '</textarea></label>'
        + '<div class="xy-vt-row"><button type="button" data-xy-vt="preview">重新生成并写入对应变量</button><span class="xy-vt-muted">只重 roll 描述到的内容，完成即写入目标楼</span></div>'
        + (fix && fix.kind === 'correct' ? preview : '');
    } else if (tab === 'fields') {
      body = varTuneFieldsHtml(varTuneFloorId);
    } else {
      body = varValidationStatusHtml(varTuneFloorId)
        + varProblemListHtml(varTuneFloorId)
        + '<div class="xy-vt-row"><button type="button" data-xy-vt="repair">一键修复变量格式</button><span class="xy-vt-muted">按 schema 把错误格式修回合规</span></div>'
        + (fix && fix.kind === 'repair' ? preview : '');
    }
    return '<div class="xy-vt-head"><span>⚙ 微调变量 · 楼层 ' + escapeHtml(String(varTuneFloorId)) + '</span><button type="button" data-xy-vt="close" class="xy-vt-x">✕</button></div>'
      + '<div class="xy-vt-tabs">' + tabBtn('fix', '一键修正变量') + tabBtn('reroll', '部分重 roll') + tabBtn('fields', '逐字段修改') + '</div>'
      + '<div class="xy-vt-body">' + body + '</div>';
  }
  function listSchemaProblems(floorId = varTuneFloorId) {
    let root;
    try { root = statRoot(getMvuDataAt(floorId)); } catch (_) { return []; }
    const Schema = getMvuSchema();
    if (!root || typeof root !== 'object' || !Schema || typeof Schema.parse !== 'function') return [];
    let repaired = null;
    try { repaired = Schema.parse(JSON.parse(JSON.stringify(root))); } catch (_) { return [{ path: '', before: null, after: null, whole: true }]; }
    const problems = [];
    const walk = (a, b, path) => {
      const bothObj = a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b);
      if (bothObj) {
        const keys = {};
        Object.keys(a).forEach(k => { keys[k] = 1; });
        Object.keys(b).forEach(k => { keys[k] = 1; });
        Object.keys(keys).forEach(k => walk(a[k], b[k], path + '/' + jsonPtrSeg(k)));
      } else if (JSON.stringify(a) !== JSON.stringify(b)) {
        problems.push({ path, before: a, after: b, whole: false });
      }
    };
    walk(root, repaired, '');
    return problems;
  }
  function renderStatTree(node, path, errMap, indent) {
    const pad = '  '.repeat(indent);
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const keys = Object.keys(node);
      if (!keys.length) return '{}';
      return '{\n' + keys.map(k => {
        const p = path + '/' + jsonPtrSeg(k);
        return pad + '  ' + '<span style="color:#8fb0c2">' + escapeHtml(JSON.stringify(k)) + '</span>: ' + renderStatTree(node[k], p, errMap, indent + 1);
      }).join(',\n') + '\n' + pad + '}';
    }
    const valStr = escapeHtml(JSON.stringify(node));
    if (Object.prototype.hasOwnProperty.call(errMap, path)) {
      const to = escapeHtml(JSON.stringify(errMap[path]));
      return '<span style="color:#e07b7b;font-weight:bold;background:rgba(224,123,123,.16);border-radius:2px;padding:0 2px">' + valStr + '</span><span style="color:#8b9aac"> → </span><span style="color:#7fbf9a;font-weight:bold;background:rgba(80,217,122,.14);border-radius:2px;padding:0 2px">' + to + '</span>';
    }
    return '<span style="color:#8b9aac">' + valStr + '</span>';
  }
  function varProblemListHtml(floorId = varTuneFloorId) {
    let root;
    try { root = statRoot(getMvuDataAt(floorId)); } catch (_) { return ''; }
    if (!root || typeof root !== 'object') return '';
    const probs = listSchemaProblems(floorId);
    if (!probs.length) return '';
    if (probs.some(p => p.whole)) return '<div class="xy-vt-problems"><div class="xy-vt-prob-h">schema 整体无法解析，点一键修复走 LLM</div></div>';
    const errMap = {};
    probs.forEach(p => { errMap[p.path] = p.after; });
    const rootKeys = [];
    Object.keys(errMap).forEach(pth => {
      const seg = pth.split('/')[1];
      if (seg == null) return;
      const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      if (rootKeys.indexOf(key) < 0) rootKeys.push(key);
    });
    const subset = {};
    rootKeys.forEach(k => { subset[k] = root[k]; });
    return '<div class="xy-vt-problems"><div class="xy-vt-prob-h">有问题的变量（原文；红=当前值 → 绿=一键修复后的真实值）：</div><pre class="xy-vt-tree">' + renderStatTree(subset, '', errMap, 0) + '</pre></div>';
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
      '.xy-cc-pop button:disabled{opacity:.68;cursor:wait;}',
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
      '.xy-cc-pop .xy-vt-tabs{display:flex;gap:4px;padding:10px 14px 0;}',
      '.xy-cc-pop .xy-vt-tab{flex:1;padding:6px 4px;font:inherit;font-size:12px;cursor:pointer;background:rgba(80,217,122,.06);color:#8fb0a0;border:1px solid rgba(80,217,122,.25);border-bottom:none;border-radius:5px 5px 0 0;}',
      '.xy-cc-pop .xy-vt-tab.is-on{background:rgba(80,217,122,.18);color:#eaf6ee;border-color:rgba(80,217,122,.6);}',
      '.xy-cc-pop .xy-vt-boolbtn{font:inherit;font-size:12px;cursor:pointer;background:rgba(80,217,122,.12);color:#d4f5e0;border:1px solid rgba(80,217,122,.5);border-radius:4px;padding:3px 14px;min-width:64px;}',
      '.xy-cc-pop .xy-vt-problems{border:1px solid rgba(224,123,123,.35);border-left:3px solid #e07b7b;border-radius:5px;padding:6px 9px;background:rgba(224,123,123,.07);display:flex;flex-direction:column;gap:3px;}',
      '.xy-cc-pop .xy-vt-prob-h{color:#e07b7b;font-size:11px;font-weight:bold;}',
      '.xy-cc-pop .xy-vt-prob{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#e9a0a0;}',
      '.xy-cc-pop .xy-vt-prob-k{color:#d4b0b0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.xy-cc-pop .xy-vt-prob-v{font-family:Consolas,monospace;flex:0 0 auto;}',
      '.xy-cc-pop .xy-vt-tree{margin:0;white-space:pre-wrap;word-break:break-all;font-family:Consolas,monospace;font-size:12px;line-height:1.5;color:#8b9aac;max-height:230px;overflow:auto;background:#050912;border:1px solid rgba(42,72,88,.5);border-radius:4px;padding:8px;}',
    ].join('');
    const style = doc.createElement('style');
    style.id = 'xingyue-var-tune-style';
    style.textContent = css;
    (doc.head || doc.body).appendChild(style);
  }
  function centerCcPop(panel) {
    try {
      const win = panel.ownerDocument?.defaultView || hostWindow();
      const vw = win.innerWidth || 800, vh = win.innerHeight || 600;
      const r = panel.getBoundingClientRect();
      const w = r.width || 420, h = r.height || 400;
      panel.style.left = Math.max(8, Math.round((vw - w) / 2)) + 'px';
      panel.style.top = Math.max(8, Math.round((vh - h) / 2)) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.transform = 'none';
    } catch (_) {}
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
  function openVariableTunePopover(floorId = 'latest') {
    varTuneFloorId = normalizeToolFloorId(floorId);
    closeAnalysisPopover();
    const doc = hostDocument();
    ensureVarTuneStyle(doc);
    if (!varTunePanel || !varTunePanel.isConnected) {
      varTunePanel = doc.createElement('div');
      varTunePanel.id = 'xingyue-var-tune-pop';
      varTunePanel.className = 'xy-cc-pop';
      doc.body.appendChild(varTunePanel);
      makeCcPopDraggable(varTunePanel);
      varTunePanel.addEventListener('click', async (event) => {
        const tabEl = event.target?.closest?.('[data-xy-vt-tab]');
        if (tabEl) { event.preventDefault(); event.stopPropagation(); varTuneTab = tabEl.getAttribute('data-xy-vt-tab'); renderVarTunePanel(); return; }
        const boolEl = event.target?.closest?.('[data-xy-vt-bool]');
        if (boolEl) { event.preventDefault(); event.stopPropagation(); const on = boolEl.getAttribute('data-val') === 'true'; boolEl.setAttribute('data-val', on ? 'false' : 'true'); boolEl.textContent = on ? 'false' : 'true'; return; }
        const actionButton = event.target?.closest?.('[data-xy-vt]');
        const act = actionButton?.getAttribute?.('data-xy-vt');
        if (!act) return;
        event.preventDefault(); event.stopPropagation();
        try {
          if (act === 'close') { closeVariableTunePopover(); return; }
          if (act === 'repair') await repairVariableFormat(varTuneFloorId);
          if (act === 'preview') {
            const instruction = varTunePanel.querySelector('[data-xy-vt-input]')?.value || '';
            await withBusyButton(actionButton, '正在重算…', () => previewVariableCorrection(instruction, varTuneFloorId));
          }
          if (act === 'apply') await applyVariableCorrection();
          if (act === 'apply-fields') await applyFieldEdits(varTuneFloorId);
          if (act === 'discard') lastVariableFix = null;
        } catch (error) { toast('error', error.message || String(error)); }
        renderVarTunePanel();
      });
    }
    renderVarTunePanel();
    if (!varTunePanel.__centered) { centerCcPop(varTunePanel); varTunePanel.__centered = true; }
  }
  function bindVariableTuneEntries() {
    const doc = hostDocument();
    if (doc.__xyVarTuneBound?.owner === runtimeOwner) return;
    try { doc.__xyVarTuneBound?.dispose?.(); } catch (_) {}
    const handler = (event) => {
      const hook = event.target?.closest?.('[data-xy-var-tune]');
      if (!hook) return;
      event.preventDefault(); event.stopPropagation();
      openVariableTunePopover(resolveFloorFromEl(hook));
    };
    const dispose = () => {
      try { doc.removeEventListener('click', handler, true); } catch (_) {}
      try { if (doc.__xyVarTuneBound?.owner === runtimeOwner) delete doc.__xyVarTuneBound; } catch (_) {}
    };
    doc.addEventListener('click', handler, true);
    doc.__xyVarTuneBound = { owner: runtimeOwner, dispose };
    disposers.push(dispose);
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
  function varTuneFieldsHtml(floorId = varTuneFloorId) {
    let root;
    try { root = statRoot(getMvuDataAt(floorId)); } catch (_) { return '<div class="xy-vt-hint">MVU 未就绪，无法读取本楼变量。</div>'; }
    if (!root || typeof root !== 'object') return '<div class="xy-vt-hint">本楼暂无变量。</div>';
    const groups = Object.keys(root).map(rk => {
      const fields = [];
      flattenStat(root[rk], '/' + jsonPtrSeg(rk), fields);
      if (!fields.length) return '';
      const rows = fields.map(f => {
        const label = f.path.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')).join(' › ');
        if (f.kind === 'boolean') { const on = (f.value === true || f.value === 'true'); return '<label class="xy-vt-frow"><span title="' + escapeHtml(f.path) + '">' + escapeHtml(label) + '</span><button type="button" class="xy-vt-boolbtn" data-xy-vt-field="' + escapeHtml(f.path) + '" data-xy-vt-kind="boolean" data-xy-vt-bool data-val="' + (on ? 'true' : 'false') + '">' + (on ? 'true' : 'false') + '</button></label>'; }
        return '<label class="xy-vt-frow"><span title="' + escapeHtml(f.path) + '">' + escapeHtml(label) + '</span><input data-xy-vt-field="' + escapeHtml(f.path) + '" data-xy-vt-kind="' + f.kind + '" value="' + escapeHtml(String(f.value)) + '"></label>';
      }).join('');
      return '<details class="xy-vt-group"><summary>' + escapeHtml(rk) + ' · ' + fields.length + '</summary>' + rows + '</details>';
    }).join('');
    return groups + '<div class="xy-vt-row"><button type="button" data-xy-vt="apply-fields">应用字段修改</button><span class="xy-vt-muted">改哪个写哪个，只写当前楼</span></div>';
  }
  async function applyFieldEdits(floorId = varTuneFloorId) {
    if (!varTunePanel) return;
    const targetFloor = normalizeToolFloorId(floorId);
    let root;
    try { root = statRoot(getMvuDataAt(targetFloor)); } catch (_) { throw new Error('MVU 未就绪'); }
    const ops = [];
    varTunePanel.querySelectorAll('[data-xy-vt-field]').forEach(input => {
      const path = input.getAttribute('data-xy-vt-field');
      const kind = input.getAttribute('data-xy-vt-kind');
      const orig = getByPointer(root, path);
      let next = input.hasAttribute('data-xy-vt-bool') ? input.getAttribute('data-val') : input.value;
      if (kind === 'number') { const n = Number(next); if (!Number.isNaN(n)) next = n; }
      else if (kind === 'boolean') next = (next === 'true' || next === '1' || next === 'True');
      else if (kind === 'json') { try { next = JSON.parse(next); } catch (_) { return; } }
      if (JSON.stringify(orig) !== JSON.stringify(next)) ops.push({ op: 'replace', path, value: next });
    });
    if (!ops.length) { toast('info', '没有检测到字段改动'); return; }
    const raw = wrapUpdateVariableBlock('逐字段修改：按玩家在变量微调面板中的字段编辑写回。', ops);
    await writeRawToFloor(raw, targetFloor);
    lastVariableFix = { kind: 'fields', instruction: '（逐字段修改 ' + ops.length + ' 处）', raw, floorId: targetFloor, at: new Date().toISOString() };
    toast('success', '字段修改已写回目标楼（' + ops.length + ' 处，正文未改）');
    renderVarTunePanel();
  }
  // 3.3.0 桌宠悬浮球（原 B17 Phase 3 暖色胶囊球升级）——科幻自由点阵球(canvas+rAF) + 半轮盘4键 +
  // 贴边半隐/收纳两档 + hover通电探头 + 时段气泡(已批文案)。复用 v291 骨架：拖拽/吸附/localStorage 持久化
  // (键 xingyue-sidebar-v291 向后兼容·新增 dockDepth)。节点 id 沿用 xingyue-sidebar-ball/-menu/-style(destroy/真机V1 兼容)。
  let sidebarBall = null;
  let petOrbRenderer = null;
  let petBubbleTimer = null;
  let petBubbleHideTimer = null;
  let petBubbleBootTimer = null;
  let petOrbDragRafCancel = null;
  let ensureSidebarRetryTimer = null; // 启动 1.5s 重试 timer——destroy 必清,否则切卡窗口期球被重建（审查 minor）
  // 3.3.1 自由浮动模型（总监拍板）：初始=页面中心、全屏拖放、靠边(<24px)才吸附贴边；fx/fy=视口比例坐标
  const sidebarState = { side: 'right', top: 0.42, open: false, dockDepth: 'half', fx: 0.5, fy: 0.5, docked: false };
  function loadSidebarState() {
    try {
      const rawSaved = localStorage.getItem('xingyue-sidebar-v291');
      const s = JSON.parse(rawSaved || '{}');
      if (s.side === 'left' || s.side === 'right') sidebarState.side = s.side;
      if (typeof s.top === 'number') sidebarState.top = s.top;
      if (s.dockDepth === 'half' || s.dockDepth === 'hidden') sidebarState.dockDepth = s.dockDepth;
      if (typeof s.fx === 'number') sidebarState.fx = Math.min(1, Math.max(0, s.fx));
      if (typeof s.fy === 'number') sidebarState.fy = Math.min(1, Math.max(0, s.fy));
      if (typeof s.docked === 'boolean') sidebarState.docked = s.docked;
      else if (rawSaved) sidebarState.docked = true; // 3.3.0 旧档只有贴边模型 → 视为吸附态
    } catch (_) {}
  }
  function saveSidebarState() {
    try { localStorage.setItem('xingyue-sidebar-v291', JSON.stringify({ side: sidebarState.side, top: sidebarState.top, dockDepth: sidebarState.dockDepth, fx: sidebarState.fx, fy: sidebarState.fy, docked: sidebarState.docked })); } catch (_) {}
  }
  function orbReducedMotion() {
    try { const w = hostWindow(); return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }
  // ── 点阵球渲染器（pet_orb_renderer 定稿参数嵌入版·D2 密·数据网 · 单色淡蓝）────────────
  // 与原型差异：修「burst-in 完成后粒子不重散布」bug（原型把 _burstPhase 置 null 后再读它判 dir，恒 false）；加 renderOnce() 供 reduced-motion 静态帧。
  // 3.4.7：拖尾灵动感调优——tailRatio 0.58→0.70（更多粒子参与甩尾）、dragShear 1.28→1.72（甩尾幅度更明显）
  // 3.4.7：radius 0→56（固定粒子场半径=56 buffer=28 CSS，球视觉仍 56px）；canvas 缓冲放大到 200（下方 ensureSidebarBall），
  // 粒子场不再填满 canvas，四周留出空间让拖尾甩出球外不被裁。
  const XY_ORB_CFG = { n: 46, linkDist: 33, speed: 0.3, glowIntensity: 1.08, tailRatio: 0.35, dragShear: 0.9, colorTokens: { particle: '#6bc7f2', bright: '#4be4ff', highlight: '#cdf3ff' }, radius: 56 };
  const XY_ORB_STATES = {
    'idle': { speedMul: 1.0, linkDistMul: 1.0, glowMul: 1.0 },
    'hover': { speedMul: 1.8, linkDistMul: 1.4, glowMul: 1.6 },
    'drag': { speedMul: 2.35, linkDistMul: 1.62, glowMul: 1.95 },
    'edge-left': { speedMul: 0.5, linkDistMul: 0.8, glowMul: 0.6 },
    'edge-right': { speedMul: 0.5, linkDistMul: 0.8, glowMul: 0.6 },
  };
  function xyOrbHex(hex) { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [107, 199, 242]; }
  function xyOrbLerp(a, b, t) { return a + (b - a) * t; }
  class PetOrbRenderer {
    constructor(canvas, options) {
      this._cfg = Object.assign({}, XY_ORB_CFG, options || {});
      this._canvas = canvas; this._ctx = canvas.getContext('2d');
      this._state = 'idle'; this._running = false; this._rafId = null;
      this._particles = []; this._lastTs = null; this._burstPhase = null;
      this._tailDrag = false; // ⑧c 数据史莱姆：拖动中=弹簧松（甩尾），松手=刚度加倍（加速追上归位）
      this._dragEnergy = 0; this._dragDX = 0; this._dragDY = 0;
      const w = hostWindow();
      this._raf = (w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : (cb => setTimeout(cb, 16)));
      this._caf = (w.cancelAnimationFrame ? w.cancelAnimationFrame.bind(w) : clearTimeout);
      this._initParticles();
    }
    start() { if (this._running) return; this._running = true; this._lastTs = null; this._tick = this._loop.bind(this); this._rafId = this._raf(this._tick); }
    stop() { this._running = false; if (this._rafId != null) { this._caf(this._rafId); this._rafId = null; } }
    renderOnce() { this._update(16); this._draw(); }
    setState(state) { if (XY_ORB_STATES[state]) this._state = state; }
    setTailDrag(on) {
      this._tailDrag = !!on;
      if (!on) this._dragEnergy = Math.max(this._dragEnergy, 0.32);
    }
    nudge(dx, dy) {
      // ⑧c：外壳直写跟手，滞后下沉到点阵——tail 粒子按各自 lag 反向甩出（CSS px→2x 物理 px），弹簧回中
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > 0.01) {
        const nx = dx / mag, ny = dy / mag;
        this._dragEnergy = Math.min(1, this._dragEnergy + mag / 30);
        this._dragDX = xyOrbLerp(this._dragDX || 0, nx, 0.42);
        this._dragDY = xyOrbLerp(this._dragDY || 0, ny, 0.42);
      }
      // 3.4.7-r37：拖动=部分点阵本身被惯性留在后方(靠点阵连线拉成拖影)，非给每个点加尾巴线。位移上限放到 2.4r 配合 240px 画布不裁；甩离幅度走 dragShear，速度踢随幅度缩放
      const cap = this._effectiveRadius() * 2.4;
      for (const p of this._particles) {
        const pull = p.tail ? p.lag : 0.10;
        const shear = p.tail ? this._cfg.dragShear : 0.22;
        p.sx = Math.max(-cap, Math.min(cap, p.sx - dx * 2 * pull * shear));
        p.sy = Math.max(-cap, Math.min(cap, p.sy - dy * 2 * pull * shear));
        if (p.tail) {
          const kick = 0.05 * (this._cfg.dragShear / 1.72);
          p.svx -= dx * kick * p.lag;
          p.svy -= dy * kick * p.lag;
        }
      }
    }
    playBurstOut(onDone) {
      this._burstPhase = { dir: 'out', progress: 0, onDone: onDone || null };
      const cx = this._canvas.width / 2, cy = this._canvas.height / 2;
      for (const p of this._particles) {
        const dx = (p.x - cx) || (Math.random() * 2 - 1), dy = (p.y - cy) || (Math.random() * 2 - 1);
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        p._burstVx = (dx / len) * 4; p._burstVy = (dy / len) * 4; p._burstAlpha = 1;
      }
    }
    playBurstIn(onDone) {
      this._burstPhase = { dir: 'in', progress: 0, onDone: onDone || null };
      const cx = this._canvas.width / 2, cy = this._canvas.height / 2, r = this._effectiveRadius();
      for (const p of this._particles) {
        const angle = Math.random() * Math.PI * 2;
        p._burstStartX = cx + Math.cos(angle) * r * 2.5; p._burstStartY = cy + Math.sin(angle) * r * 2.5; p._burstAlpha = 0;
      }
    }
    destroy() { this.stop(); this._particles = []; this._canvas = null; this._ctx = null; this._burstPhase = null; }
    _effectiveRadius() { return this._cfg.radius > 0 ? this._cfg.radius : Math.min(this._canvas.width, this._canvas.height) / 2; }
    _initParticles() {
      this._particles = [];
      const cx = this._canvas.width / 2, cy = this._canvas.height / 2, r = this._effectiveRadius();
      for (let i = 0; i < this._cfg.n; i++) {
        const angle = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * r;
        // ⑧c：过半粒子参与拖尾（数据史莱姆），每粒随机刚度/阻尼/滞后系数（欠阻尼弹簧带个体抖动）
        this._particles.push({ x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist, vx: (Math.random() * 2 - 1) * this._cfg.speed, vy: (Math.random() * 2 - 1) * this._cfg.speed, blink: Math.random(), blinkSpeed: 0.3 + Math.random() * 0.5, isHighlight: Math.random() < 0.2, tail: Math.random() < this._cfg.tailRatio, sx: 0, sy: 0, svx: 0, svy: 0, springK: 0.045 + Math.random() * 0.04, springD: 0.87 + Math.random() * 0.08, lag: 0.32 + Math.random() * 0.58 });
      }
    }
    _loop(timestamp) {
      if (!this._running || !this._canvas || !this._ctx) return;
      const dt = this._lastTs == null ? 16 : Math.min(timestamp - this._lastTs, 50);
      this._lastTs = timestamp;
      this._update(dt); this._draw();
      this._rafId = this._raf(this._tick);
    }
    _update(dt) {
      const stateP = XY_ORB_STATES[this._state];
      const dtFrac = dt / 16;
      // 3.4.7：松手能量衰减 0.86→0.90，尾巴归位更绵长不戛然而止（更灵动）
      this._dragEnergy *= Math.pow(this._tailDrag ? 0.94 : 0.90, dtFrac);
      if (this._dragEnergy < 0.01) this._dragEnergy = 0;
      const speed = this._cfg.speed * stateP.speedMul * (1 + this._dragEnergy * 0.72);
      const cx = this._canvas.width / 2, cy = this._canvas.height / 2, r = this._effectiveRadius();
      for (const p of this._particles) {
        p.blink += p.blinkSpeed * dtFrac * 0.04; if (p.blink > 1) p.blink -= 1;
        if (p.tail && (p.sx || p.sy || p.svx || p.svy)) {
          // ⑧c 欠阻尼弹簧：拉回中心偏移。3.4.7-r37 再软化——松手刚度 x1.7→x1.5 回中更绵，
          // 松手阻尼略降(springD-0.03)让回中带轻微惯性过冲、更绵软丝滑；收敛后清零避免残余漂移。
          const k = p.springK * (this._tailDrag ? 0.62 : 1.5);
          const damp = Math.pow(this._tailDrag ? Math.min(0.985, p.springD + 0.045) : Math.max(0.82, p.springD - 0.03), dtFrac);
          p.svx = (p.svx - k * p.sx * dtFrac) * damp;
          p.svy = (p.svy - k * p.sy * dtFrac) * damp;
          p.sx += p.svx * dtFrac; p.sy += p.svy * dtFrac;
          if (Math.abs(p.sx) < 0.05 && Math.abs(p.svx) < 0.05) { p.sx = 0; p.svx = 0; }
          if (Math.abs(p.sy) < 0.05 && Math.abs(p.svy) < 0.05) { p.sy = 0; p.svy = 0; }
        }
        if (this._burstPhase) continue;
        const curSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || speed;
        const scale = xyOrbLerp(curSpeed, speed, 0.05) / (curSpeed || 1);
        p.vx *= scale; p.vy *= scale;
        p.x += p.vx * dtFrac; p.y += p.vy * dtFrac;
        const dx = p.x - cx, dy = p.y - cy, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r - 1) {
          const nx = dx / dist, ny = dy / dist, dot = p.vx * nx + p.vy * ny;
          p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny;
          p.x = cx + nx * (r - 1.5); p.y = cy + ny * (r - 1.5);
        }
      }
      if (this._burstPhase) {
        this._burstPhase.progress += dtFrac * 0.04;
        const t = Math.min(this._burstPhase.progress, 1);
        if (this._burstPhase.dir === 'out') {
          for (const p of this._particles) { p.x += (p._burstVx || 0) * dtFrac; p.y += (p._burstVy || 0) * dtFrac; p._burstAlpha = Math.max(0, 1 - t * 1.4); }
        } else {
          for (const p of this._particles) { p.x = xyOrbLerp(p._burstStartX, cx, t); p.y = xyOrbLerp(p._burstStartY, cy, t); p._burstAlpha = t; }
        }
        if (t >= 1) {
          const done = this._burstPhase; this._burstPhase = null;
          if (done.dir === 'in') this._initParticles();
          if (done.onDone) try { done.onDone(); } catch (_) {}
        }
      }
    }
    _draw() {
      const canvas = this._canvas, ctx = this._ctx;
      const stateP = XY_ORB_STATES[this._state];
      const glow = this._cfg.glowIntensity * stateP.glowMul;
      // 3.4.7：绘制缩放系数改按粒子场半径（drawScale=2*r/56，等于旧 canvas.width/56 的值），
      // 与 canvas 缓冲尺寸解耦——canvas 放大给拖尾留空间时点/线尺寸不变、球视觉不变。
      const drawScale = (2 * this._effectiveRadius()) / 56;
      const linkD = this._cfg.linkDist * stateP.linkDistMul * drawScale;
      const tk = this._cfg.colorTokens;
      const [pr, pg, pb] = xyOrbHex(tk.particle), [br2, bg2, bb2] = xyOrbHex(tk.bright), [hr, hg, hb] = xyOrbHex(tk.highlight);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ps = this._particles, useBurst = this._burstPhase !== null;
      for (const p of ps) { p.rx = p.x + (p.sx || 0); p.ry = p.y + (p.sy || 0); } // ⑧c 渲染坐标=物理位置+弹簧偏移
      const breathPhase = (Date.now() % 3000) / 3000;
      const cx = canvas.width / 2, cy = canvas.height / 2, r = this._effectiveRadius();
      const dragE = Math.max(0, Math.min(1, this._dragEnergy || 0));
      ctx.save();
      ctx.globalAlpha = (0.06 + 0.04 * Math.sin(breathPhase * Math.PI * 2) + dragE * 0.1) * glow;
      if (dragE > 0.02 && (this._dragDX || this._dragDY)) {
        const angle = Math.atan2(this._dragDY || 0, this._dragDX || 1);
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.scale(1 + dragE * 0.12, 1 - dragE * 0.05);
        ctx.translate(-cx, -cy);
      }
      const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      grad.addColorStop(0, 'rgba(' + br2 + ',' + bg2 + ',' + bb2 + ',0.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 3.4.7-r37：删除错误的"拖尾线"绘制——数据史莱姆的甩尾=部分点阵本身被惯性留在后方(rx/ry 含 sx/sy 滞后偏移)+下方点阵连线自然拉成拖影，不再给每个点画尾巴线段。
      ctx.save();
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].rx - ps[j].rx, dy = ps[i].ry - ps[j].ry, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > linkD) continue;
          const alpha = (1 - dist / linkD) * 0.65;
          const lineAlpha = useBurst ? alpha * Math.min(ps[i]._burstAlpha ?? 1, ps[j]._burstAlpha ?? 1) : alpha;
          ctx.strokeStyle = 'rgba(' + pr + ',' + pg + ',' + pb + ',' + lineAlpha.toFixed(3) + ')';
          ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(ps[i].rx, ps[i].ry); ctx.lineTo(ps[j].rx, ps[j].ry); ctx.stroke();
        }
      }
      ctx.restore();
      ctx.save();
      for (const p of ps) {
        const blinkVal = 0.55 + 0.45 * Math.sin(p.blink * Math.PI * 2);
        const isHl = p.isHighlight;
        const [r2, g2, b2] = isHl ? [hr, hg, hb] : [pr, pg, pb];
        const size = (isHl ? 2.4 : 1.6) * drawScale;
        let alpha = blinkVal * (isHl ? 1.0 : 0.75);
        if (useBurst) alpha *= (p._burstAlpha ?? 1);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        if (isHl && glow > 0.3) {
          const gg = ctx.createRadialGradient(p.rx, p.ry, 0, p.rx, p.ry, size * 4);
          gg.addColorStop(0, 'rgba(' + br2 + ',' + bg2 + ',' + bb2 + ',' + (0.4 * glow).toFixed(3) + ')'); gg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.rx, p.ry, size * 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgb(' + r2 + ',' + g2 + ',' + b2 + ')';
        ctx.beginPath(); ctx.arc(p.rx, p.ry, size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  // ── 贴边深度（dock_depth_presets 嵌入·绝对像素偏移·绕 transform 劫持）────────────
  const ORB_SIZE = 56;
  // 过渡时长走 .dock-ease/.dock-out CSS 类（探出 320ms 轻回弹 / 缩回 240ms）；原 easeMs 配置从未接线，已删
  const DOCK_DEPTH_PRESETS = { half: { peek: 28 }, hidden: { peek: 10 } };
  const DOCK_SNAP_PX = 24; // 球缘距视口左右边小于此值才吸附
  // 统一 left/top 定位（K1：right/bottom 在 ST 顶层 transform 劫持下会落到长页底端，禁用）
  // ⑧a：写位置走 dock-ease 门控过渡（拖拽开始会摘掉这两个 class，直写 left 不再被过渡抢位）
  function applyDockOffset(peekOut) {
    if (!sidebarBall) return;
    const p = DOCK_DEPTH_PRESETS[sidebarState.dockDepth] || DOCK_DEPTH_PRESETS.half;
    const vw = hostWindow().innerWidth || 1200;
    const off = peekOut ? -4 : -(ORB_SIZE - p.peek);
    try { sidebarBall.classList.add('dock-ease'); sidebarBall.classList.toggle('dock-out', !!peekOut); } catch (_) {}
    sidebarBall.style.right = 'auto';
    sidebarBall.style.left = (sidebarState.side === 'left' ? off : vw - ORB_SIZE - off) + 'px';
  }
  // ── 时段气泡（time_bubble_logic 嵌入 + 已批 5 段文案·中性桌宠口吻）────────────
  const BUBBLE_BUCKETS = { morning: [5, 10], noon: [11, 13], afternoon: [14, 17], evening: [18, 22], night: [23, 4] };
  const BUBBLE_TEXTS = {
    morning: '早安，今天也要元气满满哦。',
    noon: '中午了，记得好好吃饭呀。',
    afternoon: '下午的阳光正好，要不要歇口气？',
    evening: '天色暗下来了，今天过得还顺利吗？',
    night: '夜深了，别熬太晚，早点休息。',
  };
  const BUBBLE_STORAGE_KEY = 'xingyue-pet-bubble-v1';
  function getTimeBucket() {
    const h = new Date().getHours();
    for (const [bucket, [start, end]] of Object.entries(BUBBLE_BUCKETS)) {
      if (start <= end) { if (h >= start && h <= end) return bucket; }
      else if (h >= start || h <= end) return bucket;
    }
    return 'night';
  }
  function readBubbleRecord() {
    try { return Object.assign({ lastBucket: null, lastShownAt: null, muteUntil: null }, JSON.parse(localStorage.getItem(BUBBLE_STORAGE_KEY) || '{}')); } catch (_) { return { lastBucket: null, lastShownAt: null, muteUntil: null }; }
  }
  function shouldShowBubble(bucket) {
    if (orbReducedMotion()) return false;
    const rec = readBubbleRecord(), now = Date.now();
    if (rec.muteUntil && now < rec.muteUntil) return false;               // 显式静音中
    if (rec.lastBucket === bucket && rec.lastShownAt && (now - rec.lastShownAt) < 2 * 60 * 60 * 1000) return false; // 同桶 2h 窗口内只弹一次
    if (rec.lastShownAt && (now - rec.lastShownAt) < 30 * 60 * 1000) return false; // 最小间隔 30min
    return true;
  }
  function recordBubbleShown(bucket, extra) {
    try { localStorage.setItem(BUBBLE_STORAGE_KEY, JSON.stringify(Object.assign(readBubbleRecord(), { lastBucket: bucket, lastShownAt: Date.now() }, extra || {}))); } catch (_) {}
  }
  function showPetBubble() {
    const bucket = getTimeBucket();
    if (!shouldShowBubble(bucket) || !sidebarBall || !sidebarBall.isConnected) return;
    const doc = hostDocument();
    doc.getElementById('xingyue-pet-bubble')?.remove();
    const el = doc.createElement('div');
    el.id = 'xingyue-pet-bubble';
    el.className = sidebarState.docked ? ('dock-' + (sidebarState.side === 'left' ? 'left' : 'right')) : 'float';
    el.innerHTML = '<span class="xy-pb-text"></span><button type="button" class="xy-pb-mute" title="今天不再提示">✕</button>';
    el.querySelector('.xy-pb-text').textContent = BUBBLE_TEXTS[bucket] || '';
    doc.body.appendChild(el);
    const r = sidebarBall.getBoundingClientRect();
    const vw = hostWindow().innerWidth || 1200;
    const vh = hostWindow().innerHeight || 800;
    if (sidebarState.docked) {
      // 吸附版：从屏幕边缘横向弹出、尾巴指回球（蓝图 S4'）；全走 left/top 视口坐标——
      // fixed 的 right/bottom 会被 ST 顶层 transform 劫持到长页底端（K1 铁律，2026-07 真机实锤 reroll 气泡）。
      el.style.top = Math.max(8, Math.min(vh - 60, r.top - 6)) + 'px';
      const bw = el.getBoundingClientRect().width || 200; // 元素已挂载可量宽
      if (sidebarState.side === 'left') el.style.left = (ORB_SIZE + 10) + 'px';
      else el.style.left = Math.max(8, vw - (ORB_SIZE + 10) - bw) + 'px';
      el.style.right = 'auto';
    } else {
      // 浮空版：头顶冒、尾巴朝下（蓝图 S4；元素已挂载可量宽高）
      const br = el.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(vw - (br.width || 180) - 8, r.left + ORB_SIZE / 2 - (br.width || 180) / 2)) + 'px';
      el.style.top = Math.max(8, r.top - (br.height || 44) - 14) + 'px';
      el.style.right = 'auto';
    }
    (hostWindow().requestAnimationFrame || requestAnimationFrame)(() => { try { el.classList.add('show'); } catch (_) {} });
    if (petBubbleHideTimer) clearTimeout(petBubbleHideTimer);
    petBubbleHideTimer = setTimeout(() => { try { el.classList.remove('show'); setTimeout(() => el.remove(), 300); } catch (_) {} }, 7000);
    el.querySelector('.xy-pb-mute').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(petBubbleHideTimer);
      recordBubbleShown(bucket, { muteUntil: Date.now() + 24 * 60 * 60 * 1000 });
      el.remove();
    });
    recordBubbleShown(bucket);
  }
  // ── 样式 ────────────────────────────────────────────────────────────────
  function ensureSidebarStyle(doc) {
    if (doc.getElementById('xingyue-sidebar-style')) return;
    const css = [
      '#xingyue-sidebar-ball{position:fixed;z-index:2147483500;width:56px;height:56px;border-radius:50%;cursor:pointer;user-select:none;touch-action:none;background:transparent;transition:filter .2s;}',
      '#xingyue-sidebar-ball::before{content:"";position:absolute;inset:-22px;border-radius:50%;background:radial-gradient(circle,rgba(75,228,255,.16) 0%,rgba(75,228,255,.05) 45%,transparent 70%);pointer-events:none;opacity:.4;transition:opacity .25s;}',
      '#xingyue-sidebar-ball:hover{filter:brightness(1.15);}',
      '#xingyue-sidebar-ball:hover::before{opacity:.9;}',
      '#xingyue-sidebar-ball.dock-ease{transition:left .24s ease,top .24s ease,filter .2s;}',
      '#xingyue-sidebar-ball.dock-ease.dock-out{transition:left .32s cubic-bezier(.34,1.56,.64,1),top .32s cubic-bezier(.34,1.56,.64,1),filter .2s;}',
      '#xingyue-sidebar-ball canvas{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:240px;height:240px;pointer-events:none;}',
      '#xingyue-sidebar-menu{position:fixed;inset:0;z-index:2147483550;pointer-events:none;}',
      '.xy-orb-radial-btn{position:fixed;pointer-events:auto;display:flex;align-items:center;gap:6px;padding:7px 13px;background:linear-gradient(180deg,rgba(10,20,34,.96),rgba(5,9,18,.97));border:1px solid rgba(107,199,242,.42);border-radius:999px;color:#cfeaff;font:600 12px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:1px;box-shadow:0 6px 18px rgba(0,0,0,.5),0 0 10px rgba(75,228,255,.14);cursor:pointer;white-space:nowrap;transform:scale(.6);opacity:0;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .18s,border-color .15s,color .15s;z-index:2147483550;}',
      '.xy-orb-radial-btn.show{transform:scale(1);opacity:1;}',
      '.xy-orb-radial-btn:hover{border-color:rgba(75,228,255,.85);color:#eafaff;box-shadow:0 6px 20px rgba(0,0,0,.55),0 0 16px rgba(75,228,255,.35);}',
      '#xingyue-pet-bubble{position:fixed;z-index:2147483560;max-width:230px;padding:9px 12px;background:linear-gradient(180deg,rgba(10,20,34,.97),rgba(5,9,18,.97));border:1px solid rgba(107,199,242,.45);border-radius:11px;color:#dcf2ff;font:12px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 12px rgba(75,228,255,.18);display:flex;align-items:flex-start;gap:8px;opacity:0;transition:opacity .3s,transform .3s;}',
      '#xingyue-pet-bubble.dock-right{transform:translateX(14px);}',
      '#xingyue-pet-bubble.dock-left{transform:translateX(-14px);}',
      '#xingyue-pet-bubble.show{opacity:1;transform:translateX(0);}',
      '#xingyue-pet-bubble.dock-right::after{content:"";position:absolute;right:-6px;top:18px;border:6px solid transparent;border-right:none;border-left-color:rgba(107,199,242,.45);}',
      '#xingyue-pet-bubble.dock-left::after{content:"";position:absolute;left:-6px;top:18px;border:6px solid transparent;border-left:none;border-right-color:rgba(107,199,242,.45);}',
      '#xingyue-pet-bubble.float{transform:translateY(8px);}',
      '#xingyue-pet-bubble.float.show{transform:translateY(0);}',
      '#xingyue-pet-bubble.float::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:none;border-top-color:rgba(107,199,242,.45);}',
      '#xingyue-pet-bubble .xy-pb-mute{flex:0 0 auto;background:transparent;border:none;color:#6f9daf;cursor:pointer;font-size:11px;padding:0 2px;line-height:1.4;}',
      '#xingyue-pet-bubble .xy-pb-mute:hover{color:#cfeaff;}',
      '@media (prefers-reduced-motion: reduce){#xingyue-sidebar-ball,.xy-orb-radial-btn,#xingyue-pet-bubble{transition:none !important;}}',
    ].join('');
    const style = doc.createElement('style');
    style.id = 'xingyue-sidebar-style';
    style.textContent = css;
    (doc.head || doc.body).appendChild(style);
  }
  // ── 半轮盘（half_radial_menu 数学嵌入·⑧b 四向净空自适应·弧朝屏内·全键收在视口内）────────────
  const RADIAL_BUTTONS = [
    { id: 'hud', icon: '📊', label: '状态栏' },
    { id: 'npc', icon: '👁', label: 'TA的视角' },
    { id: 'control', icon: '⚙️', label: '控制中心' },
    { id: 'avatar', icon: '🖼️', label: '气泡头像' },
    { id: 'map', icon: '🗺️', label: '地图' },
  ];
  // 紧急回退开关：true=弃扇形，改「对角斜列」布局（自适应扇形若在某真机布局翻车，切这个保底）
  const RADIAL_DIAGONAL_FALLBACK = false;
  function calcRadialPositions(center, vw, vh) {
    const mk = (btn, x, y) => ({ id: btn.id, icon: btn.icon, label: btn.label, x: Math.round(x), y: Math.round(y) });
    const hs = center.x < vw / 2 ? 1 : -1;  // 屏内水平方向（左半屏→向右展开）
    const vsn = center.y < vh / 2 ? 1 : -1; // 屏内垂直方向（上半屏→向下展开）
    if (RADIAL_DIAGONAL_FALLBACK) {
      return RADIAL_BUTTONS.map((btn, i) => mk(btn, center.x + hs * (64 + i * 12), center.y + vsn * (40 + i * 42)));
    }
    const rArc = 122;    // 3.4.7：5 键沿弧分布，半径从 108 加大到 122 避免相邻键堆叠（≥28/|cos75°| 仍满足不与球重叠）
    const rCorner = 168; // 角落 90° 扇形半径加大，5 键完整文字标签不堆叠
    const needH = rArc + 84, needV = rArc + 28; // 弧端点之外还要放下按钮标签（估 96 宽 / 30 高）
    const tightL = center.x < needH, tightR = vw - center.x < needH;
    const tightT = center.y < needV, tightB = vh - center.y < needV;
    const oh = (tightL && !tightR) ? 1 : ((tightR && !tightL) ? -1 : hs);  // 水平展开方向
    const ov = (tightT && !tightB) ? 1 : ((tightB && !tightT) ? -1 : vsn); // 垂直展开方向（1=向下）
    let startDeg, endDeg, rPx = rArc;
    if ((tightL || tightR) && (tightT || tightB)) {
      // 角落（两向净空都不足）→ 90° 扇形朝屏内对角展开 + 半径加大
      rPx = rCorner;
      if (oh === 1) { startDeg = 0; endDeg = ov === 1 ? -90 : 90; }
      else { startDeg = 180; endDeg = ov === 1 ? 270 : 90; }
    } else if (tightT || tightB) {
      // 靠顶→下半弧 / 靠底→上半弧（150°）
      if (ov === 1) { startDeg = -15; endDeg = -165; }
      else { startDeg = 15; endDeg = 165; }
    } else {
      // 默认：按球所在半屏出 150° 半弧（弧朝屏内，与 3.3.0 行为一致）
      if (oh === 1) { startDeg = 75; endDeg = -75; }
      else { startDeg = 105; endDeg = 255; }
    }
    return RADIAL_BUTTONS.map((btn, i) => {
      const t = RADIAL_BUTTONS.length > 1 ? i / (RADIAL_BUTTONS.length - 1) : 0;
      const angle = (startDeg + t * (endDeg - startDeg)) * (Math.PI / 180);
      return mk(btn, center.x + rPx * Math.cos(angle), center.y - rPx * Math.sin(angle));
    });
  }
  function closeSidebarMenu() {
    const m = hostDocument().getElementById('xingyue-sidebar-menu');
    if (m) m.remove();
    sidebarState.open = false;
    if (sidebarBall && !sidebarBall.matches(':hover')) {
      if (sidebarState.docked) { applyDockOffset(false); if (petOrbRenderer) petOrbRenderer.setState(sidebarState.side === 'left' ? 'edge-left' : 'edge-right'); }
      else if (petOrbRenderer) petOrbRenderer.setState('idle');
    }
  }
  // ── 3.4.7：聊天上下文气泡头像管理器（轮盘第5键）──────────────────
  // 复用 collectDialogSpeakers/avatarManagerThumb（查顶层聊天 DOM，函数声明提升可跨段调用），
  // 在 host 文档建独立 modal，不依赖开局页 DOM；导入/换绑/清除/手动添加名字后 force 重渲气泡即时生效。
  function ensureHudAvatarMgrStyle(doc) {
    if (!doc || doc.getElementById('xingyue-hud-avatar-mgr-style')) return;
    const style = doc.createElement('style');
    style.id = 'xingyue-hud-avatar-mgr-style';
    style.textContent = [
      // 3.4.7：overlay 用 left/top:0 + JS 显式设视口宽高（inset:0 在 ST 顶层 transform 下会塌成 32px 高→panel 跑屏外）；panel 用 calc(100%-…) 相对 overlay 硬边界防溢出
      '#xingyue-hud-avatar-mgr{position:fixed;left:0;top:0;width:100vw;height:100dvh;z-index:2147483600;display:grid;place-items:center;background:rgba(4,8,12,.62);backdrop-filter:blur(3px);padding:16px;box-sizing:border-box;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}',
      '#xingyue-hud-avatar-mgr .xy-ham-panel{width:min(460px,calc(100% - 32px));max-width:calc(100% - 32px);max-height:calc(100% - 32px);overflow:auto;background:linear-gradient(180deg,#141d29,#0c1119);border:1px solid rgba(75,228,255,.28);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.55);color:#eafaff;padding:16px;box-sizing:border-box}',
      '#xingyue-hud-avatar-mgr .xy-ham-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}',
      '#xingyue-hud-avatar-mgr .xy-ham-head strong{font-size:15px;color:#9fe9ff}',
      '#xingyue-hud-avatar-mgr button{cursor:pointer}',
      '#xingyue-hud-avatar-mgr .xy-ham-close{min-height:34px;padding:6px 14px;border-radius:8px;border:1px solid rgba(75,228,255,.35);background:transparent;color:#cdeffb}',
      '#xingyue-hud-avatar-mgr .xy-ham-note{font-size:12px;line-height:1.7;color:rgba(190,225,240,.8);margin:0 0 10px}',
      '#xingyue-hud-avatar-mgr .xy-ham-add{display:flex;gap:8px;margin-bottom:10px}',
      '#xingyue-hud-avatar-mgr .xy-ham-add input{flex:1 1 auto;min-width:0;min-height:40px;padding:8px 10px;border-radius:8px;border:1px solid rgba(75,228,255,.3);background:rgba(7,14,20,.8);color:#eafaff;box-sizing:border-box}',
      '#xingyue-hud-avatar-mgr .xy-ham-addbtn{flex:0 0 auto;min-height:40px;padding:8px 14px;border-radius:8px;border:1px solid rgba(75,228,255,.45);background:rgba(75,228,255,.14);color:#eafaff}',
      '#xingyue-hud-avatar-mgr .xy-ham-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid rgba(75,228,255,.2);border-radius:10px;margin-top:8px;background:rgba(10,18,26,.6)}',
      '#xingyue-hud-avatar-mgr .xy-ham-thumb{width:44px;height:44px;flex:0 0 auto;border-radius:10px;object-fit:cover;background:rgba(75,228,255,.1);border:1px solid rgba(75,228,255,.3)}',
      '#xingyue-hud-avatar-mgr .xy-ham-rowname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}',
      '#xingyue-hud-avatar-mgr .xy-ham-rowname small{display:block;color:rgba(150,200,220,.75);font-size:11px}',
      '#xingyue-hud-avatar-mgr .xy-ham-row button{min-height:34px;padding:6px 10px;border-radius:8px;border:1px solid rgba(75,228,255,.35);background:transparent;color:#cdeffb;flex:0 0 auto}',
      '#xingyue-hud-avatar-mgr .xy-ham-empty{font-size:12px;color:rgba(180,210,225,.7);padding:10px 2px}',
    ].join('');
    (doc.head || doc.documentElement).appendChild(style);
  }
  // 3.4.7：HUD 段自含采集/缩略图，不跨闭包依赖开局段的 collectDialogSpeakers/avatarManagerThumb（那些闭包 root，HUD 段不可达会 ReferenceError）。
  function hudCollectSpeakers() {
    const doc = hostDocument();
    const names = new Map();
    names.set('{{user}}', { kind: 'user' });
    const userAliases = new Set(['user', 'player', '{{user}}', '玩家', '主角']);
    try {
      doc.querySelectorAll('[data-xy-dialog-speaker]').forEach(node => {
        const raw = String(node.getAttribute('data-xy-dialog-speaker') || '').trim();
        if (raw && !userAliases.has(raw.toLowerCase()) && !userAliases.has(raw)) names.set(raw, { kind: 'npc' });
      });
      doc.querySelectorAll('.xy-dialog-speaker, .custom-xy-dialog-speaker').forEach(node => {
        const raw = String(node.textContent || '').trim();
        if (raw && raw !== '{{user}}' && !names.has(raw)) names.set(raw, { kind: 'npc' });
      });
    } catch (_) {}
    try {
      (mediaLibrary()?.listManagedAssets?.() || []).forEach(item => {
        if (item?.type === 'bond' && item?.slot === 'avatar' && item.name && item.name !== '{{user}}' && !names.has(item.name)) names.set(item.name, { kind: 'npc' });
      });
    } catch (_) {}
    return [...names.entries()].map(([name, info]) => ({ name, ...info }));
  }
  function hudAvatarThumb(name) {
    try {
      const lib = mediaLibrary();
      const exact = lib?.getExactAsset?.({ type: 'bond', slot: 'avatar', name, variant: 'normal' });
      if (exact) return exact.dataUrl || exact.url || exact.src || '';
      const loose = lib?.getAsset?.({ type: 'bond', slot: 'avatar', name, variant: 'normal' });
      return loose?.dataUrl || loose?.url || loose?.src || '';
    } catch (_) { return ''; }
  }
  // 3.4.7：HUD 段可达的 CC api getter——controlCenter() 在 bindOpeningPage 闭包内、HUD 段调它会 ReferenceError。
  function hudControlCenterApi() {
    try { return window.XingyueControlCenter || hostWindow().XingyueControlCenter || null; } catch (_) { return null; }
  }
  function renderHudAvatarManagerList() {
    const list = hostDocument().querySelector('#xingyue-hud-avatar-mgr .xy-ham-list');
    if (!list) return;
    let speakers = [];
    try { speakers = hudCollectSpeakers(); } catch (_) { speakers = [{ name: '{{user}}', kind: 'user' }]; }
    list.innerHTML = speakers.map(item => {
      const isUser = item.kind === 'user';
      const src = isUser ? (hudControlCenterApi()?.resolvePlayerAvatarSrc?.('') || hudAvatarThumb(item.name)) : hudAvatarThumb(item.name);
      const hint = isUser ? '玩家气泡兜底头像' : (src ? '已绑定' : '未绑定 · 气泡显示占位头像');
      return '<div class="xy-ham-row">'
        + (src ? '<img class="xy-ham-thumb" src="' + escapeHtml(src) + '" alt="">' : '<span class="xy-ham-thumb"></span>')
        + '<span class="xy-ham-rowname">' + escapeHtml(item.name) + '<small>' + escapeHtml(hint) + '</small></span>'
        + '<button type="button" data-xy-ham-import data-name="' + escapeHtml(item.name) + '">' + (src ? '换头像' : '导入头像') + '</button>'
        + (src && !isUser ? '<button type="button" data-xy-ham-clear data-name="' + escapeHtml(item.name) + '">清除</button>' : '')
        + '</div>';
    }).join('') || '<div class="xy-ham-empty">当前聊天还没有出现对话气泡；可以先在上方手动添加名字。</div>';
  }
  function hudRefreshDialogBubbles() {
    try { mediaLibrary()?.renderDialogBubbles?.({ force: true }); } catch (_) {}
  }
  // 3.4.7：显式把 overlay 尺寸钉到真实视口（绕 ST 顶层 transform 对 fixed inset:0 的高度塌缩劫持）
  let hudAvatarMgrResizeHandler = null;
  function sizeHudAvatarMgrOverlay() {
    const overlay = hostDocument().getElementById('xingyue-hud-avatar-mgr');
    if (!overlay) return;
    const win = hostWindow();
    const vv = win.visualViewport;
    const vw = Math.round(vv?.width || win.innerWidth || 360);
    const vh = Math.round(vv?.height || win.innerHeight || 640);
    overlay.style.width = vw + 'px';
    overlay.style.height = vh + 'px';
  }
  function closeHudAvatarManager() {
    try { hostDocument().getElementById('xingyue-hud-avatar-mgr')?.remove(); } catch (_) {}
    if (hudAvatarMgrResizeHandler) {
      try { const win = hostWindow(); win.removeEventListener('resize', hudAvatarMgrResizeHandler); win.visualViewport?.removeEventListener?.('resize', hudAvatarMgrResizeHandler); win.removeEventListener('orientationchange', hudAvatarMgrResizeHandler); } catch (_) {}
      hudAvatarMgrResizeHandler = null;
    }
  }
  async function hudAvatarManagerImport(name) {
    const lib = mediaLibrary();
    if (!lib?.requestLocalImport) { toast('error', '媒体库导入 API 未就绪'); return; }
    const clean = String(name || '').trim();
    if (!clean) { toast('error', '请先输入角色名（要与气泡显示名完全一致）'); return; }
    try {
      const item = await lib.requestLocalImport({ type: 'bond', name: clean, slot: 'avatar', variant: 'normal' });
      if (item && item.key) {
        hudRefreshDialogBubbles();
        renderHudAvatarManagerList();
        toast('success', '已给「' + clean + '」绑定气泡头像，聊天中立即生效');
      }
    } catch (error) { toast('error', error.message || String(error)); }
  }
  function openHudAvatarManager() {
    const doc = hostDocument();
    ensureHudAvatarMgrStyle(doc);
    closeHudAvatarManager();
    const overlay = doc.createElement('div');
    overlay.id = 'xingyue-hud-avatar-mgr';
    overlay.innerHTML = '<div class="xy-ham-panel" role="dialog" aria-modal="true" aria-label="气泡头像管理">'
      + '<div class="xy-ham-head"><strong>气泡头像管理</strong><button type="button" class="xy-ham-close">关闭</button></div>'
      + '<p class="xy-ham-note">对话气泡按「说话者名字」自动取头像。给名字绑定头像后，聊天里该角色的气泡立即换新头像；名字要与气泡显示名完全一致。</p>'
      + '<div class="xy-ham-add"><input type="text" class="xy-ham-name" placeholder="输入角色名（与气泡显示名一致）"><button type="button" class="xy-ham-addbtn">添加名字</button></div>'
      + '<div class="xy-ham-list"></div></div>';
    (doc.body || doc.documentElement).appendChild(overlay);
    sizeHudAvatarMgrOverlay(); // 3.4.7：钉视口尺寸→panel 正中且不超边界
    const win = hostWindow();
    hudAvatarMgrResizeHandler = () => sizeHudAvatarMgrOverlay();
    try { win.addEventListener('resize', hudAvatarMgrResizeHandler, { passive: true }); win.visualViewport?.addEventListener?.('resize', hudAvatarMgrResizeHandler, { passive: true }); win.addEventListener('orientationchange', hudAvatarMgrResizeHandler, { passive: true }); } catch (_) {}
    renderHudAvatarManagerList();
    overlay.addEventListener('click', event => {
      const t = event.target;
      if (t === overlay || t.closest?.('.xy-ham-close')) { closeHudAvatarManager(); return; }
      const importBtn = t.closest?.('[data-xy-ham-import]');
      if (importBtn) { void hudAvatarManagerImport(importBtn.dataset.name); return; }
      const clearBtn = t.closest?.('[data-xy-ham-clear]');
      if (clearBtn) {
        const name = String(clearBtn.dataset.name || '').trim();
        try { mediaLibrary()?.removeAsset?.({ type: 'bond', name, slot: 'avatar', variant: 'normal' }); } catch (_) {}
        hudRefreshDialogBubbles();
        renderHudAvatarManagerList();
        toast('success', '已清除「' + name + '」的气泡头像');
        return;
      }
      if (t.closest?.('.xy-ham-addbtn')) {
        const input = overlay.querySelector('.xy-ham-name');
        const name = String(input?.value || '').trim();
        if (!name) { toast('error', '请先输入角色名'); return; }
        void hudAvatarManagerImport(name).then(() => { if (input) input.value = ''; });
      }
    });
  }
  function openSidebarMenu() {
    const doc = hostDocument();
    ensureSidebarStyle(doc);
    closeSidebarMenu();
    if (sidebarState.docked) applyDockOffset(true); // 吸附态展开时球探出，轮盘围球布局
    const menu = doc.createElement('div');
    menu.id = 'xingyue-sidebar-menu';
    doc.body.appendChild(menu);
    const vw = hostWindow().innerWidth || 1200;
    const vh = hostWindow().innerHeight || 800;
    const r = sidebarBall.getBoundingClientRect();
    // 吸附态：圆心按探出后落点估算（探出动画进行中 rect 不准）；浮空态：球真实中心，四向净空自适应选弧
    const cx = sidebarState.docked
      ? (sidebarState.side === 'left' ? (ORB_SIZE / 2 - 4) : (vw - ORB_SIZE / 2 + 4))
      : (r.left + ORB_SIZE / 2);
    const cy = r.top + ORB_SIZE / 2;
    const positions = calcRadialPositions({ x: cx, y: cy }, vw, vh);
    positions.forEach((pos, i) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'xy-orb-radial-btn';
      btn.setAttribute('data-xy-orb', pos.id);
      btn.innerHTML = '<span class="xy-orb-ic"></span><span class="xy-orb-lb"></span>';
      btn.querySelector('.xy-orb-ic').textContent = pos.icon;
      btn.querySelector('.xy-orb-lb').textContent = pos.label;
      menu.appendChild(btn);
      // 量宽一律 offsetWidth：出场 scale(.6) 动画期 getBoundingClientRect 会量小 40%（CDP 实锤坑）
      const bw = btn.offsetWidth || 96;
      const bh = btn.offsetHeight || 30;
      // K1 铁律：只用 left/top 视口坐标（right/bottom 会被 ST 顶层 transform 劫持到长页底端）
      const dxc = pos.x - cx;
      let bx;
      if (dxc > 12) bx = pos.x;            // 弧点在球右侧 → 左缘锚弧点，标签向右伸
      else if (dxc < -12) bx = pos.x - bw; // 弧点在球左侧 → 右缘锚弧点，标签向左伸
      else bx = pos.x - bw / 2;            // 近正上/正下 → 水平居中
      btn.style.left = Math.max(6, Math.min(vw - bw - 6, bx)) + 'px';
      btn.style.top = Math.max(8, Math.min(vh - bh - 8, pos.y - bh / 2)) + 'px';
      btn.style.transitionDelay = (i * 30) + 'ms';
      (hostWindow().requestAnimationFrame || requestAnimationFrame)(() => { try { btn.classList.add('show'); } catch (_) {} });
    });
    menu.addEventListener('click', (event) => {
      const act = event.target?.closest?.('[data-xy-orb]')?.getAttribute?.('data-xy-orb');
      if (!act) return;
      event.preventDefault(); event.stopPropagation();
      closeSidebarMenu();
      try {
        if (petOrbRenderer && !orbReducedMotion()) { petOrbRenderer.playBurstOut(() => { try { petOrbRenderer.playBurstIn(); } catch (_) {} }); }
        if (act === 'hud') openStatusHud();
        if (act === 'npc') openNpcPopover(); // 居中由 deworkshop patchNpcView 在派生层统一处理
        if (act === 'control') togglePanel(true);
        if (act === 'avatar') openHudAvatarManager(); // 3.4.7：轮盘第5键——聊天上下文气泡头像管理器
        if (act === 'map') toast('info', '地图系统建设中，敬请期待');
      } catch (error) { toast('error', error.message || String(error)); }
    });
    sidebarState.open = true;
  }
  // ── HUD 顶层单例状态栏（P-C-0 承重墙）────────────────────────────────
  // 真身 status-bar.html 从 git runtime 拉取(双源回退)，Blob iframe 挂进顶层居中面板(绝对像素·绕 transform 劫持)。
  // 桥：CC 先在顶层窗口放 __XY_HUD_BRIDGE 函数包(函数与文档无关可跨窗)，blob 内同步引导脚本在**解析期**
  // 取包装桥(与 3.2.0 已证变量桥同模式、无 load 竞态)；getVariables 走 Mvu+最新楼强取(N4 数据源切 latest)。
  const HUD_RT_BASE = 'https://cdn.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.4.7';
  const HUD_RT_BASE_CF = 'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.4.7';
  let hudPanel = null;
  let hudDrawer = null;
  const hudSession = {
    phase: 'idle',
    mode: null,
    host: null,
    blobUrl: null,
    abortController: null,
    generation: 0,
    contextRevision: 0,
    iframe: null,
    visible: false,
    dirty: true,
    pendingChatReset: false,
    destroyed: false,
    refreshTimer: null,
    subscribers: new Set(),
    eventDisposers: [],
    eventsBound: false,
    eventGeneration: 0,
    mvuEventsBound: false,
    mvuBindPromise: null,
    readyTimer: null,
  };
  let statusHudViewportTimer = null;
  function currentHudHost() {
    return (hudDrawer && hudDrawer.isConnected) ? hudDrawer : ((hudPanel && hudPanel.isConnected) ? hudPanel : null);
  }
  function effectiveStatusHudMode(forceMode) {
    const mode = normalizeStatusHudEntryMode(forceMode || settings.statusHudEntryMode);
    if (mode === 'drawer' || mode === 'orb') return mode;
    try {
      const win = hostWindow();
      const vw = Number(win.innerWidth || hostDocument().documentElement?.clientWidth || 1200);
      const coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
      return (vw <= 768 || coarse) ? 'drawer' : 'orb';
    } catch (_) {
      return 'orb';
    }
  }
  function effectiveStatusHudDrawerPlacement(forcePlacement) {
    const placement = normalizeStatusHudDrawerPlacement(forcePlacement || settings.statusHudDrawerPlacement);
    if (placement === 'top' || placement === 'bottom') return placement;
    return 'top';
  }
  function setHudPhase(phase) {
    hudSession.phase = phase;
    try {
      const hostEl = currentHudHost();
      if (hostEl) hostEl.dataset.phase = phase;
    } catch (_) {}
  }
  function stopHudEventDisposers() {
    if (hudSession.refreshTimer) {
      clearTimeout(hudSession.refreshTimer);
      hudSession.refreshTimer = null;
    }
    while (hudSession.eventDisposers.length) {
      try { hudSession.eventDisposers.pop()?.(); } catch (_) {}
    }
    hudSession.eventGeneration += 1;
    hudSession.eventsBound = false;
    hudSession.mvuEventsBound = false;
    hudSession.mvuBindPromise = null;
  }
  function abortHudLoad() {
    hudSession.generation += 1;
    if (hudSession.readyTimer) {
      clearTimeout(hudSession.readyTimer);
      hudSession.readyTimer = null;
    }
    try { hudSession.abortController?.abort(); } catch (_) {}
    hudSession.abortController = null;
    if (hudSession.phase === 'loading') setHudPhase('idle');
  }
  function resetHudLoad() {
    abortHudLoad();
    hudSession.subscribers.clear();
    try { hudSession.iframe?.remove?.(); } catch (_) {}
    revokeHudBlob();
  }
  function emitHudSignal(type, detail = {}) {
    if (!['data-changed', 'chat-reset', 'visibility'].includes(type)) return;
    if (!hudSession.visible && (type === 'data-changed' || type === 'chat-reset')) {
      hudSession.dirty = true;
      if (type === 'chat-reset') hudSession.pendingChatReset = true;
      return;
    }
    const signal = {
      type,
      visible: hudSession.visible,
      chatId: hudCurrentChatId(),
      messageId: hudCurrentMsgId(),
      revision: hudSession.contextRevision,
      ...detail,
    };
    for (const listener of Array.from(hudSession.subscribers)) {
      try { listener(signal); } catch (_) {}
    }
  }
  function setHudVisibility(visible) {
    const next = !!visible;
    const changed = hudSession.visible !== next;
    hudSession.visible = next;
    if (next && hudSession.refreshTimer) {
      clearTimeout(hudSession.refreshTimer);
      hudSession.refreshTimer = null;
    }
    if (changed) emitHudSignal('visibility', { visible: next, dirty: hudSession.dirty });
    if (next && hudSession.pendingChatReset) {
      hudSession.pendingChatReset = false;
      emitHudSignal('chat-reset', { force: true });
    }
    if (next && hudSession.dirty) {
      hudSession.dirty = false;
      emitHudSignal('data-changed', { force: true });
    }
    if (next) ensureHudMvuEventBindings();
  }
  function subscribeHud(listener) {
    if (typeof listener !== 'function') return () => {};
    hudSession.subscribers.add(listener);
    try { listener({ type: 'visibility', visible: hudSession.visible, dirty: hudSession.dirty, chatId: hudCurrentChatId(), messageId: hudCurrentMsgId() }); } catch (_) {}
    return () => { hudSession.subscribers.delete(listener); };
  }
  function addHudEventSubscription(eventOnHost, eventName, listener) {
    if (typeof eventOnHost !== 'function' || !eventName) return;
    try {
      const handle = eventOnHost(eventName, listener);
      if (typeof handle === 'function') hudSession.eventDisposers.push(handle);
      else if (handle?.stop) hudSession.eventDisposers.push(() => handle.stop());
      else if (handle?.unsubscribe) hudSession.eventDisposers.push(() => handle.unsubscribe());
    } catch (_) {}
  }
  function queueHudDataChanged() {
    hudSession.dirty = true;
    ensureHudMvuEventBindings();
    if (hudSession.refreshTimer) clearTimeout(hudSession.refreshTimer);
    hudSession.refreshTimer = setTimeout(() => {
      hudSession.refreshTimer = null;
      if (!hudSession.dirty) return;
      emitHudSignal('data-changed');
      if (hudSession.visible) hudSession.dirty = false;
    }, 80);
  }
  function invalidateHudContext() {
    hudSession.contextRevision += 1;
    hudSession.dirty = true;
    if (hudSession.refreshTimer) {
      clearTimeout(hudSession.refreshTimer);
      hudSession.refreshTimer = null;
    }
    emitHudSignal('chat-reset', { force: true, revision: hudSession.contextRevision });
    if (hudSession.visible) hudSession.dirty = false;
    ensureHudMvuEventBindings();
  }
  function ensureHudMvuEventBindings() {
    if (!hudSession.eventsBound || hudSession.destroyed || hudSession.mvuEventsBound) return hudSession.mvuBindPromise;
    if (hudSession.mvuBindPromise) return hudSession.mvuBindPromise;
    const bindGeneration = hudSession.eventGeneration;
    const host = hostWindow();
    const eventOnHost = window.eventOn || host.eventOn;
    hudSession.mvuBindPromise = Promise.resolve(waitForHudMvu()).then((mvu) => {
      if (!hudSession.eventsBound || hudSession.destroyed || hudSession.mvuEventsBound || bindGeneration !== hudSession.eventGeneration) return;
      const mvuEvents = new Set([
        mvu?.events?.VARIABLE_INITIALIZED,
        mvu?.events?.VARIABLE_UPDATE_ENDED,
      ].filter(Boolean));
      mvuEvents.forEach(eventName => addHudEventSubscription(eventOnHost, eventName, queueHudDataChanged));
      hudSession.mvuEventsBound = mvuEvents.size > 0;
    }).catch(() => {}).finally(() => {
      if (bindGeneration === hudSession.eventGeneration) hudSession.mvuBindPromise = null;
    });
    return hudSession.mvuBindPromise;
  }
  function bindHudDataEvents() {
    if (hudSession.eventsBound) return;
    hudSession.eventsBound = true;
    hudSession.destroyed = false;
    const host = hostWindow();
    const eventOnHost = window.eventOn || host.eventOn;
    const tavernEvents = window.tavern_events || host.tavern_events || {};
    const contextEvents = new Set([
      tavernEvents.CHAT_CHANGED,
      tavernEvents.MESSAGE_SWIPED,
      tavernEvents.MESSAGE_UPDATED,
      tavernEvents.MESSAGE_RECEIVED,
    ].filter(Boolean));
    contextEvents.forEach(eventName => addHudEventSubscription(eventOnHost, eventName, invalidateHudContext));
    const messageEvents = new Set([
      tavernEvents.CHARACTER_MESSAGE_RENDERED,
      tavernEvents.USER_MESSAGE_RENDERED,
    ].filter(Boolean));
    messageEvents.forEach(eventName => addHudEventSubscription(eventOnHost, eventName, queueHudDataChanged));
    ensureHudMvuEventBindings();
  }
  function revokeHudBlob() {
    try { if (hudSession.blobUrl) URL.revokeObjectURL(hudSession.blobUrl); } catch (_) {}
    hudSession.blobUrl = null;
    hudSession.iframe = null;
    setHudPhase('idle');
  }
  function destroyStatusHudHost() {
    hudSession.destroyed = true;
    setHudVisibility(false);
    stopHudEventDisposers();
    resetHudLoad();
    hudSession.subscribers.clear();
    try { hostDocument().getElementById('xingyue-hud-panel')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xingyue-hud-panel-style')?.remove(); } catch (_) {}
    try { hostDocument().getElementById(STATUS_HUD_DRAWER_ID)?.remove(); } catch (_) {}
    try { hostDocument().getElementById(STATUS_HUD_DRAWER_STYLE_ID)?.remove(); } catch (_) {}
    hudPanel = null;
    hudDrawer = null;
    hudSession.host = null;
    hudSession.mode = null;
    try {
      const host = hostWindow();
      if (host.__XY_HUD_BRIDGE === hudBridge) delete host.__XY_HUD_BRIDGE;
    } catch (_) {}
  }
  function hudCurrentMsgId() {
    try { if (typeof getLastMessageId === 'function') return getLastMessageId(); } catch (_) {}
    try { if (typeof getCurrentMessageId === 'function') return getCurrentMessageId(); } catch (_) {}
    return 'latest';
  }
  function hudCurrentChatId() {
    try { return String(hostWindow().SillyTavern?.getCurrentChatId?.() || window.SillyTavern?.getCurrentChatId?.() || ''); } catch (_) { return ''; }
  }
  function hudCurrentContextKey() {
    const messageId = hudCurrentMsgId();
    return hudCurrentChatId() + '::' + String(messageId == null ? 'latest' : messageId);
  }
  function assertHudExpectedContext(expectedContextKey, expectedContextRevision) {
    const currentContextKey = hudCurrentContextKey();
    const revisionChanged = Number.isInteger(expectedContextRevision) && expectedContextRevision !== hudSession.contextRevision;
    if (revisionChanged || (expectedContextKey && String(expectedContextKey) !== currentContextKey)) {
      throw new Error('聊天上下文已变化，已取消本次变量写入');
    }
    return currentContextKey;
  }
  async function waitForHudMvu(timeoutMs = 8000) {
    const host = hostWindow();
    const waitGlobal = window.waitGlobalInitialized || host.waitGlobalInitialized;
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 8000));
    if (typeof waitGlobal === 'function') {
      let timer = null;
      try {
        await Promise.race([
          Promise.resolve(waitGlobal('Mvu')),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待 MVU 初始化超时')), Math.min(4000, Math.max(1000, Number(timeoutMs || 8000)))); }),
        ]);
      } catch (_) {
        // 官方等待器不可用或超时后继续在总预算内轮询。
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    while (Date.now() <= deadline) {
      const mvu = mvuHost();
      if (mvu?.getMvuData && mvu?.replaceMvuData && mvu?.events) return mvu;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('MVU 尚未就绪');
  }
  function hudGetVariables() {
    const mvu = mvuHost();
    if (!mvu?.getMvuData) throw new Error('MVU 读取接口尚未就绪');
    return mvu.getMvuData({ type: 'message', message_id: hudCurrentMsgId() });
  }
  function validateHudMvuData(next) {
    const Schema = getMvuSchema();
    if (!Schema || typeof Schema.parse !== 'function') throw new Error('星月 Schema 尚未就绪');
    const cloned = clone(next) || { stat_data: {} };
    const parsed = Schema.parse(clone(statRoot(cloned)) || {});
    if (isObject(cloned.stat_data)) cloned.stat_data = parsed;
    else return parsed;
    return cloned;
  }
  async function hudUpdateVariablesWith(updater, options = {}) {
    if (options.type && options.type !== 'message') throw new Error('HUD bridge 只允许写入 message 变量');
    const expectedContextKey = String(options.expectedContextKey || hudCurrentContextKey());
    const expectedContextRevision = hudSession.contextRevision;
    assertHudExpectedContext(expectedContextKey, expectedContextRevision);
    const mvu = await waitForHudMvu();
    assertHudExpectedContext(expectedContextKey, expectedContextRevision);
    const messageId = options.message_id == null ? hudCurrentMsgId() : options.message_id;
    const mvuOptions = { type: 'message', message_id: messageId };
    const oldData = clone(mvu.getMvuData(mvuOptions) || { stat_data: {} });
    let nextData = clone(oldData) || { stat_data: {} };
    const returned = await updater(nextData);
    if (returned !== undefined) nextData = returned;
    nextData = validateHudMvuData(nextData);
    assertHudExpectedContext(expectedContextKey, expectedContextRevision);
    await mvu.replaceMvuData(nextData, mvuOptions);
    emitHudSignal('data-changed', { force: true });
    return nextData;
  }
  let hudBridge = null;
  function publishHudBridge() {
    const host = hostWindow();
    const fns = {};
    // XingyueHudSettings/CrossedZoneHudSettings：设置持久化对象（缺了真机报 timeout、齿轮设置不保存——3.3.0 实锤）
    ['$', 'jQuery', '_', 'errorCatched', 'toastr', 'TavernHelper', 'XingyueHudSettings', 'CrossedZoneHudSettings'].forEach((k) => {
      try { if (typeof window[k] !== 'undefined') fns[k] = window[k]; else if (typeof host[k] !== 'undefined') fns[k] = host[k]; } catch (_) {}
    });
    // getMvu 动态取(非快照)——早开面板时 Mvu 可能未就绪,快照 null 会让真身事件绑定失效(审查 minor)
    // closeHud：给 blob 内 ✕ 用的收起回调（✕=收起整个浮窗；真身 CLOSE=折叠内容，语义不同不合并）
    // onCollapse：真身 CLOSE 折叠内容时通知外壳，把深黑玻璃底透明化（否则折叠后剩一大块空磨砂框；透明化=回落 3.3.1 折叠观感）
    hudBridge = {
      fns,
      getCurrentMessageId: () => hudCurrentMsgId(),
      getCurrentChatId: () => hudCurrentChatId(),
      waitForMvu: (timeoutMs) => waitForHudMvu(timeoutMs),
      getVariables: () => hudGetVariables(),
      updateVariablesWith: (updater, options) => hudUpdateVariablesWith(updater, options),
      applyCraftSettlement: (recipeId, options) => applyCraftSettlement(recipeId, options),
      subscribeHud,
      getVisibility: () => hudSession.visible,
      closeHud: () => { try { closeStatusHud(); } catch (_) {} },
      onCollapse: (v) => { try { const el = currentHudHost(); if (el) el.classList.toggle('xy-hud-collapsed', !!v); } catch (_) {} },
    };
    host.__XY_HUD_BRIDGE = hudBridge;
    return hudBridge;
  }
  function buildHudBlobHtml(html) {
    const host = hostWindow();
    const jqueryUrl = host.XY_HUD_JQUERY_OVERRIDE || window.XY_HUD_JQUERY_OVERRIDE || 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js';
    const lodashUrl = host.XY_HUD_LODASH_OVERRIDE || window.XY_HUD_LODASH_OVERRIDE || 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js';
    const libs = '<script>(function(){var B=(window.parent&&window.parent.__XY_HUD_BRIDGE)||null;var f=B&&B.fns||{};'
      + 'try{var jq=f.jQuery||f.$;var probe=jq&&jq("<i>")[0];if(probe&&probe.ownerDocument===document){window.jQuery=jq;window.$=jq;}}catch(e){}'
      + 'if(!window._&&f._)window._=f._;'
      + 'if(!window.jQuery)document.write(\'<script src="' + String(jqueryUrl).replace(/"/g, '&quot;') + '"><\\/script>\');'
      + 'if(!window._)document.write(\'<script src="' + String(lodashUrl).replace(/"/g, '&quot;') + '"><\\/script>\');'
      + '})();<\/script>';
    // ⑦⑨b：真身文档撑满 iframe 视口（杀文档级滚动条，绘制矩形恒等于外壳矩形，右下握把天然贴角）；
    // 注入点在真身样式之前，同权重会被真身盖回——布局声明必须带 !important（审查实锤雷）。
    const shellFit = '<style>'
      + 'html,body{height:100% !important;margin:0 !important;overflow:hidden !important;}'
      + '.hud-container{height:100% !important;box-sizing:border-box !important;display:flex !important;flex-direction:column !important;}'
      + '.hud-container:has(.hud-body.collapsed){height:auto !important;}'
      + '.hud-header{flex:0 0 auto !important;}'
      + '.hud-body:not(.collapsed){display:flex !important;flex-direction:column !important;flex:1 1 auto !important;min-height:0 !important;}'
      + '.hud-body .tab-bar{flex:0 0 auto !important;}'
      + '.hud-body .hud-scroll-progress{flex:0 0 auto !important;}'
      + '.hud-body .tab-content{height:auto !important;flex:1 1 auto !important;min-height:0 !important;}'
      + '<\/style>';
    // ⑨d：透明表面模式的面板/卡片/控件不透明度抬到可读档。不再用 :root !important 钉死变量（审查 major 实锤：
    // 样式表 !important 恒压真身 applyHudColorSettings 的 inline setProperty，齿轮「背景透明度」滑条与主题色
    // 对这 4 面彻底失效，且误伤非透明表面模式）。改为 liftSurface：MutationObserver 盯真身引擎写完 inline
    // 变量后再抬——仅 --hud-surface-mode=transparent 时生效，保留引擎算出的 rgb（主题色照常），alpha 按
    // 引擎透明档区间→可读档区间线性单调重映射（滑条全程有响应）；liftLast 记自己写过的值防自触发循环。
    const boot = '<script>(function(){try{'
      + 'var B=(window.parent&&window.parent.__XY_HUD_BRIDGE)||null;if(!B)return;'
      + 'Object.keys(B.fns||{}).forEach(function(k){try{if(typeof window[k]==="undefined")window[k]=B.fns[k];}catch(e){}});'
      + 'window.XingyueHudBridge=B;window.__XY_HUD_BRIDGE=B;'
      + 'try{document.documentElement.setAttribute("data-xy-hud-bridge","ready");}catch(e){}'
      + 'try{document.documentElement.setAttribute("data-xy-hud-deps",(typeof window.jQuery)+":"+(typeof window._));}catch(e){}'
      + 'window.getCurrentMessageId=function(){return B.getCurrentMessageId();};'
      + 'window.getVariables=function(){return B.getVariables();};'
      + 'window.updateVariablesWith=function(updater,o){return B.updateVariablesWith(updater,o||{});};'
      + 'window.waitGlobalInitialized=function(n){return n==="Mvu"?B.waitForMvu():Promise.resolve(window[n]);};'
      + 'var LIFT={"--hud-bg-panel":[18,52,40,72],"--hud-bg-panel-2":[22,60,46,78],"--hud-bg-card":[10,22,32,56],"--hud-control-bg":[18,44,40,68]};var liftLast={};'
      + 'var liftSurface=function(){try{var root=document.documentElement;if(String(getComputedStyle(root).getPropertyValue("--hud-surface-mode")||"").trim()!=="transparent")return;Object.keys(LIFT).forEach(function(p){try{var v=(root.style.getPropertyValue(p)||"").trim();if(!v||v===liftLast[p]||v.indexOf("rgba(")!==0)return;var i=v.lastIndexOf(",");var j=v.lastIndexOf(")");if(i<5||j<i)return;var a=Math.round(parseFloat(v.slice(i+1,j))*100);if(!isFinite(a))return;var c=LIFT[p];if(a<c[0]||a>c[1])return;var y=c[2]+(a-c[0])*(c[3]-c[2])/(c[1]-c[0]);var nv=v.slice(0,i+1)+(y/100).toFixed(2)+")";liftLast[p]=nv;root.style.setProperty(p,nv);}catch(e){}});}catch(e){}};'
      + 'try{new MutationObserver(liftSurface).observe(document.documentElement,{attributes:true,attributeFilter:["style"]});}catch(e){}'
      + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",liftSurface);else liftSurface();'
      + 'var mkX=function(){try{if(document.getElementById("xy-hud-shell-x"))return;var c=document.getElementById("hud-toggle-btn");if(!c||!c.parentNode)return;var b=document.createElement("button");b.type="button";b.id="xy-hud-shell-x";b.className="hud-collapse-btn";b.textContent="✕";b.title="收起浮窗";b.addEventListener("click",function(ev){ev.preventDefault();ev.stopPropagation();try{if(B.closeHud)B.closeHud();}catch(e){}});c.parentNode.insertBefore(b,c.nextSibling);}catch(e){}};'
      + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mkX);else mkX();'
      + 'var lastCol=null;var wc=function(){try{var b=document.querySelector(".hud-body");if(!b)return;var rep=function(){try{var c=b.classList.contains("collapsed");if(c===lastCol)return;lastCol=c;if(B.onCollapse)B.onCollapse(c);}catch(e){}};new MutationObserver(rep).observe(b,{attributes:true,attributeFilter:["class"]});rep();}catch(e){}};'
      + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wc);else wc();'
      + '}catch(e){}})();<\/script>';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + libs + shellFit + boot);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + libs + shellFit + boot);
    return libs + shellFit + boot + html;
  }
  // 3.3.1：位置/尺寸持久化（总监拍板：可拖动移动 + 右下角拖动调大小）
  const HUD_PANEL_STORE_KEY = 'xingyue-hud-panel-v331';
  function saveHudPanelRect() {
    try {
      if (!hudPanel || !hudPanel.isConnected) return;
      const r = hudPanel.getBoundingClientRect();
      localStorage.setItem(HUD_PANEL_STORE_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
    } catch (_) {}
  }
  function hudPanelGeometry() {
    // panel_manager 契约：绝对像素定位，不用 transform translate（绕 fixed 包含块劫持）
    const vw = hostWindow().innerWidth || 1200;
    const vh = hostWindow().innerHeight || 800;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(HUD_PANEL_STORE_KEY) || 'null'); } catch (_) {}
    let w = saved && typeof saved.w === 'number' ? saved.w : 430;
    let h = saved && typeof saved.h === 'number' ? saved.h : 640;
    const bounds = hudPanelSizeBounds(vw, vh, 8, 8);
    w = Math.min(Math.max(bounds.minW, w), bounds.maxW);
    h = Math.min(Math.max(bounds.minH, h), bounds.maxH);
    let left = saved && typeof saved.x === 'number' ? saved.x : Math.round((vw - w) / 2);
    let top = saved && typeof saved.y === 'number' ? saved.y : Math.round((vh - h) / 2);
    left = Math.max(8, Math.min(vw - w - 8, left));
    top = Math.max(8, Math.min(vh - h - 8, top));
    return { left, top, w, h };
  }
  function hudPanelSizeBounds(vw, vh, left, top) {
    const maxW = Math.max(1, Number(vw || 0) - Number(left || 0) - 8);
    const maxH = Math.max(1, Number(vh || 0) - Number(top || 0) - 8);
    return {
      minW: Math.min(280, maxW),
      minH: Math.min(320, maxH),
      maxW,
      maxH,
    };
  }
  function ensureHudPanelStyle(doc) {
    if (doc.getElementById('xingyue-hud-panel-style')) return;
    const style = doc.createElement('style');
    style.id = 'xingyue-hud-panel-style';
    // 3.3.1 S1 深黑玻璃浮窗（总监拍板）：外壳深黑半透底+磨砂（磨浮窗底下聊天正文，必须在外壳层做，
    // iframe 内做无效）；✕ 移入真身 header（经 blob 注入），外壳不再挂骑角 ✕；拖动条只留命中区不再有辉光带；
    // 缩放命中区保留，但可见提示改为同款切角斜边，避免 L 形角标与右下切角视觉打架。
    style.textContent = [
      '#xingyue-hud-panel{--xy-hud-cut:14px;position:fixed;z-index:2147483540;background:rgba(6,10,16,.6);backdrop-filter:blur(14px) saturate(1.12);-webkit-backdrop-filter:blur(14px) saturate(1.12);border:none;border-radius:0;clip-path:polygon(var(--xy-hud-cut) 0,100% 0,100% calc(100% - var(--xy-hud-cut)),calc(100% - var(--xy-hud-cut)) 100%,0 100%,0 var(--xy-hud-cut));transform-origin:center center;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .18s;}',
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#xingyue-hud-panel{background:rgba(6,10,16,.92);}}',
      '#xingyue-hud-panel .xy-hud-body{position:absolute;inset:0;}',
      '#xingyue-hud-panel .xy-hud-body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}',
      '#xingyue-hud-panel.xy-hud-busy .xy-hud-body iframe{pointer-events:none;}',
      '#xingyue-hud-panel .xy-hud-drag{position:absolute;top:0;left:0;width:calc(100% - 170px);height:26px;cursor:move;z-index:3;background:transparent;touch-action:none;}',
      '#xingyue-hud-panel.xy-hud-collapsed{background:transparent !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}',
      '#xingyue-hud-panel.xy-hud-collapsed .xy-hud-resize{display:none !important;opacity:0 !important;pointer-events:none !important;}',
      '#xingyue-hud-panel .xy-hud-resize{position:absolute;right:0;bottom:0;width:32px;height:32px;cursor:nwse-resize;z-index:3;opacity:0;transition:opacity .15s;border:none;border-radius:0;background:transparent;touch-action:none;}',
      '#xingyue-hud-panel .xy-hud-resize::before{content:"";position:absolute;right:3px;bottom:3px;width:24px;height:24px;background:rgba(75,228,255,.76);clip-path:polygon(100% 0,100% 6px,6px 100%,0 100%,0 calc(100% - 3px),calc(100% - 3px) 0);filter:drop-shadow(0 0 6px rgba(75,228,255,.38));}',
      '#xingyue-hud-panel .xy-hud-resize::after{content:"";position:absolute;right:9px;bottom:9px;width:13px;height:13px;background:rgba(207,243,255,.34);clip-path:polygon(100% 0,100% 3px,3px 100%,0 100%,0 calc(100% - 2px),calc(100% - 2px) 0);}',
      '#xingyue-hud-panel:hover .xy-hud-resize{opacity:1;}',
      '#xingyue-hud-panel .xy-hud-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6f9daf;font:12px/1.6 Consolas,monospace;letter-spacing:1px;background:rgba(4,8,14,.9);border:1px solid rgba(107,199,242,.3);border-radius:0;clip-path:inherit;}',
    ].join('');
    (doc.head || doc.body).appendChild(style);
  }
  function failHudLoad(hostEl, message) {
    setHudPhase('failed');
    let loading = hostEl?.querySelector?.('.xy-hud-loading');
    if (!loading) {
      const body = hostEl?.querySelector?.('.xy-hud-body');
      if (body) {
        loading = hostEl.ownerDocument.createElement('div');
        loading.className = 'xy-hud-loading';
        body.replaceChildren(loading);
      }
    }
    if (loading) loading.textContent = message || '状态栏远程组件加载失败，请检查网络后重试。';
  }
  function mountHudBody(html, expectedHost, generation, signal) {
    const hostEl = currentHudHost();
    if (!hostEl || hostEl !== expectedHost || signal?.aborted || generation !== hudSession.generation) return false;
    const bridge = publishHudBridge();
    html = buildHudBlobHtml(html);
    try {
      if (hudSession.blobUrl) URL.revokeObjectURL(hudSession.blobUrl);
      hudSession.blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    } catch (error) {
      failHudLoad(hostEl, '状态栏面板挂载失败：' + (error.message || error));
      toast('error', '状态栏面板挂载失败：' + (error.message || error));
      return false;
    }
    const body = hostEl.querySelector('.xy-hud-body');
    if (!body) {
      failHudLoad(hostEl, '状态栏宿主已失效，请重试。');
      return false;
    }
    const frame = hostEl.ownerDocument.createElement('iframe');
    frame.title = '星月状态栏';
    frame.src = hudSession.blobUrl;
    frame.addEventListener('load', () => {
      if (signal?.aborted || generation !== hudSession.generation || currentHudHost() !== expectedHost || hudSession.iframe !== frame) return;
      const deadline = Date.now() + 12000;
      const checkReady = () => {
        if (signal?.aborted || generation !== hudSession.generation || currentHudHost() !== expectedHost || hudSession.iframe !== frame) return;
        let healthy = false;
        try {
          const frameWindow = frame.contentWindow;
          healthy = frameWindow?.XingyueHudBridge === bridge
            && typeof frameWindow?.jQuery === 'function'
            && !!frameWindow?._
            && frameWindow.document?.documentElement?.getAttribute('data-xy-hud-ready') === '1';
        } catch (_) {}
        if (healthy) {
          hudSession.readyTimer = null;
          hudSession.abortController = null;
          setHudPhase('ready');
          emitHudSignal('data-changed', { force: true });
          return;
        }
        if (Date.now() >= deadline) {
          hudSession.readyTimer = null;
          hudSession.abortController = null;
          failHudLoad(expectedHost, '状态栏初始化或桥接握手失败，请重试。');
          return;
        }
        hudSession.readyTimer = setTimeout(checkReady, 50);
      };
      checkReady();
    }, { once: true });
    hudSession.iframe = frame;
    hudSession.host = hostEl;
    body.replaceChildren(frame);
    return true;
  }
  async function fetchHudBody() {
    const hostEl = currentHudHost();
    if (!hostEl) return;
    abortHudLoad();
    const generation = hudSession.generation;
    const controller = new AbortController();
    hudSession.abortController = controller;
    hudSession.host = hostEl;
    hudSession.mode = hostEl.id === STATUS_HUD_DRAWER_ID ? 'drawer' : 'orb';
    setHudPhase('loading');
    const host = hostWindow();
    const override = host.XY_HUD_BASE_OVERRIDE || window.XY_HUD_BASE_OVERRIDE || null; // 仿真/调试可指本地
    const urls = override ? [override + '/status-bar.html'] : [HUD_RT_BASE + '/status-bar.html', HUD_RT_BASE_CF + '/status-bar.html'];
    for (const url of urls) {
      if (controller.signal.aborted || generation !== hudSession.generation || currentHudHost() !== hostEl) return;
      try {
        const response = await fetch(url, { cache: 'default', signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const html = await response.text();
        if (controller.signal.aborted || generation !== hudSession.generation || currentHudHost() !== hostEl) return;
        if (mountHudBody(html, hostEl, generation, controller.signal)) return;
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
      }
    }
    if (generation === hudSession.generation && currentHudHost() === hostEl) {
      hudSession.abortController = null;
      failHudLoad(hostEl);
    }
  }
  function closeHudPanel() {
    if (!hudPanel) return;
    hudPanel.dataset.xyHudOpen = '0';
    hudPanel.style.transform = 'scale(0.88)';
    hudPanel.style.opacity = '0';
    hudPanel.style.pointerEvents = 'none';
    setHudVisibility(false);
  }
  function openHudPanel() {
    const oldDrawer = hudDrawer || hostDocument().getElementById(STATUS_HUD_DRAWER_ID);
    if (oldDrawer || hudSession.mode === 'drawer') {
      resetHudLoad();
      destroyStatusDrawer();
    }
    hudSession.mode = 'orb';
    const doc = hostDocument();
    ensureHudPanelStyle(doc);
    const geo = hudPanelGeometry();
    if (hudPanel && hudPanel.isConnected) {
      const isHidden = hudPanel.dataset.xyHudOpen === '0' || hudPanel.style.opacity === '0';
      if (!isHidden) { closeHudPanel(); return; } // 再点收回
      hudPanel.style.left = geo.left + 'px'; hudPanel.style.top = geo.top + 'px';
      hudPanel.style.width = geo.w + 'px'; hudPanel.style.height = geo.h + 'px';
      hudPanel.dataset.xyHudOpen = '1';
      hudPanel.style.transform = 'scale(1)'; hudPanel.style.opacity = '1'; hudPanel.style.pointerEvents = 'auto';
      hudSession.host = hudPanel;
      setHudVisibility(true);
      if (hudSession.phase === 'idle' || hudSession.phase === 'failed') fetchHudBody();
      return;
    }
    hudPanel = doc.createElement('div');
    hudPanel.id = 'xingyue-hud-panel';
    hudPanel.dataset.xyHudOpen = '0';
    hudPanel.style.cssText = 'left:' + geo.left + 'px;top:' + geo.top + 'px;width:' + geo.w + 'px;height:' + geo.h + 'px;transform:scale(0.88);opacity:0;';
    hudPanel.innerHTML = '<div class="xy-hud-body"><div class="xy-hud-loading">〔 OMNI-NEXUS 〕状态栏加载中…</div></div>'
      + '<div class="xy-hud-drag" title="拖动移动"></div>'
      + '<div class="xy-hud-resize" title="拖动调整大小"></div>';
    doc.body.appendChild(hudPanel);
    // ✕ 已移入真身 header（buildHudBlobHtml 注入 · 桥 closeHud 回调）；加载失败时经轮盘再点状态栏可收回
    // 拖动移动 + 右下角缩放（pointer capture 在把手上；拖动期禁 iframe 吃事件；transition 只作用 transform/opacity 不冲突）
    const dragBar = hudPanel.querySelector('.xy-hud-drag');
    const resizer = hudPanel.querySelector('.xy-hud-resize');
    let hudPtr = null;
    const onHudMove = (ev) => {
      if (!hudPtr) return;
      const vw = hostWindow().innerWidth || 1200;
      const vh = hostWindow().innerHeight || 800;
      if (hudPtr.mode === 'move') {
        hudPanel.style.left = Math.max(8, Math.min(vw - hudPtr.base.w - 8, hudPtr.base.left + ev.clientX - hudPtr.startX)) + 'px';
        hudPanel.style.top = Math.max(8, Math.min(vh - 48, hudPtr.base.top + ev.clientY - hudPtr.startY)) + 'px';
      } else {
        const bounds = hudPanelSizeBounds(vw, vh, hudPtr.base.left, hudPtr.base.top);
        hudPanel.style.width = Math.max(bounds.minW, Math.min(bounds.maxW, hudPtr.base.w + ev.clientX - hudPtr.startX)) + 'px';
        hudPanel.style.height = Math.max(bounds.minH, Math.min(bounds.maxH, hudPtr.base.h + ev.clientY - hudPtr.startY)) + 'px';
      }
    };
    const onHudUp = () => {
      if (!hudPtr) return;
      hudPtr = null;
      hudPanel.classList.remove('xy-hud-busy');
      saveHudPanelRect();
    };
    const startHudPtr = (mode) => (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const r = hudPanel.getBoundingClientRect();
      hudPtr = { mode, startX: ev.clientX, startY: ev.clientY, base: { left: r.left, top: r.top, w: r.width, h: r.height } };
      hudPanel.classList.add('xy-hud-busy');
      try { ev.target.setPointerCapture(ev.pointerId); } catch (_) {}
    };
    [[dragBar, 'move'], [resizer, 'resize']].forEach(([el, mode]) => {
      el.addEventListener('pointerdown', startHudPtr(mode));
      el.addEventListener('pointermove', onHudMove);
      el.addEventListener('pointerup', onHudUp);
      el.addEventListener('pointercancel', onHudUp);
    });
    hudSession.host = hudPanel;
    setHudVisibility(true);
    (hostWindow().requestAnimationFrame || requestAnimationFrame)(() => { try { hudPanel.dataset.xyHudOpen = '1'; hudPanel.style.transform = 'scale(1)'; hudPanel.style.opacity = '1'; hudPanel.style.pointerEvents = 'auto'; } catch (_) {} });
    fetchHudBody();
  }
  function measureTopChromeBottom() {
    try {
      const doc = hostDocument();
      const win = hostWindow();
      const viewport = visibleViewportRect();
      const selectors = ['#top-settings-holder', '#top-settings', '#navbar', '#sheld_header'];
      for (const selector of selectors) {
        try {
          const el = doc.querySelector(selector);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (!r || r.width < 120 || r.height < 20 || r.height > 120) continue;
          const cs = win.getComputedStyle ? win.getComputedStyle(el) : null;
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
          if (r.bottom <= viewport.top || r.top > viewport.top + 24) continue;
          return Math.max(viewport.top, Math.min(viewport.bottom - 44, Math.round(r.bottom + 4)));
        } catch (_) {}
      }
      return Math.min(viewport.bottom - 44, viewport.top + 4);
    } catch (_) {
      return visibleViewportRect().top + 4;
    }
  }
  function ensureStatusDrawerStyle(doc) {
    if (doc.getElementById(STATUS_HUD_DRAWER_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STATUS_HUD_DRAWER_STYLE_ID;
    style.textContent = [
      '#' + STATUS_HUD_DRAWER_ID + '{--xy-hud-drawer-y:0px;--xy-hud-drawer-max:100dvh;position:fixed;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));top:var(--xy-hud-drawer-y);bottom:auto;z-index:2147483535;pointer-events:none;color:#d9f4ff;font:12px/1.45 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"]{top:var(--xy-hud-drawer-y);bottom:auto;}',
      '#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-handle{position:absolute;top:0;left:50%;transform:translateX(-50%);pointer-events:auto;min-width:116px;height:30px;padding:0 18px;border:1px solid rgba(107,199,242,.5);border-top:none;border-radius:0 0 12px 12px;background:linear-gradient(180deg,rgba(8,18,30,.96),rgba(4,9,16,.96));color:#cfeaff;box-shadow:0 8px 22px rgba(0,0,0,.42),0 0 14px rgba(75,228,255,.16);cursor:pointer;letter-spacing:1px;touch-action:none;}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-drawer-handle{top:auto;bottom:0;border-top:1px solid rgba(107,199,242,.5);border-bottom:none;border-radius:12px 12px 0 0;background:linear-gradient(0deg,rgba(8,18,30,.96),rgba(4,9,16,.96));box-shadow:0 -8px 22px rgba(0,0,0,.42),0 0 14px rgba(75,228,255,.16);}',
      '#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-handle::after{content:"";display:inline-block;margin-left:8px;border:5px solid transparent;border-top-color:currentColor;vertical-align:-3px;transition:transform .18s;}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-drawer-handle::after{border-top-color:transparent;border-bottom-color:currentColor;vertical-align:2px;}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-open="1"] .xy-hud-drawer-handle::after{transform:rotate(180deg) translateY(3px);}',
      '#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-panel{position:absolute;top:0;left:0;right:0;height:min(76dvh,680px,var(--xy-hud-drawer-max));max-height:var(--xy-hud-drawer-max);min-height:min(360px,var(--xy-hud-drawer-max));background:rgba(6,10,16,.66);backdrop-filter:blur(14px) saturate(1.12);-webkit-backdrop-filter:blur(14px) saturate(1.12);clip-path:polygon(12px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 12px);box-shadow:0 16px 46px rgba(0,0,0,.55),0 0 24px rgba(107,199,242,.22);opacity:0;transform:translateY(-16px);pointer-events:none;transition:opacity .18s ease,transform .2s cubic-bezier(.34,1.56,.64,1);}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-drawer-panel{top:auto;bottom:0;max-height:var(--xy-hud-drawer-max);transform:translateY(16px);box-shadow:0 -16px 46px rgba(0,0,0,.55),0 0 24px rgba(107,199,242,.22);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,12px 100%,0 calc(100% - 12px));}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-open="1"] .xy-hud-drawer-panel{opacity:1;transform:translateY(0);pointer-events:auto;}',
      '#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-body{position:absolute;left:0;right:0;top:28px;bottom:0;}',
      '#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-body{top:0;bottom:30px;}',
      '#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}',
      '#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6f9daf;font:12px/1.6 Consolas,monospace;letter-spacing:1px;background:rgba(4,8,14,.88);border:1px solid rgba(107,199,242,.3);}',
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-panel{background:rgba(6,10,16,.94);}}',
      '@media(max-width:768px){#' + STATUS_HUD_DRAWER_ID + '{left:0;right:0;}#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-panel{height:min(82dvh,720px,var(--xy-hud-drawer-max));max-height:var(--xy-hud-drawer-max);min-height:min(420px,var(--xy-hud-drawer-max));clip-path:none;}#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-drawer-panel{max-height:var(--xy-hud-drawer-max);min-height:min(420px,var(--xy-hud-drawer-max));}}',
      '@media(pointer:coarse){#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-handle{height:44px;min-height:44px;}#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-body{top:42px;}#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-body{top:0;bottom:44px;}}',
      '@media(max-width:768px){#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-handle{height:44px;min-height:44px;}#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-body{top:42px;}#' + STATUS_HUD_DRAWER_ID + '[data-placement="bottom"] .xy-hud-body{top:0;bottom:44px;}}',
      '@media(prefers-reduced-motion:reduce){#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-panel,#' + STATUS_HUD_DRAWER_ID + ' .xy-hud-drawer-handle::after{transition:none !important;}}',
    ].join('');
    (doc.head || doc.body).appendChild(style);
  }
  function visibleViewportRect() {
    try {
      const win = hostWindow();
      const layoutHeight = Math.max(1, Number(win.innerHeight || hostDocument().documentElement?.clientHeight || 800));
      const vv = win.visualViewport;
      const top = vv && Number.isFinite(vv.offsetTop) ? Math.max(0, Number(vv.offsetTop)) : 0;
      const height = vv && Number.isFinite(vv.height) ? Math.max(1, Number(vv.height)) : layoutHeight;
      const bottom = Math.max(top + 1, Math.min(layoutHeight, top + height));
      return { top:Math.round(top), bottom:Math.round(bottom), height:Math.round(bottom - top) };
    } catch (_) {
      return { top:0, bottom:800, height:800 };
    }
  }
  function measureBottomInputTop() {
    try {
      const doc = hostDocument();
      const win = hostWindow();
      const viewport = visibleViewportRect();
      const selectors = ['#form_sheld', '#send_form', '#send_textarea', '.send_form'];
      for (const selector of selectors) {
        try {
          const el = doc.querySelector(selector);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (!r || r.width < 80 || r.height < 20 || r.height > 360) continue;
          const cs = win.getComputedStyle ? win.getComputedStyle(el) : null;
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
          if (r.bottom < viewport.bottom - 360 || r.top >= viewport.bottom) continue;
          return Math.max(viewport.top + 44, Math.min(viewport.bottom - 4, Math.round(r.top - 6)));
        } catch (_) {}
      }
      return Math.max(viewport.top + 44, viewport.bottom - 8);
    } catch (_) {
      const viewport = visibleViewportRect();
      return Math.max(viewport.top + 44, viewport.bottom - 8);
    }
  }
  function isStatusSendInputTarget(target) {
    try {
      if (!target || target.nodeType !== 1) return false;
      if (target.id === 'send_textarea' || target.id === 'send_but') return true;
      return !!target.closest?.('#send_textarea,#send_form,#form_sheld,.send_form');
    } catch (_) {
      return false;
    }
  }
  function syncStatusDrawerPosition() {
    try {
      const drawer = hudDrawer || hostDocument().getElementById(STATUS_HUD_DRAWER_ID);
      if (!drawer) return;
      const placement = effectiveStatusHudDrawerPlacement();
      const viewport = visibleViewportRect();
      const anchor = placement === 'bottom' ? measureBottomInputTop() : measureTopChromeBottom();
      const available = placement === 'bottom' ? anchor - viewport.top - 4 : viewport.bottom - anchor - 4;
      drawer.dataset.placement = placement;
      drawer.style.setProperty('--xy-hud-drawer-y', anchor + 'px');
      drawer.style.setProperty('--xy-hud-drawer-max', Math.max(44, Math.round(available)) + 'px');
    } catch (_) {}
  }
  function bindStatusDrawerHandle(handle) {
    if (!handle || handle.dataset.xyHudGestureBound === '1') return;
    handle.dataset.xyHudGestureBound = '1';
    let startY = null;
    let swiped = false;
    handle.addEventListener('pointerdown', event => {
      startY = event.clientY;
      swiped = false;
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointerup', event => {
      if (startY == null) return;
      const dy = event.clientY - startY;
      startY = null;
      if (Math.abs(dy) < 34) return;
      swiped = true;
      event.preventDefault();
      event.stopPropagation();
      const placement = effectiveStatusHudDrawerPlacement();
      if ((placement === 'bottom' && dy < 0) || (placement !== 'bottom' && dy > 0)) openStatusDrawer(true);
      else closeStatusDrawer();
    });
    handle.addEventListener('pointercancel', () => { startY = null; });
    handle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (swiped) { swiped = false; return; }
      openStatusHud('drawer');
    });
  }
  function ensureStatusDrawerHandle() {
    const doc = hostDocument();
    ensureStatusDrawerStyle(doc);
    if (hudDrawer && hudDrawer.isConnected) {
      bindStatusDrawerHandle(hudDrawer.querySelector('.xy-hud-drawer-handle'));
      syncStatusDrawerPosition();
      return hudDrawer;
    }
    hudDrawer = doc.getElementById(STATUS_HUD_DRAWER_ID);
    if (!hudDrawer) {
      hudDrawer = doc.createElement('div');
      hudDrawer.id = STATUS_HUD_DRAWER_ID;
      hudDrawer.dataset.open = '0';
      hudDrawer.innerHTML = '<button type="button" class="xy-hud-drawer-handle" title="状态栏">状态栏</button><section class="xy-hud-drawer-panel" aria-hidden="true"><div class="xy-hud-body"></div></section>';
      doc.body.appendChild(hudDrawer);
    }
    bindStatusDrawerHandle(hudDrawer.querySelector('.xy-hud-drawer-handle'));
    syncStatusDrawerPosition();
    return hudDrawer;
  }
  function closeStatusDrawer() {
    const drawer = hudDrawer || hostDocument().getElementById(STATUS_HUD_DRAWER_ID);
    if (!drawer) return;
    hudDrawer = drawer;
    drawer.dataset.open = '0';
    const panel = drawer.querySelector('.xy-hud-drawer-panel');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    setHudVisibility(false);
  }
  function openStatusDrawer(forceOpen) {
    const oldPanel = hudPanel || hostDocument().getElementById('xingyue-hud-panel');
    if (oldPanel || hudSession.mode === 'orb') {
      resetHudLoad();
      destroyFloatingHudPanel();
    }
    hudSession.mode = 'drawer';
    const drawer = ensureStatusDrawerHandle();
    hudSession.host = drawer;
    const isOpen = drawer.dataset.open === '1';
    if (isOpen) {
      if (forceOpen === true) { setHudVisibility(true); return; }
      closeStatusDrawer();
      return;
    }
    drawer.dataset.open = '1';
    const panel = drawer.querySelector('.xy-hud-drawer-panel');
    if (panel) panel.setAttribute('aria-hidden', 'false');
    const body = drawer.querySelector('.xy-hud-body');
    if (body && !body.firstElementChild) body.innerHTML = '<div class="xy-hud-loading">〔 OMNI-NEXUS 〕状态栏加载中…</div>';
    setHudVisibility(true);
    if (hudSession.phase === 'idle' || hudSession.phase === 'failed') fetchHudBody();
  }
  function destroyFloatingHudPanel() {
    const oldPanel = hudPanel || hostDocument().getElementById('xingyue-hud-panel');
    try { hostDocument().getElementById('xingyue-hud-panel')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xingyue-hud-panel-style')?.remove(); } catch (_) {}
    if (hudSession.host === oldPanel) hudSession.host = null;
    hudPanel = null;
  }
  function destroyStatusDrawer() {
    const oldDrawer = hudDrawer || hostDocument().getElementById(STATUS_HUD_DRAWER_ID);
    try { hostDocument().getElementById(STATUS_HUD_DRAWER_ID)?.remove(); } catch (_) {}
    try { hostDocument().getElementById(STATUS_HUD_DRAWER_STYLE_ID)?.remove(); } catch (_) {}
    if (hudSession.host === oldDrawer) hudSession.host = null;
    hudDrawer = null;
  }
  function closeStatusHud() {
    closeHudPanel();
    closeStatusDrawer();
  }
  function openStatusHud(forceMode) {
    const mode = effectiveStatusHudMode(forceMode);
    if (mode === 'drawer') {
      openStatusDrawer();
      return;
    }
    openHudPanel();
  }
  function refreshStatusHudEntrySurface() {
    const mode = effectiveStatusHudMode();
    if (mode === 'drawer') {
      if (hudPanel || hudSession.mode === 'orb') {
        resetHudLoad();
        destroyFloatingHudPanel();
      }
      hudSession.mode = 'drawer';
      ensureStatusDrawerHandle();
      return;
    }
    if (hudDrawer || hudSession.mode === 'drawer') {
      resetHudLoad();
      destroyStatusDrawer();
    }
    hudSession.mode = 'orb';
  }
  function bindStatusHudViewportWatcher() {
    const win = hostWindow();
    const doc = hostDocument();
    const onChange = () => {
      if (statusHudViewportTimer) clearTimeout(statusHudViewportTimer);
      statusHudViewportTimer = setTimeout(() => { try { refreshStatusHudEntrySurface(); } catch (_) {} }, 120);
    };
    const onFocusIn = event => {
      try {
        const drawer = hudDrawer || doc.getElementById(STATUS_HUD_DRAWER_ID);
        if (!drawer || drawer.dataset.open !== '1' || effectiveStatusHudDrawerPlacement() !== 'bottom') return;
        if (isStatusSendInputTarget(event.target)) closeStatusDrawer();
      } catch (_) {}
    };
    try { win.addEventListener('resize', onChange); disposers.push(() => win.removeEventListener('resize', onChange)); } catch (_) {}
    try { win.addEventListener('orientationchange', onChange); disposers.push(() => win.removeEventListener('orientationchange', onChange)); } catch (_) {}
    try {
      const vv = win.visualViewport;
      if (vv) {
        vv.addEventListener('resize', onChange);
        vv.addEventListener('scroll', onChange);
        disposers.push(() => { try { vv.removeEventListener('resize', onChange); vv.removeEventListener('scroll', onChange); } catch (_) {} });
      }
    } catch (_) {}
    try {
      const RO = win.ResizeObserver || window.ResizeObserver;
      if (RO) {
        const observer = new RO(onChange);
        ['#top-settings-holder', '#top-settings', '#form_sheld', '#send_form', '#send_textarea'].forEach(selector => {
          try { const node = doc.querySelector(selector); if (node) observer.observe(node); } catch (_) {}
        });
        disposers.push(() => { try { observer.disconnect(); } catch (_) {} });
      }
    } catch (_) {}
    try { doc.addEventListener('focusin', onFocusIn, true); disposers.push(() => doc.removeEventListener('focusin', onFocusIn, true)); } catch (_) {}
  }
  function positionSidebarBall() {
    if (!sidebarBall) return;
    const vw = hostWindow().innerWidth || 1200;
    const vh = hostWindow().innerHeight || 800;
    if (sidebarState.docked) {
      sidebarBall.style.top = Math.max(8, Math.min(vh - ORB_SIZE - 8, (sidebarState.top || 0.42) * vh)) + 'px';
      applyDockOffset(sidebarState.open);
      if (petOrbRenderer && !sidebarState.open) petOrbRenderer.setState(sidebarState.side === 'left' ? 'edge-left' : 'edge-right');
    } else {
      sidebarBall.style.right = 'auto';
      sidebarBall.style.left = Math.max(4, Math.min(vw - ORB_SIZE - 4, sidebarState.fx * vw - ORB_SIZE / 2)) + 'px';
      sidebarBall.style.top = Math.max(4, Math.min(vh - ORB_SIZE - 4, sidebarState.fy * vh - ORB_SIZE / 2)) + 'px';
      if (petOrbRenderer && !sidebarState.open) petOrbRenderer.setState('idle');
    }
  }
  function ensureSidebar() {
    const doc = hostDocument();
    ensureSidebarStyle(doc);
    if (sidebarBall && sidebarBall.isConnected) { positionSidebarBall(); return; }
    sidebarBall = doc.createElement('div');
    sidebarBall.id = 'xingyue-sidebar-ball';
    sidebarBall.title = '星月 · 桌宠球（点击展开功能轮盘 · 拖动吸附左右边 · 长按切换收纳深度）';
    const canvas = doc.createElement('canvas');
    canvas.width = 480; canvas.height = 480; // 3.4.7-r37：2x 物理分辨率(240px CSS)，远大于 56px 球，四周留足空间让被甩离的点阵不被裁
    sidebarBall.appendChild(canvas);
    doc.body.appendChild(sidebarBall);
    try { petOrbRenderer?.destroy(); } catch (_) {}
    petOrbRenderer = new PetOrbRenderer(canvas);
    if (orbReducedMotion()) petOrbRenderer.renderOnce(); else petOrbRenderer.start();
    petOrbRenderer.setState(sidebarState.side === 'left' ? 'edge-left' : 'edge-right');
    // hover 通电 + 吸附态探头滑出（浮空态只通电）
    sidebarBall.addEventListener('mouseenter', () => { if (petOrbRenderer) petOrbRenderer.setState('hover'); if (sidebarState.docked) applyDockOffset(true); });
    sidebarBall.addEventListener('mouseleave', () => {
      if (sidebarState.open) return; // 轮盘开着保持现状
      if (petOrbRenderer) petOrbRenderer.setState(sidebarState.docked ? (sidebarState.side === 'left' ? 'edge-left' : 'edge-right') : 'idle');
      if (sidebarState.docked) applyDockOffset(false);
    });
    // 拖拽（⑧c 主体直写跟手·容器级 rAF lerp 已删·滞后甩尾下沉到点阵 tail 粒子=数据史莱姆）
    // + 单击开轮盘 + 吸附态长按切收纳深度
    let dragging = false, moved = false, startX = 0, startY = 0, holdTimer = null, holdFired = false;
    let dragBaseL = 0, dragBaseT = 0, dragLastL = 0, dragLastT = 0, dragCX = 0, dragCY = 0;
    const hw = () => hostWindow();
    function settleAfterDrag() {
      const vw = hw().innerWidth || 1200, vh = hw().innerHeight || 800;
      const edgeDist = Math.min(dragCX - ORB_SIZE / 2, vw - dragCX - ORB_SIZE / 2);
      // top 与 fy 有意保持同步 = 上次拖停的 Y（吸附态用 top、浮空态用 fy，模式切换不跳变）
      sidebarState.top = Math.min(1, Math.max(0, dragCY / vh));
      sidebarState.fy = sidebarState.top;
      if (edgeDist < DOCK_SNAP_PX) {
        sidebarState.docked = true; // 靠边才吸附（总监拍板）
        sidebarState.side = dragCX < vw / 2 ? 'left' : 'right';
      } else {
        sidebarState.docked = false;
        sidebarState.fx = Math.min(1, Math.max(0, dragCX / vw));
      }
      saveSidebarState();
      // ⑧a：松手挂回 dock-ease 门控（拖拽期已摘）→ 吸附/归位走 240ms 平滑过渡
      try { sidebarBall.classList.add('dock-ease'); sidebarBall.classList.remove('dock-out'); } catch (_) {}
      positionSidebarBall();
    }
    sidebarBall.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false; holdFired = false;
      startX = e.clientX; startY = e.clientY;
      const r = sidebarBall.getBoundingClientRect();
      dragBaseL = r.left; dragBaseT = r.top;
      dragCX = r.left + ORB_SIZE / 2; dragCY = r.top + ORB_SIZE / 2;
      try { sidebarBall.setPointerCapture(e.pointerId); } catch (_) {}
      clearTimeout(holdTimer);
      if (sidebarState.docked) { // 长按切档只在吸附态有意义
        holdTimer = setTimeout(() => {
          if (moved) return;
          holdFired = true;
          const next = sidebarState.dockDepth === 'half' ? 'hidden' : 'half';
          sidebarState.dockDepth = next;
          saveSidebarState();
          applyDockOffset(true);
          toast('info', next === 'hidden' ? '桌宠球已切换为「收纳」（贴边只露一道边）' : '桌宠球已切换为「半隐」');
        }, 600);
      }
    });
    sidebarBall.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!moved && (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4)) {
        moved = true; clearTimeout(holdTimer);
        // ⑧a 拖拽开始：先把球冻结在当前动画位置，再摘 dock-ease/dock-out（根治过渡动画与直写 left 抢位竞态）
        const fr = sidebarBall.getBoundingClientRect();
        sidebarBall.style.right = 'auto';
        sidebarBall.style.left = fr.left + 'px';
        sidebarBall.style.top = fr.top + 'px';
        try { sidebarBall.classList.remove('dock-ease'); sidebarBall.classList.remove('dock-out'); } catch (_) {}
        dragBaseL = fr.left; dragBaseT = fr.top;
        dragLastL = fr.left; dragLastT = fr.top;
        startX = e.clientX; startY = e.clientY;
        if (petOrbRenderer) { petOrbRenderer.setState('drag'); if (!orbReducedMotion()) petOrbRenderer.setTailDrag(true); }
      }
      if (!moved) return;
      // ⑧c：主体直写跟手，位移增量喂给点阵 tail 粒子做甩尾（reduced-motion 下不喂）
      const nl = dragBaseL + (e.clientX - startX);
      const nt = dragBaseT + (e.clientY - startY);
      sidebarBall.style.left = nl + 'px';
      sidebarBall.style.top = nt + 'px';
      if (petOrbRenderer && !orbReducedMotion()) petOrbRenderer.nudge(nl - dragLastL, nt - dragLastT);
      dragLastL = nl; dragLastT = nt;
      dragCX = nl + ORB_SIZE / 2; dragCY = nt + ORB_SIZE / 2;
    });
    sidebarBall.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      clearTimeout(holdTimer);
      try { sidebarBall.releasePointerCapture(e.pointerId); } catch (_) {}
      try { petOrbRenderer?.setTailDrag(false); } catch (_) {} // 松手弹簧刚度加倍，粒子加速追上归位
      if (!moved && !holdFired) { if (sidebarState.open) closeSidebarMenu(); else openSidebarMenu(); return; }
      if (moved) settleAfterDrag(); // 直写跟手无滞后 → 松手即结算吸附判定
    });
    // pointercancel（iOS 下拉刷新/系统手势中断触摸会发）：不清 holdTimer 会 600ms 后误切收纳档
    sidebarBall.addEventListener('pointercancel', (e) => {
      dragging = false; moved = false;
      clearTimeout(holdTimer);
      try { sidebarBall.releasePointerCapture(e.pointerId); } catch (_) {}
      try { petOrbRenderer?.setTailDrag(false); } catch (_) {}
      try { sidebarBall.classList.add('dock-ease'); sidebarBall.classList.remove('dock-out'); } catch (_) {}
      positionSidebarBall();
    });
    petOrbDragRafCancel = () => { dragging = false; moved = false; try { clearTimeout(holdTimer); } catch (_) {} try { petOrbRenderer?.setTailDrag(false); } catch (_) {} };
    // 点空白处收轮盘（挂宿主文档，destroy 经 disposers 解绑）
    const onDocClick = (event) => { if (sidebarState.open && !event.target?.closest?.('#xingyue-sidebar-ball,#xingyue-sidebar-menu')) closeSidebarMenu(); };
    doc.addEventListener('click', onDocClick);
    disposers.push(() => { try { doc.removeEventListener('click', onDocClick); } catch (_) {} });
    // 时段气泡：开机 8s 后首查，此后每 10 分钟巡检跨桶（节流规则在 shouldShowBubble 内）
    if (petBubbleTimer) { clearInterval(petBubbleTimer); petBubbleTimer = null; }
    if (petBubbleBootTimer) { clearTimeout(petBubbleBootTimer); petBubbleBootTimer = null; }
    petBubbleBootTimer = setTimeout(() => { try { showPetBubble(); } catch (_) {} }, 8000);
    petBubbleTimer = setInterval(() => { try { showPetBubble(); } catch (_) {} }, 10 * 60 * 1000);
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
    if (!npcPanel.__centered) { centerCcPop(npcPanel); npcPanel.__centered = true; }
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
    // 3.3.0 已批精简 prompt（一句代入 + 目标角色/档案/本楼正文；文案源=3.3.0打底/文案/NPC视角-prompt.txt）
    const prompt = [
      '请完全代入目标角色，用 TA 的口吻与认知，写出 TA 此刻对当前场景的真实所见、所感与内心活动。',
      '',
      '目标角色：' + npc.name,
      '角色档案：' + safeJson(npc.profile, '{}').slice(0, 4000),
      '当前楼正文：' + (message.text || '无法读取当前楼正文').slice(0, 5000),
    ].join('\n');
    const result = String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.4.7 的楼层内临时旁观视角生成器。结果只供玩家娱乐阅读，不进入后续上下文。' },
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
  // 3.3.8:制造/NPC 面板 UI 已删,结算链在 07_craft,TA 浮窗在 12_npc_view

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
        const actionNode = event.target?.closest?.('[data-xy-action]');
        if (!actionNode || !panel.contains(actionNode)) return;
        const action = actionNode.getAttribute('data-xy-action');
        if (!action) return;
        if (action === 'close') { togglePanel(false); return; }
        if (action === 'open-worldbook-editor') {
          try { await openWorldbookEditor(); } catch (_) {}
          return;
        }
        if (action === 'open-worldbook-recovery') {
          try { await openWorldbookManager(); } catch (error) { toast('error', error?.message || String(error)); }
          return;
        }
        if (action === 'toggle-setting') {
          const key = actionNode.closest?.('[data-key]')?.getAttribute?.('data-key');
          if (key && Object.prototype.hasOwnProperty.call(settings, key)) saveSettings({ [key]: !settings[key] });
        }
        if (action === 'news-mode') {
          const mode = actionNode.getAttribute('data-mode') === 'round' ? 'round' : 'time';
          saveSettings({ newsRefreshMode: mode });
        }
        if (action === 'status-hud-entry-mode') {
          saveSettings({ statusHudEntryMode: normalizeStatusHudEntryMode(actionNode.getAttribute('data-mode')) });
        }
        if (action === 'status-hud-drawer-placement') {
          saveSettings({ statusHudDrawerPlacement: normalizeStatusHudDrawerPlacement(actionNode.getAttribute('data-placement')) });
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
        if (event.target?.matches?.('[data-xy-input="newsPerRound"]')) {
          let count = parseInt(event.target.value, 10);
          if (!Number.isFinite(count)) count = DEFAULT_SETTINGS.newsPerRound;
          saveSettings({ newsPerRound: Math.max(1, Math.min(5, count)) });
        }
        if (event.target?.matches?.('[data-xy-input="newsTimeIntervalHours"]')) {
          let hours = parseInt(event.target.value, 10);
          if (!Number.isFinite(hours)) hours = DEFAULT_SETTINGS.newsTimeIntervalHours;
          saveSettings({ newsTimeIntervalHours: Math.max(0, Math.min(48, hours)) });
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
    return '<button type="button" class="xy-switch ' + (enabled ? 'is-on' : '') + '" data-xy-action="toggle-setting" data-key="' + escapeHtml(key) + '"><span><b>' + escapeHtml(label) + '</b><span>' + escapeHtml(note || '') + '</span></span><i class="xy-sw"><span class="xy-sw-knob"></span></i></button>';
  }
  function renderStatusHudEntryModeControl() {
    const current = normalizeStatusHudEntryMode(settings.statusHudEntryMode);
    const option = (mode, label) => '<button type="button" data-xy-action="status-hud-entry-mode" data-mode="' + mode + '" class="' + (current === mode ? 'is-on' : '') + '">' + label + '</button>';
    return '<div class="xy-segment-row"><b>状态栏入口</b><span class="xy-segment">' +
      option('auto', '自动') + option('drawer', '抽屉') + option('orb', '悬浮球') +
      '</span></div>';
  }
  function renderStatusHudDrawerPlacementControl() {
    const current = normalizeStatusHudDrawerPlacement(settings.statusHudDrawerPlacement);
    const option = (placement, label) => '<button type="button" data-xy-action="status-hud-drawer-placement" data-placement="' + placement + '" class="' + (current === placement ? 'is-on' : '') + '">' + label + '</button>';
    return '<div class="xy-segment-row"><b>抽屉位置</b><span class="xy-segment">' +
      option('auto', '自动') + option('top', '顶部') + option('bottom', '底部') +
      '</span></div>';
  }
  function renderNewsPolicyOptions() {
    if (settings.newsPolicyEnabled === false) return '';
    const timeMode = settings.newsRefreshMode !== 'round';
    const perRound = numberOf(settings.newsPerRound, 1);
    const hours = numberOf(settings.newsTimeIntervalHours, 6);
    return '<div class="xy-news-opts">' +
      '<span class="xy-news-mode">' +
      '<button type="button" data-xy-action="news-mode" data-mode="time" class="' + (timeMode ? 'is-on' : '') + '">时间模式</button>' +
      '<button type="button" data-xy-action="news-mode" data-mode="round" class="' + (timeMode ? '' : 'is-on') + '">每轮模式</button>' +
      '</span>' +
      '<label>每轮条数<input type="number" min="1" max="5" step="1" data-xy-input="newsPerRound" value="' + perRound + '"' + (timeMode ? ' disabled' : '') + '></label>' +
      '<label>小时阈值<input type="number" min="0" max="48" step="1" data-xy-input="newsTimeIntervalHours" value="' + hours + '"' + (timeMode ? '' : ' disabled') + '></label>' +
      '</div>';
  }
  function renderPolicyControls() {
    return '<div class="xy-switch-grid">' +
      renderStatusHudEntryModeControl() +
      renderStatusHudDrawerPlacementControl() +
      settingSwitch('头像立绘显示', 'mediaDisplayEnabled', '同步状态栏媒体显示') +
      settingSwitch('新闻策略', 'newsPolicyEnabled', '生成前策略开关') +
      renderNewsPolicyOptions() +
      settingSwitch('雷达清理增强', 'radarCleanupPolicyEnabled', '生成前注入清理增强提示词') +
      '</div>';
  }
  function renderPanel() {
    const panel = ensurePanel();
    const currentRoot = readCurrentStatSafe();
    const openingCount = scanOpeningPages();
    // 每个分区独立兜底：任一分区渲染抛错时只显示该分区的错误提示，不再让整个控制中心空白
    //（历史 bug：renderPanel 是一次性 innerHTML 拼接，任一分区抛错就整面板空白 + hidden 不翻转）。
    const safe = (label, fn) => { try { return fn(); } catch (e) { return '<div class="xy-muted">【' + label + '】渲染失败：' + escapeHtml((e && e.message) || String(e)) + '</div>'; } };
    panel.innerHTML = '<div class="xy-head"><div class="xy-title">控制中心</div><button class="xy-close" data-xy-action="close">关闭</button></div>' +
      '<div class="xy-grid">' +
      '<div class="xy-section"><h4>运行状态</h4>' + safe('运行状态', () => row('版本', VERSION) + row('开局页接管', openingCount ? '已接管' : '等待首条消息') + row('当前楼变量', currentRoot ? '可读取' : '不可读取')) + '</div>' +
      '<div class="xy-section"><h4>开局与状态栏</h4><div class="xy-actions"><button data-xy-action="open-worldbook-editor">世界书条目编辑</button><button data-xy-action="open-worldbook-recovery">备份与恢复</button></div>' + safe('开局与状态栏', renderPolicyControls) + '</div>' +
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
    if (runtimeDestroyed) return false;
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
  const boundOpeningRoots = new Set();
  const openingTimers = new Set();
  const openingFetchControllers = new Set();
  let openingContextChangeGeneration = 0;
  function cleanupOpeningRoot(root, options = {}) {
    if (!root) return false;
    if (options.flush !== false) { try { root.__xyOpeningFlushState?.(); } catch (_) {} }
    try { root.__xyOpeningAbort?.abort?.(); } catch (_) {}
    try { root.__xyPrefixObs?.disconnect?.(); } catch (_) {}
    try { root.__xyOpeningViewportCleanup?.(); } catch (_) {}
    if (options.releaseOwnership !== false) {
      try { delete root.dataset.xyOpeningBound; delete root.dataset.xyOpeningBoundOwner; } catch (_) {}
    }
    try {
      delete root.__xyOpeningAbort;
      delete root.__xyPrefixObs;
      delete root.__xyOpeningViewportCleanup;
      delete root.__xyOpeningFlushState;
      delete root.__xyOpeningRefreshContext;
      delete root.__xyOpeningRefreshWorkshop;
      delete root.__xyOpeningRefreshPlayer;
    } catch (_) {}
    boundOpeningRoots.delete(root);
    return true;
  }
  function scheduleOpeningTimer(callback, delay) {
    if (runtimeDestroyed) return null;
    const timer = setTimeout(() => {
      openingTimers.delete(timer);
      if (!runtimeDestroyed) callback();
    }, delay);
    openingTimers.add(timer);
    return timer;
  }
  function bindOpeningPage(root) {
    if (!root) return false;
    const previousBindingOwner = root.dataset.xyOpeningBoundOwner || '';
    if (root.dataset.xyOpeningBound === 'true' && previousBindingOwner === runtimeOwner.id) return false;
    if (root.dataset.xyOpeningBound === 'true' && previousBindingOwner !== runtimeOwner.id) {
      cleanupOpeningRoot(root);
    }
    root.dataset.xyOpeningBound = 'true';
    root.dataset.xyOpeningBoundOwner = runtimeOwner.id;
    boundOpeningRoots.add(root);
    const AbortCtor = root.ownerDocument?.defaultView?.AbortController || window.AbortController;
    const openingAbort = AbortCtor ? new AbortCtor() : null;
    const openingListenerOptions = openingAbort ? { signal: openingAbort.signal } : undefined;
    root.__xyOpeningAbort = openingAbort;

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

    try {
      if (!root.__xyOpeningViewportCleanup) {
        const doc = root.ownerDocument || document;
        const win = doc.defaultView || hostWindow() || window;
        const docEl = doc.documentElement || document.documentElement;
        const cleanup = [];
        let frame = 0;
        const syncViewport = () => {
          frame = 0;
          try {
            const rect = root.getBoundingClientRect ? root.getBoundingClientRect() : { width: 0 };
            const vv = win.visualViewport;
            const layoutWidth = Math.max(1, Math.round(win.innerWidth || docEl.clientWidth || rect.width || 390));
            const layoutHeight = Math.max(1, Math.round(win.innerHeight || docEl.clientHeight || 720));
            const visibleWidth = Math.max(1, Math.round((vv && vv.width) || layoutWidth));
            const visualHeight = Math.max(1, Math.round((vv && vv.height) || layoutHeight));
            const visualTop = Math.max(0, Number(vv?.offsetTop || 0));
            let visualBottom = visualTop + visualHeight;
            const sendBar = openingFocusActive() ? null : doc.querySelector('#send_form,#form_sheld,.send_form');
            if (sendBar) {
              const sendRect = sendBar.getBoundingClientRect();
              if (sendRect?.top > visualTop && sendRect.top < visualBottom) visualBottom = Math.max(visualTop + 1, sendRect.top - 4);
            }
            const rootTop = Math.max(visualTop, Number(rect.top || visualTop));
            const visibleHeight = Math.max(1, Math.round(visualBottom - rootTop));
            const viewportScale = Number.isFinite(Number(vv?.scale)) && Number(vv.scale) > 0
              ? Number(vv.scale)
              : Math.max(1, layoutWidth / visibleWidth);
            const dpr = Math.max(1, Number(win.devicePixelRatio || 1));
            const rootWidth = Math.max(1, Math.round(rect.width || visibleWidth));
            const fit = Math.min(1, rootWidth / 420, visibleHeight / 680);
            const pageScale = viewportScale <= 1.5 ? Math.max(.82, fit) : 1;
            const tier = viewportScale > 1.5 || visibleHeight < 360
              ? 'scroll'
              : (visibleWidth <= 560 || visibleHeight < 700 || viewportScale > 1.05 ? 'compact' : 'standard');
            root.style.setProperty('--xy-visible-w', visibleWidth + 'px');
            root.style.setProperty('--xy-visible-h', visibleHeight + 'px');
            root.style.setProperty('--xy-visual-h', visualHeight + 'px');
            root.style.setProperty('--xy-layout-w', layoutWidth + 'px');
            root.style.setProperty('--xy-layout-h', layoutHeight + 'px');
            root.style.setProperty('--xy-viewport-scale', viewportScale.toFixed(3));
            root.style.setProperty('--xy-device-pixel-ratio', dpr.toFixed(3));
            root.style.setProperty('--xy-page-scale', pageScale.toFixed(3));
            root.dataset.xyViewportTier = tier;
            root.dataset.xyHostTight = tier === 'compact' && rootWidth < 280 && visibleHeight < 520 ? '1' : '0';
            root.dataset.xyShortViewport = visibleHeight < 700 ? '1' : '0';
          } catch (_e) {}
        };
        const scheduleViewportSync = () => {
          try { if (frame) win.cancelAnimationFrame(frame); } catch (_e) {}
          try { frame = win.requestAnimationFrame(syncViewport); } catch (_e) { syncViewport(); }
        };
        const listen = (target, type) => {
          try {
            target.addEventListener(type, scheduleViewportSync, { passive: true });
            cleanup.push(() => target.removeEventListener(type, scheduleViewportSync));
          } catch (_e) {}
        };
        listen(win, 'resize');
        listen(win, 'orientationchange');
        if (win.visualViewport) {
          listen(win.visualViewport, 'resize');
          listen(win.visualViewport, 'scroll');
        }
        try {
          const RO = win.ResizeObserver || window.ResizeObserver;
          if (RO) {
            const ro = new RO(scheduleViewportSync);
            ro.observe(root);
            cleanup.push(() => ro.disconnect());
          }
        } catch (_e) {}
        root.__xyOpeningViewportCleanup = () => {
          try { if (frame) win.cancelAnimationFrame(frame); } catch (_e) {}
          while (cleanup.length) { try { cleanup.pop()?.(); } catch (_e) {} }
          try { delete root.__xyOpeningViewportCleanup; } catch (_e) {}
        };
        scheduleViewportSync();
      }
    } catch (_viewportErr) {}

  const TYPE_LABELS = { character:'角色范本', user_identity:'身份模板', world_factor:'世界因子', shop_item:'商店道具', blueprint:'蓝图', recipe:'配方', skill:'技能', function:'功能' };
  const ATTRIBUTE_KEYS = IDENTITY_ATTRIBUTE_KEYS;
  const DEFAULT_ATTRIBUTES = IDENTITY_DEFAULT_ATTRIBUTES;
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
  const savedOpeningUi = openingDraftService.readUi();
  const state = {
    view: savedOpeningUi.view || root.dataset.xyOpeningView || 'boot',
    returnView: 'boot',
    step: Number(savedOpeningUi.step || root.dataset.xyOpeningStep || 1) || 1,
    maxStep: Math.max(Number(savedOpeningUi.maxStep) || 1, Number(savedOpeningUi.step) || 1),
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
    workshopAuthGeneration: 0,
    workshopRefreshGeneration: 0,
    workshopLoginStatus: '',
    workshopLoginDeadlineAt: 0,
    packageInspections: new Map(),
    packageDetailGeneration: 0,
    packageDetailInspectionGeneration: 0,
    previewMode: false,
    identityMediaSlot: 'avatar',
    personaSnapshot: null,
    personaFingerprint: '',
    pendingPersonaImport: null,
    publishSelection: null,
    pendingActions: new Set(),
    workshopFocusOwned: false,
  };
  try {
    hostWindow().addEventListener('xy-workshop-login-state', event => {
      const detail = event?.detail || {};
      state.workshopLoginStatus = String(detail.status || '');
      state.workshopLoginDeadlineAt = Number(detail.deadlineAt) || 0;
      if (detail.status === 'error' || detail.status === 'timeout') state.lastWorkshopError = String(detail.message || 'Discord 登录失败');
      if (detail.status === 'ready') state.lastWorkshopError = '';
      if (detail.status === 'cancelled' || detail.status === 'timeout') {
        state.workshopAuthGeneration += 1;
        state.workshopRefreshGeneration += 1;
        state.workshopLoading = false;
      }
      updateWorkshopStatusPills();
      renderWorkshop();
    }, openingListenerOptions);
  } catch (_) {}
  const previewEntry = root.querySelector('[data-xy-opening-action="enter-preview"]');
  if (previewEntry) previewEntry.hidden = hostWindow()?.XY_DEV_OPENING_PREVIEW !== true;
  const PREVIEW_ALLOWED_ACTIONS = new Set([
    'enter-preview','back-boot','back-entry','go-step','prev-step','next-step','check-deps','open-workshop',
    'return-from-workshop','switch-workshop-tab','refresh-workshop','show-package-detail','toggle-focus-mode',
    'close-package-detail','export-opening-draft','export-opening-package','export-current-package',
  ]);
  let activeOpeningModal = null;
  let openingModalReturnFocus = null;
  let openingModalTrigger = null;
  let pendingIdentityPersistenceDecision = null;
  function settleIdentityPersistenceDecision(decision) {
    const pending = pendingIdentityPersistenceDecision;
    pendingIdentityPersistenceDecision = null;
    const modal = root.querySelector('[data-xy-identity-write-modal]');
    if (modal) modal.hidden = true;
    pending?.resolve?.(String(decision || 'cancel'));
  }
  function requestIdentityPersistenceDecision(error) {
    if (pendingIdentityPersistenceDecision) settleIdentityPersistenceDecision('cancel');
    const modal = root.querySelector('[data-xy-identity-write-modal]');
    const message = modal?.querySelector('[data-xy-identity-write-error]');
    if (!modal || !message) return Promise.resolve('cancel');
    message.textContent = '身份世界书写入失败：' + (error?.message || String(error)) + '。默认不会发送；可重试写入，或明确选择仅本次继续。';
    modal.hidden = false;
    return new Promise(resolve => { pendingIdentityPersistenceDecision = { resolve }; });
  }
  const openingModalBackground = () => [...root.children].filter(node => node !== activeOpeningModal && !node.matches?.('script,.xy-modal'));
  function setOpeningModalBackgroundInert(value) {
    openingModalBackground().forEach(node => {
      try { node.inert = value; } catch (_) {}
      if (value) node.setAttribute?.('aria-hidden','true'); else node.removeAttribute?.('aria-hidden');
    });
  }
  function activateOpeningModal(modal) {
    if (!modal || modal.hidden) return;
    if (activeOpeningModal && activeOpeningModal !== modal) activeOpeningModal.hidden = true;
    activeOpeningModal = modal;
    openingModalReturnFocus = openingModalTrigger || root.ownerDocument?.activeElement || null;
    setOpeningModalBackgroundInert(true);
    const target = modal.querySelector('.xy-modal-panel') || modal;
    target.focus?.({ preventScroll:true });
  }
  function closeActiveOpeningModal() {
    const modal = activeOpeningModal;
    if (!modal) return false;
    if (modal.matches?.('[data-xy-identity-write-modal]')) { settleIdentityPersistenceDecision('cancel'); return true; }
    if (modal.matches?.('[data-xy-character-editor-modal]') && characterEditorSnapshot(modal) !== characterEditorBaseline && !hostWindow().confirm?.('角色表单有未保存修改。确认放弃并关闭？')) return false;
    if (modal.matches?.('[data-xy-world-factor-modal]') && worldFactorEditorDirty(modal) && !hostWindow().confirm?.('世界因子表单有未添加内容。确认放弃并关闭？')) return false;
    activeOpeningModal = null;
    modal.hidden = true;
    setOpeningModalBackgroundInert(false);
    try { openingModalReturnFocus?.focus?.({ preventScroll:true }); } catch (_) {}
    openingModalReturnFocus = null;
    return true;
  }
  function handleOpeningModalKeydown(event) {
    const modal = activeOpeningModal;
    if (!modal || modal.hidden) {
      if (event.key === 'Escape' && openingFocusActive()) { event.preventDefault(); exitOpeningFocusMode(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); closeActiveOpeningModal(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node => !node.closest('[hidden]'));
    if (!focusable.length) { event.preventDefault(); modal.querySelector('.xy-modal-panel')?.focus?.(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1], current = root.ownerDocument?.activeElement;
    if (event.shiftKey && (current === first || !focusable.includes(current))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (current === last || !focusable.includes(current))) { event.preventDefault(); first.focus(); }
  }
  root.addEventListener('keydown', handleOpeningModalKeydown, openingListenerOptions);
  const OpeningMutationObserver = root.ownerDocument?.defaultView?.MutationObserver || window.MutationObserver;
  const openingModalObserver = OpeningMutationObserver ? new OpeningMutationObserver(records => {
    records.forEach(record => {
      const modal = record.target;
      if (!modal.matches?.('.xy-modal')) return;
      if (!modal.hidden) activateOpeningModal(modal);
      else if (activeOpeningModal === modal) {
        activeOpeningModal = null; setOpeningModalBackgroundInert(false);
        try { openingModalReturnFocus?.focus?.({ preventScroll:true }); } catch (_) {}
        openingModalReturnFocus = null;
      }
    });
  }) : null;
  openingModalObserver?.observe(root, { subtree:true, attributes:true, attributeFilter:['hidden'] });
  openingAbort?.signal?.addEventListener?.('abort', () => { openingModalObserver?.disconnect?.(); setOpeningModalBackgroundInert(false); }, { once:true });
  openingAbort?.signal?.addEventListener?.('abort', () => settleIdentityPersistenceDecision('cancel'), { once:true });

  // 任务4.19：删除与顶层完全相同的 hostWindow/toast/escapeHtml 重复定义，直接引用外层
  // hostWindow/toast/escapeHtml 均来自外层闭包，无需在此重声明（遮蔽外层各自演化是屎山根因A）
  function controlCenter() { return window.XingyueControlCenter || hostWindow().XingyueControlCenter || null; }
  const playerTextTemplates = new Map();
  const playerAttributeTemplates = new Map();
  function isPortablePayloadPreview(node) {
    try { return !!node?.parentElement?.closest?.('[data-xy-package-detail]'); } catch (_) { return false; }
  }
  function capturePlayerFacingTemplates() {
    const doc = root.ownerDocument || document;
    const NodeFilterCtor = doc.defaultView?.NodeFilter || window.NodeFilter;
    try {
      const walker = doc.createTreeWalker(root, NodeFilterCtor?.SHOW_TEXT || 4);
      let node = walker.nextNode();
      while (node) {
        const parentTag = String(node.parentElement?.tagName || '').toUpperCase();
        const persistedTemplate = typeof node.__xyPlayerTemplate === 'string' ? node.__xyPlayerTemplate : '';
        if (!['SCRIPT', 'STYLE'].includes(parentTag) && !isPortablePayloadPreview(node) && (persistedTemplate || /\{\{\s*user\s*\}\}/i.test(node.nodeValue || ''))) {
          const template = persistedTemplate || node.nodeValue || '';
          node.__xyPlayerTemplate = template;
          if (!playerTextTemplates.has(node)) playerTextTemplates.set(node, template);
        }
        node = walker.nextNode();
      }
    } catch (_) {}
    try {
      root.querySelectorAll('*').forEach(element => {
        if (element.closest?.('[data-xy-package-detail]')) return;
        const templates = { ...(isObject(element.__xyPlayerAttributeTemplates) ? element.__xyPlayerAttributeTemplates : {}), ...(playerAttributeTemplates.get(element) || {}) };
        ['placeholder', 'title', 'aria-label', 'alt'].forEach(name => {
          const value = element.getAttribute?.(name);
          if (value && /\{\{\s*user\s*\}\}/i.test(value) && templates[name] === undefined) templates[name] = value;
        });
        if (Object.keys(templates).length) {
          element.__xyPlayerAttributeTemplates = { ...templates };
          playerAttributeTemplates.set(element, templates);
        }
      });
    } catch (_) {}
  }
  function renderPlayerFacingText() {
    capturePlayerFacingTemplates();
    playerTextTemplates.forEach((template, node) => {
      if (!root.contains(node)) { playerTextTemplates.delete(node); return; }
      try { node.nodeValue = resolvePlayerText(template); } catch (_) {}
    });
    playerAttributeTemplates.forEach((templates, element) => {
      if (!root.contains(element)) { playerAttributeTemplates.delete(element); return; }
      Object.keys(templates).forEach(name => {
        try { element.setAttribute(name, resolvePlayerText(templates[name])); } catch (_) {}
      });
    });
  }
  function readDraft() { return readOpeningDraft(); }
  function normalizeDraft(next) {
    const draft = normalizeOpeningDraftData(next);
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
  function openingStoryDiffText(currentBody, officialBody = OFFICIAL_OPENING_DAY.body) {
    const currentLines = canonicalizeOpeningStoryBody(currentBody).split('\n');
    const officialLines = canonicalizeOpeningStoryBody(officialBody).split('\n');
    if (currentLines.join('\n') === officialLines.join('\n')) return '当前正文与 3.4.7 出厂版一致。';
    const lines = [];
    const count = Math.max(currentLines.length, officialLines.length);
    for (let index = 0; index < count; index += 1) {
      const officialLine = officialLines[index];
      const currentLine = currentLines[index];
      if (officialLine === currentLine) {
        if (officialLine !== undefined) lines.push('  ' + officialLine);
        continue;
      }
      if (officialLine !== undefined) lines.push('- ' + officialLine);
      if (currentLine !== undefined) lines.push('+ ' + currentLine);
    }
    return lines.join('\n');
  }
  function saveOpeningDayBody(body, options = {}) {
    const draft = normalizeDraft(readDraft());
    const current = normalizeOpeningDayDraft(draft.openingDay);
    draft.openingDay = normalizeOpeningDayDraft({
      ...current,
      body: canonicalizeOpeningStoryBody(body),
      gradeScope: Array.isArray(options.gradeScope) && options.gradeScope.length ? options.gradeScope.map(String) : current.gradeScope,
      origin: 'user',
      localModifiedAt: new Date().toISOString(),
    });
    return writeDraft(draft, { immediate: options.immediate === true });
  }
  function restoreOfficialOpeningDay() {
    const draft = normalizeDraft(readDraft());
    draft.openingDay = copyOfficialOpeningDay();
    return writeDraft(draft, { immediate: true });
  }
  function captureOpeningDayField(options = {}) {
    const input = root.querySelector('[data-xy-opening-story-body]');
    if (!input) return normalizeDraft(readDraft());
    return saveOpeningDayBody(input.value, options);
  }
  function renderOpeningDayEditor(draft = readDraft()) {
    draft = normalizeDraft(draft);
    const openingDay = normalizeOpeningDayDraft(draft.openingDay);
    const input = root.querySelector('[data-xy-opening-story-body]');
    if (input && input.value !== openingDay.body) {
      const doc = input.ownerDocument || root.ownerDocument || document;
      const focused = doc.activeElement === input;
      const start = focused ? input.selectionStart : null;
      const end = focused ? input.selectionEnd : null;
      input.value = openingDay.body;
      if (focused && start !== null && end !== null) {
        try { input.setSelectionRange(Math.min(start, input.value.length), Math.min(end, input.value.length)); } catch (_) {}
      }
    }
    const bytes = openingStoryUtf8Bytes(openingDay.body);
    const dirty = openingDay.origin === 'user' || openingDay.bodyHash !== OFFICIAL_OPENING_DAY.baseHash;
    const byteNode = root.querySelector('[data-xy-opening-story-bytes]');
    const sourceNode = root.querySelector('[data-xy-opening-story-source]');
    const statusNode = root.querySelector('[data-xy-opening-story-status]');
    const finalPreview = root.querySelector('[data-xy-opening-final-preview]');
    const compatibilityNode = root.querySelector('[data-xy-opening-grade-compatibility]');
    const compatibilityButton = root.querySelector('[data-xy-opening-action="use-grade-compatible-story"]');
    if (byteNode) byteNode.textContent = bytes + ' / ' + OPENING_DAY_MAX_BYTES + ' bytes';
    if (sourceNode) {
      sourceNode.textContent = openingDay.sourcePackage?.title ? ('工坊：' + openingDay.sourcePackage.title) : (dirty ? '用户修改' : '官方出厂版');
      sourceNode.className = 'xy-pill ' + (openingDay.sourcePackage ? 'ok' : (dirty ? 'warn' : 'ok'));
    }
    root.querySelectorAll('[data-xy-opening-action="restore-opening-source"],[data-xy-opening-action="restore-opening-official"]').forEach(button => {
      button.disabled = !dirty;
    });
    const compatibility = openingStoryCompatibility(draft);
    if (compatibilityNode) {
      compatibilityNode.hidden = compatibility.compatible;
      compatibilityNode.textContent = compatibility.compatible ? '' : compatibility.message;
    }
    if (compatibilityButton) compatibilityButton.hidden = compatibility.compatible;
    try {
      const validation = validateOpeningStory(openingDay.body, { grade:compatibility.grade.value });
      if (statusNode) {
        statusNode.dataset.state = 'ok';
        statusNode.textContent = '正文有效 · ' + validation.bytes + ' bytes · ' + (dirty ? '已按当前聊天保存修改' : '正在使用 3.4.7 出厂版');
      }
      if (finalPreview) finalPreview.textContent = composeOpeningMessage(draft);
    } catch (error) {
      const message = error?.message || String(error);
      if (statusNode) { statusNode.dataset.state = 'error'; statusNode.textContent = message; }
      if (finalPreview) finalPreview.textContent = '无法生成最终消息：' + message;
    }
    return { openingDay, dirty, bytes };
  }
  function writeDraft(next, options = {}) { return openingDraftService.replaceDraft(normalizeDraft(next || {}), options); }
  function saveDraft(patch, options = {}) { return openingDraftService.patchDraft(patch || {}, options); }
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
  function packageDestinationLabel(type) {
    if (type === 'character') return '角色拓展';
    if (type === 'user_identity') return '身份设定';
    if (type === 'world_factor') return '世界因子';
    return '功能拓展';
  }
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
    return state.publishSelection;
  }
  function buildPublishPackage(source) {
    if (!source) throw new Error('请先选择、导入或打开一个工坊包，再发布/导出。');
    const form = publishForm();
    const createdAt = new Date().toISOString();
    const title = String(form.title || source.title || source.id).slice(0, 120);
    const payload = clone(source.payload || {});
    if (source.cardScope === OPENING_PACKAGE_SCOPE && Array.isArray(payload.worldFactors) && payload.worldFactors.length === 1) {
      payload.worldFactors[0].title = title;
      delete payload.factors;
    }
    return {
      ...source,
      packageVersion:'1.0.0', id:source.id || safeSlug(title || 'package', 'package-' + Date.now()),
      type:source.type, cardScope:source.cardScope || 'xingyue', title,
      summary:form.summary || source.summary || '星月工坊内容包。导入前请查看影响预览。',
      authorName:source.authorName || '未署名', tags:Array.isArray(source.tags) ? source.tags : [],
      rating:form.rating, language:source.language || 'zh-CN', createdAt:source.createdAt || createdAt, updatedAt:createdAt, payload,
    };
  }
  function openingDraftAsPackage() {
    const draft = normalizeDraft(readDraft());
    const openingDay = normalizeOpeningDayDraft(draft.openingDay);
    validateOpeningStory(openingDay.body, { grade:resolveEffectiveGrade(draft).value });
    const source = isObject(openingDay.sourcePackage) ? openingDay.sourcePackage : {};
    const title = String(source.title || '我的入学日正文').slice(0, 120);
    const pkg = {
      packageVersion:'1.0.0',
      id:String(source.id || ('opening-' + openingDay.bodyHash.slice(0, 16))),
      type:'world_factor', cardScope:OPENING_PACKAGE_SCOPE, title,
      summary:'由 3.4.7 入学日正文编辑器生成的纯文本模板。', authorName:'未署名',
      tags:['开局正文'], rating:'general', language:'zh-CN',
      payload:{
        target:OPENING_PACKAGE_TARGET, schemaVersion:1, compatibility:{ minRuntimeVersion:'3.4.1' },
        gradeScope:Array.isArray(openingDay.gradeScope) && openingDay.gradeScope.length ? openingDay.gradeScope.slice() : ['all'],
        worldFactors:[{ title, content:openingDay.body }],
      },
    };
    if (Number.isInteger(Number(source.revision)) && Number(source.revision) >= 1) pkg.revision = Number(source.revision);
    return validatePackage(pkg, ['world_factor']);
  }
  function identityDraftAsPackage() {
    const draft = readDraft();
    if (!userIdentityDraftHasContent(draft)) return null;
    const payload = buildUserIdentityPayload(draft);
    const title = payload.identity || payload.callname || (payload.grade ? payload.grade + '身份模板' : (payload.media.avatar || payload.media.portrait ? '媒体身份模板' : '属性身份模板'));
    return {
      type: 'user_identity',
      id: 'identity-' + safeSlug(title, 'template'),
      title,
      summary: payload.background.slice(0, 120) || payload.appearance.slice(0, 120) || ('身份模板 · ' + title),
      authorName: '未署名',
      tags: ['身份模板'],
      payload,
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
    { field: 'avatar', slot: 'avatar', variant: 'normal' },
    { field: 'portrait_normal', slot: 'portrait', variant: 'normal' },
    { field: 'portrait_nude', slot: 'portrait', variant: 'nude' },
    { field: 'portrait_aftermath', slot: 'portrait', variant: 'aftermath' },
  ];
  let characterEditorBaseline = '';
  function characterEditorSnapshot(modal = root.querySelector('[data-xy-character-editor-modal]')) {
    return JSON.stringify([...modal?.querySelectorAll?.('[data-xy-char-field]') || []].map(input => [input.dataset.xyCharField,input.value || '']));
  }
  function worldFactorEditorDirty(modal = root.querySelector('[data-xy-world-factor-modal]')) {
    return [...modal?.querySelectorAll?.('[data-xy-wf-field]') || []].some(input => String(input.value || '').trim());
  }
  function characterMediaMeta(spec, name) {
    return { type: 'bond', name: name || '角色', slot: spec.slot, variant: spec.variant };
  }
  // D10：头像气泡管理器。气泡按说话者名查媒体库 bond/avatar；这里收集聊天中出现过的说话者，
  // 提供绑定/换绑/清除入口，操作后 force 重渲所有气泡立即生效。
  function collectDialogSpeakers() {
    const doc = root.ownerDocument || document;
    const names = new Map();
    names.set('{{user}}', { kind: 'user' });
    const userAliases = new Set(['user', 'player', '{{user}}', '玩家', '主角']);
    try {
      doc.querySelectorAll('[data-xy-dialog-speaker]').forEach(node => {
        const raw = String(node.getAttribute('data-xy-dialog-speaker') || '').trim();
        if (raw && !userAliases.has(raw.toLowerCase()) && !userAliases.has(raw)) names.set(raw, { kind: 'npc' });
      });
      doc.querySelectorAll('.xy-dialog-speaker, .custom-xy-dialog-speaker').forEach(node => {
        const raw = String(node.textContent || '').trim();
        if (raw && raw !== '{{user}}' && !names.has(raw)) names.set(raw, { kind: 'npc' });
      });
    } catch (_) {}
    try {
      (mediaLibrary()?.listManagedAssets?.() || []).forEach(item => {
        if (item?.type === 'bond' && item?.slot === 'avatar' && item.name && item.name !== '{{user}}' && !names.has(item.name)) {
          names.set(item.name, { kind: 'npc' });
        }
      });
    } catch (_) {}
    return [...names.entries()].map(([name, info]) => ({ name, ...info }));
  }
  function avatarManagerThumb(name) {
    try {
      const lib = mediaLibrary();
      const exact = lib?.getExactAsset?.({ type: 'bond', slot: 'avatar', name, variant: 'normal' });
      if (exact) return exact.dataUrl || exact.url || exact.src || '';
      const loose = lib?.getAsset?.({ type: 'bond', slot: 'avatar', name, variant: 'normal' });
      return loose?.dataUrl || loose?.url || loose?.src || '';
    } catch (_) { return ''; }
  }
  function renderAvatarManager() {
    const modal = root.querySelector('[data-xy-avatar-manager-modal]');
    const list = modal?.querySelector('[data-xy-avatar-manager-list]');
    if (!modal || !list) return;
    const speakers = collectDialogSpeakers();
    list.innerHTML = speakers.map(item => {
      const isUser = item.kind === 'user';
      const src = isUser
        ? (controlCenter()?.resolvePlayerAvatarSrc?.('') || avatarManagerThumb(item.name))
        : avatarManagerThumb(item.name);
      const hint = isUser
        ? '玩家气泡兜底头像'
        : (src ? '已绑定' : '未绑定 · 气泡显示占位头像');
      return '<div class="xy-avatar-mgr-row">'
        + (src ? '<img class="xy-avatar-mgr-thumb" src="' + escapeHtml(src) + '" alt="">' : '<span class="xy-avatar-mgr-thumb"></span>')
        + '<span class="xy-avatar-mgr-name">' + escapeHtml(item.name) + '<small>' + escapeHtml(hint) + '</small></span>'
        + '<span class="xy-actions">'
        + '<button type="button" data-xy-opening-action="avatar-manager-import" data-name="' + escapeHtml(item.name) + '">' + (src ? '换头像' : '导入头像') + '</button>'
        + (src && !isUser ? '<button type="button" data-xy-opening-action="avatar-manager-clear" data-name="' + escapeHtml(item.name) + '">清除</button>' : '')
        + '</span></div>';
    }).join('') || '<p class="xy-note">当前聊天还没有出现对话气泡；可以先在上方手动添加名字。</p>';
  }
  function refreshDialogBubblesAfterAvatarChange() {
    try { mediaLibrary()?.renderDialogBubbles?.({ force: true }); } catch (_) {}
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
      else if (val && lib) {
        const asset = lib.getAssetByKey?.(val) || lib.listManagedAssets?.().find(item => String(item?.key || '') === val);
        src = String(asset?.dataUrl || asset?.url || asset?.src || '');
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
      portraits: { normal: textOf(cd.portrait_normal, ''), nude: textOf(cd.portrait_nude, ''), aftermath: textOf(cd.portrait_aftermath, '') },
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

  let openingScrollSaveTimer = null;
  function openingScrollSnapshot() {
    const previous = openingDraftService.readUi().scroll || { root: 0, workshop: 0, panes: {} };
    const pane = root.querySelector('[data-xy-opening-pane="' + state.step + '"]');
    const workshopMain = root.querySelector('[data-xy-view="workshop"] .xy-workshop-main');
    return {
      ...previous,
      root: Math.max(0, Number(root.scrollTop) || 0),
      workshop: Math.max(0, Number(workshopMain?.scrollTop) || 0),
      panes: { ...(previous.panes || {}), [String(state.step)]: Math.max(0, Number(pane?.scrollTop) || 0) },
    };
  }
  function saveOpeningScroll(options = {}) {
    if (state.previewMode) return openingDraftService.readUi();
    if (openingScrollSaveTimer) { clearTimeout(openingScrollSaveTimer); openingTimers.delete(openingScrollSaveTimer); openingScrollSaveTimer = null; }
    return openingDraftService.patchUi({ scroll: openingScrollSnapshot() }, { immediate: options.immediate === true });
  }
  function scheduleOpeningScrollSave() {
    if (state.previewMode) return;
    if (openingScrollSaveTimer) { clearTimeout(openingScrollSaveTimer); openingTimers.delete(openingScrollSaveTimer); }
    openingScrollSaveTimer = scheduleOpeningTimer(() => {
      openingScrollSaveTimer = null;
      openingDraftService.patchUi({ scroll: openingScrollSnapshot() });
    }, 140);
  }
  function restoreOpeningScroll() {
    const snapshot = openingDraftService.readUi().scroll || {};
    scheduleOpeningTimer(() => {
      try { root.scrollTop = Math.max(0, Number(snapshot.root) || 0); } catch (_) {}
      try {
        const pane = root.querySelector('[data-xy-opening-pane="' + state.step + '"]');
        if (pane) pane.scrollTop = Math.max(0, Number(snapshot.panes?.[String(state.step)]) || 0);
      } catch (_) {}
      try {
        const workshopMain = root.querySelector('[data-xy-view="workshop"] .xy-workshop-main');
        if (workshopMain) workshopMain.scrollTop = Math.max(0, Number(snapshot.workshop) || 0);
      } catch (_) {}
    }, 0);
  }
  let openingFocusPortal = null;
  let openingFocusReturnFocus = null;
  let openingFocusViewportCleanup = null;
  function openingFocusActive() { return root.dataset.xyFocusMode === '1'; }
  function syncOpeningFocusButton() {
    const active = openingFocusActive();
    root.querySelectorAll('[data-xy-opening-action="toggle-focus-mode"]').forEach(button => {
      button.textContent = active ? '退出全屏' : '全屏';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  function openingFocusViewportRect(doc = root.ownerDocument || document) {
    const win = doc.defaultView || hostWindow();
    const vv = win.visualViewport;
    const layoutWidth = Math.max(1, Number(win.innerWidth || doc.documentElement?.clientWidth || 1));
    const layoutHeight = Math.max(1, Number(win.innerHeight || doc.documentElement?.clientHeight || 1));
    const left = Math.max(0, Math.min(layoutWidth - 1, Number(vv?.offsetLeft) || 0));
    const top = Math.max(0, Math.min(layoutHeight - 1, Number(vv?.offsetTop) || 0));
    const width = Math.max(1, Math.min(Number(vv?.width) || layoutWidth, layoutWidth - left));
    const height = Math.max(1, Math.min(Number(vv?.height) || layoutHeight, layoutHeight - top));
    return { left, top, width, height };
  }
  function syncOpeningFocusViewport() {
    const dialog = openingFocusPortal?.dialog;
    if (!dialog?.isConnected) return;
    const rect = openingFocusViewportRect(dialog.ownerDocument || root.ownerDocument || document);
    dialog.style.position = 'fixed';
    dialog.style.inset = 'auto';
    dialog.style.left = rect.left + 'px';
    dialog.style.top = rect.top + 'px';
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
    dialog.style.width = rect.width + 'px';
    dialog.style.height = rect.height + 'px';
    dialog.style.maxWidth = rect.width + 'px';
    dialog.style.maxHeight = rect.height + 'px';
    dialog.style.margin = '0';
    dialog.style.transform = 'none';
    root.style.setProperty('--xy-visible-w', rect.width + 'px');
    root.style.setProperty('--xy-visible-h', rect.height + 'px');
  }
  function bindOpeningFocusViewport(dialog) {
    try { openingFocusViewportCleanup?.(); } catch (_) {}
    const win = dialog.ownerDocument?.defaultView || hostWindow();
    const vv = win.visualViewport;
    let frame = 0;
    const schedule = () => {
      if (frame) win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(() => { frame = 0; syncOpeningFocusViewport(); });
    };
    win.addEventListener('resize', schedule, { passive:true });
    win.addEventListener('orientationchange', schedule, { passive:true });
    if (vv) {
      vv.addEventListener('resize', schedule, { passive:true });
      vv.addEventListener('scroll', schedule, { passive:true });
    }
    openingFocusViewportCleanup = () => {
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener('resize', schedule);
      win.removeEventListener('orientationchange', schedule);
      if (vv) {
        vv.removeEventListener('resize', schedule);
        vv.removeEventListener('scroll', schedule);
      }
      frame = 0;
    };
    syncOpeningFocusViewport();
  }
  function enterOpeningFocusMode() {
    if (openingFocusActive()) return true;
    const doc = root.ownerDocument || document;
    const parent = root.parentNode;
    if (!doc.body || !parent) return false;
    const placeholder = doc.createComment('xy-opening-focus-placeholder');
    parent.insertBefore(placeholder, root);
    const dialog = doc.createElement('dialog');
    dialog.setAttribute('data-xy-opening-focus-dialog', '');
    dialog.setAttribute('aria-label', '星月开局页全屏');
    dialog.addEventListener('cancel', event => { event.preventDefault(); exitOpeningFocusMode(); });
    openingFocusReturnFocus = doc.activeElement;
    if (parent.matches?.('[data-xy-opening-remote]')) parent.__xyOpeningPortalRoot = root;
    doc.body.appendChild(dialog);
    dialog.appendChild(root);
    openingFocusPortal = { placeholder, dialog, mount:parent.matches?.('[data-xy-opening-remote]') ? parent : null };
    root.dataset.xyFocusMode = '1';
    try { dialog.showModal(); }
    catch (_) {
      exitOpeningFocusMode({ restoreFocus:false });
      return false;
    }
    bindOpeningFocusViewport(dialog);
    syncOpeningFocusButton();
    try { root.focus({ preventScroll:true }); } catch (_) {}
    return true;
  }
  function exitOpeningFocusMode(options = {}) {
    if (!openingFocusPortal) {
      try { openingFocusViewportCleanup?.(); } catch (_) {}
      openingFocusViewportCleanup = null;
      delete root.dataset.xyFocusMode;
      syncOpeningFocusButton();
      return false;
    }
    const { placeholder, dialog, mount } = openingFocusPortal;
    placeholder.parentNode?.insertBefore(root, placeholder);
    placeholder.remove();
    try { if (mount?.__xyOpeningPortalRoot === root) delete mount.__xyOpeningPortalRoot; } catch (_) {}
    try { if (dialog.open) dialog.close(); } catch (_) {}
    dialog.remove();
    try { openingFocusViewportCleanup?.(); } catch (_) {}
    openingFocusViewportCleanup = null;
    openingFocusPortal = null;
    delete root.dataset.xyFocusMode;
    syncOpeningFocusButton();
    if (options.restoreFocus !== false) {
      try { openingFocusReturnFocus?.focus?.({ preventScroll:true }); } catch (_) {}
    }
    openingFocusReturnFocus = null;
    return true;
  }
  openingAbort?.signal?.addEventListener?.('abort', () => exitOpeningFocusMode({ restoreFocus:false }), { once:true });
  function setView(view, options = {}) {
    const nextView = ['boot', 'wizard', 'workshop'].includes(view) ? view : 'boot';
    const leavingOwnedWorkshop = state.view === 'workshop' && nextView !== 'workshop' && state.workshopFocusOwned;
    if (nextView === 'workshop' && !openingFocusActive()) state.workshopFocusOwned = enterOpeningFocusMode();
    if (!state.previewMode && options.savePreviousScroll !== false) saveOpeningScroll({ immediate: true });
    state.view = nextView;
    root.dataset.xyOpeningView = nextView;
    root.querySelectorAll('[data-xy-view]').forEach(node => { node.hidden = node.dataset.xyView !== nextView; });
    if (!state.previewMode && options.persist !== false) openingDraftService.patchUi({ view: nextView }, { immediate: true });
    render();
    if (options.restoreScroll !== false) restoreOpeningScroll();
    if (leavingOwnedWorkshop) { state.workshopFocusOwned = false; exitOpeningFocusMode(); }
  }

  function setStep(next, options = {}) {
    if (!state.previewMode && options.savePreviousScroll !== false) saveOpeningScroll({ immediate: true });
    state.step = Math.max(1, Math.min(6, Number(next) || 1));
    state.maxStep = Math.max(Number(state.maxStep) || 1, state.step);
    root.dataset.xyOpeningStep = String(state.step);
    if (!state.previewMode && options.persist !== false) openingDraftService.patchUi({ step: state.step, maxStep: state.maxStep }, { immediate: true });
    root.querySelectorAll('[data-xy-opening-pane]').forEach(pane => { pane.hidden = Number(pane.dataset.xyOpeningPane) !== state.step; });
    root.querySelectorAll('.xy-step').forEach(button => {
      const target = Number(button.dataset.xyStepTarget);
      const active = target === state.step;
      if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      // 3.4.7：走过的步骤给完成态标记（✓ 表示访问过，不代表填写完整）
      const done = !active && target <= (Number(state.maxStep) || 1);
      if (done) button.dataset.xyStepDone = '1'; else delete button.dataset.xyStepDone;
      const em = button.querySelector('em');
      if (em) em.textContent = done ? '✓' : String(target);
    });
    const progress = root.querySelector('[data-xy-opening-progress]');
    if (progress) progress.style.width = String(state.step * 100 / 6) + '%';
    render();
    if (options.restoreScroll !== false) restoreOpeningScroll();
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
  function safeDiscordAvatarUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const discordAvatarPath = url.pathname.startsWith('/avatars/') || url.pathname.startsWith('/embed/avatars/');
      return url.protocol === 'https:' && url.hostname === 'cdn.discordapp.com' && discordAvatarPath ? url.toString() : '';
    } catch (_) { return ''; }
  }
  function renderWorkshopIdentityPill(node, auth, fallbackText) {
    if (!node) return;
    node.replaceChildren();
    const identity = controlCenter()?.getWorkshopIdentity?.();
    const avatar = auth.loggedIn ? safeDiscordAvatarUrl(identity?.avatar) : '';
    if (avatar) {
      const img = node.ownerDocument.createElement('img');
      img.dataset.xyDiscordAvatar = '';
      img.src = avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      node.appendChild(img);
    }
    const label = node.ownerDocument.createElement('span');
    label.textContent = auth.loggedIn ? ('Discord 已确认' + (identity?.name ? (' · ' + identity.name) : '')) : fallbackText;
    node.appendChild(label);
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
      renderWorkshopIdentityPill(login, auth, 'Discord 未登录');
    }
    root.querySelectorAll('[data-xy-login-button]').forEach(button => {
      const waiting = state.workshopLoginStatus === 'waiting';
      button.textContent = auth.loggedIn ? '退出登录' : (waiting ? '等待 Discord 确认…' : 'Discord 登录');
      button.disabled = waiting;
    });
    root.querySelectorAll('[data-xy-login-cancel]').forEach(button => { button.hidden = state.workshopLoginStatus !== 'waiting'; });
  }
  async function refreshWorkshopAuth() {
    const generation = ++state.workshopAuthGeneration;
    const cc = controlCenter();
    if (!cc?.checkWorkshopAuth) {
      state.workshopAuth = { checked: true, loggedIn: false, publisherId: '', error: '控制中心 API 未就绪' };
      updateWorkshopStatusPills();
      return state.workshopAuth;
    }
    const auth = await cc.checkWorkshopAuth();
    if (generation !== state.workshopAuthGeneration || runtimeDestroyed || root.isConnected === false) return state.workshopAuth;
    state.workshopAuth = auth;
    updateWorkshopStatusPills();
    return state.workshopAuth;
  }
  function loginDiscord() {
    const cc = controlCenter();
    if (cc?.beginWorkshopLogin) return cc.beginWorkshopLogin();
    const url = cc?.workshopLoginUrl ? cc.workshopLoginUrl() : '';
    if (!url) throw new Error('创意工坊登录地址未就绪');
    return hostWindow().open(url, 'xy-workshop-login', 'width=520,height=720');
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
  try {
    openingAbort?.signal?.addEventListener('abort', () => {
      if (depAutoTimer) clearInterval(depAutoTimer);
      depAutoTimer = null;
    }, { once: true });
  } catch (_) {}
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
      if (key === 'player_identity' || key === 'player_grade') return; // 自由输入是唯一真相源；预设控件只负责填入对应输入框
      const selected = group.querySelector('.xy-choice.selected');
      if (selected) patch[key] = selected.dataset.xyChoiceValue || '';
    });
    root.querySelectorAll('[data-xy-check-group]').forEach(group => {
      const key = group.dataset.xyCheckGroup;
      patch[key] = Array.from(group.querySelectorAll('.xy-choice.selected')).map(item => item.dataset.xyCheckValue).filter(Boolean);
    });
    return saveDraft(patch);
  }

  function renderIdentityChoiceState(value) {
    const group = root.querySelector('[data-xy-choice-group="player_identity"]');
    if (!group) return;
    const current = String(value || '');
    group.querySelectorAll('.xy-choice').forEach(button => button.classList.toggle('selected', !!current && button.dataset.xyChoiceValue === current));
  }
  function renderGradeControlState(draft = readDraft()) {
    const grade = normalizeGrade(draft.player_grade);
    const select = root.querySelector('[data-xy-grade-preset]');
    const status = root.querySelector('[data-xy-grade-status]');
    if (select) select.value = GRADE_PRESET_VALUES.includes(grade) ? grade : (grade ? '__custom__' : '');
    if (status) {
      const effective = resolveEffectiveGrade(draft);
      status.textContent = grade ? ('当前年级：' + grade + ' · ' + effective.band) : (effective.fallback ? '未填写；发送时沿用旧版初三兜底，但不会写回草稿' : '未提供年级');
      status.dataset.state = grade || effective.fallback ? 'ok' : 'warn';
    }
  }
  function personaDiffText(rows) {
    if (!rows.length) return '当前草稿与 Persona 星月结构块内容一致。';
    return rows.map(row => row.field + '\n  当前：' + (row.current || '（空）') + '\n  Persona：' + (row.persona || '（空）')).join('\n\n');
  }
  function currentPersonaSnapshot() {
    return resolveActivePersonaSnapshot(getSillyTavernContext(), hostDocument());
  }
  function renderPersonaStatus() {
    const card = root.querySelector('[data-xy-persona-sync]');
    const label = root.querySelector('[data-xy-persona-status]');
    const detail = root.querySelector('[data-xy-persona-detail]');
    const importButton = root.querySelector('[data-xy-opening-action="import-current-persona"]');
    const syncButton = root.querySelector('[data-xy-opening-action="sync-current-persona"]');
    if (!card || !label) return null;
    const snapshot = currentPersonaSnapshot();
    state.personaSnapshot = snapshot;
    state.personaFingerprint = personaSnapshotFingerprint(snapshot);
    if (!snapshot.resolved) {
      card.dataset.state = 'error';
      label.textContent = snapshot.reason || '当前 Persona 不可用';
      if (detail) detail.textContent = snapshot.ambiguous ? '请在 ST 笑脸 Persona 列表中明确选中唯一项后重试。' : '可继续使用本地草稿；不会自动导入或清空。';
      if (importButton) importButton.disabled = true;
      if (syncButton) syncButton.disabled = true;
      return snapshot;
    }
    const parsed = parsePersonaIdentityBlock(snapshot.description);
    const blockReady = parsed.found && parsed.valid && !parsed.multiple && parsed.count === 1;
    card.dataset.state = parsed.valid ? (blockReady ? 'ok' : 'warn') : 'error';
    label.textContent = '当前 Persona：' + (snapshot.name || snapshot.id);
    if (detail) {
      detail.textContent = !parsed.found
        ? '尚无星月结构块；可把当前草稿同步追加到 Persona。'
        : (!parsed.valid ? ('结构块无效：' + (parsed.errors?.[0]?.message || '无法解析'))
          : (parsed.multiple ? '检测到多个星月结构块；同步时可合并为一个规范块。'
            : ('结构块有效 · 年级 ' + parsed.gradeLabel + ' · SHA-256 ' + parsed.contentHash.slice(0, 12) + '…' + (snapshot.position === PERSONA_DESCRIPTION_DISABLED_POSITION ? ' · 当前注入已禁用' : ''))));
    }
    if (importButton) importButton.disabled = !blockReady;
    if (syncButton) syncButton.disabled = false;
    return snapshot;
  }
  function closePersonaImportDialog() {
    const modal = root.querySelector('[data-xy-persona-import-modal]');
    if (modal) modal.hidden = true;
    state.pendingPersonaImport = null;
  }
  function openPersonaImportDialog() {
    const snapshot = currentPersonaSnapshot();
    if (!snapshot.resolved) throw new Error(snapshot.reason || '当前 Persona 无法唯一定位');
    const parsed = parsePersonaIdentityBlock(snapshot.description);
    if (!parsed.found) throw new Error('当前 Persona 没有星月结构块');
    if (!parsed.valid || parsed.multiple || parsed.count !== 1) throw new Error(parsed.multiple ? '当前 Persona 有多个结构块，请先同步合并' : (parsed.errors?.[0]?.message || 'Persona 结构块无效'));
    const rows = userIdentityPayloadDiff(readDraft(), parsed.payload, parsed.rawPayload);
    state.pendingPersonaImport = { snapshot, parsed, rows };
    const modal = root.querySelector('[data-xy-persona-import-modal]');
    const title = root.querySelector('[data-xy-persona-import-title]');
    const diff = root.querySelector('[data-xy-persona-import-diff]');
    if (title) title.textContent = '从 Persona 导入 · ' + snapshot.name;
    if (diff) diff.textContent = personaDiffText(rows);
    if (modal) modal.hidden = false;
  }
  function applyPendingPersonaImport(mode) {
    if (mode === 'cancel') { closePersonaImportDialog(); return; }
    const pending = state.pendingPersonaImport;
    if (!pending) throw new Error('没有待导入的 Persona 内容');
    const current = currentPersonaSnapshot();
    if (!current.resolved || current.id !== pending.snapshot.id || current.fingerprint !== pending.snapshot.fingerprint) throw new Error('Persona 已切换或内容已变化，请重新打开导入');
    const merged = mergePersonaIdentityIntoDraft(readDraft(), pending.parsed, mode);
    writeDraft(merged, { immediate:true });
    closePersonaImportDialog();
    applyDraftToFields();
    renderWizard({ collect:false });
    toast('success', mode === 'replace' ? '已用 Persona 全部替换身份草稿' : '已从 Persona 填入草稿空项');
  }
  async function syncCurrentDraftToPersona() {
    const draft = collectFields();
    if (!userIdentityDraftHasContent(draft)) throw new Error('当前身份草稿为空，无法同步到 Persona');
    const snapshot = currentPersonaSnapshot();
    if (!snapshot.resolved) throw new Error(snapshot.reason || '当前 Persona 无法唯一定位');
    const parsed = parsePersonaIdentityBlock(snapshot.description);
    if (parsed.found && (!parsed.valid || parsed.matchedCount !== parsed.count)) throw new Error(parsed.errors?.[0]?.message || 'Persona 结构块无效');
    const payload = buildUserIdentityPayload(draft);
    const replacement = replacePersonaIdentityBlocks(snapshot.description, payload);
    if (replacement.description === snapshot.description || (parsed.count === 1 && parsed.contentHash === replacement.contentHash)) {
      toast('info', 'Persona 星月结构块内容已一致，无需更新');
      renderPersonaStatus();
      return;
    }
    const rows = parsed.found ? userIdentityPayloadDiff(draft, parsed.payload) : [];
    const prompt = replacement.mode === 'merge'
      ? '检测到多个星月结构块。确认合并为一个规范块？块外原有人设文本和 descriptor 其他字段将保持不变。'
      : (replacement.mode === 'replace'
        ? 'Persona 中已有不同的星月结构块。确认只替换该结构块？\n\n' + personaDiffText(rows)
        : 'Persona 中尚无星月结构块。确认追加当前身份草稿？');
    if (!confirm(prompt)) return;
    await writeActivePersonaDescription(snapshot, replacement.description);
    state.personaFingerprint = '';
    renderPersonaStatus();
    renderPlayerFacingText();
    toast('success', replacement.mode === 'merge' ? '已合并并同步 Persona 星月结构块' : '已同步到当前 Persona');
  }
  function applyDraftToFields() {
    const draft = normalizeDraft(readDraft());
    root.querySelectorAll('[data-xy-opening-field]').forEach(input => { input.value = draft[input.dataset.xyOpeningField] ?? ''; });
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
    renderGradeControlState(draft);
    renderPersonaStatus();
    renderOpeningDayEditor(draft);
  }
  function flushOpeningRootState() {
    if (state.previewMode) return false;
    try { saveOpeningScroll({ immediate: true }); } catch (_) {}
    try { captureOpeningDayField({ immediate: true }); } catch (_) {}
    try { collectFields(); } catch (_) {}
    try { openingDraftService.flushSync(); } catch (_) {}
  }
  function refreshOpeningContext() {
    const ui = openingDraftService.readUi();
    state.step = Math.max(1, Math.min(6, Number(ui.step) || 1));
    state.maxStep = Math.max(Number(ui.maxStep) || 1, state.step);
    state.view = ['boot', 'wizard', 'workshop'].includes(ui.view) ? ui.view : 'boot';
    applyDraftToFields();
    setStep(state.step, { persist: false, savePreviousScroll: false, restoreScroll: false });
    setView(state.view, { persist: false, savePreviousScroll: false, restoreScroll: false });
    renderPlayerFacingText();
    restoreOpeningScroll();
  }
  root.__xyOpeningFlushState = flushOpeningRootState;
  root.__xyOpeningRefreshContext = refreshOpeningContext;
  root.__xyOpeningRefreshWorkshop = async () => {
    await refreshWorkshop();
  };
  root.__xyOpeningRefreshPlayer = () => {
    renderPlayerFacingText();
    renderPersonaStatus();
    renderOpeningDayEditor(readDraft());
  };
  const personaPollTimer = setInterval(() => {
    if (openingAbort?.signal?.aborted) return;
    if (root.isConnected === false) {
      try { openingAbort?.abort?.(); } catch (_) { clearInterval(personaPollTimer); }
      return;
    }
    const fingerprint = personaSnapshotFingerprint(currentPersonaSnapshot());
    if (fingerprint === state.personaFingerprint) return;
    state.personaFingerprint = fingerprint;
    renderPersonaStatus();
    renderPlayerFacingText();
    renderOpeningDayEditor(readDraft());
  }, 1000);
  try { openingAbort?.signal?.addEventListener('abort', () => clearInterval(personaPollTimer), { once:true }); } catch (_) {}
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
  function identityMediaField(slot) { return slot === 'portrait' ? 'player_portrait' : 'player_avatar'; }
  function identityMediaLabel(slot) { return slot === 'portrait' ? '立绘' : '头像'; }
  function identityMediaMeta(slot) { return { type:'bond', slot:slot === 'portrait' ? 'portrait' : 'avatar', name:'{{user}}', variant:'normal' }; }
  function resolveIdentityMediaReference(reference, slot) {
    const normalized = normalizeIdentityMediaReference(reference);
    if (!normalized) return null;
    if (/^https?:\/\//i.test(normalized)) return { key:normalized, src:normalized, displayName:normalized, external:true };
    try {
      const lib = mediaLibrary();
      const exact = lib?.listManagedAssets?.().find(item => String(item?.key || '') === normalized);
      if (exact) return { ...exact, src: exact.dataUrl || exact.url || exact.src || '' };
      const fallback = lib?.getExactAsset?.(identityMediaMeta(slot));
      if (fallback && String(fallback.key || '') === normalized) return { ...fallback, src:fallback.dataUrl || fallback.url || fallback.src || '' };
    } catch (_) {}
    return { key:normalized, src:'', displayName:normalized };
  }
  function setIdentityMediaReference(slot, reference) {
    const field = identityMediaField(slot);
    const value = normalizeIdentityMediaReference(reference);
    saveDraft({ [field]: value });
    const input = root.querySelector('[data-xy-opening-field="' + field + '"]');
    if (input) input.value = value;
    renderIdentityMedia(readDraft());
    renderWizard();
    return value;
  }
  function selectIdentityMediaReference(slot, reference) {
    const key = normalizeIdentityMediaReference(reference);
    if (!key) throw new Error('请先选择媒体库资源');
    return setIdentityMediaReference(slot, key);
  }
  function clearIdentityMediaReference(slot) {
    return setIdentityMediaReference(slot, '');
  }
  async function importIdentityMediaUrl(slot, url) {
    const sourceUrl = String(url || '').trim();
    if (!sourceUrl) throw new Error('请先输入图片 URL');
    const lib = mediaLibrary();
    if (!lib?.importUrlAsset) throw new Error('媒体库 URL 导入 API 未就绪');
    const actionContext = captureOpeningActionContext(root);
    const item = await lib.importUrlAsset(sourceUrl, identityMediaMeta(slot));
    assertOpeningActionContext(actionContext);
    if (!item?.key) throw new Error('媒体库未返回可保存引用');
    return setIdentityMediaReference(slot, item.key);
  }
  async function importIdentityMediaLocal(slot) {
    const lib = mediaLibrary();
    if (!lib?.requestLocalImport) throw new Error('媒体库导入 API 未就绪');
    const actionContext = captureOpeningActionContext(root);
    const item = await lib.requestLocalImport(identityMediaMeta(slot));
    assertOpeningActionContext(actionContext);
    return item?.key ? setIdentityMediaReference(slot, item.key) : '';
  }
  function renderIdentityMedia(draft = readDraft()) {
    ['avatar','portrait'].forEach(slot => {
      const card = root.querySelector('[data-xy-identity-media="' + slot + '"]');
      if (!card) return;
      const reference = normalizeIdentityMediaReference(draft[identityMediaField(slot)]);
      const item = resolveIdentityMediaReference(reference, slot);
      const preview = card.querySelector('[data-xy-identity-media-preview]');
      const label = card.querySelector('[data-xy-identity-media-label]');
      if (preview) {
        if (item?.src) preview.innerHTML = '<img src="' + escapeHtml(item.src) + '" alt="' + identityMediaLabel(slot) + '预览">';
        else preview.textContent = reference ? '引用已保存' : '未选择';
      }
      if (label) label.textContent = reference ? (item?.displayName || reference) : '媒体库、本地图片或 URL';
    });
  }
  function renderAvatar(draft = readDraft()) { renderIdentityMedia(draft); }
  function renderIdentityMediaPicker() {
    const modal = root.querySelector('[data-xy-identity-media-modal]');
    if (!modal || modal.hidden) return;
    const slot = state.identityMediaSlot === 'portrait' ? 'portrait' : 'avatar';
    const title = modal.querySelector('[data-xy-identity-media-title]');
    const input = modal.querySelector('[data-xy-identity-media-url]');
    const filterInput = modal.querySelector('[data-xy-identity-media-filter]');
    const list = modal.querySelector('[data-xy-identity-media-list]');
    if (title) title.textContent = '选择' + identityMediaLabel(slot);
    if (input) input.placeholder = 'https://.../' + slot + '.png';
    if (!list) return;
    const query = String(filterInput?.value || '').trim().toLocaleLowerCase();
    let assets = [];
    try { assets = mediaLibrary()?.listManagedAssets?.() || []; } catch (_) {}
    assets = assets.filter(item => item?.slot === slot).filter(item => !query || [item.name,item.displayName,item.key].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    if (!assets.length) { list.innerHTML = '<div class="xy-identity-media-empty">当前媒体库没有匹配的' + identityMediaLabel(slot) + '。可从本地或 URL 导入。</div>'; return; }
    list.innerHTML = assets.map(item => {
      const src = item.dataUrl || item.url || item.src || '';
      return '<button type="button" class="xy-identity-media-option" data-xy-opening-action="select-identity-media" data-key="' + escapeHtml(item.key || '') + '"><span class="xy-identity-media-option-preview">' + (src ? '<img src="' + escapeHtml(src) + '" alt="">' : '无预览') + '</span><strong>' + escapeHtml(item.displayName || item.name || item.key) + '</strong><small>' + escapeHtml(item.builtIn ? '内置媒体' : '本地媒体') + '</small></button>';
    }).join('');
  }
  function renderEnableLists() {
    const draft = readDraft();
    const enabled = enabledPackageMap(draft);
    root.querySelectorAll('[data-xy-enable-list]').forEach(list => {
      const group = list.dataset.xyEnableList;
      const items = packages().filter(pkg => packageMatchesTypeGroup(pkg, group));
      if (!items.length) {
        // 3.4.7：空态按分组给可执行引导，薄样式不占大块空白
        const emptyGuides = {
          user_identity: '还没有身份模板。点上方「添加身份模板」逛工坊，或「本地导入」吃 JSON。',
          character: '还没有角色包。点「新建角色」创建，或「打开角色工坊」下载现成角色。',
          world_factor: '还没有世界因子包。点「添加因子」手写一条，或「打开工坊」看看别人的世界观。',
          extension: '还没有扩展包。点「打开扩展工坊」找道具、蓝图、配方、技能。',
        };
        list.dataset.xyEmpty = '1';
        list.innerHTML = '<div class="xy-enable-empty">' + (emptyGuides[group] || '暂无已导入内容。使用工坊入口或本地导入添加后，可在这里启用。') + '</div>';
        return;
      }
      delete list.dataset.xyEmpty;
      list.innerHTML = items.map(pkg => {
        const key = packageIdentity(pkg);
        const on = enabled[key] === true;
        const tags = (pkg.tags || []).slice(0, 5).map(tag => '<span class="xy-pill">' + escapeHtml(tag) + '</span>').join('');
        const inspected = state.packageInspections.get(key);
        const source = pkg.manifestUrl || pkg.reviewStatus ? '在线工坊' : '当前聊天草稿';
        const installBadges = inspected
          ? '<span class="xy-pill ' + (inspected.installed ? 'ok' : '') + '">' + (inspected.installed ? '已安装' : '未安装') + '</span>'
            + (inspected.installed ? '<span class="xy-pill">本地 revision ' + escapeHtml(inspected.revision ?? '—') + '</span>' : '')
            + (inspected.dirty ? '<span class="xy-pill warn">本地已修改</span>' : '')
          : '<span class="xy-pill">安装状态待检查</span>';
        const cloudRevision = Number.isInteger(Number(pkg.revision)) ? '<span class="xy-pill">云端 revision ' + escapeHtml(pkg.revision) + '</span>' : '';
        return '<article class="xy-enable-card"><div class="xy-enable-head"><div><strong>' + escapeHtml(pkg.title || pkg.id) + '</strong><p>' + escapeHtml(pkg.summary || '暂无摘要') + '</p></div><label class="xy-toggle"><input type="checkbox" data-xy-toggle-package="' + escapeHtml(key) + '"' + (on ? ' checked' : '') + '>启用</label></div><div class="xy-package-meta"><span class="xy-pill">' + escapeHtml(packageTypeLabel(pkg.type)) + '</span><span class="xy-pill">来源：' + source + '</span>' + cloudRevision + installBadges + tags + '</div></article>';
      }).join('');
    });
    root.querySelectorAll('[data-xy-enabled-preview]').forEach(node => {
      const group = node.dataset.xyEnabledPreview;
      const items = enabledPackages(group);
      // 3.4.7：空态标薄样式（data-xy-empty），避免大块虚线空框
      if (items.length) {
        delete node.dataset.xyEmpty;
        node.textContent = items.map(pkg => '[' + packageTypeLabel(pkg.type) + '] ' + pkg.title + '\n' + (pkg.summary || '')).join('\n\n');
      } else {
        node.dataset.xyEmpty = '1';
        node.textContent = '暂无启用内容；上方列表勾选「启用」后在这里预览。';
      }
    });
    renderWorldFactorList();
    renderPlayerFacingText();
  }
  let packageInspectionGeneration = 0;
  async function refreshPackageInspections() {
    const generation = ++packageInspectionGeneration;
    const cc = controlCenter();
    const items = packages();
    if (!cc?.inspectWorkshopPackage || !items.length) {
      if (generation === packageInspectionGeneration) state.packageInspections = new Map();
      return state.packageInspections;
    }
    const settled = await Promise.allSettled(items.map(pkg => cc.inspectWorkshopPackage(pkg)));
    if (generation !== packageInspectionGeneration || runtimeDestroyed || root.isConnected === false) return state.packageInspections;
    const next = new Map();
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') next.set(packageIdentity(items[index]), result.value);
    });
    state.packageInspections = next;
    renderEnableLists();
    return next;
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
    const effectiveGrade = resolveEffectiveGrade(draft);
    lines.push('年级：' + effectiveGrade.label);
    if (draft.player_callname) lines.push('称呼：' + draft.player_callname);
    if (draft.player_avatar) lines.push('玩家头像：' + draft.player_avatar);
    if (draft.player_portrait) lines.push('玩家立绘：' + draft.player_portrait);
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
      '写入目标：角色卡绑定世界书',
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
    if (!pkgs.length) return '暂无导入包；从各分页的工坊入口或本地导入添加后，这里会列出每个包的启用状态与写入去向。';
    const enabled = enabledPackageMap();
    return pkgs.map(pkg => {
      const on = enabled[packageIdentity(pkg)] === true ? '已启用' : '未启用';
      return '[' + packageTypeLabel(pkg.type) + '] ' + pkg.title + '\n' +
        'id: ' + pkg.id + '\n' +
        '状态：' + on + '\n' +
        '写入：启用后进入角色卡绑定世界书 / 星月工坊边界内\n' +
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

  function renderWizard(options = {}) {
    const draft = options.collect === false || state.previewMode ? normalizeDraft(readDraft()) : collectFields();
    renderIdentityChoiceState(draft.player_identity);
    const summary = root.querySelector('[data-xy-opening-summary]');
    if (summary) summary.textContent = summaryText(draft);
    const preview = root.querySelector('[data-xy-opening-preview]');
    if (preview) preview.textContent = writePreview(draft);
    renderConfirmRail(draft);
    renderDraftList();
    renderAttributes(draft);
    renderAvatar(draft);
    renderEnableLists();
    renderOpeningDayEditor(draft);
    renderPersonaStatus();
    renderPlayerFacingText();
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
      '<div class="xy-preview-card"><strong>年级</strong><span>' + escapeHtml(resolveEffectiveGrade(draft).label) + '</span></div>',
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
  function pendingActionUi(action, key, label, busyLabel = '处理中…') {
    const pending = state.pendingActions.has(action + ':' + String(key || 'global'));
    return { attrs:pending ? ' disabled aria-busy="true"' : '', label:pending ? busyLabel : label };
  }
  function renderEmptyWorkshopState(sourceLength) {
    const tab = activeTab();
    const isMine = state.workshopTab === 'mine';
    const auth = state.workshopAuth || {};
    const reason = state.lastWorkshopError
      ? '创意工坊连接失败，请稍后重试。'
      : (sourceLength ? '当前筛选没有匹配内容。' : '当前分区暂无可展示内容——登录后发布你的创作，就是这里的第一个包。');
    const title = isMine
      ? (auth.loggedIn ? '我的发布暂无内容' : '登录后查看我的发布')
      : (state.lastWorkshopError ? '创意工坊连接失败' : tab.label + '暂无在线内容');
    const copy = isMine
      ? (auth.loggedIn ? '这里仅管理你自己发布过的内容。' : '“我的发布”需登录并通过服务器成员确认后查看。你仍可浏览其他公开分区或使用本地 JSON。')
      : reason;
    const empty = '<div class="xy-empty-state"><h4>' + escapeHtml(title) + '</h4>' +
      '<p>' + escapeHtml(copy) + '</p>' +
      '<div class="xy-empty-actions"><button type="button" data-xy-opening-action="login-discord" data-xy-login-button>Discord 登录</button><button type="button" data-xy-opening-action="import-local-package">本地 JSON</button><button type="button" data-xy-opening-action="refresh-workshop">刷新</button></div></div>';
    return empty;
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
    root.querySelectorAll('[data-xy-publish-action]').forEach(node => { node.disabled = !state.publishSelection; });
    const selection = root.querySelector('[data-xy-publish-selection]');
    if (selection) selection.textContent = state.publishSelection
      ? '当前发布对象：' + (state.publishSelection.title || state.publishSelection.id) + ' · ' + packageTypeLabel(state.publishSelection.type) + ' · ID ' + state.publishSelection.id + ' · revision ' + (state.publishSelection.revision || '新建') + ' · 来源 ' + (state.publishSelection.reviewStatus ? '我的发布' : '当前聊天草稿')
      : '尚未选择发布对象；请在“我的发布”卡片中点“选择更新”。';
    const errorNode = root.querySelector('[data-xy-workshop-error]');
    if (errorNode) {
      errorNode.hidden = !state.lastWorkshopError;
      if (state.lastWorkshopError) errorNode.textContent = '最近一次操作失败：' + state.lastWorkshopError + '。可刷新重试，或返回编辑后再次执行。';
    }
    tabs.innerHTML = WORKSHOP_TABS.map(tab => '<button type="button" role="tab" aria-selected="' + String(tab.id === state.workshopTab) + '" class="xy-workshop-tab ' + (tab.id === state.workshopTab ? 'active' : '') + '" data-xy-opening-action="switch-workshop-tab" data-tab="' + escapeHtml(tab.id) + '"><strong>' + escapeHtml(tab.label) + '</strong><span>' + escapeHtml(tab.desc || '') + '</span></button>').join('');
    // 公开分区未登录也能浏览缓存目录；仅“我的发布”需要登录态
    const source = isMineTab ? (auth.loggedIn ? state.myPackages : []) : state.workshopCatalog;
    const items = source.filter(pkg => packageMatchesTab(pkg)).filter(packageMatchesFilters);
    status.innerHTML = [
      '<span class="xy-pill">' + escapeHtml(activeTab().label) + '</span>',
      '<span class="xy-pill ' + (auth.loggedIn ? 'ok' : 'warn') + '" data-xy-workshop-identity-pill></span>',
      '<span class="xy-pill ' + (state.lastWorkshopError ? 'warn' : 'ok') + '">' + (state.lastWorkshopError ? '连接失败' : (auth.loggedIn ? '工坊已连接' : '公开浏览')) + '</span>',
      '<span class="xy-pill">当前 ' + items.length + ' / 缓存 ' + source.length + '</span>',
      state.workshopLoginStatus === 'waiting' ? '<span class="xy-pill warn">等待 Discord 确认</span>' : '',
    ].join('');
    renderWorkshopIdentityPill(status.querySelector('[data-xy-workshop-identity-pill]'), auth, '未登录');
    grid.classList.toggle('single', state.workshopLoading || !items.length);
    if (state.workshopLoading) {
      grid.innerHTML = '<div class="xy-empty-state"><h4>正在读取创意工坊</h4><p>若连接暂时失败，可继续使用本地 JSON。</p></div>';
      renderPlayerFacingText();
      return;
    }
    if (!items.length) {
      grid.innerHTML = renderEmptyWorkshopState(source.length);
      updateWorkshopStatusPills();
      renderPlayerFacingText();
      return;
    }
    grid.classList.remove('single');
    grid.innerHTML = items.map(pkg => {
      const meta = [packageTypeLabel(pkg.type), pkg.rating || 'general', pkg.language || 'zh-CN'].filter(Boolean).join(' / ');
      const tags = (pkg.tags || []).slice(0, 4).map(tag => '<span class="xy-pill">' + escapeHtml(tag) + '</span>').join('');
      const reviewStatus = String(pkg.reviewStatus || 'approved');
      const reviewMeta = state.workshopTab === 'mine' ? '<span class="xy-pill">' + escapeHtml(reviewStatus) + '</span><span class="xy-pill">revision ' + escapeHtml(pkg.revision || '—') + '</span>' : '';
      const rejection = reviewStatus === 'rejected' && pkg.rejectionReason ? '<p class="xy-note">退回原因：' + escapeHtml(pkg.rejectionReason) + '</p>' : '';
      const withdrawnMeta = reviewStatus === 'withdrawn' ? '<p class="xy-note">撤回时间：' + escapeHtml(pkg.withdrawnAt || pkg.updatedAt || '未知') + '</p>' : '';
      const withdrawUi = pendingActionUi('withdraw-package', pkg.id, '撤回', '撤回中…');
      const ownerActions = state.workshopTab === 'mine'
        ? (reviewStatus === 'withdrawn'
          ? '<button type="button" data-xy-opening-action="copy-package-draft" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type || '') + '">复制为本地草稿</button>'
          : '<button type="button" data-xy-opening-action="select-publish-package" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type || '') + '">' + (reviewStatus === 'rejected' ? '选择修改后重提' : '选择更新') + '</button>'
            + (['pending','approved'].includes(reviewStatus) ? '<button type="button" data-xy-opening-action="withdraw-package" data-id="' + escapeHtml(pkg.id) + '" data-revision="' + escapeHtml(pkg.revision || '') + '"' + withdrawUi.attrs + '>' + withdrawUi.label + '</button>' : ''))
        : '';
      const votes = pkg.votes || { up: 0, down: 0 };
      const myVote = pkg.myVote || 'none';
      const voteUi = pendingActionUi('vote-package', pkg.id, '', '投票中…');
      const detailUi = pendingActionUi('show-package-detail', pkg.id, '详情', '读取中…');
      const downloadUi = pendingActionUi('download-package', pkg.id, '加入当前开局', '加入中…');
      const voteBar = voteUi.attrs
        ? '<div class="xy-vote-bar"><button type="button" class="xy-vote" disabled aria-busy="true">' + voteUi.label + '</button></div>'
        : '<div class="xy-vote-bar"><button type="button" class="xy-vote' + (myVote === 'up' ? ' on' : '') + '" data-xy-opening-action="vote-package" data-id="' + escapeHtml(pkg.id) + '" data-vote="up" aria-label="点赞">▲ ' + (votes.up || 0) + '</button><button type="button" class="xy-vote' + (myVote === 'down' ? ' on' : '') + '" data-xy-opening-action="vote-package" data-id="' + escapeHtml(pkg.id) + '" data-vote="down" aria-label="点踩">▼ ' + (votes.down || 0) + '</button></div>';
      const previewAvatar = /^https?:\/\//i.test(String(pkg.previewMedia?.avatar || '')) ? String(pkg.previewMedia.avatar) : '';
      const avatarHtml = previewAvatar ? '<img class="xy-package-preview-avatar" src="' + escapeHtml(previewAvatar) + '" alt="' + escapeHtml((pkg.title || pkg.id) + ' 头像') + '" loading="lazy" referrerpolicy="no-referrer">' : '';
      return '<article class="xy-package">' + avatarHtml + '<h4>' + escapeHtml(pkg.title || pkg.id) + '</h4><p>' + escapeHtml(pkg.summary || '暂无摘要') + '</p><div class="xy-package-meta"><span class="xy-pill">' + escapeHtml(meta) + '</span>' + tags + reviewMeta + '</div>' + rejection + withdrawnMeta + '<p>作者：' + escapeHtml(pkg.authorName || '未署名') + ' · 更新：' + escapeHtml(pkg.updatedAt || pkg.createdAt || '未知') + '</p>' + voteBar + '<div class="xy-package-actions"><button type="button" data-xy-opening-action="show-package-detail" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type || '') + '"' + detailUi.attrs + '>' + detailUi.label + '</button><button type="button" data-xy-opening-action="download-package" data-id="' + escapeHtml(pkg.id) + '" data-type="' + escapeHtml(pkg.type || '') + '"' + downloadUi.attrs + '>' + downloadUi.label + '</button>' + ownerActions + '</div></article>';
    }).join('');
    renderPlayerFacingText();
  }

  function resolveCharacterPackageMedia(reference, slot, pkg) {
    const key = String(reference || '').trim();
    if (!key) return { key:'', src:'' };
    if (/^https?:\/\//i.test(key)) return { key, src:key };
    try {
      const lib = mediaLibrary();
      const exact = lib?.listManagedAssets?.().find(item => String(item?.key || '') === key);
      const src = String(exact?.dataUrl || exact?.url || exact?.src || '');
      if (/^(https?:\/\/|blob:|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(src)) return { key, src };
    } catch (_) {}
    return { key, src:'' };
  }
  function renderCharacterPackageMedia(pkg) {
    const host = root.querySelector('[data-xy-package-media]');
    if (!host) return;
    host.replaceChildren();
    const payload = pkg?.type === 'character' && pkg?.payload && typeof pkg.payload === 'object' ? pkg.payload : null;
    if (!payload) { host.hidden = true; return; }
    const specs = [
      { kind:'avatar', label:'角色头像', reference:payload.media?.avatar || payload.avatar || payload.mediaRefs?.avatar || '' },
      { kind:'portrait', label:'角色立绘', reference:payload.media?.portraits?.normal || payload.portrait || payload.mediaRefs?.normal || '' },
      { kind:'portrait-nude', label:'赤裸立绘', reference:payload.media?.portraits?.nude || payload.mediaRefs?.nude || '' },
      { kind:'portrait-aftermath', label:'事后立绘', reference:payload.media?.portraits?.aftermath || '' },
    ].filter(item => String(item.reference || '').trim());
    if (!specs.length) { host.hidden = true; return; }
    specs.forEach(spec => {
      const item = resolveCharacterPackageMedia(spec.reference, spec.kind, pkg);
      const card = host.ownerDocument.createElement('figure');
      card.dataset.xyPackageMediaCard = spec.kind;
      const label = host.ownerDocument.createElement('figcaption');
      label.textContent = spec.label;
      const fallback = host.ownerDocument.createElement('div');
      fallback.dataset.xyPackageMediaFallback = '';
      fallback.textContent = item.src ? '图片加载失败' : ('媒体引用暂不可预览：' + item.key);
      fallback.hidden = Boolean(item.src);
      if (item.src) {
        const img = host.ownerDocument.createElement('img');
        img.dataset.xyPackageMediaImage = spec.kind;
        img.src = item.src;
        img.alt = (payload.name || pkg.title || '角色') + ' · ' + spec.label;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => { img.hidden = true; fallback.hidden = false; }, { once:true });
        card.appendChild(img);
      }
      card.appendChild(fallback);
      card.appendChild(label);
      host.appendChild(card);
    });
    host.hidden = false;
  }
  function renderPackageDetail(pkg, detailText) {
    const modal = root.querySelector('[data-xy-package-modal]');
    if (!modal) return;
    root.querySelector('[data-xy-package-title]').textContent = resolvePlayerText(pkg?.title || '工坊包详情');
    root.querySelector('[data-xy-package-subtitle]').textContent = resolvePlayerText('[' + packageTypeLabel(pkg?.type) + '] ' + (pkg?.summary || ''));
    renderCharacterPackageMedia(pkg);
    root.querySelector('[data-xy-package-detail]').textContent = detailText;
    renderPackageInspection(pkg);
    const openingPackage = pkg?.cardScope === 'xingyue-opening-v1' && pkg?.payload?.target === 'xingyue.opening_day_body';
    root.querySelectorAll('[data-xy-opening-package-action]').forEach(button => { button.hidden = !openingPackage; });
    modal.hidden = false;
    renderPlayerFacingText();
  }
  async function renderPackageInspection(pkg) {
    const node = root.querySelector('[data-xy-package-inspection]');
    if (!node) return;
    const identity = packageIdentity(pkg);
    const fingerprint = identity + '::' + String(pkg?.revision || '') + '::' + String(pkg?.contentHash || '');
    const generation = ++state.packageDetailInspectionGeneration;
    node.hidden = false;
    node.textContent = '正在检查本地安装状态…';
    try {
      const inspected = await controlCenter()?.inspectWorkshopPackage?.(pkg);
      const selected = state.selectedPackage || {};
      const selectedFingerprint = packageIdentity(selected) + '::' + String(selected.revision || '') + '::' + String(selected.contentHash || '');
      if (!inspected || generation !== state.packageDetailInspectionGeneration || selectedFingerprint !== fingerprint || root.isConnected === false) return;
      state.packageInspections.set(identity, inspected);
      node.textContent = [
        '来源：' + (pkg.manifestUrl || pkg.reviewStatus ? '在线工坊' : '本地 / 当前聊天'),
        '云端 revision：' + (pkg.revision || '—'),
        '本地安装：' + (inspected.installed ? ('已安装 revision ' + (inspected.revision ?? '—')) : '未安装'),
        '本地状态：' + (inspected.dirty ? '已修改（更新前需选择覆盖 / 保留 / 脱离）' : '未检测到修改'),
      ].join(' · ');
    } catch (error) {
      if (generation === state.packageDetailInspectionGeneration && packageIdentity(state.selectedPackage || {}) === identity) node.textContent = '安装状态检查失败：' + (error.message || String(error));
    }
  }

  function impactPreview(pkg) {
    const lines = [];
    lines.push('包 ID：' + (pkg.id || ''));
    lines.push('类型：' + packageTypeLabel(pkg.type));
    lines.push('评级：' + (pkg.rating || 'general'));
    lines.push('适用范围：' + (pkg.cardScope || 'xingyue'));
    lines.push('');
    lines.push('安装位置：角色卡绑定世界书');
    lines.push('重复导入：覆盖同 ID 的旧版本');
    if (EXTENSION_TYPES.includes(pkg.type)) lines.push('扩展边界：仅作为聊天世界书设定安装，不自动创建商店、制造、技能或前端功能');
    lines.push('');
    lines.push('摘要：' + resolvePlayerText(pkg.summary || '无'));
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
    try {
      return cc?.packageDetail ? await cc.packageDetail(item) : item;
    } catch (error) {
      // D8：契约拒收（多为旧格式存量包）时给玩家可读的解释，而不是裸抛校验码。
      const reason = String(error?.message || error || '');
      if (/unknown-.*-field|legacy-|invalid-|-required|-too-old/i.test(reason)) {
        throw new Error('「' + (item.title || id) + '」使用了旧版包格式，当前版本无法导入（' + reason + '）。请等待作者按新格式更新后重试。');
      }
      throw error;
    }
  }
  async function refreshWorkshop() {
    const generation = ++state.workshopRefreshGeneration;
    const cc = controlCenter();
    if (!cc?.refreshWorkshop) {
      state.workshopCatalog = [];
      state.myPackages = [];
      state.workshopLoading = false;
      state.lastWorkshopError = '在线创意工坊暂未开放，可继续使用本地 JSON';
      renderWorkshop();
      return [];
    }
    state.workshopLoading = true;
    state.lastWorkshopError = '';
    renderWorkshop();
    try {
      await refreshWorkshopAuth();
      if (generation !== state.workshopRefreshGeneration || runtimeDestroyed || root.isConnected === false) return state.workshopCatalog;
      const items = await cc.refreshWorkshop({ skipAuthCheck:true });
      if (generation !== state.workshopRefreshGeneration || runtimeDestroyed || root.isConnected === false) return state.workshopCatalog;
      state.workshopCatalog = Array.isArray(items) ? items : [];
      if (state.workshopAuth.loggedIn && cc.myPackages) {
        try {
          const mine = await cc.myPackages({ skipAuthCheck:true });
          if (generation !== state.workshopRefreshGeneration || runtimeDestroyed || root.isConnected === false) return state.workshopCatalog;
          state.myPackages = Array.isArray(mine) ? mine : (Array.isArray(mine?.packages) ? mine.packages : []);
          if (state.publishSelection) {
            state.publishSelection = state.myPackages.find(item => packageIdentity(item) === packageIdentity(state.publishSelection) && item.reviewStatus !== 'withdrawn') || null;
          }
        } catch (error) {
          if (generation !== state.workshopRefreshGeneration || runtimeDestroyed || root.isConnected === false) return state.workshopCatalog;
          state.myPackages = [];
          state.lastWorkshopError = error.message || String(error);
        }
      } else {
        state.myPackages = [];
      }
    } catch (error) {
      if (generation !== state.workshopRefreshGeneration || runtimeDestroyed || root.isConnected === false) return state.workshopCatalog;
      state.lastWorkshopError = error.message || String(error);
      throw error;
    } finally {
      if (generation === state.workshopRefreshGeneration) {
        state.workshopLoading = false;
        renderWorkshop();
      }
    }
    return state.workshopCatalog;
  }

  async function importPackageObject(pkg, allowedTypes) {
    const cc = controlCenter();
    let imported = pkg;
    if (cc?.importPackage) {
      // importPackage 已包含 validate + importPackageToDraft，禁止在 UI 层重复导入。
      imported = await cc.importPackage(pkg, { allowedTypes: allowedTypes || [] });
    } else if (cc?.importPackageToDraft) {
      cc.importPackageToDraft(pkg);
      imported = pkg;
    } else {
      const draft = readDraft();
      const key = packageIdentity(imported);
      draft.packages = packages().filter(item => packageIdentity(item) !== key).concat([imported]);
      draft.enabledPackages = enabledPackageMap(draft);
      if (draft.enabledPackages[key] === undefined) draft.enabledPackages[key] = imported.type === 'user_identity';
      writeDraft(draft);
    }
    // 导入身份后先把新草稿回填 DOM，再允许 renderWizard 采集，避免旧表单值反向覆盖导入结果。
    if (imported?.type === 'user_identity') applyDraftToFields();
    toast('success', '已加入当前开局：' + imported.title + '；前往“' + packageDestinationLabel(imported.type) + '”查看');
    renderWizard({ collect:false });
    render();
    void refreshPackageInspections();
    return imported;
  }
  async function persistIdentityBeforeSend(draft, sendContext) {
    for (;;) {
      try {
        assertOpeningChatContext(sendContext);
        const result = await controlCenter()?.writeOpeningWorldbookEntries?.(draft, { scope:'identity', expectedContext:sendContext });
        assertOpeningChatContext(sendContext);
        return { result, continuedWithoutPersistence:false };
      } catch (error) {
        assertOpeningChatContext(sendContext);
        if (runtimeDestroyed || root.isConnected === false) throw new Error('开局页已卸载，身份写入决策已取消');
        const answer = await requestIdentityPersistenceDecision(error);
        assertOpeningChatContext(sendContext);
        if (answer === 'retry') continue;
        if (answer === 'continue-once') return { result:null, continuedWithoutPersistence:true };
        throw new Error('身份未写入，已取消发送');
      }
    }
  }
  async function installPackageObject(pkg, allowedTypes) {
    const cc = controlCenter();
    if (!cc?.installPackageToWorldbook) throw new Error('控制中心世界书安装 API 未就绪');
    const result = await cc.installPackageToWorldbook(pkg, { allowedTypes: allowedTypes || [] });
    if (result?.warning) toast('info', result.warning);
    else toast('success', '已安装到角色卡绑定世界书：' + (pkg.title || pkg.id));
    return result;
  }
  async function installPackageObjectWithDecision(pkg, allowedTypes) {
    try { return await installPackageObject(pkg, allowedTypes); }
    catch (error) {
      if (error?.code !== 'workshop-dirty-decision-required') throw error;
      const answer = String(hostWindow().prompt?.('检测到本地编辑。请输入：覆盖 / 保留 / 脱离（取消则不更新）', '保留') || '').trim();
      const map = { 覆盖:'overwrite', 保留:'keep', 脱离:'detach', overwrite:'overwrite', keep:'keep', detach:'detach' };
      const dirtyDecision = map[answer];
      if (!dirtyDecision) throw new Error('已取消更新，本地内容未改变');
      return controlCenter().installPackageToWorldbook(pkg, { allowedTypes:allowedTypes || [], dirtyDecision });
    }
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
  async function previewLocalPackageArchive(buffer) {
    const cc = controlCenter();
    if (!cc?.importCharacterPackageArchive) throw new Error('控制中心压缩包导入 API 未就绪');
    const pkg = await cc.importCharacterPackageArchive(buffer);
    const detail = cc?.validatePackage ? cc.validatePackage(pkg, state.localImportTypes || []) : pkg;
    state.selectedPackage = detail;
    state.selectedAllowedTypes = state.localImportTypes || [];
    renderPackageDetail(detail, '本地压缩包预览（媒体已入媒体库）\n\n' + impactPreview(detail));
  }

  function render() {
    renderDeps();
    setAgreementState();
    renderEntryStatus();
    updateWorkshopStatusPills();
    if (state.view === 'wizard') renderWizard();
    renderWorkshop();
    renderPlayerFacingText();
    syncOpeningFocusButton();
  }

  root.addEventListener('input', event => {
    if (state.previewMode && !event.target.matches('[data-xy-workshop-search],[data-xy-identity-media-filter]')) return;
    if (event.target.matches('[data-xy-opening-story-body]')) {
      saveOpeningDayBody(event.target.value);
      renderOpeningDayEditor(readDraft());
      return;
    }
    if (event.target.matches('[data-xy-identity-media-filter]')) { renderIdentityMediaPicker(); return; }
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
  }, openingListenerOptions);

  root.addEventListener('change', event => {
    if (state.previewMode) return;
    if (event.target.matches('[data-xy-grade-preset]')) {
      const input = root.querySelector('[data-xy-opening-field="player_grade"]');
      const value = event.target.value || '';
      if (value === '__custom__') { input?.focus?.(); return; }
      if (input) input.value = value;
      saveDraft({ player_grade:normalizeGrade(value) });
      renderWizard({ collect:false });
      return;
    }
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
      const isZip = /\.zip$/i.test(String(file.name || '')) || String(file.type || '') === 'application/zip';
      if (isZip) file.arrayBuffer().then(buffer => previewLocalPackageArchive(buffer)).catch(error => toast('error', error.message || String(error)));
      else file.text().then(text => previewLocalPackage(text)).catch(error => toast('error', error.message || String(error)));
    }
  }, openingListenerOptions);

  root.addEventListener('scroll', () => scheduleOpeningScrollSave(), openingAbort
    ? { capture: true, passive: true, signal: openingAbort.signal }
    : { capture: true, passive: true });

  function openingActionPendingKey(button, action = button?.dataset?.xyOpeningAction || '') {
    return action + ':' + String(button?.dataset?.id || button?.dataset?.type || button?.dataset?.field || 'global');
  }
  function syncOpeningPendingButtons(pendingKey, pending) {
    const busyLabels = {
      'refresh-workshop':'刷新中…', 'publish-current-package':'发布中…', 'publish-character-package':'发布中…',
      'publish-identity-template':'发布中…', 'vote-package':'投票中…', 'download-package':'加入中…',
      'show-package-detail':'读取中…', 'withdraw-package':'撤回中…', 'install-selected-package':'安装中…',
      'uninstall-selected-package':'卸载中…', 'apply-selected-opening-package':'应用中…',
      'import-avatar-local':'导入中…', 'use-avatar-url':'导入中…', 'import-char-media':'导入中…', 'start-recall':'处理中…',
      'export-character-package':'导出中…', 'avatar-manager-add':'导入中…', 'avatar-manager-import':'导入中…',
    };
    root.querySelectorAll('[data-xy-opening-action]').forEach(candidate => {
      if (openingActionPendingKey(candidate) !== pendingKey) return;
      if (pending) {
        if (!candidate.dataset.xyPendingLabel) candidate.dataset.xyPendingLabel = candidate.textContent || '';
        candidate.textContent = busyLabels[candidate.dataset.xyOpeningAction] || '处理中…';
        candidate.disabled = true; candidate.setAttribute('aria-busy','true');
      } else {
        candidate.disabled = false; candidate.removeAttribute('aria-busy');
        if (candidate.dataset.xyPendingLabel) { candidate.textContent = candidate.dataset.xyPendingLabel; delete candidate.dataset.xyPendingLabel; }
      }
    });
  }

  root.addEventListener('click', async event => {
    const choice = event.target.closest('.xy-choice');
    if (choice && root.contains(choice)) {
      if (state.previewMode) { toast('info', '预览模式不保存选项修改'); return; }
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
    openingModalTrigger = button;
    const ASYNC_OPENING_ACTIONS = new Set(['refresh-workshop','publish-current-package','publish-character-package','publish-identity-template','vote-package','download-package','show-package-detail','withdraw-package','install-selected-package','uninstall-selected-package','apply-selected-opening-package','import-avatar-local','use-avatar-url','import-char-media','start-recall','export-character-package','avatar-manager-add','avatar-manager-import']);
    const pendingKey = openingActionPendingKey(button, action);
    let ownsPending = false;
    if (ASYNC_OPENING_ACTIONS.has(action)) {
      if (state.pendingActions.has(pendingKey)) return;
      state.pendingActions.add(pendingKey); ownsPending = true;
      syncOpeningPendingButtons(pendingKey, true);
    }

    try {
      if (state.previewMode && !PREVIEW_ALLOWED_ACTIONS.has(action)) throw new Error('预览模式不执行写入');
      if (action === 'toggle-focus-mode') {
        if (openingFocusActive() && state.view === 'workshop') {
          setView(state.returnView || 'boot');
          state.workshopFocusOwned = false;
          if (openingFocusActive()) exitOpeningFocusMode();
        }
        else if (openingFocusActive()) exitOpeningFocusMode();
        else enterOpeningFocusMode();
      }
      if (action === 'import-current-persona') openPersonaImportDialog();
      if (action === 'sync-current-persona') await syncCurrentDraftToPersona();
      if (action === 'persona-import-replace') applyPendingPersonaImport('replace');
      if (action === 'persona-import-fill') applyPendingPersonaImport('fill-empty');
      if (action === 'persona-import-cancel') applyPendingPersonaImport('cancel');
      if (action === 'identity-write-retry') settleIdentityPersistenceDecision('retry');
      if (action === 'identity-write-continue') settleIdentityPersistenceDecision('continue-once');
      if (action === 'identity-write-cancel') settleIdentityPersistenceDecision('cancel');
      if (action === 'check-deps') runDependencyChecks();
      if (action === 'enter-entry') {
        if (!setAgreementState()) throw new Error('请先勾选协议确认');
        setView('wizard');
        setStep(1);
      }
      if (action === 'enter-preview') {
        if (hostWindow()?.XY_DEV_OPENING_PREVIEW !== true) throw new Error('正式页面未启用开发预览');
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
        const previousView = state.view || 'boot';
        const hasWorkshopView = !!root.querySelector('[data-xy-view="workshop"]')
          && !!root.querySelector('[data-xy-workshop-tabs]')
          && !!root.querySelector('[data-xy-workshop-grid]')
          && !!root.querySelector('[data-xy-workshop-status]');
        if (!hasWorkshopView) { toast('warn', '创意工坊界面暂未挂载，请继续使用本地 JSON。'); return; }
        state.returnView = state.view === 'wizard' ? 'wizard' : 'boot';
        if (button.dataset.xyWorkshopTab) state.workshopTab = button.dataset.xyWorkshopTab;
        try { setView('workshop'); } catch (viewError) { try { setView(previousView); } catch (_) {} throw viewError; }
        if (!controlCenter()?.refreshWorkshop) {
          state.workshopCatalog = [];
          state.myPackages = [];
          state.workshopLoading = false;
          state.lastWorkshopError = '在线创意工坊暂未开放，可继续使用本地 JSON';
          renderWorkshop();
          toast('info', '在线创意工坊暂未开放；本地 JSON 仍可使用。');
          return;
        }
        refreshWorkshop().catch(error => toast('error', error.message || String(error)));
      }
      if (action === 'login-discord') {
        if (state.workshopAuth && state.workshopAuth.loggedIn) {
          Promise.resolve(controlCenter()?.logout?.()).finally(() => refreshWorkshopAuth().catch(() => updateWorkshopStatusPills()));
        } else {
          loginDiscord();
          // OAuth 成功优先走 postMessage；若 opener 被 Discord 跨源隔离切断，则由一次性交接轮询刷新。
        }
      }
      if (action === 'cancel-discord-login') {
        controlCenter()?.cancelWorkshopLogin?.();
        state.workshopLoginStatus = 'cancelled';
        updateWorkshopStatusPills();
        renderWorkshop();
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
      if (action === 'export-opening-package') {
        if (!state.previewMode) captureOpeningDayField({ immediate:true });
        const pkg = openingDraftAsPackage();
        downloadJson(pkg.id + '.json', pkg);
        toast('success', '已导出开局正文模板包');
      }
      if (action === 'prepare-opening-package') {
        if (!state.previewMode) captureOpeningDayField({ immediate:true });
        const pkg = openingDraftAsPackage();
        state.selectedPackage = pkg;
        state.publishSelection = clone(pkg);
        state.selectedAllowedTypes = ['world_factor'];
        state.returnView = state.view === 'wizard' ? 'wizard' : 'boot';
        state.workshopTab = 'mine';
        setView('workshop');
        const titleInput = root.querySelector('[data-xy-publish-title]');
        const summaryInput = root.querySelector('[data-xy-publish-summary]');
        if (titleInput) titleInput.value = pkg.title;
        if (summaryInput) summaryInput.value = pkg.summary;
        renderWorkshop();
        toast('info', '已生成规范 JSON；请核对标题、摘要与详情后发布');
      }
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
        const mediaValues = [pkg.payload?.media?.avatar, pkg.payload?.media?.portrait].filter(Boolean);
        const localMedia = mediaValues.filter(value => !/^https?:\/\//i.test(String(value)));
        if (localMedia.length) {
          const keep = confirm('身份模板包含本地媒体库 key，其他玩家可能无法显示。\n\n确定：保留媒体并发布\n取消：进入“移除媒体后发布 / 取消”');
          if (!keep) {
            const portablePayload = clone(pkg.payload);
            portablePayload.media = { avatar:'', portrait:'' };
            if (!userIdentityPayloadHasContent(portablePayload)) throw new Error('该身份模板只有媒体内容，不能移除后发布；请先补充至少一项文字或非零属性');
            if (!confirm('是否移除头像与立绘引用后继续发布？取消将终止发布。')) return;
            pkg.payload = portablePayload;
          }
        }
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
          characterEditorBaseline = characterEditorSnapshot(modal);
        }
      }
      if (action === 'close-character-editor') {
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        if (modal && characterEditorSnapshot(modal) !== characterEditorBaseline && !hostWindow().confirm?.('角色表单有未保存修改。确认放弃并关闭？')) return;
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
        void refreshPackageInspections();
        toast('success', '已保存并启用角色：' + pkg.title);
        const modal = root.querySelector('[data-xy-character-editor-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'export-character-package') {
        collectCharacterFields();
        const pkg = buildCharacterPackage();
        if (!pkg) throw new Error('请先填写角色名称');
        const cc = controlCenter();
        if (cc?.exportCharacterPackageArchive) {
          const exported = await cc.exportCharacterPackageArchive(pkg);
          if (exported.kind === 'zip') toast('success', '角色包已导出压缩包（含 ' + exported.mediaCount + ' 个媒体文件），可直接在其他设备导入');
          else { downloadJson(pkg.id + '.json', exported.package || pkg); toast('success', '已导出角色范本 JSON'); }
        } else {
          downloadJson(pkg.id + '.json', pkg);
          toast('success', '已导出角色范本 JSON');
        }
      }
      if (action === 'publish-character-package') {
        collectCharacterFields();
        const cc = controlCenter();
        if (!cc?.publishPackage) throw new Error('控制中心发布 API 未就绪');
        const pkg = buildCharacterPackage();
        if (!pkg) throw new Error('请先填写角色名称');
        const progress = root.querySelector('[data-xy-charpub-progress]');
        const progressBar = progress?.querySelector('[data-xy-charpub-progress-bar]');
        const progressText = progress?.querySelector('[data-xy-charpub-progress-text]');
        const setProgress = info => {
          if (!progress) return;
          progress.hidden = false;
          if (info.phase === 'register') {
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = '媒体已上传，正在登记角色包…';
            return;
          }
          const percent = info.total > 0 ? Math.min(100, Math.round(info.loaded / info.total * 100)) : 0;
          if (progressBar) progressBar.style.width = percent + '%';
          if (progressText) progressText.textContent = '上传中 ' + percent + '%（' + Math.round(info.loaded / 1024) + 'KB / ' + Math.round(info.total / 1024) + 'KB）';
        };
        try {
          await cc.publishPackage(pkg, { onProgress: setProgress });
          toast('success', '角色 JSON、头像与双版立绘已上传并上架，工坊列表即刻可见');
          const modal = root.querySelector('[data-xy-character-editor-modal]');
          if (modal) modal.hidden = true;
        } finally {
          if (progress) {
            progress.hidden = true;
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = '';
          }
        }
      }
      if (action === 'open-avatar-manager') {
        const modal = root.querySelector('[data-xy-avatar-manager-modal]');
        if (modal) { modal.hidden = false; renderAvatarManager(); }
      }
      if (action === 'close-avatar-manager') {
        const modal = root.querySelector('[data-xy-avatar-manager-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'avatar-manager-add' || action === 'avatar-manager-import') {
        const input = root.querySelector('[data-xy-avatar-manager-name]');
        const name = action === 'avatar-manager-add' ? String(input?.value || '').trim() : String(button.dataset.name || '').trim();
        if (!name) throw new Error('请先输入角色名（要与气泡显示名完全一致）');
        const lib = mediaLibrary();
        if (!lib?.requestLocalImport) throw new Error('媒体库导入 API 未就绪');
        const actionContext = captureOpeningActionContext(root);
        const item = await lib.requestLocalImport({ type: 'bond', name, slot: 'avatar', variant: 'normal' });
        assertOpeningActionContext(actionContext);
        if (item && item.key) {
          if (action === 'avatar-manager-add' && input) input.value = '';
          refreshDialogBubblesAfterAvatarChange();
          renderAvatarManager();
          toast('success', '已给「' + name + '」绑定气泡头像，聊天中立即生效');
        }
      }
      if (action === 'avatar-manager-clear') {
        const name = String(button.dataset.name || '').trim();
        if (!name) throw new Error('缺少角色名');
        const lib = mediaLibrary();
        lib?.removeAsset?.({ type: 'bond', name, slot: 'avatar', variant: 'normal' });
        refreshDialogBubblesAfterAvatarChange();
        renderAvatarManager();
        toast('success', '已清除「' + name + '」的气泡头像');
      }
      if (action === 'import-char-media') {
        const lib = mediaLibrary();
        if (!lib?.requestLocalImport) throw new Error('媒体库导入 API 未就绪');
        collectCharacterFields();
        const name = textOf(readCharacterDraft().name, '') || '角色';
        const field = button.dataset.field;
        const actionContext = captureOpeningActionContext(root);
        const item = await lib.requestLocalImport({ type: 'bond', name, slot: button.dataset.slot || 'avatar', variant: button.dataset.variant || 'normal' });
        assertOpeningActionContext(actionContext);
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
        if (modal && worldFactorEditorDirty(modal) && !hostWindow().confirm?.('世界因子表单有未添加内容。确认放弃并关闭？')) return;
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
        const actionContext = captureOpeningActionContext(root);
        const detail = await getPackageDetailFromCatalog(id, type);
        assertOpeningActionContext(actionContext);
        importPackageToDraft(detail);
        void refreshPackageInspections();
        renderEnableLists();
        toast('success', '已加入当前开局：' + (detail.title || id) + '；前往“' + packageDestinationLabel(detail.type) + '”查看');
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
        const detailGeneration = ++state.packageDetailGeneration;
        const actionContext = captureOpeningActionContext(root);
        const detail = await getPackageDetailFromCatalog(button.dataset.id, button.dataset.type);
        assertOpeningActionContext(actionContext);
        if (detailGeneration !== state.packageDetailGeneration) return;
        state.selectedPackage = detail;
        state.selectedAllowedTypes = activeTab().types;
        renderPackageDetail(detail, impactPreview(detail));
      }
      if (action === 'select-publish-package') {
        const item = state.myPackages.find(pkg => String(pkg.id) === String(button.dataset.id) && String(pkg.type || '') === String(button.dataset.type || ''));
        if (!item) throw new Error('待更新的发布对象已失效，请刷新后重新选择');
        state.publishSelection = clone(item);
        const title = root.querySelector('[data-xy-publish-title]');
        const summary = root.querySelector('[data-xy-publish-summary]');
        const rating = root.querySelector('[data-xy-publish-rating]');
        if (title) title.value = item.title || '';
        if (summary) summary.value = item.summary || '';
        if (rating) rating.value = item.rating || 'general';
        renderWorkshop();
      }
      if (action === 'copy-package-draft') {
        const actionContext = captureOpeningActionContext(root);
        const detail = await getPackageDetailFromCatalog(button.dataset.id, button.dataset.type);
        assertOpeningActionContext(actionContext);
        await importPackageObject(detail, [detail.type]);
      }
      if (action === 'withdraw-package') {
        const cc = controlCenter();
        if (!cc?.withdrawPackage) throw new Error('控制中心撤回 API 未就绪');
        if (!confirm('确认撤回这个工坊包？撤回只会影响云端发布，不会删除本地草稿。')) return;
        await cc.withdrawPackage(button.dataset.id, button.dataset.revision || undefined);
        state.publishSelection = null;
        toast('success', '已提交撤回');
        await refreshWorkshop();
      }
      if (action === 'close-package-detail') {
        state.packageDetailGeneration += 1;
        state.packageDetailInspectionGeneration += 1;
        root.querySelector('[data-xy-package-modal]').hidden = true;
      }
      if (action === 'import-selected-package') {
        if (!state.selectedPackage) throw new Error('未选择工坊包');
        await importPackageObject(state.selectedPackage, state.selectedAllowedTypes);
        root.querySelector('[data-xy-package-modal]').hidden = true;
      }
      if (action === 'install-selected-package') {
        if (!state.selectedPackage) throw new Error('未选择工坊包');
        await installPackageObjectWithDecision(state.selectedPackage, state.selectedAllowedTypes);
        await refreshPackageInspections();
        root.querySelector('[data-xy-package-modal]').hidden = true;
      }
      if (action === 'apply-selected-opening-package') {
        if (!state.selectedPackage) throw new Error('未选择工坊包');
        const cc = controlCenter();
        const plan = await cc.previewApplyOpeningPackage(state.selectedPackage);
        const diff = openingStoryDiffText(plan.nextBody, plan.currentBody);
        if (!confirm('应用到本局只会替换当前聊天草稿，不写 MVU、不改消息、不自动发送。\n\n' + diff + '\n\n确认应用？')) return;
        await cc.applyOpeningPackageToDraft(plan);
        applyDraftToFields();
        renderWizard({ collect:false });
        root.querySelector('[data-xy-package-modal]').hidden = true;
        toast('success', '已把正文模板应用到当前聊天草稿');
      }
      if (action === 'uninstall-selected-package') {
        if (!state.selectedPackage) throw new Error('未选择工坊包');
        if (!confirm('只卸载这个包的本地来源记录；当前聊天正文、其他包、身份与世界因子都会保留。确认？')) return;
        await controlCenter().uninstallWorkshopPackage(state.selectedPackage);
        await refreshPackageInspections();
        root.querySelector('[data-xy-package-modal]').hidden = true;
        renderWizard({ collect:false });
        toast('success', '已卸载本地来源；当前正文已保留并脱离来源');
      }
      if (action === 'open-avatar-modal' || action === 'open-identity-media') {
        state.identityMediaSlot = button.dataset.slot === 'portrait' ? 'portrait' : 'avatar';
        const modal = root.querySelector('[data-xy-identity-media-modal]');
        if (modal) { modal.hidden = false; renderIdentityMediaPicker(); }
      }
      if (action === 'close-avatar-modal' || action === 'close-identity-media') {
        const modal = root.querySelector('[data-xy-identity-media-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'select-identity-media' || action === 'use-avatar-key') {
        const key = button.dataset.key || root.querySelector('[data-xy-avatar-key]')?.value?.trim();
        selectIdentityMediaReference(state.identityMediaSlot, key);
        const modal = root.querySelector('[data-xy-identity-media-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'clear-avatar' || action === 'clear-identity-media') {
        clearIdentityMediaReference(state.identityMediaSlot);
        const modal = root.querySelector('[data-xy-identity-media-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'use-avatar-url' || action === 'use-identity-media-url') {
        const url = root.querySelector('[data-xy-identity-media-url]')?.value?.trim();
        await importIdentityMediaUrl(state.identityMediaSlot, url);
        const modal = root.querySelector('[data-xy-identity-media-modal]');
        if (modal) modal.hidden = true;
      }
      if (action === 'import-avatar-local' || action === 'import-identity-media-local') {
        const localKey = await importIdentityMediaLocal(state.identityMediaSlot);
        if (localKey) {
          const modal = root.querySelector('[data-xy-identity-media-modal]');
          if (modal) modal.hidden = true;
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
        downloadJson('xingyue-opening-draft-v3.4.7.json', readDraft());
      }
      if (action === 'use-grade-compatible-story') {
        if (!confirm('确认将当前正文替换为通用到访模板？这是显式操作，切换年级本身不会改动正文。')) return;
        const draft = normalizeDraft(readDraft());
        draft.openingDay = normalizeOpeningDayDraft({
          ...draft.openingDay,
          body:GENERIC_ARRIVAL_BODY,
          gradeScope:['all'],
          origin:'user',
          localModifiedAt:new Date().toISOString(),
        });
        writeDraft(draft, { immediate:true });
        applyDraftToFields();
        renderWizard({ collect:false });
        toast('success', '已套用通用到访模板');
      }
      if (action === 'restore-opening-source') {
        const currentDraft = normalizeDraft(readDraft());
        const source = currentDraft.openingDay?.sourcePackage;
        if (source) {
          const pkg = packages().find(item => String(item.id) === String(source.id) && item.cardScope === OPENING_PACKAGE_SCOPE);
          if (!pkg) throw new Error('当前来源模板不在本聊天缓存中，请从工坊详情重新下载后再恢复');
          const plan = await controlCenter().previewApplyOpeningPackage(pkg);
          const diff = openingStoryDiffText(plan.nextBody, plan.currentBody);
          if (!confirm('恢复已安装来源只会替换当前聊天草稿。\n\n' + diff + '\n\n确认恢复？')) return;
          await controlCenter().applyOpeningPackageToDraft(plan);
        } else {
          if (!confirm('当前正文没有工坊来源。确认恢复 3.4.7 官方出厂版？')) return;
          restoreOfficialOpeningDay();
        }
        applyDraftToFields();
        renderWizard({ collect:false });
        toast('success', '已恢复当前来源正文');
      }
      if (action === 'restore-opening-official') {
        if (!confirm('确认恢复 3.4.7 出厂正文？当前聊天里的正文修改将被替换。')) return;
        restoreOfficialOpeningDay();
        applyDraftToFields();
        renderWizard();
        toast('success', '已恢复 3.4.7 出厂正文');
      }
      if (action === 'clear-opening-draft' && confirm('确认清空当前开局草稿？')) {
        openingDraftService.clearDraft();
        applyDraftToFields();
        render();
      }
      if (action === 'preview-world-factors') {
        render();
        const fold = root.querySelector('[data-xy-write-preview-fold]');
        if (fold) fold.open = true;
      }
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
        collectFields();
        const draft = captureOpeningDayField({ immediate: true });
        const compatibility = openingStoryCompatibility(draft);
        if (!compatibility.compatible) throw new Error(compatibility.message);
        validateOpeningStory(draft.openingDay?.body, { grade:compatibility.grade.value });
        if (!confirm('开始回忆：将把「入学日正文 + 身份设定」填入聊天输入框并自动发送，形成你的开局发言（AI 据此撰写正文并初始化开局变量）。确定？')) return;
        const sendContext = openingChatContextSnapshot();
        // 身份常驻失败时默认停止；只有当前聊天内显式选择“仅本次继续”才允许进入发送链。
        const identityWrite = await persistIdentityBeforeSend(draft, sendContext);
        const wbResult = identityWrite.result;
        if (wbResult?.applied) { const rn = root.querySelector('[data-xy-opening-result]'); if (rn) rn.textContent = '身份设定已写入世界书：' + (wbResult.worldbookName || '卡绑定世界书'); }
        if (identityWrite.continuedWithoutPersistence) toast('warn', '本次继续发送，但身份没有写入世界书，不会在后续轮次常驻');
        try {
          if (runtimeDestroyed || root.isConnected === false) throw new Error('开局页已卸载，请重新打开后再操作');
          assertOpeningChatContext(sendContext);
          // 世界书写入结束后、进入真实玩家输入框前最后一次读取当前聊天草稿与 Persona；预览和发送共用唯一组装器。
          const promptText = composeOpeningMessage(readOpeningDraft());
          const hdoc = hostDocument();
          const ta = hdoc.querySelector('#send_textarea');
          const btn = hdoc.querySelector('#send_but');
          if (!ta || !btn) throw new Error('未找到 ST 聊天输入框(#send_textarea)或发送按钮(#send_but)');
          ta.value = promptText;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          try {
            openingAbort?.signal?.addEventListener('abort', () => {
              try { if (ta.value === promptText) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); } } catch (_) {}
            }, { once: true });
          } catch (_) {}
          const resultNode = root.querySelector('[data-xy-opening-result]');
          if (resultNode) resultNode.textContent = '已将「入学日正文 + 身份设定」填入输入框并发送，等待 AI 生成开局正文…';
          scheduleOpeningTimer(() => {
            try {
              assertOpeningChatContext(sendContext);
              if (root.isConnected === false || hostDocument().querySelector('#send_textarea') !== ta) throw new Error('聊天或输入框已切换');
              if (ta.value !== promptText) throw new Error('聊天输入框内容已被修改');
            } catch (contextError) {
              try { if (ta.value === promptText) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); } } catch (_) {}
              toast('warn', (contextError?.message || String(contextError)) + '，未自动发送，请在当前聊天重新操作。');
              return;
            }
            try { btn.click(); toast('success', '开局发言已发送，等待 AI 生成正文…'); }
            catch (e) { toast('error', '点击发送失败：' + (e && e.message || e) + '（文本已保留，可手动按一次发送）'); }
          }, 60);
        } catch (error) { toast('error', '开始回忆失败：' + (error.message || String(error))); }
      }
    } catch (error) {
      toast('error', error.message || String(error));
      if (ownsPending) state.lastWorkshopError = error.message || String(error);
    } finally {
      if (ownsPending) {
        state.pendingActions.delete(pendingKey);
        syncOpeningPendingButtons(pendingKey, false);
        try { renderWorkshop(); } catch (_) {}
      }
    }
  }, openingListenerOptions);

  runDependencyChecks();
  scheduleDependencyAutoRefresh();
  refreshOpeningContext();
  void refreshPackageInspections();
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
    (hostWindow() || window).addEventListener('crossed-zone-media-library-updated', applyOpeningCover, openingListenerOptions);
  } catch (_e) {}
  // 向导绑定就绪：移除 boot 载入遮罩。原淡出逻辑写在 first_message_opening.html 的楼层内联 <script>，
  // 而 ST 渲染消息楼层不执行该 script，导致遮罩永不消失、盖住整个封面（依赖项看不见、永远停在「载入中」）。
  try {
    const xyLoader = root.querySelector('[data-xy-loading]');
    if (xyLoader) { xyLoader.classList.add('done'); scheduleOpeningTimer(() => { try { xyLoader.remove(); } catch (_e) {} }, 650); }
  } catch (_e) {}
    return true;
  }
  // #1/#2(2.9.8) 核心修复：开局页不再塞进 first_mes（252KB→既发给 LLM 致上下文爆炸、又卡顿）。
  // first_mes 仅放 [data-xy-opening-remote] 短标记；控制中心 fetch 远程开局页 + 注入 + 绑定（display-only，绝不进 LLM）。
  // 整页由控制中心注入(全 bare 类) → custom- 前缀问题一并消失。fetch 失败有兜底提示、不 brick。
  // 任务2.2：opening-page 双源（cdn + testingcf 备源），与 loader 策略对称
  const OPENING_PAGE_REVISION = '20260713-347-stability-r38';
  const OPENING_PAGE_SHA256 = '9df2f9820b1580641d0bcbe21c2d62e2ccd79570789f74d6c487838ac684fd78';
  const OPENING_PAGE_SOURCES = [
    RUNTIME_BASE_URL + '/opening-page.html?v=' + OPENING_PAGE_REVISION,
    'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.4.7/opening-page.html?v=' + OPENING_PAGE_REVISION,
    'https://raw.githubusercontent.com/LiarMTTT/rolecard-diy-workshop/main/runtime/xingyue/3.4.7/opening-page.html?v=' + OPENING_PAGE_REVISION,
  ];
  const OPENING_PAGE_SOURCE_TIMEOUT_MS = 6500;
  const openingRemoteAttempts = new Map();
  const openingRemoteRetryBindings = new Map();
  function markOpeningRemoteIdle(mount) {
    try {
      mount.setAttribute('data-xy-remote-state', 'idle');
      mount.removeAttribute('data-xy-remote-owner');
      mount.removeAttribute('aria-busy');
    } catch (_) {}
  }
  function isOpeningRemoteOwnedByCurrentRuntime(mount) {
    try { return mount.getAttribute('data-xy-remote-owner') === runtimeOwner.id; } catch (_) { return false; }
  }
  function prepareOpeningRemoteFallback(mount) {
    try {
      mount.style.minHeight = 'min(720px, max(420px, calc(100dvh - 150px)))';
      mount.style.display = 'grid';
      mount.style.placeItems = 'center';
      mount.style.boxSizing = 'border-box';
      mount.style.width = '100%';
    } catch (_) {}
  }
  function releaseOpeningRemoteFallback(mount) {
    try {
      mount.removeAttribute('style');
    } catch (_) {}
  }
  function ensureOpeningRemoteShell(mount) {
    let shell = mount.querySelector?.('[data-xy-opening-shell]') || null;
    if (shell) {
      try { if (!mount.__xyOpeningShellTemplate) mount.__xyOpeningShellTemplate = mount.innerHTML; } catch (_) {}
      return shell;
    }
    try {
      if (mount.__xyOpeningShellTemplate) mount.innerHTML = mount.__xyOpeningShellTemplate;
      shell = mount.querySelector?.('[data-xy-opening-shell]') || null;
      if (shell) return shell;
      const doc = mount.ownerDocument || document;
      shell = doc.createElement('div');
      shell.setAttribute('data-xy-opening-shell', '');
      shell.style.cssText = 'width:min(620px,100%);display:grid;gap:16px;place-items:center;padding:28px 18px;box-sizing:border-box';
      shell.innerHTML = '<div data-xy-opening-spinner aria-hidden="true" style="width:48px;height:48px;box-sizing:border-box;border-radius:50%;border:3px solid rgba(224,178,123,.25);border-top-color:#efc785"></div>' +
        '<div data-xy-opening-title style="font-size:22px;color:#efc785;letter-spacing:2px;font-weight:700">星月私立高等学院</div>' +
        '<div data-xy-opening-status data-xy-opening-loading role="status" aria-live="polite" style="font-size:13px;line-height:1.85;color:#e8d8c6"></div>' +
        '<div data-xy-opening-progress aria-hidden="true" style="width:min(360px,88%);height:4px;border-radius:999px;background:rgba(224,178,123,.14)"></div>' +
        '<button type="button" data-xy-opening-retry hidden style="min-width:148px;min-height:44px;padding:10px 22px">重新加载开局页</button>';
      mount.replaceChildren(shell);
      mount.__xyOpeningShellTemplate = mount.innerHTML;
      return shell;
    } catch (_) { return null; }
  }
  function renderOpeningRemotePhase(mount, phase, message) {
    const shell = ensureOpeningRemoteShell(mount);
    prepareOpeningRemoteFallback(mount);
    try {
      mount.setAttribute('data-xy-opening-phase', phase);
      mount.setAttribute('aria-busy', phase === 'loading' ? 'true' : 'false');
      const statusNode = shell?.querySelector?.('[data-xy-opening-status]');
      const retry = shell?.querySelector?.('[data-xy-opening-retry]');
      if (statusNode) statusNode.innerHTML = message;
      if (retry) {
        retry.hidden = phase !== 'error';
        retry.disabled = phase === 'loading';
      }
    } catch (_) {}
  }
  function bindOpeningRemoteRetry(mount) {
    const existing = mount.__xyOpeningRemoteRetryBinding;
    if (existing?.owner === runtimeOwner.id) return;
    try { if (existing?.handler) mount.removeEventListener('click', existing.handler); } catch (_) {}
    const handler = event => {
      const retry = event.target?.closest?.('[data-xy-opening-retry]');
      if (!retry || !mount.contains(retry) || runtimeDestroyed) return;
      event.preventDefault();
      startOpeningRemoteLoad(mount, { force: true });
    };
    try {
      mount.addEventListener('click', handler);
      const binding = { owner: runtimeOwner.id, handler };
      mount.__xyOpeningRemoteRetryBinding = binding;
      openingRemoteRetryBindings.set(mount, binding);
    } catch (_) {}
  }
  function clearOpeningAttemptTimeout(attempt) {
    if (!attempt?.timeout) return;
    try { clearTimeout(attempt.timeout); } catch (_) {}
    openingTimers.delete(attempt.timeout);
    attempt.timeout = null;
  }
  function cleanupOpeningAttemptSource(attempt, controller) {
    clearOpeningAttemptTimeout(attempt);
    if (controller) openingFetchControllers.delete(controller);
    if (attempt?.controller === controller) attempt.controller = null;
  }
  function abortOpeningRemoteAttempt(mount, resetState = false) {
    const attempt = openingRemoteAttempts.get(mount);
    if (!attempt) return;
    clearOpeningAttemptTimeout(attempt);
    try { attempt.controller?.abort?.(); } catch (_) {}
    if (attempt.controller) openingFetchControllers.delete(attempt.controller);
    attempt.controller = null;
    attempt.sourceToken = null;
    if (openingRemoteAttempts.get(mount) === attempt) openingRemoteAttempts.delete(mount);
    if (resetState && mount.getAttribute?.('data-xy-remote-owner') === attempt.owner) markOpeningRemoteIdle(mount);
  }
  function isOpeningAttemptCurrent(mount, attempt, sourceToken) {
    if (!mount || !attempt || runtimeDestroyed || mount.isConnected === false) return false;
    if (openingRemoteAttempts.get(mount) !== attempt) return false;
    if (mount.getAttribute?.('data-xy-remote-owner') !== attempt.owner) return false;
    if (mount.getAttribute?.('data-xy-remote-state') !== 'loading') return false;
    return sourceToken === undefined || attempt.sourceToken === sourceToken;
  }
  function clearOpeningRemoteLoadingStates() {
    const docs = [];
    try { docs.push(document); } catch (_) {}
    try { const hostDoc = hostDocument(); if (hostDoc && !docs.includes(hostDoc)) docs.push(hostDoc); } catch (_) {}
    docs.forEach(doc => {
      try {
        doc.querySelectorAll?.('[data-xy-opening-remote][data-xy-remote-state="loading"]').forEach(mount => {
          if (isOpeningRemoteOwnedByCurrentRuntime(mount)) {
            markOpeningRemoteIdle(mount);
            renderOpeningRemotePhase(mount, 'loading', '开局界面等待重新载入…<br>正在接管新的运行实例。');
          }
        });
      } catch (_) {}
    });
  }
  function safeOpeningUrl(value) {
    const url = String(value || '').trim();
    if (!url || url[0] === '#' || url[0] === '/') return true;
    return /^(?:https?:|blob:|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(url);
  }
  function sha256HexFallback(value, Encoder) {
    let bytes;
    if (Encoder) bytes = new Encoder().encode(String(value));
    else {
      const encoded = unescape(encodeURIComponent(String(value)));
      bytes = Uint8Array.from(encoded, char => char.charCodeAt(0));
    }
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const constants = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const words = new Uint32Array(64);
    const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i += 1) {
        const a = words[i - 15];
        const b = words[i - 2];
        const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
        const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let i = 0; i < 64; i += 1) {
        const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choose + constants[i] + words[i]) >>> 0;
        const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      state[0] = (state[0] + a) >>> 0;
      state[1] = (state[1] + b) >>> 0;
      state[2] = (state[2] + c) >>> 0;
      state[3] = (state[3] + d) >>> 0;
      state[4] = (state[4] + e) >>> 0;
      state[5] = (state[5] + f) >>> 0;
      state[6] = (state[6] + g) >>> 0;
      state[7] = (state[7] + h) >>> 0;
    }
    return state.map(word => word.toString(16).padStart(8, '0')).join('');
  }
  async function verifyOpeningPageHtml(html, doc) {
    const view = doc?.defaultView || window;
    const subtle = view?.crypto?.subtle || window.crypto?.subtle;
    const Encoder = view?.TextEncoder || window.TextEncoder;
    const canonical = String(html || '').replace(/\r\n?/g, '\n');
    let actual;
    if (subtle && Encoder) {
      const digest = await subtle.digest('SHA-256', new Encoder().encode(canonical));
      actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      actual = sha256HexFallback(canonical, Encoder);
    }
    if (actual !== OPENING_PAGE_SHA256) throw new Error('远程开局页完整性校验失败');
  }
  function sanitizeOpeningPageHtml(html, doc) {
    const Parser = doc?.defaultView?.DOMParser || window.DOMParser;
    if (!Parser) throw new Error('DOMParser 不可用');
    const parsed = new Parser().parseFromString(String(html || ''), 'text/html');
    const root = parsed.querySelector('[data-xy-opening-page="3.4.7"]');
    if (!root
      || !root.querySelector('[data-xy-opening-action="enter-entry"]')
      || !root.querySelector('[data-xy-view="boot"]')
      || !root.querySelector('[data-xy-view="wizard"]')) {
      throw new Error('远程开局页结构或版本不匹配');
    }
    parsed.querySelectorAll('script,iframe,object,embed,base,link,meta,form').forEach(node => node.remove());
    parsed.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes || []).forEach(attr => {
        const name = String(attr.name || '').toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          return;
        }
        if (['href', 'src', 'xlink:href', 'action', 'formaction', 'poster'].includes(name) && !safeOpeningUrl(value)) {
          node.removeAttribute(attr.name);
          return;
        }
        if (name === 'style' && /(?:javascript\s*:|expression\s*\(|url\s*\(\s*["']?\s*(?!https?:|blob:|data:image\/|\/|#))/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      });
    });
    parsed.querySelectorAll('style').forEach(style => {
      style.textContent = String(style.textContent || '')
        .replace(/@import[\s\S]*?;/gi, '')
        .replace(/url\s*\(\s*(["']?)\s*javascript:[\s\S]*?\1\s*\)/gi, 'none');
    });
    return root.outerHTML;
  }
  function failOpeningRemoteAttempt(mount, attempt, error) {
    if (!isOpeningAttemptCurrent(mount, attempt)) return;
    attempt.lastError = error?.message || String(error || 'unknown');
    clearOpeningAttemptTimeout(attempt);
    try { attempt.controller?.abort?.(); } catch (_) {}
    if (attempt.controller) openingFetchControllers.delete(attempt.controller);
    attempt.controller = null;
    attempt.sourceToken = null;
    openingRemoteAttempts.delete(mount);
    markOpeningRemoteIdle(mount);
    renderOpeningRemotePhase(mount, 'error', '开局界面加载失败。<br>三个安全来源均未能返回通过校验的页面。请检查网络，恢复后点击下方按钮重试。');
  }
  async function tryOpeningRemoteSource(doc, mount, attempt, sourceIndex) {
    if (!isOpeningAttemptCurrent(mount, attempt)) return;
    if (sourceIndex >= OPENING_PAGE_SOURCES.length) {
      failOpeningRemoteAttempt(mount, attempt, attempt.lastError || new Error('所有开局页来源均不可达'));
      return;
    }
    const sourceToken = {};
    attempt.sourceToken = sourceToken;
    attempt.sourceIndex = sourceIndex;
    const AbortCtor = doc.defaultView?.AbortController || window.AbortController;
    const controller = AbortCtor ? new AbortCtor() : null;
    attempt.controller = controller;
    if (controller) openingFetchControllers.add(controller);
    const url = OPENING_PAGE_SOURCES[sourceIndex];
    let sourceTimedOut = false;
    let rejectTimeout = null;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    attempt.timeout = setTimeout(() => {
      openingTimers.delete(attempt.timeout);
      attempt.timeout = null;
      if (!isOpeningAttemptCurrent(mount, attempt, sourceToken)) return;
      sourceTimedOut = true;
      try { controller?.abort?.(); } catch (_) {}
      rejectTimeout(new Error('开局页来源请求超时'));
    }, OPENING_PAGE_SOURCE_TIMEOUT_MS);
    openingTimers.add(attempt.timeout);
    try {
      const fetchHost = doc.defaultView || window;
      const fetchFn = fetchHost?.fetch || window.fetch;
      if (typeof fetchFn !== 'function') throw new Error('fetch 不可用');
      const html = await Promise.race([
        Promise.resolve(fetchFn.call(fetchHost, url, { cache: 'default', signal: controller?.signal })).then(response => {
          if (!response?.ok) throw new Error('HTTP ' + String(response?.status || 0));
          return response.text();
        }),
        timeoutPromise,
      ]);
      cleanupOpeningAttemptSource(attempt, controller);
      if (!isOpeningAttemptCurrent(mount, attempt, sourceToken)) return;
      await verifyOpeningPageHtml(html, doc);
      if (!isOpeningAttemptCurrent(mount, attempt, sourceToken)) return;
      const sanitized = sanitizeOpeningPageHtml(html, doc);
      if (!isOpeningAttemptCurrent(mount, attempt, sourceToken)) return;
      mount.innerHTML = sanitized;
      releaseOpeningRemoteFallback(mount);
      mount.setAttribute('data-xy-remote-state', 'loaded');
      mount.setAttribute('data-xy-remote-owner', runtimeOwner.id);
      mount.setAttribute('data-xy-remote-revision', OPENING_PAGE_REVISION);
      mount.removeAttribute('data-xy-opening-phase');
      mount.removeAttribute('aria-busy');
      openingRemoteAttempts.delete(mount);
      try { scanOpeningPages(); } catch (_) {}
      return;
    } catch (error) {
      if (!isOpeningAttemptCurrent(mount, attempt, sourceToken)) return;
      attempt.lastError = sourceTimedOut ? 'timeout: ' + url : (error?.message || String(error));
      cleanupOpeningAttemptSource(attempt, controller);
      await tryOpeningRemoteSource(doc, mount, attempt, sourceIndex + 1);
    } finally {
      cleanupOpeningAttemptSource(attempt, controller);
    }
  }
  function startOpeningRemoteLoad(mount, options = {}) {
    if (!mount || runtimeDestroyed || mount.isConnected === false) return false;
    const doc = mount.ownerDocument || document;
    bindOpeningRemoteRetry(mount);
    const state = mount.getAttribute('data-xy-remote-state') || 'idle';
    const phase = mount.getAttribute('data-xy-opening-phase') || '';
    const loadedRevision = mount.getAttribute('data-xy-remote-revision') || '';
    const portaledPage = mount.__xyOpeningPortalRoot;
    const loadedPage = mount.querySelector?.('[data-xy-opening-page="3.4.7"]')
      || (portaledPage?.isConnected && portaledPage.dataset?.xyOpeningBoundOwner === runtimeOwner.id ? portaledPage : null);
    const activeAttempt = openingRemoteAttempts.get(mount);
    if (!options.force && state === 'loaded' && loadedRevision === OPENING_PAGE_REVISION && loadedPage) {
      mount.setAttribute('data-xy-remote-owner', runtimeOwner.id);
      releaseOpeningRemoteFallback(mount);
      return false;
    }
    if (!options.force && state === 'idle' && phase === 'error') return false;
    if (!options.force && state === 'loading' && activeAttempt && isOpeningAttemptCurrent(mount, activeAttempt)) return false;
    if (activeAttempt) abortOpeningRemoteAttempt(mount, false);
    ensureOpeningRemoteShell(mount);
    renderOpeningRemotePhase(mount, 'loading', '开局界面加载中…<br>正在从云端载入完整开局页，请稍候。首次打开、切换存档或重新挂载时可能需要一点时间。');
    mount.setAttribute('data-xy-remote-state', 'loading');
    mount.setAttribute('data-xy-remote-owner', runtimeOwner.id);
    mount.setAttribute('data-xy-remote-target-revision', OPENING_PAGE_REVISION);
    const attempt = { owner: runtimeOwner.id, controller: null, timeout: null, sourceToken: null, sourceIndex: 0, lastError: '' };
    openingRemoteAttempts.set(mount, attempt);
    void tryOpeningRemoteSource(doc, mount, attempt, 0).catch(error => failOpeningRemoteAttempt(mount, attempt, error));
    return true;
  }
  function loadRemoteOpeningPages(doc) {
    try { doc.querySelectorAll?.('[data-xy-opening-remote]').forEach(mount => startOpeningRemoteLoad(mount)); } catch (_) {}
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
    if (openingScanTimer) { clearTimeout(openingScanTimer); openingTimers.delete(openingScanTimer); }
    openingScanTimer = scheduleOpeningTimer(() => {
      openingScanTimer = null;
      scanOpeningPages();
    }, delay);
  }
  function currentOwnedOpeningRoots() {
    return Array.from(boundOpeningRoots).filter(root => {
      if (!root || root.isConnected === false) {
        cleanupOpeningRoot(root);
        return false;
      }
      return root.dataset?.xyOpeningBoundOwner === runtimeOwner.id;
    });
  }
  async function handleOpeningContextChanged() {
    const generation = ++openingContextChangeGeneration;
    const roots = currentOwnedOpeningRoots();
    roots.forEach(root => { try { root.__xyOpeningFlushState?.(); } catch (_) {} });
    await openingDraftService.switchChat();
    if (runtimeDestroyed || generation !== openingContextChangeGeneration) return;
    currentOwnedOpeningRoots().forEach(root => {
      try { root.__xyOpeningRefreshContext?.(); } catch (_) {}
      try { root.__xyOpeningRefreshPlayer?.(); } catch (_) {}
    });
    scheduleOpeningPageScan(0);
  }
  function handleOpeningPersonaChanged() {
    if (runtimeDestroyed) return;
    currentOwnedOpeningRoots().forEach(root => {
      try { root.__xyOpeningRefreshPlayer?.(); } catch (_) {}
    });
    // 空聊天切换 Persona 可能重建首消息 DOM；分波次重新扫描并绑定新 root。
    scheduleOpeningPageScan(0);
    [120, 350].forEach(delay => scheduleOpeningTimer(scanOpeningPages, delay));
  }
  function ensureOpeningPageBinding() {
    scanOpeningPages();
    // #1(2.9.8)：移除对整个 doc.body 的常驻 subtree MutationObserver——它在「选卡→逐个确认导入」窗口里
    // 持续触发扫描，是卡顿次因（2.9.8 仅「绑定后断开」，但绑定发生在开局页渲染之后，导入期仍空转）。
    // 改纯靠定时兜底 + 下方 ST 事件捕获开局页（开局页只渲染一次，事件+定时足够）。
    [120, 350, 700, 1200, 2000, 3200, 5000, 8000].forEach(delay => scheduleOpeningTimer(scanOpeningPages, delay));
    try {
      const eventOnHost = window.eventOn || hostWindow().eventOn;
      const events = window.tavern_events || hostWindow().tavern_events || {};
      const eventNames = [events.USER_MESSAGE_RENDERED, events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_UPDATED, events.MESSAGE_SWIPED].filter(Boolean);
      const personaEventNames = Array.from(new Set([events.PERSONA_CHANGED, events.PERSONA_CREATED, events.PERSONA_UPDATED, events.PERSONA_RENAMED, events.PERSONA_DELETED, events.SETTINGS_UPDATED].filter(Boolean)));
      if (typeof eventOnHost === 'function') {
        if (events.CHAT_CHANGED) {
          try {
            const disposer = eventOnHost(events.CHAT_CHANGED, () => { void handleOpeningContextChanged().catch(error => { lastError = error?.message || String(error); }); });
            if (typeof disposer === 'function') disposers.push(disposer);
            else if (disposer?.stop) disposers.push(() => disposer.stop());
          } catch (_) {}
        }
        eventNames.forEach(name => {
          try {
            const disposer = eventOnHost(name, () => scheduleOpeningPageScan(80));
            if (typeof disposer === 'function') disposers.push(disposer);
            else if (disposer?.stop) disposers.push(() => disposer.stop());
          } catch (_) {}
        });
        personaEventNames.forEach(name => {
          try {
            const disposer = eventOnHost(name, handleOpeningPersonaChanged);
            if (typeof disposer === 'function') disposers.push(disposer);
            else if (disposer?.stop) disposers.push(() => disposer.stop());
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function destroy() {
    if (runtimeDestroyed) return;
    runtimeDestroyed = true;
    currentOwnedOpeningRoots().forEach(root => { try { root.__xyOpeningFlushState?.(); } catch (_) {} });
    try { openingDraftService.flushSync(); } catch (_) {}
    try { openingDraftService.destroy(); } catch (_) {}
    try { worldbookManagerUi?.destroy(); } catch (_) {}
    worldbookManagerUi = null;
    try { worldbookAiAssistant.cancelAll(); } catch (_) {}
    try { worldbookEditor?.destroy?.(); } catch (_) {}
    worldbookEditor = null;
    worldbookEditorModulePromise = null;
    try { openingObserver?.disconnect?.(); } catch (_) {}
    openingObserver = null;
    if (openingScanTimer) { clearTimeout(openingScanTimer); openingTimers.delete(openingScanTimer); }
    openingScanTimer = null;
    Array.from(openingRemoteAttempts.keys()).forEach(mount => abortOpeningRemoteAttempt(mount, true));
    openingFetchControllers.forEach(controller => { try { controller.abort(); } catch (_) {} });
    openingFetchControllers.clear();
    clearOpeningRemoteLoadingStates();
    openingRemoteRetryBindings.forEach((binding, mount) => {
      if (binding?.owner !== runtimeOwner.id) return;
      try { mount.removeEventListener('click', binding.handler); } catch (_) {}
      try { if (mount.__xyOpeningRemoteRetryBinding === binding) delete mount.__xyOpeningRemoteRetryBinding; } catch (_) {}
    });
    openingRemoteRetryBindings.clear();
    openingTimers.forEach(timer => { try { clearTimeout(timer); } catch (_) {} });
    openingTimers.clear();
    boundOpeningRoots.forEach(root => {
      if (root.dataset?.xyOpeningBoundOwner !== runtimeOwner.id) return;
      cleanupOpeningRoot(root);
    });
    boundOpeningRoots.clear();
    while (disposers.length) {
      try { disposers.pop()?.(); } catch (_) {}
    }
    try { hostDocument().getElementById(CONTROL_PANEL_ID)?.remove(); } catch (_) {}
    try { hostDocument().getElementById(CONTROL_PANEL_STYLE_ID)?.remove(); } catch (_) {}
    try { hostDocument().getElementById(WAND_CONTAINER_ID)?.remove(); } catch (_) {}
    closeAnalysisPopover();
    closeVariableTunePopover();
    try { hostDocument().getElementById('xingyue-var-tune-style')?.remove(); } catch (_) {}
    removeOmniFlatStyle();
    try { hostDocument().getElementById('xy-reroll-bubble')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xy-reroll-bubble-style')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xingyue-npc-pop')?.remove(); } catch (_) {}
    try { if (window.XingyueControlCenter === api) delete window.XingyueControlCenter; } catch (_) {}
    try { if (window.CrossedZoneControlCenter === api) delete window.CrossedZoneControlCenter; } catch (_) {}
    try { const host = hostWindow(); if (host && host !== window) { if (host.XingyueControlCenter === api) delete host.XingyueControlCenter; if (host.CrossedZoneControlCenter === api) delete host.CrossedZoneControlCenter; } } catch (_) {}
    // 桌宠悬浮球 N3 补全：球/轮盘/样式/气泡/渲染器 rAF/巡检 timer 全清理（防切卡重载残留与泄漏）
    try { hostDocument().getElementById('xingyue-sidebar-ball')?.remove(); } catch (_) {}
    sidebarBall = null;
    try { hostDocument().getElementById('xingyue-sidebar-menu')?.remove(); } catch (_) {}
    sidebarState.open = false;
    try { hostDocument().getElementById('xingyue-sidebar-style')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xingyue-pet-bubble')?.remove(); } catch (_) {}
    // 3.4.7：轮盘第5键气泡头像管理器 modal + 样式清理
    try { hostDocument().getElementById('xingyue-hud-avatar-mgr')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xingyue-hud-avatar-mgr-style')?.remove(); } catch (_) {}
    try { petOrbRenderer?.destroy(); } catch (_) {}
    petOrbRenderer = null;
    if (petBubbleTimer) { clearInterval(petBubbleTimer); petBubbleTimer = null; }
    if (petBubbleHideTimer) { clearTimeout(petBubbleHideTimer); petBubbleHideTimer = null; }
    if (petBubbleBootTimer) { clearTimeout(petBubbleBootTimer); petBubbleBootTimer = null; }
    if (ensureSidebarRetryTimer) { clearTimeout(ensureSidebarRetryTimer); ensureSidebarRetryTimer = null; }
    if (statusHudViewportTimer) { clearTimeout(statusHudViewportTimer); statusHudViewportTimer = null; }
    try { petOrbDragRafCancel?.(); } catch (_) {}
    petOrbDragRafCancel = null;
    // HUD 顶层单例面板 / 抽屉清理：面板/样式/Blob URL/顶层桥
    destroyStatusHudHost();
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    targets.forEach(target => {
      try { if (target.XingyueHudSettings === hudSettingsApi) delete target.XingyueHudSettings; } catch (_) {}
      try { if (target.CrossedZoneHudSettings === hudSettingsApi) delete target.CrossedZoneHudSettings; } catch (_) {}
      try { if (target.XY_RT_BASE === RUNTIME_BASE_URL) delete target.XY_RT_BASE; } catch (_) {}
    });
  }
  function status() {
    return { version: VERSION, runtimeRevision: GIT_RUNTIME_REVISION, settings: { ...settings }, statusHudMode: effectiveStatusHudMode(), statusHudDrawerPlacement: effectiveStatusHudDrawerPlacement(), workshopCacheCount: workshopCache.length, lastError };
  }
  const api = {
    version: VERSION,
    runtimeRevision: GIT_RUNTIME_REVISION,
    getSettings: () => ({ ...settings }),
    saveSettings,
    refreshWorkshop: fetchWorkshopCatalog,
    packageDetail,
    uploadCharacterPackage,
    publishPackage,
    exportCharacterPackageArchive,
    importCharacterPackageArchive,
    registerCharacterPackageMedia,
    myPackages,
    withdrawPackage,
    votePackage,
    checkWorkshopAuth,
    workshopLoginUrl,
    beginWorkshopLogin,
    cancelWorkshopLogin,
    logout,
    getWorkshopIdentity,
    importPackage,
    installPackageToWorldbook,
    inspectWorkshopPackage,
    installOrUpdateWorkshopPackage,
    uninstallWorkshopPackage,
    previewApplyOpeningPackage,
    applyOpeningPackageToDraft,
    worldbookManager,
    applyTransaction: worldbookManager.applyTransaction,
    getRevision: worldbookManager.getRevision,
    diffWorldbookEntries: worldbookManager.diff,
    previewActivation: worldbookManager.previewActivation,
    sharedWorldbookManagerSourceSha256: SHARED_WORLDBOOK_MANAGER_SOURCE_SHA256,
    sharedWorldbookManagerUiSourceSha256: SHARED_WORLDBOOK_MANAGER_UI_SOURCE_SHA256,
    worldbookEditorSourceSha256: WORLDBOOK_EDITOR_SOURCE_SHA256,
    getWorldbookAiSessionStatus:worldbookAiAssistant.status,
    clearWorldbookAiSessionConfig,
    openWorldbookEditor,
    closeWorldbookEditor,
    listWorldbookSnapshots: worldbookManager.listSnapshots,
    previewWorldbookRestore,
    commitWorldbookRestore,
    openWorldbookManager,
    closeWorldbookManager,
    previewOpeningDayFactoryRestore,
    restoreOpeningDayFactoryDraft,
    undoOpeningDayFactoryRestore,
    validatePackage,
    importPackageToDraft,
    readOpeningDraft,
    writeOpeningDraft,
    resolveCurrentPlayerName,
    resolvePlayerText,
    resolvePlayerAvatarSrc,
    OFFICIAL_OPENING_DAY,
    normalizeOpeningDayDraft,
    normalizeGrade,
    gradeBand,
    resolveEffectiveGrade,
    openingStoryCompatibility,
    serializePersonaIdentityBlock,
    parsePersonaIdentityBlock,
    personaIdentityPayloadHash,
    replacePersonaIdentityBlocks,
    userIdentityPayloadDiff,
    mergePersonaIdentityIntoDraft,
    resolveActivePersonaSnapshot,
    writeActivePersonaDescription,
    personaIdentityAuthority,
    openingWorldbookPayload,
    validateOpeningStory,
    resolveOpeningStory,
    composeOpeningMessage,
    getOpeningDraftStatus: () => openingDraftService.status(),
    flushOpeningDraft: () => openingDraftService.flush(),
    switchOpeningDraftChat: () => handleOpeningContextChanged(),
    whenOpeningDraftReady: () => openingDraftReady,
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
    renderOmniDoneContent,
    analyzeOmniUpdateBlock,
    handleOmniButton,
    npcEntries,
    generateNpcPerspective,
    getNpcPerspectiveCache: () => clone(npcPerspectiveCache),
    bindOpeningPage,
    scanOpeningPages,
    ensureOpeningPageBinding,
    ensureWandEntry,
    togglePanel,
    openStatusHud,
    closeStatusHud,
    effectiveStatusHudMode,
    effectiveStatusHudDrawerPlacement,
    refreshStatusHudEntrySurface,
    status,
    destroy,
  };
  window.XingyueControlCenter = api;
  window.CrossedZoneControlCenter = api;
  hudSettingsApi = { getSettings: () => ({ ...settings }), saveSettings };
  window.XingyueHudSettings = hudSettingsApi;
  window.CrossedZoneHudSettings = hudSettingsApi;
  // 任务3.3：注入 RUNTIME_BASE_URL 为全局常量，media_library.js/status_bar_regex.html 从此读取（降级保留内联硬编码）
  window.XY_RT_BASE = RUNTIME_BASE_URL;
  // #3(2.9.8) 同步暴露到宿主窗口(top/parent)：媒体库等同级 iframe 的 cc() 经 hostWindow() 才能取到控制中心 API
  try {
    const host = hostWindow();
    if (host && host !== window) {
      host.XingyueControlCenter = api;
      host.CrossedZoneControlCenter = api;
      host.XingyueHudSettings = hudSettingsApi;
      host.CrossedZoneHudSettings = hudSettingsApi;
      // 同步 XY_RT_BASE 到宿主窗口
      host.XY_RT_BASE = RUNTIME_BASE_URL;
    }
  } catch (_) {}
  ensureOmniFlatStyle();
  captureWorkshopLogin();
  notifyGitRuntimeRevision();
  ensurePanel();
  ensureWandEntry();
  const wandRetryTimer = setTimeout(ensureWandEntry, 1000);
  disposers.push(() => { try { clearTimeout(wandRetryTimer); } catch (_) {} });
  void openingDraftReady.then(result => {
    if (runtimeDestroyed || !result || !openingDraftService.status().ready) return;
    dispatchControlCenterReady();
    ensureOpeningPageBinding();
  });
  bindVariableTuneEntries();
  bindAnalysisEntries();
  loadSidebarState();
  ensureSidebar();
  ensureSidebarRetryTimer = setTimeout(ensureSidebar, 1500);
  bindHudDataEvents();
  bindStatusHudViewportWatcher();
  refreshStatusHudEntrySurface();
  const statusHudBootTimer = setTimeout(refreshStatusHudEntrySurface, 700);
  disposers.push(() => { try { clearTimeout(statusHudBootTimer); } catch (_) {} });
  const pageHideTargets = [window];
  try { const host = hostWindow(); if (host && !pageHideTargets.includes(host)) pageHideTargets.push(host); } catch (_) {}
  pageHideTargets.forEach(target => {
    try {
      target.addEventListener('pagehide', destroy, { once: true });
      disposers.push(() => target.removeEventListener('pagehide', destroy));
    } catch (_) {}
  });
  bindGenerationPromptInjection();
  api.getLastGenerationInjection = () => (lastGenerationInjection ? { ...lastGenerationInjection } : null);
})();
