// [星月私立高等学院] 小手机桥 v3.9.9 — runtime 模块（控制中心 importModule 懒加载）
// 职责：
//   ① MVU 快照流（读最新楼层 stat_data，提交去抖，供手机前端 __xyPhoneStat 读取）；
//   ② 宿主桥：发送/填入输入框（__xyPhoneSend/__xyPhoneInput）、AI 桥（__xyPhoneAi）、
//      媒体桥（__xyPhoneMedia，适配星月媒体库）、羁绊（__xyPhoneBond）与删除（__xyPhoneRemove）写入；
//   ③ phone-hud.html 前端的挂载/卸载（挂宿主 body，new Function 注入）与事件订阅刷新。
// 移植自怪谈笔记 kdn_phone.js，变量根/schema/桥名/存储 key 已星月化。

const VERSION = '3.9.9';
const RUNTIME_KEY = '__xyPhoneBridgeRuntime';
const HUD_RUNTIME_KEY = '__xyPhoneHudRuntime';
const AI_CONFIG_KEY = 'xy_phone_ai_config_v1';
const AI_KEY_STORE = 'xy_phone_ai_key_v1';
const AI_SYSTEM_CHAR_LIMIT = 24000;
const AI_MESSAGE_CHAR_LIMIT = 32768;
const AI_MESSAGES_TOTAL_CHAR_LIMIT = 96000;
const AI_RESPONSE_CHAR_LIMIT = 16000;

let singleton = null;

/* ================= 宿主解析 ================= */
function resolveHostWindow() {
  let current = window;
  try {
    for (let i = 0; i < 4; i++) {
      if (!current.parent || current.parent === current) break;
      void current.parent.document.body;
      current = current.parent;
    }
  } catch (e) {}
  return current;
}

