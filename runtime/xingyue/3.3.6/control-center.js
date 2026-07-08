(() => {
  const VERSION = '3.3.6';
  const BUTTON_NAME = '星月私立高等学院 控制中心 v3.3.6';
  // 任务3.3：单一真相源 RUNTIME_BASE_URL；media_library.js/status_bar_regex.html 从 window.XY_RT_BASE 读（降级保留内联硬编码）
  const RUNTIME_BASE_URL = 'https://cdn.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.3.6';
  // 任务3.4：开局草稿 localStorage key 提顶层常量，版本 bump 只改这一处（bindOpeningPage 内层 STORAGE_KEY 须与此保持同步）
  const OPENING_DRAFT_KEY = 'xingyue-opening-draft-v333';
  const CONTROL_PANEL_ID = 'xingyue-control-center-panel';
  const CONTROL_PANEL_STYLE_ID = 'xingyue-control-center-style';
  const WAND_CONTAINER_ID = 'xingyue-control-center-wand-container';
  const WAND_BUTTON_ID = 'xingyue-control-center-wand-button';
  const STORAGE_KEY = 'xingyue-academy-control-center-settings-v333';
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
  const GIT_RUNTIME_REVISION = '3.3.6-inherit-335-baseline-20260707';
  const GIT_RUNTIME_REVISION_KEY = 'xingyue-control-center-runtime-revision';
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
  function getCurrentMvuData() {
    const Mvu = mvuHost();
    if (!Mvu?.getMvuData) throw new Error('MVU 尚未就绪');
    return Mvu.getMvuData({ type: 'message', message_id: 'latest' });
  }
  // 带外写变量后手动派发 MVU 变量更新事件——replaceMvuData 只落盘、不 fire VARIABLE_UPDATE_ENDED（该事件仅由
  // bundle.js 在 LLM 正常输出 UpdateVariable 后触发）；状态栏靠此事件刷新，不补这一发 reroll/制造的带外写不会反映到状态栏。
  async function emitVarUpdate(nextData, oldData) {
    try {
      const Mvu = mvuHost();
      const evName = (Mvu && Mvu.events && Mvu.events.VARIABLE_UPDATE_ENDED) || 'mag_variable_update_ended';
      const emit = (typeof window.eventEmit === 'function') ? window.eventEmit
        : (hostWindow() && typeof hostWindow().eventEmit === 'function' ? hostWindow().eventEmit : null);
      if (emit) await emit(evName, nextData, oldData == null ? nextData : oldData);
    } catch (_) {}
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
      '#xingyue-control-center-panel{position:fixed;z-index:2147483000;right:auto;top:82px;width:min(520px,calc(100vw - 28px));height:min(640px,78vh);overflow:auto;color:#d9f4ff;background:linear-gradient(180deg,rgba(12,28,44,.97),rgba(4,11,18,.99));border:1px solid rgba(107,199,242,.7);box-shadow:0 16px 46px rgba(0,0,0,.55),0 0 24px rgba(107,199,242,.22);font:12px/1.55 "Microsoft YaHei",sans-serif;padding:12px;resize:none}' +
      '#xingyue-control-center-panel[hidden]{display:none!important}#xingyue-control-center-panel button{background:rgba(107,199,242,.08);border:1px solid rgba(107,199,242,.45);color:#d9f4ff;padding:4px 8px;cursor:pointer}#xingyue-control-center-panel button:hover{background:rgba(107,199,242,.18)}' +
      '#xingyue-control-center-panel input,#xingyue-control-center-panel textarea,#xingyue-control-center-panel select{width:100%;min-width:0;background:rgba(3,8,13,.82);border:1px solid rgba(107,199,242,.35);color:#d9f4ff;padding:5px;font:inherit}#xingyue-control-center-panel textarea{min-height:72px;resize:vertical}' +
      '#xingyue-control-center-panel .xy-head{display:flex;gap:8px;align-items:center;margin:-4px -4px 10px;padding:4px;cursor:move;user-select:none}.xy-title{font-weight:700;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.xy-close{margin-left:auto;flex:0 0 auto}.xy-resize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;border-right:2px solid rgba(255,212,122,.72);border-bottom:2px solid rgba(255,212,122,.72);cursor:nwse-resize}.xy-grid{display:grid;gap:8px}.xy-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);padding:7px;background:rgba(255,255,255,.035)}.xy-section{border:1px solid rgba(107,199,242,.22);padding:8px;background:rgba(255,255,255,.025)}.xy-section h4{margin:0 0 6px;color:#fff}.xy-section label{display:grid;gap:4px;margin:6px 0;color:#9fc7d8}.xy-list{display:grid;gap:6px}.xy-card{border:1px solid rgba(107,199,242,.2);padding:7px;background:rgba(0,0,0,.18)}.xy-actions{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.xy-pre{white-space:pre-wrap;max-height:220px;overflow:auto;border:1px dashed rgba(107,199,242,.24);background:rgba(0,0,0,.22);padding:7px;color:#bfeaff}.xy-muted{color:#9fc7d8}.xy-switch-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.xy-switch{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid rgba(107,199,242,.22);background:rgba(255,255,255,.025);padding:7px;text-align:left}.xy-switch b{display:block;color:#fff;font-weight:600}.xy-switch span{display:block;color:#9fc7d8;font-size:11px}.xy-switch *{pointer-events:none}.xy-sw{position:relative;display:inline-block;width:34px;height:18px;border-radius:9px;background:rgba(70,105,135,.3);border:1px solid rgba(107,199,242,.35)}.xy-sw-knob{position:absolute;left:2px;top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;background:#9fc7d8;transition:left .18s ease,background .18s}.xy-switch.is-on{border-color:rgba(115,226,189,.55);background:rgba(115,226,189,.08)}.xy-switch.is-on .xy-sw{background:rgba(115,226,189,.35);border-color:rgba(115,226,189,.7)}.xy-switch.is-on .xy-sw-knob{left:18px;background:#73e2bd}.native-wand-menu{display:inline-flex;align-items:center;margin-left:4px}#xingyue-control-center-wand-button{border:1px solid rgba(107,199,242,.45);background:rgba(107,199,242,.08);color:#d9f4ff;padding:2px 7px;cursor:pointer}@media(max-width:520px){#xingyue-control-center-panel .xy-switch-grid{grid-template-columns:1fr}}' +
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
  function extractUpdateBlock(text) {
    const all = [...String(text || '').matchAll(/<UpdateVariable(?:variable)?>[\s\S]*?<\/UpdateVariable(?:variable)?>/gi)];
    return all.length ? all[all.length - 1][0] : '';
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
  function pointerParts(path) {
    return String(path || '').replace(/^\//, '').split('/').filter(Boolean).map(decodePointer);
  }
  function hasOwn(container, key) {
    return container && typeof container === 'object' && Object.prototype.hasOwnProperty.call(container, key);
  }
  function getPointerValue(root, path) {
    const parts = pointerParts(path);
    let cur = root;
    for (const part of parts) {
      if (Array.isArray(cur)) {
        const idx = Number(part);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { ok: false };
        cur = cur[idx];
      } else if (hasOwn(cur, part)) {
        cur = cur[part];
      } else {
        return { ok: false };
      }
    }
    return { ok: true, value: cur };
  }
  function setPointerValue(root, path, value, mode) {
    const parts = pointerParts(path);
    if (!parts.length) return '禁止直接替换根对象';
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (Array.isArray(cur)) {
        const idx = Number(key);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return '父路径不存在：/' + parts.slice(0, i + 1).join('/');
        cur = cur[idx];
      } else if (hasOwn(cur, key)) {
        cur = cur[key];
      } else {
        return '父路径不存在：/' + parts.slice(0, i + 1).join('/');
      }
      if (!cur || typeof cur !== 'object') return '父路径不是对象：/' + parts.slice(0, i + 1).join('/');
    }
    const key = parts[parts.length - 1];
    if (Array.isArray(cur)) {
      const idx = key === '-' ? cur.length : Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) return '数组下标非法：' + path;
      if (mode === 'replace' && idx >= cur.length) return 'replace 路径不存在：' + path;
      if (mode === 'remove') {
        if (idx >= cur.length) return 'remove 路径不存在：' + path;
        cur.splice(idx, 1);
      } else if (mode === 'add') {
        cur.splice(idx, 0, clone(value));
      } else {
        cur[idx] = clone(value);
      }
      return '';
    }
    const exists = hasOwn(cur, key);
    if (mode === 'replace' && !exists) return 'replace 路径不存在：' + path;
    if (mode === 'remove' && !exists) return 'remove 路径不存在：' + path;
    if (mode === 'remove') delete cur[key];
    else cur[key] = clone(value);
    return '';
  }
  function applyPatchStrict(root, ops) {
    const next = clone(root || {});
    const problems = [];
    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
      if (!op || typeof op !== 'object') return;
      if (op.op === 'move') {
        const from = getPointerValue(next, op.from);
        if (!from.ok) { problems.push('op #' + (index + 1) + ' from 路径不存在：' + op.from); return; }
        const removeErr = setPointerValue(next, op.from, undefined, 'remove');
        if (removeErr) { problems.push('op #' + (index + 1) + ' ' + removeErr); return; }
        const addErr = setPointerValue(next, op.path, from.value, 'add');
        if (addErr) problems.push('op #' + (index + 1) + ' ' + addErr);
        return;
      }
      const err = setPointerValue(next, op.path, op.value, op.op);
      if (err) problems.push('op #' + (index + 1) + ' ' + err);
    });
    return { next, problems };
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
  function analyzeOmniUpdateBlock(rawInput, floorId) {
    const raw = decodeHtmlEntities(rawInput);
    const block = /<UpdateVariable/i.test(raw) ? (extractUpdateBlock(raw) || raw) : '<UpdateVariable>' + raw + '</UpdateVariable>';
    const analysis = extractTagContent(block, 'analysis');
    const parsed = parseJsonPatchOps(block);
    const messages = [];
    if (!analysis) messages.push('缺少内置 <analysis>');
    if (!parsed.ok) messages.push(parsed.error);
    const opProblems = parsed.ok ? validatePatchOps(parsed.ops) : [];
    messages.push(...opProblems);
    let state = messages.length ? 'error' : 'warn';
    let schemaMessage = '';
    if (!messages.length) {
      let root = null;
      try { root = statRoot(getMvuDataAt(floorId)); } catch (_) { root = null; }
      const Schema = getMvuSchema();
      if (!root || typeof root !== 'object' || !Schema || typeof Schema.parse !== 'function') {
        state = 'warn';
        schemaMessage = 'schema 或当前楼变量不可用，无法离线确认写入后格式';
      } else {
        const applied = applyPatchStrict(root, parsed.ops);
        if (applied.problems.length) {
          state = 'error';
          messages.push(...applied.problems);
        } else {
          try {
            const repaired = Schema.parse(JSON.parse(JSON.stringify(applied.next)));
            if (JSON.stringify(repaired) !== JSON.stringify(applied.next)) {
              state = 'error';
              messages.push('写入后需要 schema 回正，存在格式类型问题');
            } else {
              state = 'ok';
              schemaMessage = 'JSONPatch 可解析，op 合法，写入后符合 schema';
            }
          } catch (error) {
            state = 'error';
            messages.push('写入后 schema 无法解析：' + (error && error.message || error));
          }
        }
      }
    }
    return { raw, block, analysis, ops: parsed.ops, jsonText: parsed.jsonText, state, messages, schemaMessage };
  }
  function renderOmniDoneContent(rawInput, floorId) {
    const result = analyzeOmniUpdateBlock(rawInput, floorId);
    const palette = {
      ok: { color: '#4fd97a', label: '格式正确' },
      warn: { color: '#e0b27b', label: '无法离线确认' },
      error: { color: '#e07b7b', label: '格式错误' },
    };
    const tone = palette[result.state] || palette.warn;
    const opRows = result.ops.length
      ? result.ops.map((op, index) => '<div class="xy-omni-op ' + (result.state === 'ok' ? 'is-ok' : (result.state === 'warn' ? 'is-warn' : 'is-error')) + '"><span>#' + (index + 1) + '</span><code>' + escapeHtml(JSON.stringify(op)) + '</code></div>').join('')
      : '<div class="xy-omni-empty ' + (result.state === 'error' ? 'is-error' : 'is-warn') + '">' + escapeHtml(result.jsonText || '未解析到 JSONPatch 数组') + '</div>';
    const statusText = result.messages.length ? result.messages : [result.schemaMessage || '等待校验结果'];
    return '<div class="xy-omni-grid" data-xy-omni-state="' + result.state + '">'
      + '<section class="xy-omni-pane xy-omni-analysis-pane"><h4>预分析</h4><pre>' + escapeHtml(result.analysis || '缺少内置 <analysis>') + '</pre><div class="xy-omni-actions"><button type="button" data-xy-analysis-edit>编辑</button><button type="button" data-xy-analysis-reroll>重算</button></div></section>'
      + '<section class="xy-omni-pane"><h4>JSONPatch</h4><div class="xy-omni-op-list">' + opRows + '</div></section>'
      + '<section class="xy-omni-pane"><h4>格式校验</h4><div class="xy-omni-status xy-omni-status--' + result.state + '" style="border-color:' + tone.color + ';color:' + tone.color + '"><b>' + tone.label + '</b></div><ul>' + statusText.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></section>'
      + '<section class="xy-omni-pane"><h4>原始块 / 操作</h4><pre>' + escapeHtml(result.block) + '</pre><div class="xy-omni-actions"><button type="button" data-xy-var-tune>微调</button></div></section>'
      + '</div>';
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
  async function applyCraftSettlement(recipeId) {
    const settlement = buildCraftSettlement(recipeId, { commit: true });
    if (!settlement.ok) throw new Error(settlement.message + '：' + settlement.missing.map(item => item.id + ' ' + item.available + '/' + item.amount).join('，'));
    const Mvu = mvuHost();
    if (!Mvu?.replaceMvuData) throw new Error('MVU 写入接口尚未就绪');
    const oldData = getCurrentMvuData();
    const message = wrapUpdateVariableBlock('制造/改造结算：扣除材料、写入产物、同步容器列表并追加流转记录。', settlement.patch);
    let nextData = null;
    if (typeof Mvu.parseMessage === 'function') {
      try { nextData = await Mvu.parseMessage(message, oldData); } catch (_) { nextData = null; }
    }
    if (!nextData) {
      nextData = clone(oldData);
      applyPatchObject(statRoot(nextData), settlement.patch);
    }
    await Mvu.replaceMvuData(nextData, { type: 'message', message_id: 'latest' });
    await emitVarUpdate(nextData, oldData);
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
    // 包一层：generateRaw（LLM，慢）期间显示持续气泡，完成/失败都关闭——所有 reroll/修正共用此入口，一处覆盖全部。
    return async function (opts) {
      const done = showRerollBubble('正在重算变量，请稍候…（只改变量、不动正文）');
      try { return await fn(opts); }
      finally { done(); }
    };
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
    await emitVarUpdate(nextData, oldData);
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
      '请严格沿用上述变量结构与字段名，只为「当前楼正文」重新生成应有的变量更新，输出单个 <UpdateVariable> 块。',
      '<UpdateVariable> 内必须先写 <analysis> 变量预分析，再写 <JSONPatch> 数组；不要在变量块外输出 analysis。',
      '只改这一楼应当变化的变量；不要重新生成正文、不要输出世界书条目、cot 或给下一楼的提示词。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.3.6 的当前楼变量重算器，只输出一个内含 <analysis> 和 <JSONPatch> 的 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), '整楼重算：依据当前楼正文重新推导本楼变量变化。');
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
      '请严格沿用上述变量结构与字段名，只为这条修正生成最小的变量更新，输出单个 <UpdateVariable> 块。',
      '<UpdateVariable> 内必须先写 <analysis> 修正依据，再写 <JSONPatch> 数组；不要在变量块外输出 analysis。',
      '只改被要求的字段、其它一律不动；不要重新生成正文、不要输出世界书条目或下一楼提示词。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.3.6 的变量定点修正器，只输出一个内含 <analysis> 和 <JSONPatch> 的最小 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), '定点修正：按玩家要求只更新指定变量。');
    if (!/<UpdateVariable/i.test(raw)) throw new Error('修正结果未包含 <UpdateVariable> 块，请调整描述后重试');
    // 3.3.1 总监拍板：生成即自动写入（去手动「写回当前楼」步骤），并把正文原变量块中同 path 条目替换为新值
    await writeRawToCurrentFloor(raw);
    let mergedIntoFloor = false;
    try { mergedIntoFloor = await mergeUpdateBlockInFloor(raw, null); } catch (_) {}
    lastVariableFix = { kind: 'correct', instruction, raw, at: new Date().toISOString() };
    toast('success', mergedIntoFloor ? '已重新生成并写入对应变量（本楼正文变量块已同步）' : '已重新生成并写入对应变量');
    renderPanel();
    return lastVariableFix;
  }
  async function applyVariableCorrection() {
    // 3.3.1 起修正已自动写入；本函数保留作 api 兼容/手动兜底
    if (!lastVariableFix?.raw) throw new Error('没有可写回的修正结果');
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
    await emitVarUpdate(nextData, oldData);
  }
  // ── 楼层正文变量块读写（3.3.1 总监拍板语义;CDP 实验证实 setChatMessages 编辑不触发 MVU 重处理,变量写入仍由 replaceMvuData 负责）──
  function floorMessageApi() {
    const helper = helperHost();
    const get = helper?.getChatMessages || window.getChatMessages || hostWindow().getChatMessages;
    const set = helper?.setChatMessages || window.setChatMessages || hostWindow().setChatMessages;
    return (typeof get === 'function' && typeof set === 'function') ? { get, set } : null;
  }
  // 按预分析重算：把新 <UpdateVariable> 块追加到楼层正文底部（旧块保留,读数以最新为准）
  async function appendUpdateBlockToFloor(raw, floorId) {
    const api = floorMessageApi();
    if (!api) return false;
    const block = String(raw).match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/i)?.[0];
    if (!block) return false;
    const range = (floorId == null || floorId === 'latest') ? -1 : floorId;
    const msg = api.get(range)?.[0];
    if (!msg) return false;
    await api.set([{ message_id: msg.message_id, message: String(msg.message || '') + '\n\n' + block }], { refresh: 'affected' });
    return true;
  }
  // 定点修正：正文原块内「相同 path 条目」替换为新值,块内没有的追加;楼内无块则整块追加
  async function mergeUpdateBlockInFloor(raw, floorId) {
    const api = floorMessageApi();
    if (!api) return false;
    const newBlock = String(raw).match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i);
    if (!newBlock) return false;
    let newPatch = null;
    try { const parsedNew = parseJsonPatchOps(newBlock[0]); newPatch = parsedNew.ok ? parsedNew.ops : null; } catch (_) { newPatch = null; }
    if (!Array.isArray(newPatch)) return appendUpdateBlockToFloor(raw, floorId);
    const range = (floorId == null || floorId === 'latest') ? -1 : floorId;
    const msg = api.get(range)?.[0];
    if (!msg) return false;
    const text = String(msg.message || '');
    // 以最后一个块为主块（读数以最新为准的语义，与「按预分析重算」append 的新块自洽——审查 minor 修复）
    const all = [...text.matchAll(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi)];
    if (!all.length) return appendUpdateBlockToFloor(raw, floorId);
    const m = all[all.length - 1];
    let oldPatch = null;
    try { const parsedOld = parseJsonPatchOps(m[0]); oldPatch = parsedOld.ok ? parsedOld.ops : null; } catch (_) { oldPatch = null; }
    if (!Array.isArray(oldPatch)) return appendUpdateBlockToFloor(raw, floorId);
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
    await api.set([{ message_id: msg.message_id, message: newText }], { refresh: 'affected' });
    return true;
  }
  function extractAnalysis(text) {
    const block = extractUpdateBlock(text) || String(text || '');
    return extractTagContent(block, 'analysis');
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
      '请严格沿用上述变量结构与字段名，依据预分析与正文，为「当前楼」重新生成应有的全部变量更新，输出单个 <UpdateVariable> 块。',
      '<UpdateVariable> 内必须先写 <analysis>，再写 <JSONPatch> 数组；不要在变量块外输出 analysis。',
      '只改这一楼应当变化的变量；不要重新生成正文、不要输出世界书条目或给下一楼的提示词。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.3.6 的当前楼变量重算器，依据玩家给定的变量预分析与正文，只输出一个内含 <analysis> 和 <JSONPatch> 的 <UpdateVariable> 块，不生成正文。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), analysis || '按玩家编辑后的预分析重算本楼变量。');
    await writeRawToFloor(raw, floorId);
    // 3.3.1 总监拍板：完成时把新变量块追加到本楼正文底部（旧块保留，读数以最新为准）
    let appendedToFloor = false;
    try { appendedToFloor = await appendUpdateBlockToFloor(raw, floorId); } catch (_) {}
    lastVariableFix = { kind: 'reroll-analysis', instruction: '（按预分析整楼重算）', raw, at: new Date().toISOString() };
    toast('success', appendedToFloor ? '已按预分析重算全部变量，新变量块已写入本楼正文底部' : '已按预分析重算该楼全部变量（正文块追加失败，变量已写入）');
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
        const raw = wrapUpdateVariableBlock('schema 修复：将不合规字段回正为当前变量结构可接受的格式。', ops);
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
      '只为需要修复的字段生成最小的变量更新，输出单个 <UpdateVariable> 块；块内先写 <analysis> 修复依据，再写 <JSONPatch> 数组。不改语义、不重写正文。',
    ].join('\n');
    const raw = normalizeGeneratedUpdateBlock(String(await generateRaw({
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: '你是星月 3.3.6 的变量格式修复器，只输出一个内含 <analysis> 和 <JSONPatch> 的最小 <UpdateVariable> 块，只修格式不改语义。' },
        { role: 'user', content: prompt },
      ],
    }) || '').trim(), 'LLM 格式修复：只修正变量结构和类型问题，不改变语义。');
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
      + '<div class="xy-vt-hint">预分析是变量更新的导向。在这里补足/修正本楼预分析，再点下方按钮——按预分析重算本楼变量，完成后新变量块写入本楼正文底部（不耗历史楼）。</div>'
      + '<label class="xy-vt-field">本楼变量预分析<textarea data-xy-an-input rows="8" placeholder="正文未给出预分析时，可在此写下本楼应当发生的变量变化（按顶层根分条）">' + escapeHtml(analysis) + '</textarea></label>'
      + '<div class="xy-vt-row"><button type="button" data-xy-an="reroll">按预分析重算整楼变量</button><span class="xy-vt-muted">重算变量并把新变量块写入本楼底部</span></div>'
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
  let varTuneTab = 'fix';
  function getVariableValidationStatus() {
    let root;
    try { root = statRoot(getCurrentMvuData()); } catch (_) { return { state: 'unknown', text: 'MVU 未就绪，无法校验' }; }
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
    const tab = varTuneTab;
    const preview = (fix && fix.raw)
      ? '<div class="xy-vt-label">' + fixKindLabel(fix.kind) + '（已自动写入本楼）</div><pre class="xy-vt-pre">' + escapeHtml(String(fix.raw).slice(0, 2000)) + '</pre>'
      : '';
    const tabBtn = (id, label) => '<button type="button" class="xy-vt-tab' + (tab === id ? ' is-on' : '') + '" data-xy-vt-tab="' + id + '">' + label + '</button>';
    let body;
    if (tab === 'reroll') {
      body = '<label class="xy-vt-field">重新生成哪些变量（一句话）<textarea data-xy-vt-input rows="2" placeholder="例：把星月的好感度改成 80；或 重算当前穿着">' + escapeHtml(fix && fix.kind === 'correct' ? (fix.instruction || '') : '') + '</textarea></label>'
        + '<div class="xy-vt-row"><button type="button" data-xy-vt="preview">重新生成并写入对应变量</button><span class="xy-vt-muted">只重 roll 描述到的内容，完成即写入本楼</span></div>'
        + (fix && fix.kind === 'correct' ? preview : '');
    } else if (tab === 'fields') {
      body = varTuneFieldsHtml();
    } else {
      body = varValidationStatusHtml()
        + varProblemListHtml()
        + '<div class="xy-vt-row"><button type="button" data-xy-vt="repair">一键修复变量格式</button><span class="xy-vt-muted">按 schema 把错误格式修回合规</span></div>'
        + (fix && fix.kind === 'repair' ? preview : '');
    }
    return '<div class="xy-vt-head"><span>⚙ 微调当前楼变量</span><button type="button" data-xy-vt="close" class="xy-vt-x">✕</button></div>'
      + '<div class="xy-vt-tabs">' + tabBtn('fix', '一键修正变量') + tabBtn('reroll', '部分重 roll') + tabBtn('fields', '逐字段修改') + '</div>'
      + '<div class="xy-vt-body">' + body + '</div>';
  }
  function listSchemaProblems() {
    let root;
    try { root = statRoot(getCurrentMvuData()); } catch (_) { return []; }
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
  function varProblemListHtml() {
    let root;
    try { root = statRoot(getCurrentMvuData()); } catch (_) { return ''; }
    if (!root || typeof root !== 'object') return '';
    const probs = listSchemaProblems();
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
        const tabEl = event.target?.closest?.('[data-xy-vt-tab]');
        if (tabEl) { event.preventDefault(); event.stopPropagation(); varTuneTab = tabEl.getAttribute('data-xy-vt-tab'); renderVarTunePanel(); return; }
        const boolEl = event.target?.closest?.('[data-xy-vt-bool]');
        if (boolEl) { event.preventDefault(); event.stopPropagation(); const on = boolEl.getAttribute('data-val') === 'true'; boolEl.setAttribute('data-val', on ? 'false' : 'true'); boolEl.textContent = on ? 'false' : 'true'; return; }
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
    if (!varTunePanel.__centered) { centerCcPop(varTunePanel); varTunePanel.__centered = true; }
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
        if (f.kind === 'boolean') { const on = (f.value === true || f.value === 'true'); return '<label class="xy-vt-frow"><span title="' + escapeHtml(f.path) + '">' + escapeHtml(label) + '</span><button type="button" class="xy-vt-boolbtn" data-xy-vt-field="' + escapeHtml(f.path) + '" data-xy-vt-kind="boolean" data-xy-vt-bool data-val="' + (on ? 'true' : 'false') + '">' + (on ? 'true' : 'false') + '</button></label>'; }
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
      let next = input.hasAttribute('data-xy-vt-bool') ? input.getAttribute('data-val') : input.value;
      if (kind === 'number') { const n = Number(next); if (!Number.isNaN(n)) next = n; }
      else if (kind === 'boolean') next = (next === 'true' || next === '1' || next === 'True');
      else if (kind === 'json') { try { next = JSON.parse(next); } catch (_) { return; } }
      if (JSON.stringify(orig) !== JSON.stringify(next)) ops.push({ op: 'replace', path, value: next });
    });
    if (!ops.length) { toast('info', '没有检测到字段改动'); return; }
    const raw = wrapUpdateVariableBlock('逐字段修改：按玩家在变量微调面板中的字段编辑写回。', ops);
    await writeRawToCurrentFloor(raw);
    lastVariableFix = { kind: 'fields', instruction: '（逐字段修改 ' + ops.length + ' 处）', raw, at: new Date().toISOString() };
    toast('success', '字段修改已写回当前楼（' + ops.length + ' 处，正文未改）');
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
  const XY_ORB_CFG = { n: 46, linkDist: 33, speed: 0.3, glowIntensity: 1.08, tailRatio: 0.58, dragShear: 1.28, colorTokens: { particle: '#6bc7f2', bright: '#4be4ff', highlight: '#cdf3ff' }, radius: 0 };
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
      const cap = this._effectiveRadius() * 0.9;
      for (const p of this._particles) {
        const pull = p.tail ? p.lag : 0.12;
        const shear = p.tail ? this._cfg.dragShear : 0.28;
        p.sx = Math.max(-cap, Math.min(cap, p.sx - dx * 2 * pull * shear));
        p.sy = Math.max(-cap, Math.min(cap, p.sy - dy * 2 * pull * shear));
        if (p.tail) {
          p.svx -= dx * 0.035 * p.lag;
          p.svy -= dy * 0.035 * p.lag;
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
      this._dragEnergy *= Math.pow(this._tailDrag ? 0.94 : 0.86, dtFrac);
      if (this._dragEnergy < 0.01) this._dragEnergy = 0;
      const speed = this._cfg.speed * stateP.speedMul * (1 + this._dragEnergy * 0.72);
      const cx = this._canvas.width / 2, cy = this._canvas.height / 2, r = this._effectiveRadius();
      for (const p of this._particles) {
        p.blink += p.blinkSpeed * dtFrac * 0.04; if (p.blink > 1) p.blink -= 1;
        if (p.tail && (p.sx || p.sy || p.svx || p.svy)) {
          // ⑧c 欠阻尼弹簧：拉回中心偏移，松手刚度 x2.4 加速追上；收敛后清零避免残余漂移
          const k = p.springK * (this._tailDrag ? 0.62 : 2.8);
          const damp = Math.pow(this._tailDrag ? Math.min(0.985, p.springD + 0.045) : p.springD, dtFrac);
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
      const linkD = this._cfg.linkDist * stateP.linkDistMul * (canvas.width / 56);
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
      if (dragE > 0.03 && (this._dragDX || this._dragDY)) {
        const dx = this._dragDX || 0, dy = this._dragDY || 0;
        ctx.save();
        ctx.lineCap = 'round';
        for (const p of ps) {
          if (!p.tail) continue;
          const len = (8 + 18 * p.lag) * dragE * (canvas.width / 56);
          ctx.strokeStyle = 'rgba(' + br2 + ',' + bg2 + ',' + bb2 + ',' + (0.12 + 0.2 * dragE).toFixed(3) + ')';
          ctx.lineWidth = (0.65 + 0.9 * p.lag) * (canvas.width / 56);
          ctx.beginPath(); ctx.moveTo(p.rx - dx * len, p.ry - dy * len); ctx.lineTo(p.rx, p.ry); ctx.stroke();
        }
        ctx.restore();
      }
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
        const size = (isHl ? 2.4 : 1.6) * (canvas.width / 56);
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
      '#xingyue-sidebar-ball canvas{display:block;width:56px;height:56px;border-radius:50%;pointer-events:none;}',
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
    const rArc = 108;    // ≥28/|cos75°| 保证最近角按钮不与球(半径28)重叠（审查 minor 修复）
    const rCorner = 150; // 角落 90° 扇形半径加大，4 键完整文字标签不堆叠
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
        if (act === 'hud') openHudPanel();
        if (act === 'npc') openNpcPopover(); // 居中由 deworkshop patchNpcView 在派生层统一处理
        if (act === 'control') togglePanel(true);
        if (act === 'map') toast('info', '地图系统建设中，敬请期待');
      } catch (error) { toast('error', error.message || String(error)); }
    });
    sidebarState.open = true;
  }
  // ── HUD 顶层单例状态栏（P-C-0 承重墙）────────────────────────────────
  // 真身 status-bar.html 从 git runtime 拉取(双源回退)，Blob iframe 挂进顶层居中面板(绝对像素·绕 transform 劫持)。
  // 桥：CC 先在顶层窗口放 __XY_HUD_BRIDGE 函数包(函数与文档无关可跨窗)，blob 内同步引导脚本在**解析期**
  // 取包装桥(与 3.2.0 已证变量桥同模式、无 load 竞态)；getVariables 走 Mvu+最新楼强取(N4 数据源切 latest)。
  const HUD_RT_BASE = 'https://cdn.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.3.6';
  const HUD_RT_BASE_CF = 'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.3.6';
  let hudPanel = null;
  let hudBlobUrl = null;
  let hudLoadState = 'idle'; // idle | loading | ready | failed
  function hudCurrentMsgId() {
    try { if (typeof getLastMessageId === 'function') return getLastMessageId(); } catch (_) {}
    try { if (typeof getCurrentMessageId === 'function') return getCurrentMessageId(); } catch (_) {}
    return 'latest';
  }
  function publishHudBridge() {
    const host = hostWindow();
    const fns = {};
    // XingyueHudSettings/CrossedZoneHudSettings：设置持久化对象（缺了真机报 timeout、齿轮设置不保存——3.3.0 实锤）
    ['eventOn', 'eventOff', 'eventEmit', 'errorCatched', 'updateVariablesWith', 'replaceVariables', 'toastr', 'TavernHelper', 'XingyueHudSettings', 'CrossedZoneHudSettings'].forEach((k) => {
      try { if (typeof window[k] !== 'undefined') fns[k] = window[k]; else if (typeof host[k] !== 'undefined') fns[k] = host[k]; } catch (_) {}
    });
    // getMvu 动态取(非快照)——早开面板时 Mvu 可能未就绪,快照 null 会让真身事件绑定失效(审查 minor)
    // closeHud：给 blob 内 ✕ 用的收起回调（✕=收起整个浮窗；真身 CLOSE=折叠内容，语义不同不合并）
    // onCollapse：真身 CLOSE 折叠内容时通知外壳，把深黑玻璃底透明化（否则折叠后剩一大块空磨砂框；透明化=回落 3.3.1 折叠观感）
    host.__XY_HUD_BRIDGE = { fns, Mvu: mvuHost(), getMvu: () => mvuHost(), curId: () => hudCurrentMsgId(), closeHud: () => { try { closeHudPanel(); } catch (_) {} }, onCollapse: (v) => { try { if (hudPanel) hudPanel.classList.toggle('xy-hud-collapsed', !!v); } catch (_) {} } };
  }
  function buildHudBlobHtml(html) {
    const libs = '<script src="https://cdn.jsdelivr.net/npm/jquery/dist/jquery.min.js"><\/script>'
      + '<script src="https://cdn.jsdelivr.net/npm/lodash/lodash.min.js"><\/script>';
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
      + 'var getM=function(){try{return (B.getMvu&&B.getMvu())||B.Mvu||null;}catch(e){return B.Mvu||null;}};'
      + 'try{Object.defineProperty(window,"Mvu",{configurable:true,get:getM});}catch(e){window.Mvu=getM();}'
      + 'var cur=function(){try{return (B.curId&&B.curId())||"latest";}catch(e){return "latest";}};'
      + 'var clone=function(v){try{return JSON.parse(JSON.stringify(v));}catch(e){return v;}};'
      + 'var emitVar=function(next,old){try{var m=getM();var ev=(m&&m.events&&m.events.VARIABLE_UPDATE_ENDED)||"mag_variable_update_ended";var fn=window.eventEmit||(B.fns&&B.fns.eventEmit);if(typeof fn==="function")return Promise.resolve(fn(ev,next,old==null?next:old));}catch(e){}return Promise.resolve();};'
      + 'window.getCurrentMessageId=function(){return cur();};'
      + 'window.getVariables=function(o){try{return getM().getMvuData({type:"message",message_id:cur()});}catch(e){return {stat_data:{}};}};'
      + 'var nativeUpdate=window.updateVariablesWith;window.updateVariablesWith=function(updater,o){o=o||{};if(o.type&&o.type!=="message"&&typeof nativeUpdate==="function")return nativeUpdate(updater,o);var m=getM();if(!m||!m.getMvuData||!m.replaceMvuData){if(typeof nativeUpdate==="function")return nativeUpdate(updater,o);throw new Error("MVU 写入接口尚未就绪");}var opt={type:"message",message_id:o.message_id==null?cur():o.message_id};var old=m.getMvuData(opt)||{stat_data:{}};var next=clone(old)||{stat_data:{}};return Promise.resolve(updater(next)).then(function(ret){if(ret!==undefined)next=ret;return Promise.resolve(m.replaceMvuData(next,opt)).then(function(){return emitVar(next,old).then(function(){return next;});});});};'
      + 'window.waitGlobalInitialized=function(n){return new Promise(function(res){var k=0;(function c(){if(window[n]||k>20)return res();k++;setTimeout(c,50);})();});};'
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
    w = Math.max(320, Math.min(w, vw - 16));
    h = Math.max(380, Math.min(h, vh - 16));
    let left = saved && typeof saved.x === 'number' ? saved.x : Math.round((vw - w) / 2);
    let top = saved && typeof saved.y === 'number' ? saved.y : Math.round((vh - h) / 2);
    left = Math.max(8, Math.min(vw - w - 8, left));
    top = Math.max(8, Math.min(vh - h - 8, top));
    return { left, top, w, h };
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
  function mountHudBody(html) {
    if (!hudPanel) return;
    publishHudBridge(); // 确保桥就位(幂等,取最新引用)
    html = buildHudBlobHtml(html);
    try {
      if (hudBlobUrl) { try { URL.revokeObjectURL(hudBlobUrl); } catch (_) {} }
      hudBlobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    } catch (error) { hudLoadState = 'failed'; toast('error', '状态栏面板挂载失败：' + (error.message || error)); return; }
    const body = hudPanel.querySelector('.xy-hud-body');
    body.innerHTML = '';
    const frame = hudPanel.ownerDocument.createElement('iframe');
    frame.src = hudBlobUrl;
    // 真身初渲染依赖 VARIABLE_UPDATE_ENDED 才填数据(2026-07-02 sim 实测竞态)——挂载后补发一次,初显必有数据
    frame.addEventListener('load', () => {
      setTimeout(() => { try { const d = getCurrentMvuData(); emitVarUpdate(d, d); } catch (_) {} }, 600);
      setTimeout(() => { try { const d = getCurrentMvuData(); emitVarUpdate(d, d); } catch (_) {} }, 2500);
    });
    body.appendChild(frame);
    hudLoadState = 'ready';
  }
  function fetchHudBody() {
    hudLoadState = 'loading';
    const host = hostWindow();
    const override = host.XY_HUD_BASE_OVERRIDE || window.XY_HUD_BASE_OVERRIDE || null; // 仿真/调试可指本地
    const urls = override ? [override + '/status-bar.html'] : [HUD_RT_BASE + '/status-bar.html', HUD_RT_BASE_CF + '/status-bar.html'];
    const tryFetch = (idx) => {
      if (idx >= urls.length) {
        hudLoadState = 'failed';
        const loading = hudPanel?.querySelector('.xy-hud-loading');
        if (loading) loading.textContent = '状态栏远程组件加载失败，请检查网络后重试。';
        return;
      }
      fetch(urls[idx], { cache: 'default' })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then((html) => mountHudBody(html))
        .catch(() => tryFetch(idx + 1));
    };
    tryFetch(0);
  }
  function closeHudPanel() {
    if (!hudPanel) return;
    hudPanel.dataset.xyHudOpen = '0';
    hudPanel.style.transform = 'scale(0.88)';
    hudPanel.style.opacity = '0';
    hudPanel.style.pointerEvents = 'none';
  }
  function openHudPanel() {
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
      if (hudLoadState === 'failed') fetchHudBody(); // 上次失败重试
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
        hudPanel.style.width = Math.max(320, Math.min(vw - hudPtr.base.left - 8, hudPtr.base.w + ev.clientX - hudPtr.startX)) + 'px';
        hudPanel.style.height = Math.max(380, Math.min(vh - hudPtr.base.top - 8, hudPtr.base.h + ev.clientY - hudPtr.startY)) + 'px';
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
    (hostWindow().requestAnimationFrame || requestAnimationFrame)(() => { try { hudPanel.dataset.xyHudOpen = '1'; hudPanel.style.transform = 'scale(1)'; hudPanel.style.opacity = '1'; hudPanel.style.pointerEvents = 'auto'; } catch (_) {} });
    publishHudBridge();
    fetchHudBody();
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
    canvas.width = 112; canvas.height = 112; // 2x 物理分辨率防糊
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
        { role: 'system', content: '你是星月 3.3.6 的楼层内临时旁观视角生成器。结果只供玩家娱乐阅读，不进入后续上下文。' },
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
  // 3.3.6:制造/NPC 面板 UI 已删,结算链在 07_craft,TA 浮窗在 12_npc_view

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
        if (action === 'toggle-setting') {
          const key = actionNode.closest?.('[data-key]')?.getAttribute?.('data-key');
          if (key && Object.prototype.hasOwnProperty.call(settings, key)) saveSettings({ [key]: !settings[key] });
        }
        if (action === 'news-mode') {
          const mode = actionNode.getAttribute('data-mode') === 'round' ? 'round' : 'time';
          saveSettings({ newsRefreshMode: mode });
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
      settingSwitch('头像立绘显示', 'mediaDisplayEnabled', '同步状态栏媒体显示') +
      settingSwitch('新闻策略', 'newsPolicyEnabled', '生成前策略开关') +
      renderNewsPolicyOptions() +
      settingSwitch('雷达清理增强', 'radarCleanupPolicyEnabled', '生成前注入清理增强提示词') +
      settingSwitch('摘要更新', 'summaryUpdateEnabled', '近期记录更新策略') +
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
      '<div class="xy-section"><h4>开局与状态栏</h4><div class="xy-actions"></div>' + safe('开局与状态栏', renderPolicyControls) + '</div>' +
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

  const STORAGE_KEY = 'xingyue-opening-draft-v333';
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
      state.lastWorkshopError = '在线创意工坊暂未开放，可继续使用本地 JSON 和本地示例';
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
          state.lastWorkshopError = '在线创意工坊暂未开放，可继续使用本地 JSON 和本地示例';
          renderWorkshop();
          toast('info', '在线创意工坊暂未开放；本地 JSON 和本地示例仍可使用。');
          return;
        }
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
        downloadJson('xingyue-opening-draft-v3.3.6.json', readDraft());
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
    'https://testingcf.jsdelivr.net/gh/LiarMTTT/rolecard-diy-workshop@main/runtime/xingyue/3.3.6/opening-page.html',
    'https://43-132-171-157.sslip.io/runtime/xingyue/3.3.6/opening-page.html',
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
    // 桌宠悬浮球 N3 补全：球/轮盘/样式/气泡/渲染器 rAF/巡检 timer 全清理（防切卡重载残留与泄漏）
    try { hostDocument().getElementById('xingyue-sidebar-ball')?.remove(); } catch (_) {}
    sidebarBall = null;
    try { hostDocument().getElementById('xingyue-sidebar-menu')?.remove(); } catch (_) {}
    sidebarState.open = false;
    try { hostDocument().getElementById('xingyue-sidebar-style')?.remove(); } catch (_) {}
    try { hostDocument().getElementById('xingyue-pet-bubble')?.remove(); } catch (_) {}
    try { petOrbRenderer?.destroy(); } catch (_) {}
    petOrbRenderer = null;
    if (petBubbleTimer) { clearInterval(petBubbleTimer); petBubbleTimer = null; }
    if (petBubbleHideTimer) { clearTimeout(petBubbleHideTimer); petBubbleHideTimer = null; }
    if (petBubbleBootTimer) { clearTimeout(petBubbleBootTimer); petBubbleBootTimer = null; }
    if (ensureSidebarRetryTimer) { clearTimeout(ensureSidebarRetryTimer); ensureSidebarRetryTimer = null; }
    try { petOrbDragRafCancel?.(); } catch (_) {}
    petOrbDragRafCancel = null;
    // HUD 顶层单例面板（P-C-0）清理：面板/样式/Blob URL/顶层桥
    try { hostDocument().getElementById('xingyue-hud-panel')?.remove(); } catch (_) {}
    hudPanel = null;
    try { hostDocument().getElementById('xingyue-hud-panel-style')?.remove(); } catch (_) {}
    try { if (hudBlobUrl) URL.revokeObjectURL(hudBlobUrl); } catch (_) {}
    hudBlobUrl = null;
    try { const host = hostWindow(); if (host.__XY_HUD_BRIDGE) delete host.__XY_HUD_BRIDGE; } catch (_) {}
  }
  function status() {
    return { version: VERSION, runtimeRevision: GIT_RUNTIME_REVISION, settings: { ...settings }, workshopCacheCount: workshopCache.length, lastError };
  }
  const api = {
    version: VERSION,
    runtimeRevision: GIT_RUNTIME_REVISION,
    getSettings: () => ({ ...settings }),
    saveSettings,
    importPackage,
    installPackageToWorldbook,
    validatePackage,
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
  notifyGitRuntimeRevision();
  dispatchControlCenterReady();
  ensurePanel();
  ensureWandEntry();
  setTimeout(ensureWandEntry, 1000);
  ensureOpeningPageBinding();
  bindVariableTuneEntries();
  bindAnalysisEntries();
  loadSidebarState();
  ensureSidebar();
  ensureSidebarRetryTimer = setTimeout(ensureSidebar, 1500);
  bindGenerationPromptInjection();
  api.getLastGenerationInjection = () => (lastGenerationInjection ? { ...lastGenerationInjection } : null);
})();