function createRuntime(ctx) {
  const helperWindow = window;
  const hostWindow = resolveHostWindow();
  const hostDocument = hostWindow.document;
  const integrity = ctx && ctx.integrity || null;

  const runtime = {
    build: VERSION,
    destroyed: false,
    root: null,
    timers: Object.create(null),
    stops: [],
    tavernEventsBound: false,
    mvuEventsBound: false,
    mvu: null,
    committedStat: null,
    committedStatJson: '',
    statRevision: 0,
    phase: 'cold',
    chatEpoch: 0,
    isGenerating: false,
    awaitingPersist: false,
    activeUpdateChatEpoch: null,
    bondWritePending: false,
    destroy: destroy
  };

  /* ---------- 通用解析 ---------- */
  function getMvu() {
    if (runtime.mvu) return runtime.mvu;
    let value = null;
    try { if (typeof Mvu !== 'undefined' && Mvu) value = Mvu; } catch (e) {}
    try { if (!value && hostWindow.Mvu) value = hostWindow.Mvu; } catch (e) {}
    if (value) runtime.mvu = value;
    return value;
  }
  function getTavernHelper() {
    try { if (typeof TavernHelper !== 'undefined' && TavernHelper) return TavernHelper; } catch (e) {}
    try { return hostWindow.TavernHelper || null; } catch (e) { return null; }
  }
  function getEventOn() {
    try { if (typeof eventOn === 'function') return eventOn; } catch (e) {}
    try { if (typeof hostWindow.eventOn === 'function') return hostWindow.eventOn; } catch (e) {}
    return null;
  }
  function getTavernEvents() {
    try { if (typeof tavern_events !== 'undefined' && tavern_events) return tavern_events; } catch (e) {}
    try { return hostWindow.tavern_events || {}; } catch (e) { return {}; }
  }
  function getVariablesReader() {
    try { if (typeof getVariables === 'function') return getVariables; } catch (e) {}
    try { const helper = getTavernHelper(); if (helper && typeof helper.getVariables === 'function') return helper.getVariables.bind(helper); } catch (e) {}
    try { if (typeof hostWindow.getVariables === 'function') return hostWindow.getVariables.bind(hostWindow); } catch (e) {}
    return null;
  }

  /* ---------- 定时器/事件 ---------- */
  function clearTimer(name) {
    const id = runtime.timers[name];
    if (id === undefined) return;
    try { hostWindow.clearTimeout(id); } catch (e) {}
    delete runtime.timers[name];
  }
  function schedule(name, fn, delay) {
    clearTimer(name);
    runtime.timers[name] = hostWindow.setTimeout(function () {
      delete runtime.timers[name];
      if (!runtime.destroyed) fn();
    }, delay);
  }
  function bindEvent(type, handler) {
    const on = getEventOn();
    if (!type || !on) return false;
    try {
      const listener = on(type, handler);
      if (listener && typeof listener.stop === 'function') runtime.stops.push(function () { listener.stop(); });
      return true;
    } catch (e) { return false; }
  }

  /* ---------- MVU 快照流 ---------- */
  function readLatestStat() {
    try {
      const mvu = getMvu();
      if (mvu && typeof mvu.getMvuData === 'function') {
        const data = mvu.getMvuData({ type: 'message', message_id: 'latest' });
        if (data && data.stat_data) return data.stat_data;
      }
    } catch (e) {}
    try {
      const readVariables = getVariablesReader();
      if (readVariables) {
        const persisted = readVariables({ type: 'message', message_id: 'latest' });
        if (persisted && persisted.stat_data) return persisted.stat_data;
      }
    } catch (e) {}
    return null;
  }
  function commitStat(stat) {
    if (!stat || typeof stat !== 'object') return false;
    let encoded = '';
    try { encoded = JSON.stringify(stat); } catch (e) { return false; }
    if (!encoded) return false;
    if (runtime.committedStat && encoded === runtime.committedStatJson) return true;
    let snapshot = null;
    try { snapshot = JSON.parse(encoded); } catch (e) { return false; }
    if (!snapshot || typeof snapshot !== 'object') return false;
    runtime.committedStat = snapshot;
    runtime.committedStatJson = encoded;
    runtime.statRevision += 1;
    return true;
  }
  function commitMvuData(data) { return !!(data && commitStat(data.stat_data)); }
  function syncLatestStat(expectedChatEpoch, force) {
    if (runtime.destroyed || expectedChatEpoch !== runtime.chatEpoch) return false;
    if (!force && runtime.phase !== 'cold' && runtime.phase !== 'stable' && runtime.phase !== 'switching') return false;
    const stat = readLatestStat();
    if (!stat || !commitStat(stat)) return false;
    runtime.isGenerating = false;
    runtime.awaitingPersist = false;
    runtime.activeUpdateChatEpoch = null;
    runtime.phase = 'stable';
    requestRefresh(0);
    return true;
  }
  function getStat() { return runtime.committedStat; }
  function scheduleStableSync(chatEpoch, attempt, delay) {
    schedule('stat-sync', function () {
      if (syncLatestStat(chatEpoch, false)) return;
      if (attempt < 119 && chatEpoch === runtime.chatEpoch && (runtime.phase === 'cold' || runtime.phase === 'switching')) {
        scheduleStableSync(chatEpoch, attempt + 1, 250);
      }
    }, delay);
  }
  function beginNavigation(clearCommitted, delay) {
    runtime.chatEpoch += 1;
    runtime.isGenerating = false;
    runtime.awaitingPersist = false;
    runtime.activeUpdateChatEpoch = null;
    runtime.phase = 'switching';
    clearTimer('stat-finalize');
    clearTimer('stat-reconcile');
    if (clearCommitted) { runtime.committedStat = null; runtime.committedStatJson = ''; runtime.statRevision += 1; }
    requestRefresh(0);
    scheduleStableSync(runtime.chatEpoch, 0, typeof delay === 'number' ? delay : 280);
  }

  /* ---------- 宿主输入/发送桥 ---------- */
  function escPipe(text) { return String(text).replace(/\|/g, '\\|'); }
  function getSlashRunner() {
    const helper = getTavernHelper();
    if (helper && typeof helper.triggerSlash === 'function') return function (command) { return helper.triggerSlash(command); };
    try { if (typeof triggerSlash === 'function') return function (command) { return triggerSlash(command); }; } catch (e) {}
    return null;
  }
  function runSlash(command) {
    const runner = getSlashRunner();
    if (!runner) return Promise.reject(new Error('酒馆助手命令接口尚未就绪'));
    try { return Promise.resolve(runner(command)); } catch (error) { return Promise.reject(error); }
  }
  function hostInputValue() {
    try {
      const input = hostDocument.querySelector('#send_textarea');
      if (!input) return '';
      return String(input.value != null ? input.value : input.textContent || '');
    } catch (e) { return ''; }
  }
  function hostInputText() { return hostInputValue().trim(); }
  function doSend(text) { return runSlash('/send ' + escPipe(text) + ' | /trigger').then(function () { return true; }); }
  function doInput(text) {
    if (hostInputText()) return Promise.reject(new Error('输入框已有内容，请先清空或自行合并'));
    return runSlash('/setinput ' + escPipe(text)).then(function () { return true; });
  }

  /* ---------- AI 桥（幽讯/论坛/新闻生成） ---------- */
  let aiBusy = false;
  const aiGenerations = Object.create(null);
  function aiStorage(name) { try { const s = hostWindow[name]; return s && typeof s.getItem === 'function' ? s : null; } catch (e) { return null; } }
  function aiRead(name, key) { const s = aiStorage(name); if (!s) return ''; try { return String(s.getItem(key) || ''); } catch (e) { return ''; } }
  function aiWrite(name, key, value) { const s = aiStorage(name); if (!s) return false; try { s.setItem(key, String(value)); return true; } catch (e) { return false; } }
  function aiRemove(name, key) { const s = aiStorage(name); if (!s) return false; try { s.removeItem(key); return true; } catch (e) { return false; } }
  function aiText(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit); }
  function aiPromptText(value, limit, label) { const text = String(value == null ? '' : value).trim(); if (text.length > limit) throw aiError(label + '超过处理上限，请缩短上下文后重试'); return text; }
  function aiError(message) { return new Error(message); }
  function normalizeAiConfig(value) { value = value && typeof value === 'object' ? value : {}; return { apiurl: aiText(value.apiurl, 2048), model: aiText(value.model, 256) }; }
  function readAiConfig() { const raw = aiRead('localStorage', AI_CONFIG_KEY); if (!raw) return normalizeAiConfig({}); try { return normalizeAiConfig(JSON.parse(raw)); } catch (e) { return normalizeAiConfig({}); } }
  function readAiKeyStore() {
    let raw = aiRead('localStorage', AI_KEY_STORE);
    if (!raw) return { apiurl: '', key: '' };
    try { const v = JSON.parse(raw); return { apiurl: aiText(v && v.apiurl, 2048), key: aiText(v && v.key, 4096) }; } catch (e) { return { apiurl: '', key: '' }; }
  }
  let aiConfig = readAiConfig();
  function aiKeyReady(config) { const session = readAiKeyStore(); config = config || aiConfig; return !!session.key && session.apiurl === config.apiurl; }
  function aiState() { aiConfig = readAiConfig(); return { apiurl: aiConfig.apiurl, model: aiConfig.model, hasKey: aiKeyReady(aiConfig), enabled: !!(aiConfig.apiurl && aiConfig.model), busy: aiBusy, preview: false }; }
  function getAiConfig() {
    const config = readAiConfig(); if (!config.apiurl || !config.model) return null;
    const session = readAiKeyStore();
    const out = { apiurl: config.apiurl, model: config.model, source: 'openai' };
    if (session.apiurl === config.apiurl && session.key) out.key = session.key;
    return out;
  }
  function requireAiUrl(value) {
    const apiurl = aiText(value, 2048);
    if (!apiurl) throw aiError('请先填写 OpenAI 格式 API URL');
    if (!/^https?:\/\//i.test(apiurl)) throw aiError('API URL 必须以 http:// 或 https:// 开头');
    if (/^[a-z]+:\/\/[^/]*@/i.test(apiurl)) throw aiError('API URL 不能包含用户名或密码');
    if (/[?&](?:api[_-]?key|key|token|secret)=/i.test(apiurl)) throw aiError('API URL 不能携带 Key、Token 或 Secret 参数');
    return apiurl;
  }
  function aiPublicError(error, action) {
    const status = Number(error && (error.status || error.statusCode || (error.response && error.response.status))) || 0;
    const message = String(error && error.message || '');
    if (status === 401 || /(?:^|\D)401(?:\D|$)|unauthori[sz]ed|invalid[ _-]*(?:api[ _-]*)?key/i.test(message)) return aiError('API Key 无效或无权限（401）');
    if (status === 403 || /(?:^|\D)403(?:\D|$)|forbidden/i.test(message)) return aiError('API 拒绝访问（403），请检查 Key 权限');
    if (status === 404 || /(?:^|\D)404(?:\D|$)|not found/i.test(message)) return aiError('API 地址不存在（404），请检查 Base URL');
    if (status === 429 || /(?:^|\D)429(?:\D|$)|rate limit/i.test(message)) return aiError('API 请求过于频繁（429），请稍后重试');
    if (/failed to fetch|network|cors|load failed|connection|timeout|abort/i.test(message)) return aiError('无法连接 API，请检查地址、网络或 CORS 设置');
    return aiError(action === 'generate' ? 'AI 回复生成失败，请检查 API 设置' : '模型列表拉取失败，请检查 API 设置');
  }
  function modelListRunner() {
    const helper = getTavernHelper();
    if (helper && typeof helper.getModelList === 'function') return { fn: helper.getModelList, owner: helper };
    try { if (typeof getModelList === 'function') return { fn: getModelList, owner: helperWindow }; } catch (e) {}
    try { if (typeof hostWindow.getModelList === 'function') return { fn: hostWindow.getModelList, owner: hostWindow }; } catch (e) {}
    return null;
  }
  function normalizeAiModels(value) {
    const out = [], seen = Object.create(null);
    (Array.isArray(value) ? value.slice(0, 500) : []).forEach(function (item) {
      if (typeof item !== 'string') return;
      const model = aiText(item, 256);
      if (!model || seen[model]) return;
      seen[model] = true; out.push(model);
    });
    return out;
  }
  function fetchAiModels(input) {
    if (runtime.destroyed) return Promise.reject(aiError('AI 桥已销毁'));
    if (aiBusy) return Promise.reject(aiError('模型列表正在拉取，请稍候'));
    input = input && typeof input === 'object' ? input : {};
    let apiurl, key;
    try {
      apiurl = requireAiUrl(aiText(input.apiurl, 2048) || aiConfig.apiurl);
      const session = readAiKeyStore();
      key = aiText(input.key, 4096) || (session.apiurl === apiurl ? session.key : '');
      if (!key) throw aiError('请填写当前 API URL 对应的 API Key');
    } catch (error) { return Promise.reject(error); }
    const runner = modelListRunner();
    if (!runner) return Promise.reject(aiError('酒馆助手 getModelList 接口尚未就绪'));
    aiBusy = true;
    let settled = false, timer = 0, request;
    try { request = Promise.resolve(runner.fn.call(runner.owner, { apiurl: apiurl, key: key })); }
    catch (error) { aiBusy = false; return Promise.reject(aiPublicError(error, 'models')); }
    return new Promise(function (resolve, reject) {
      timer = hostWindow.setTimeout(function () {
        if (settled) return; settled = true; aiBusy = false;
        reject(aiError('模型列表拉取超时，请检查网络或 API 地址'));
      }, 30000);
      request.then(function (value) {
        if (settled) return null;
        try { hostWindow.clearTimeout(timer); } catch (e) {}
        const models = normalizeAiModels(value);
        if (!models.length) throw aiError('API 未返回可用模型');
        settled = true; aiBusy = false; resolve(models); return null;
      }, function (error) {
        if (settled) return null;
        settled = true; try { hostWindow.clearTimeout(timer); } catch (e) {}
        aiBusy = false; reject(aiPublicError(error, 'models')); return null;
      }).catch(function (error) {
        if (settled) return; settled = true;
        try { hostWindow.clearTimeout(timer); } catch (e) {}
        aiBusy = false; reject(error);
      });
    });
  }
  function generationRunner() {
    const helper = getTavernHelper();
    return helper && typeof helper.generateRaw === 'function' ? { fn: helper.generateRaw, owner: helper } : null;
  }
  function normalizeAiMessages(value) {
    const out = []; let total = 0; const source = Array.isArray(value) ? value : [];
    source.forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;
      const role = item.role === 'assistant' ? 'assistant' : (item.role === 'user' ? 'user' : '');
      if (!role) return;
      const content = aiPromptText(item.content, AI_MESSAGE_CHAR_LIMIT, '第 ' + (index + 1) + ' 条 AI 消息');
      if (!content) return;
      total += content.length;
      if (total > AI_MESSAGES_TOTAL_CHAR_LIMIT) throw aiError('AI 消息总长度超过处理上限，请缩短上下文后重试');
      out.push({ role: role, content: content });
    });
    return out;
  }
  function generateAiText(input) {
    if (runtime.destroyed) return Promise.reject(aiError('AI 桥已销毁'));
    input = input && typeof input === 'object' ? input : {};
    const config = getAiConfig();
    if (!config || !config.apiurl || !config.model) return Promise.reject(aiError('请先在设置中保存 API URL 与模型'));
    if (!config.key) return Promise.reject(aiError('当前会话没有 API Key，请先到设置中填写'));
    const runner = generationRunner();
    if (!runner) return Promise.reject(aiError('酒馆助手 generateRaw 接口尚未就绪'));
    let system, messages;
    try {
      system = aiPromptText(input.system, AI_SYSTEM_CHAR_LIMIT, 'AI 系统提示词');
      messages = normalizeAiMessages(input.messages);
    } catch (error) { return Promise.reject(error); }
    if (!system || !messages.length) return Promise.reject(aiError('AI 生成上下文不完整'));
    const generationId = aiText(input.generationId, 128);
    if (!generationId) return Promise.reject(aiError('缺少 AI 请求标识'));
    if (!/^[A-Za-z0-9._:-]+$/.test(generationId)) return Promise.reject(aiError('AI 请求标识无效'));
    if (aiGenerations[generationId]) return Promise.reject(aiError('同一 AI 请求正在处理中'));
    const maxTokens = Math.max(64, Math.min(2048, Math.floor(Number(input.maxTokens)) || 512));
    const token = { cancelled: false, timer: 0 };
    aiGenerations[generationId] = token;
    token.timer = hostWindow.setTimeout(function () {
      if (aiGenerations[generationId] !== token) return;
      token.cancelled = true; delete aiGenerations[generationId];
      try { const helper = getTavernHelper(); if (helper && typeof helper.stopGenerationById === 'function') helper.stopGenerationById(generationId); } catch (e) {}
      try { if (typeof token.reject === 'function') token.reject(aiError('AI 请求超时，请检查网络或模型后重试')); } catch (e) {}
    }, 45000);
    let request; const ordered = [{ role: 'system', content: system }].concat(messages);
    try {
      request = Promise.resolve(runner.fn.call(runner.owner, {
        generation_id: generationId, should_silence: true, should_stream: false, max_chat_history: 0,
        ordered_prompts: ordered,
        custom_api: { apiurl: config.apiurl, key: config.key, model: config.model, source: 'openai', max_tokens: maxTokens }
      }));
    } catch (error) {
      try { hostWindow.clearTimeout(token.timer); } catch (e) {}
      delete aiGenerations[generationId];
      return Promise.reject(aiPublicError(error, 'generate'));
    }
    return new Promise(function (resolve, reject) {
      token.reject = reject;
      request.then(function (value) {
        if (aiGenerations[generationId] === token) { try { hostWindow.clearTimeout(token.timer); } catch (e) {} delete aiGenerations[generationId]; }
        if (token.cancelled) throw aiError('AI 请求已取消');
        if (typeof value !== 'string') throw aiError('API 返回了非文本结果');
        const text = String(value == null ? '' : value).trim();
        if (!text) throw aiError('API 未返回可用回复');
        if (text.length > AI_RESPONSE_CHAR_LIMIT) throw aiError('API 回复超过处理上限，请缩短生成内容后重试');
        return { generationId: generationId, text: text };
      }, function (error) {
        if (aiGenerations[generationId] === token) { try { hostWindow.clearTimeout(token.timer); } catch (e) {} delete aiGenerations[generationId]; }
        if (token.cancelled) throw aiError('AI 请求已取消');
        throw aiPublicError(error, 'generate');
      }).then(resolve, reject);
    });
  }
  function cancelAiGeneration(generationId) {
    generationId = aiText(generationId, 128);
    const token = generationId && aiGenerations[generationId];
    if (!token) return false;
    if (token.timer) { try { hostWindow.clearTimeout(token.timer); } catch (e) {} token.timer = 0; }
    token.cancelled = true;
    const helper = getTavernHelper();
    try { return !!(helper && typeof helper.stopGenerationById === 'function' && helper.stopGenerationById(generationId)); } catch (e) { return false; }
  }
  function cancelAllAiGenerations() { Object.keys(aiGenerations).forEach(function (id) { cancelAiGeneration(id); }); }
  function aiSave(input) {
    input = input && typeof input === 'object' ? input : {};
    const apiurl = requireAiUrl(input.apiurl);
    const model = aiText(input.model, 256);
    if (!model) return Promise.reject(aiError('请先选择模型'));
    const key = aiText(input.key, 4096);
    aiWrite('localStorage', AI_CONFIG_KEY, JSON.stringify({ apiurl: apiurl, model: model }));
    if (key) aiWrite('localStorage', AI_KEY_STORE, JSON.stringify({ apiurl: apiurl, key: key }));
    aiConfig = readAiConfig();
    return Promise.resolve(aiState());
  }
  function aiClearKey() { aiRemove('localStorage', AI_KEY_STORE); return aiState(); }
  const AI_BRIDGE = {
    version: VERSION,
    preview: false,
    getState: function () { return aiState(); },
    fetchModels: function (input) { return fetchAiModels(input); },
    generate: function (input) { return generateAiText(input); },
    cancel: function (generationId) { return cancelAiGeneration(generationId); },
    save: function (input) { return aiSave(input); },
    clearKey: function () { return aiClearKey(); }
  };

  /* ---------- 媒体桥（适配星月媒体库） ---------- */
  function mediaLib() {
    try { const w = hostWindow; if (w.XingyueMediaLibrary && typeof w.XingyueMediaLibrary.listManagedAssets === 'function') return w.XingyueMediaLibrary; } catch (e) {}
    try { if (helperWindow.XingyueMediaLibrary && typeof helperWindow.XingyueMediaLibrary.listManagedAssets === 'function') return helperWindow.XingyueMediaLibrary; } catch (e) {}
    return null;
  }
  function mediaKeyOf(item) { return encodeURIComponent(item.name) + '|' + item.slot + '|' + item.variant; }
  const MEDIA_BRIDGE = {
    version: VERSION,
    scriptId: 'xingyue-media-library',
    read: function () {
      const lib = mediaLib();
      const assets = {};
      if (lib) {
        try {
          lib.listManagedAssets().forEach(function (item) {
            if (item.type !== 'bond') return;
            const key = mediaKeyOf(item);
            assets[key] = { key: key, name: item.name, slot: item.slot, variant: item.variant, dataUrl: item.dataUrl || '', url: item.url || '', mime: item.mime || '', bytes: item.bytes || 0, updatedAt: item.updatedAt || 0 };
          });
        } catch (e) {}
      }
      return { version: 1, type: 'xingyue-media-library', assets: assets };
    },
    write: function (next) {
      const lib = mediaLib();
      if (!lib) throw new Error('媒体库尚未就绪');
      const nextAssets = (next && next.assets) || {};
      const nextKeys = {};
      Object.keys(nextAssets).forEach(function (key) {
        const item = nextAssets[key];
        nextKeys[key] = true;
        lib.upsertAsset({ type: 'bond', name: item.name, slot: item.slot, variant: item.variant }, { dataUrl: item.dataUrl || '', url: item.url || '', mime: item.mime || '', bytes: item.bytes || 0 });
      });
      lib.listManagedAssets().forEach(function (item) {
        if (item.type !== 'bond') return;
        if (!nextKeys[mediaKeyOf(item)]) lib.removeAsset({ type: 'bond', name: item.name, slot: item.slot, variant: item.variant });
      });
      return true;
    }
  };

  /* ---------- 羁绊/删除写入（星月变量根/schema） ---------- */
  function bridgeMessageId() {
    let value = null;
    try { if (typeof getLastMessageId === 'function') value = getLastMessageId(); } catch (e) {}
    try { if (value === null && typeof getCurrentMessageId === 'function') value = getCurrentMessageId(); } catch (e) {}
    try {
      const helper = getTavernHelper();
      if (value === null && helper && typeof helper.getLastMessageId === 'function') value = helper.getLastMessageId();
      if (value === null && helper && typeof helper.getCurrentMessageId === 'function') value = helper.getCurrentMessageId();
    } catch (e) {}
    try { if (value === null && typeof hostWindow.getLastMessageId === 'function') value = hostWindow.getLastMessageId(); } catch (e) {}
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
  }
  function bridgeMessageMatches(messageId) { return messageId !== null && String(bridgeMessageId()) === String(messageId); }
  function copyMvuData(value) { try { if (typeof structuredClone === 'function') return structuredClone(value); } catch (e) {} try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; } }
  function getSchema() { try { if (helperWindow.__xingyueMvuSchema) return helperWindow.__xingyueMvuSchema; } catch (e) {} try { return hostWindow.__xingyueMvuSchema || null; } catch (e) { return null; } }

  function writeCharacterBond(name) {
    name = String(name || '').trim();
    if (!name) return Promise.reject(new Error('角色姓名为空'));
    if (runtime.destroyed) return Promise.reject(new Error('小手机桥已销毁'));
    if (runtime.bondWritePending) return Promise.reject(new Error('另一项羁绊写入正在处理'));
    if (runtime.isGenerating || runtime.awaitingPersist || (runtime.phase !== 'stable' && runtime.phase !== 'cold')) return Promise.reject(new Error('变量正在结算，请稍后再试'));
    const mvu = getMvu(), messageId = bridgeMessageId(), epoch = runtime.chatEpoch, options = { type: 'message', message_id: messageId };
    if (messageId === null) return Promise.reject(new Error('无法确认当前最新楼层，请稍后再试'));
    if (!mvu || typeof mvu.getMvuData !== 'function' || typeof mvu.replaceMvuData !== 'function') return Promise.reject(new Error('MVU 写入接口尚未就绪'));
    let current = null, next = null;
    try { current = mvu.getMvuData(options); } catch (error) { return Promise.reject(error); }
    next = copyMvuData(current);
    if (!next || !next.stat_data || typeof next.stat_data !== 'object') return Promise.reject(new Error('当前楼层变量尚未就绪'));
    const archive = next.stat_data.角色档案;
    if (!archive || typeof archive !== 'object' || Array.isArray(archive) || !archive[name] || typeof archive[name] !== 'object' || Array.isArray(archive[name])) return Promise.reject(new Error('角色档案缺失：' + name));
    if (archive[name].羁绊标签 === true) return Promise.resolve(true);
    archive[name].羁绊标签 = true;
    archive[name].角色类型 = '羁绊';
    const schema = getSchema();
    if (!schema || typeof schema.parse !== 'function') return Promise.reject(new Error('变量 schema 尚未就绪'));
    try { next.stat_data = schema.parse(next.stat_data); } catch (error) { return Promise.reject(error); }
    if (epoch !== runtime.chatEpoch || !bridgeMessageMatches(messageId)) return Promise.reject(new Error('对话或楼层已切换，请重新操作'));
    runtime.bondWritePending = true;
    let task = null;
    try { task = mvu.replaceMvuData(next, options); } catch (error) { runtime.bondWritePending = false; return Promise.reject(error); }
    return Promise.resolve(task).then(function () {
      runtime.bondWritePending = false;
      if (runtime.destroyed || epoch !== runtime.chatEpoch || !bridgeMessageMatches(messageId)) throw new Error('对话或楼层已切换，旧操作不再回写当前界面');
      commitMvuData(next);
      runtime.phase = 'stable';
      requestRefresh(0);
      return true;
    }, function (error) { runtime.bondWritePending = false; throw error; });
  }

  function removeMvuRecord(path) {
    path = String(path || '').trim();
    if (!path || path.indexOf('/') < 0) return Promise.reject(new Error('删除路径无效'));
    const rootKey = path.split('/')[0];
    if (['居所', '载具', '资产库', '雷达系统'].indexOf(rootKey) < 0) return Promise.reject(new Error('该变量根不允许玩家删除'));
    if (runtime.destroyed) return Promise.reject(new Error('小手机桥已销毁'));
    if (runtime.bondWritePending) return Promise.reject(new Error('另一项写入正在处理'));
    if (runtime.isGenerating || runtime.awaitingPersist || (runtime.phase !== 'stable' && runtime.phase !== 'cold')) return Promise.reject(new Error('变量正在结算，请稍后再试'));
    const mvu = getMvu(), messageId = bridgeMessageId(), epoch = runtime.chatEpoch, options = { type: 'message', message_id: messageId };
    if (messageId === null) return Promise.reject(new Error('无法确认当前最新楼层，请稍后再试'));
    if (!mvu || typeof mvu.getMvuData !== 'function' || typeof mvu.replaceMvuData !== 'function') return Promise.reject(new Error('MVU 写入接口尚未就绪'));
    let current = null, next = null;
    try { current = mvu.getMvuData(options); } catch (error) { return Promise.reject(error); }
    next = copyMvuData(current);
    if (!next || !next.stat_data || typeof next.stat_data !== 'object') return Promise.reject(new Error('当前楼层变量尚未就绪'));
    const parts = path.split('/'); let parent = next.stat_data;
    for (let i = 0; i < parts.length - 1; i++) {
      parent = parent && parent[parts[i]];
      if (!parent || typeof parent !== 'object') return Promise.reject(new Error('路径不存在：' + path));
    }
    const leaf = parts[parts.length - 1];
    if (!Object.prototype.hasOwnProperty.call(parent, leaf)) return Promise.reject(new Error('条目不存在：' + path));
    delete parent[leaf];
    const schema = getSchema();
    if (schema && typeof schema.parse === 'function') { try { next.stat_data = schema.parse(next.stat_data); } catch (error) { return Promise.reject(error); } }
    if (epoch !== runtime.chatEpoch || !bridgeMessageMatches(messageId)) return Promise.reject(new Error('对话或楼层已切换，请重新操作'));
    runtime.bondWritePending = true;
    let task = null;
    try { task = mvu.replaceMvuData(next, options); } catch (error) { runtime.bondWritePending = false; return Promise.reject(error); }
    return Promise.resolve(task).then(function () {
      runtime.bondWritePending = false;
      if (runtime.destroyed || epoch !== runtime.chatEpoch || !bridgeMessageMatches(messageId)) throw new Error('对话或楼层已切换，旧操作不再回写当前界面');
      commitMvuData(next);
      runtime.phase = 'stable';
      requestRefresh(0);
      return true;
    }, function (error) { runtime.bondWritePending = false; throw error; });
  }

  /* ---------- 桥暴露 ---------- */
  function exposeBridge(target) {
    if (!target) return;
    try {
      target.__xyPhoneStat = getStat;
      target.__xyPhoneSend = doSend;
      target.__xyPhoneInput = doInput;
      target.__xyPhoneAi = AI_BRIDGE;
      target.__xyPhoneMedia = MEDIA_BRIDGE;
      target.__xyPhoneBond = writeCharacterBond;
      target.__xyPhoneRemove = removeMvuRecord;
    } catch (e) {}
  }
  function clearBridge(target) {
    if (!target) return;
    try { if (target.__xyPhoneStat === getStat) delete target.__xyPhoneStat; } catch (e) {}
    try { if (target.__xyPhoneSend === doSend) delete target.__xyPhoneSend; } catch (e) {}
    try { if (target.__xyPhoneInput === doInput) delete target.__xyPhoneInput; } catch (e) {}
    try { if (target.__xyPhoneAi === AI_BRIDGE) delete target.__xyPhoneAi; } catch (e) {}
    try { if (target.__xyPhoneMedia === MEDIA_BRIDGE) delete target.__xyPhoneMedia; } catch (e) {}
    try { if (target.__xyPhoneBond === writeCharacterBond) delete target.__xyPhoneBond; } catch (e) {}
    try { if (target.__xyPhoneRemove === removeMvuRecord) delete target.__xyPhoneRemove; } catch (e) {}
  }

  /* ---------- 挂载/卸载 phone-hud 前端 ---------- */
  function hudSourceKey(source) {
    source = String(source || '');
    let hash = 5381;
    for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash) ^ source.charCodeAt(i);
    return source.length + ':' + (hash >>> 0).toString(36);
  }
  function destroyMountedRoot() {
    const root = runtime.root;
    runtime.root = null;
    runtime.hudSourceKey = '';
    if (!root) return;
    try { if (typeof root.__xyPhoneDestroy === 'function') root.__xyPhoneDestroy(); } catch (e) {}
    try { root.remove(); } catch (e) { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (_e) {} }
  }
  function mountHud(source, sourceKey) {
    if (runtime.destroyed || !hostDocument || !hostDocument.body) return false;
    source = typeof source === 'string' ? source : '';
    if (!source) return false;
    sourceKey = sourceKey || hudSourceKey(source);
    let node = null;
    try {
      const template = hostDocument.createElement('template');
      template.innerHTML = source.trim();
      node = template.content.querySelector('#xy-phone-root');
      if (!node) throw new Error('phone hud root missing');
      const script = node.querySelector('script');
      if (!script) throw new Error('phone hud script missing');
      const scriptText = script.textContent || '';
      script.remove();
      const stale = hostDocument.getElementById('xy-phone-root');
      if (stale && stale !== node) {
        try { if (typeof stale.__xyPhoneDestroy === 'function') stale.__xyPhoneDestroy(); } catch (e) {}
        try { stale.remove(); } catch (e) {}
      }
      hostDocument.body.appendChild(node);
      runtime.root = node;
      runtime.hudSourceKey = sourceKey;
      node.setAttribute('data-xyph-build', runtime.build);
      node.__xyPhoneHudSourceKey = sourceKey;
      const raf = typeof hostWindow.requestAnimationFrame === 'function' ? hostWindow.requestAnimationFrame.bind(hostWindow) : function (fn) { return hostWindow.setTimeout(fn, 16); };
      const caf = typeof hostWindow.cancelAnimationFrame === 'function' ? hostWindow.cancelAnimationFrame.bind(hostWindow) : function (id) { hostWindow.clearTimeout(id); };
      const runHud = new Function('window', 'document', 'eventOn', 'Mvu', 'requestAnimationFrame', 'cancelAnimationFrame', scriptText + '\n//# sourceURL=xingyue-phone-hud-host.js');
      runHud(hostWindow, hostDocument, getEventOn(), getMvu(), raf, caf);
      if (!node.__xyPhoneInit || typeof node.__xyPhoneRender !== 'function') throw new Error('phone hud initialization incomplete');
      return true;
    } catch (error) {
      try { console.warn('[星月终端] 小手机挂载失败', error); } catch (e) {}
      try { if (node && typeof node.__xyPhoneDestroy === 'function') node.__xyPhoneDestroy(); } catch (e) {}
      if (node === runtime.root) { runtime.root = null; runtime.hudSourceKey = ''; }
      try { if (node) node.remove(); } catch (e) {}
      return false;
    }
  }
  function refreshHud() {
    if (runtime.destroyed) return;
    const root = runtime.root;
    if (root && root.isConnected !== false && typeof root.__xyPhoneRender === 'function') { root.__xyPhoneRender(); return; }
  }
  function requestRefresh(delay) { schedule('refresh', refreshHud, typeof delay === 'number' ? delay : 60); }

  /* ---------- 事件订阅 ---------- */
  function bindTavernEvents() {
    if (runtime.tavernEventsBound) return true;
    const events = getTavernEvents();
    if (!events || !events.CHAT_CHANGED || !events.GENERATION_ENDED || !events.MESSAGE_UPDATED) return false;
    let coreBound = true;
    coreBound = bindEvent(events.CHAT_CHANGED, function () { beginNavigation(true, 300); }) && coreBound;
    coreBound = bindEvent(events.GENERATION_STARTED, function (_type, _option, dryRun) {
      if (dryRun) return;
      syncLatestStat(runtime.chatEpoch, false);
      clearTimer('stat-finalize'); clearTimer('stat-reconcile');
      runtime.isGenerating = true; runtime.awaitingPersist = false; runtime.activeUpdateChatEpoch = runtime.chatEpoch; runtime.phase = 'generating';
      requestRefresh(0);
    }) && coreBound;
    coreBound = bindEvent(events.GENERATION_ENDED, function () {
      if (runtime.phase === 'aborted' || runtime.phase === 'switching') return;
      runtime.isGenerating = false; runtime.awaitingPersist = true; runtime.phase = 'awaiting-persist';
      const chatEpoch = runtime.chatEpoch;
      schedule('stat-finalize', function () { if (runtime.phase === 'awaiting-persist') syncLatestStat(chatEpoch, true); }, 1200);
      requestRefresh(0);
    }) && coreBound;
    coreBound = bindEvent(events.GENERATION_STOPPED, function () {
      runtime.isGenerating = false; runtime.awaitingPersist = true; runtime.activeUpdateChatEpoch = null; runtime.phase = 'aborted';
      clearTimer('stat-finalize'); clearTimer('stat-reconcile');
      requestRefresh(0);
    }) && coreBound;
    if (events.MESSAGE_RECEIVED) bindEvent(events.MESSAGE_RECEIVED, function () { requestRefresh(0); });
    coreBound = bindEvent(events.MESSAGE_UPDATED, function () {
      requestRefresh(0);
      const chatEpoch = runtime.chatEpoch;
      if (runtime.phase === 'awaiting-persist') schedule('stat-reconcile', function () { syncLatestStat(chatEpoch, true); }, 300);
      else if (runtime.phase === 'stable') schedule('stat-reconcile', function () { syncLatestStat(chatEpoch, false); }, 80);
    }) && coreBound;
    [events.MESSAGE_EDITED, events.MESSAGE_DELETED, events.MESSAGE_SWIPED].forEach(function (type) { if (type) bindEvent(type, function () { beginNavigation(false, 280); }); });
    [events.CHARACTER_MESSAGE_RENDERED, events.USER_MESSAGE_RENDERED].forEach(function (type) { if (type) bindEvent(type, function () { requestRefresh(0); }); });
    if (!coreBound) {
      runtime.stops.splice(0).forEach(function (stop) { try { stop(); } catch (e) {} });
      return false;
    }
    runtime.tavernEventsBound = true;
    return true;
  }
  function awaitTavernEvents(attempt) {
    if (runtime.destroyed || bindTavernEvents()) return;
    if (attempt < 119) schedule('tavern-events', function () { awaitTavernEvents(attempt + 1); }, 250);
  }
  function bindMvuEvents() {
    if (runtime.mvuEventsBound) return true;
    const mvu = getMvu();
    if (!mvu || !mvu.events) return false;
    runtime.mvu = mvu;
    const stopStart = runtime.stops.length;
    const initBound = bindEvent(mvu.events.VARIABLE_INITIALIZED, function (variables) {
      if (runtime.phase === 'switching') { syncLatestStat(runtime.chatEpoch, false); return; }
      if (runtime.phase !== 'cold') return;
      if (commitMvuData(variables)) { runtime.isGenerating = false; runtime.awaitingPersist = false; runtime.activeUpdateChatEpoch = null; runtime.phase = 'stable'; requestRefresh(0); }
    });
    const startedBound = bindEvent(mvu.events.VARIABLE_UPDATE_STARTED, function () {
      if (runtime.phase === 'aborted' || runtime.phase === 'switching') return;
      if (runtime.phase === 'cold') syncLatestStat(runtime.chatEpoch, false);
      runtime.isGenerating = true; runtime.awaitingPersist = false; runtime.activeUpdateChatEpoch = runtime.chatEpoch; runtime.phase = 'updating';
      clearTimer('stat-finalize'); requestRefresh(0);
    });
    const endedBound = bindEvent(mvu.events.VARIABLE_UPDATE_ENDED, function (variables) {
      if (runtime.phase === 'aborted' || runtime.phase === 'switching') return;
      if (runtime.activeUpdateChatEpoch !== null && runtime.activeUpdateChatEpoch !== runtime.chatEpoch) return;
      if (commitMvuData(variables)) { runtime.isGenerating = false; runtime.awaitingPersist = true; runtime.activeUpdateChatEpoch = runtime.chatEpoch; runtime.phase = 'awaiting-persist'; requestRefresh(0); }
    });
    let beforeBound = true;
    if (mvu.events.BEFORE_MESSAGE_UPDATE) {
      beforeBound = bindEvent(mvu.events.BEFORE_MESSAGE_UPDATE, function (context) {
        if (runtime.phase === 'aborted' || runtime.phase === 'switching') return;
        if (!context || !context.variables) return;
        if (commitMvuData(context.variables)) { runtime.isGenerating = false; runtime.awaitingPersist = true; runtime.phase = 'awaiting-persist'; requestRefresh(0); }
      });
    }
    if (!initBound || !startedBound || !endedBound || !beforeBound) {
      runtime.stops.splice(stopStart).forEach(function (stop) { try { stop(); } catch (e) {} });
      return false;
    }
    runtime.mvuEventsBound = true;
    if (runtime.phase === 'cold' && !syncLatestStat(runtime.chatEpoch, false)) scheduleStableSync(runtime.chatEpoch, 0, 0);
    requestRefresh(0);
    return true;
  }
  function awaitMvu(attempt) {
    if (runtime.destroyed || bindMvuEvents()) return;
    if (attempt === 0) {
      try {
        if (typeof waitGlobalInitialized === 'function') {
          Promise.resolve(waitGlobalInitialized('Mvu')).then(function (mvu) { if (mvu) runtime.mvu = mvu; if (!runtime.destroyed) bindMvuEvents(); }).catch(function () {});
        }
      } catch (e) {}
    }
    if (attempt < 119) schedule('mvu', function () { awaitMvu(attempt + 1); }, 250);
  }

  /* ---------- 销毁 ---------- */
  function destroy() {
    if (runtime.destroyed) return;
    runtime.destroyed = true;
    cancelAllAiGenerations();
    Object.keys(runtime.timers).forEach(clearTimer);
    runtime.stops.splice(0).forEach(function (stop) { try { stop(); } catch (e) {} });
    destroyMountedRoot();
    clearBridge(helperWindow);
    if (hostWindow !== helperWindow) clearBridge(hostWindow);
    try { if (helperWindow[RUNTIME_KEY] === runtime) delete helperWindow[RUNTIME_KEY]; } catch (e) {}
    try { if (hostWindow[HUD_RUNTIME_KEY] === runtime) delete hostWindow[HUD_RUNTIME_KEY]; } catch (e) {}
  }

  /* ---------- 挂载入口（fetchText phone-hud + 挂 body） ---------- */
  let hudHtmlCache = '';
  async function loadHudHtml() {
    if (hudHtmlCache) return hudHtmlCache;
    if (integrity && typeof integrity.fetchText === 'function') {
      const text = await integrity.fetchText('phone-hud', { timeoutMs: 12000 });
      hudHtmlCache = String(text || '');
      return hudHtmlCache;
    }
    // 卡内兜底：离线回退时从 loader 嵌入的 phone-hud 副本读
    const embedded = (() => { try { return hostWindow.__xyPhoneHudEmbedded || helperWindow.__xyPhoneHudEmbedded || ''; } catch (_) { return ''; } })();
    if (embedded) { hudHtmlCache = String(embedded); return hudHtmlCache; }
    throw new Error('runtime integrity 尚未就绪，无法加载小手机前端');
  }
  async function mount() {
    if (runtime.destroyed) throw new Error('小手机桥已销毁');
    const source = await loadHudHtml();
    if (!source) throw new Error('小手机前端为空');
    if (runtime.root && runtime.root.isConnected !== false && typeof runtime.root.__xyPhoneRender === 'function' && runtime.root.__xyPhoneHudSourceKey === hudSourceKey(source)) {
      runtime.root.__xyPhoneRender();
      return true;
    }
    destroyMountedRoot();
    if (!mountHud(source, hudSourceKey(source))) throw new Error('小手机前端挂载失败');
    // 双模态切换进入时自动展开手机壳（而非收起待拖）
    try { if (runtime.root && typeof runtime.root.__xyPhoneSettle === 'function') runtime.root.__xyPhoneSettle(true); } catch (e) {}
    return true;
  }

  // 启动：暴露桥 + 订阅事件 + 初始同步
  exposeBridge(helperWindow);
  if (hostWindow !== helperWindow) exposeBridge(hostWindow);
  awaitTavernEvents(0);
  awaitMvu(0);
  if (!syncLatestStat(runtime.chatEpoch, false)) scheduleStableSync(runtime.chatEpoch, 0, 0);

  return {
    version: VERSION,
    mount: mount,
    unmount: function () { destroyMountedRoot(); },
    isOpen: function () { return !!(runtime.root && runtime.root.isConnected !== false); },
    get destroyed() { return runtime.destroyed; },
    getStat: getStat,
    destroy: destroy,
    refresh: function () { requestRefresh(0); }
  };
}

/* ================= 导出（控制中心调用） ================= */
export async function mountPhone(ctx) {
  const hostWindow = resolveHostWindow();
  const previous = singleton || hostWindow[HUD_RUNTIME_KEY];
  if (previous && typeof previous.destroy === 'function' && previous !== singleton) {
    try { previous.destroy(); } catch (e) {}
  }
  if (singleton && !singleton.destroyed) {
    await singleton.mount();
    return singleton;
  }
  singleton = createRuntime(ctx || {});
  try { hostWindow[HUD_RUNTIME_KEY] = singleton; } catch (e) {}
  await singleton.mount();
  return singleton;
}

export function unmountPhone() {
  if (singleton && typeof singleton.unmount === 'function') singleton.unmount();
}

export function isPhoneOpen() {
  return !!(singleton && typeof singleton.isOpen === 'function' && singleton.isOpen());
}

export async function togglePhone(ctx) {
  if (isPhoneOpen()) { unmountPhone(); return false; }
  await mountPhone(ctx); return true;
}

export function getPhoneStat() {
  return singleton && typeof singleton.getStat === 'function' ? singleton.getStat() : null;
}

export function destroyPhone() {
  if (singleton && typeof singleton.destroy === 'function') singleton.destroy();
  singleton = null;
}

export { VERSION };
