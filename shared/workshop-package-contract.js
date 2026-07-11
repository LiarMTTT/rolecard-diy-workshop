const SUPPORTED_TYPES = new Set([
  'character',
  'user_identity',
  'world_factor',
  'shop_item',
  'blueprint',
  'recipe',
  'skill',
  'function',
]);

const BLOCKED_TYPES = new Set(['opening_pack', 'prompt_patch', 'ui_theme']);
const BASE_CARD_SCOPES = new Set(['xingyue', 'shared']);
const OPENING_CARD_SCOPE = 'xingyue-opening-v1';
const OPENING_TARGET = 'xingyue.opening_day_body';
const OPENING_SCHEMA_VERSION = 1;
const OPENING_MIN_RUNTIME_VERSION = '3.4.0';
const GRADE_BANDS = new Set(['primary', 'middle', 'high', 'university', 'none', 'custom', 'all']);
const RATINGS = new Set(['general', 'mature', 'restricted']);
const IDENTITY_TEXT_LIMITS = Object.freeze({
  identity: 80,
  grade: 80,
  callname: 80,
  background: 12000,
  appearance: 12000,
  skills: 12000,
  avatar: 2048,
  portrait: 2048,
});
const IDENTITY_FIELDS = new Set([
  ...Object.keys(IDENTITY_TEXT_LIMITS),
  'media',
  'core_attributes',
]);
const IDENTITY_ATTRIBUTES = new Set(['格斗', '平衡', '反应', '感知', '技巧', '精神']);

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, maxLength, code, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(code);
    return '';
  }
  if (typeof value !== 'string') fail(code);
  const text = value.trim();
  if (required && !text) fail(code);
  if (text.length > maxLength) fail(code);
  return text;
}

function cleanIdentityMediaReference(value, code) {
  const text = cleanString(value, 2048, code);
  if (!text) return '';
  if (/[\u0000-\u001f\u007f]/.test(text)) fail(code);
  if (/^(?:data|blob|file|javascript):/i.test(text)) fail(code);
  return text;
}

function containsEmbeddedImageData(value) {
  if (typeof value === 'string') return /data:image\//i.test(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsEmbeddedImageData);
  return Object.values(value).some(containsEmbeddedImageData);
}

function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value)).byteLength;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(value), 'utf8');
  return unescape(encodeURIComponent(String(value))).length;
}

function compareVersions(left, right) {
  const parse = value => {
    const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) fail('invalid-runtime-version', String(value || ''));
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function normalizeTags(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) fail('invalid-package-tags');
  const tags = value.map(tag => cleanString(tag, 40, 'invalid-package-tag', { required: true }));
  if (new Set(tags).size !== tags.length) fail('duplicate-package-tag');
  return tags;
}

function normalizeWorldFactors(payload, { allowLegacyFactors = true } = {}) {
  const source = Array.isArray(payload.worldFactors)
    ? payload.worldFactors
    : (allowLegacyFactors && Array.isArray(payload.factors) ? payload.factors : null);
  if (!source) fail('world-factors-required');
  return source.map((item, index) => {
    if (typeof item === 'string') {
      const content = cleanString(item, 16384, 'invalid-world-factor-content', { required: true }).replace(/\r\n?/g, '\n');
      return { title: `Legacy world factor ${index + 1}`, content };
    }
    if (!isObject(item)) fail('invalid-world-factor', String(index));
    return {
      ...clone(item),
      title: cleanString(item.title, 120, 'invalid-world-factor-title', { required: true }),
      content: cleanString(item.content, 16384, 'invalid-world-factor-content', { required: true })
        .replace(/\r\n?/g, '\n')
        .replace(/\{\{user\}\}/g, '{{player}}'),
    };
  });
}

function normalizeGradeScope(value) {
  if (!Array.isArray(value) || !value.length) fail('opening-grade-scope-required');
  const normalized = value.map(item => cleanString(item, 20, 'invalid-opening-grade-band', { required: true }));
  if (normalized.some(item => !GRADE_BANDS.has(item))) fail('invalid-opening-grade-band');
  if (new Set(normalized).size !== normalized.length) fail('duplicate-opening-grade-band');
  if (normalized.includes('all') && normalized.length !== 1) fail('opening-all-grade-band-must-be-alone');
  return normalized;
}

function assertOpeningBody(body) {
  if (body.includes('\0')) fail('opening-body-contains-nul');
  const macros = body.match(/\{\{[^{}]+\}\}/g) || [];
  if (macros.some(item => item !== '{{player}}' && item !== '{{grade}}' && item !== '{{user}}')) {
    fail('opening-body-contains-unsupported-macro');
  }
}

function normalizeOpeningPayload(payload, title, runtimeVersion, allowLegacyFactors) {
  const allowedPayloadKeys = new Set(['target', 'schemaVersion', 'compatibility', 'gradeScope', 'worldFactors', 'factors']);
  Object.keys(payload).forEach(key => {
    if (!allowedPayloadKeys.has(key)) fail('unknown-opening-payload-field', key);
  });
  if (allowLegacyFactors === false && Object.hasOwn(payload, 'factors')) fail('legacy-opening-factors-not-publishable');
  if (payload.schemaVersion !== OPENING_SCHEMA_VERSION) fail('invalid-opening-schema-version');
  if (payload.target !== OPENING_TARGET) fail('invalid-opening-target');
  if (!isObject(payload.compatibility)) fail('opening-compatibility-required');
  Object.keys(payload.compatibility).forEach(key => {
    if (key !== 'minRuntimeVersion') fail('unknown-opening-compatibility-field', key);
  });
  const minRuntimeVersion = cleanString(
    payload.compatibility.minRuntimeVersion,
    40,
    'opening-min-runtime-required',
    { required: true },
  );
  if (compareVersions(minRuntimeVersion, OPENING_MIN_RUNTIME_VERSION) < 0) fail('opening-min-runtime-too-old');
  if (runtimeVersion && compareVersions(runtimeVersion, minRuntimeVersion) < 0) fail('runtime-too-old');
  const worldFactors = normalizeWorldFactors(payload, { allowLegacyFactors });
  const sourceFactors = Array.isArray(payload.worldFactors) ? payload.worldFactors : payload.factors;
  sourceFactors.forEach((item, index) => {
    if (!isObject(item)) return;
    Object.keys(item).forEach(key => {
      if (key !== 'title' && key !== 'content') fail('unknown-opening-world-factor-field', `${index}:${key}`);
    });
  });
  if (!Array.isArray(payload.worldFactors) && Array.isArray(payload.factors) && typeof payload.factors[0] === 'string' && worldFactors.length === 1) {
    worldFactors[0].title = title;
  }
  if (worldFactors.length !== 1) fail('opening-world-factors-must-have-one-item');
  if (worldFactors[0].title !== title) fail('opening-title-mismatch');
  assertOpeningBody(worldFactors[0].content);
  if (utf8ByteLength(worldFactors[0].content) > 16384) fail('opening-body-too-large');
  const gradeScope = normalizeGradeScope(payload.gradeScope);
  return {
    target: OPENING_TARGET,
    schemaVersion: OPENING_SCHEMA_VERSION,
    compatibility: { minRuntimeVersion },
    gradeScope,
    worldFactors: worldFactors.map(item => ({ title: item.title, content: item.content })),
  };
}

function normalizeIdentityPayload(payload) {
  if (containsEmbeddedImageData(payload)) fail('embedded-identity-image-data');
  Object.keys(payload).forEach(key => {
    if (!IDENTITY_FIELDS.has(key)) fail('unknown-identity-field', key);
  });
  const normalized = {};
  for (const [field, limit] of Object.entries(IDENTITY_TEXT_LIMITS)) {
    if (payload[field] !== undefined) {
      if (typeof payload[field] !== 'string') fail(`invalid-identity-${field}`);
      normalized[field] = cleanString(payload[field], limit, `invalid-identity-${field}`);
    }
  }
  if (payload.avatar !== undefined) normalized.avatar = cleanIdentityMediaReference(payload.avatar, 'invalid-identity-avatar');
  if (payload.portrait !== undefined) normalized.portrait = cleanIdentityMediaReference(payload.portrait, 'invalid-identity-portrait');
  if (payload.media !== undefined) {
    if (!isObject(payload.media)) fail('invalid-identity-media');
    Object.keys(payload.media).forEach(key => {
      if (key !== 'avatar' && key !== 'portrait') fail('unknown-identity-media-field', key);
    });
    normalized.media = {};
    if (payload.media.avatar !== undefined) {
      if (typeof payload.media.avatar !== 'string') fail('invalid-identity-media-avatar');
      normalized.media.avatar = cleanIdentityMediaReference(payload.media.avatar, 'invalid-identity-media-avatar');
    }
    if (payload.media.portrait !== undefined) {
      if (typeof payload.media.portrait !== 'string') fail('invalid-identity-media-portrait');
      normalized.media.portrait = cleanIdentityMediaReference(payload.media.portrait, 'invalid-identity-media-portrait');
    }
  }
  if (payload.core_attributes !== undefined) {
    if (!isObject(payload.core_attributes)) fail('invalid-identity-core-attributes');
    normalized.core_attributes = {};
    for (const [key, value] of Object.entries(payload.core_attributes)) {
      if (!IDENTITY_ATTRIBUTES.has(key)) fail('unknown-identity-core-attribute', key);
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 30) {
        fail('invalid-identity-core-attribute', key);
      }
      normalized.core_attributes[key] = value;
    }
  }
  return normalized;
}

function normalizePackage(input, options = {}) {
  if (!isObject(input)) fail('package-not-object');
  if (JSON.stringify(input).length > 256 * 1024) fail('package-too-large');
  const pkg = clone(input);
  const type = cleanString(pkg.type, 40, 'invalid-package-type', { required: true });
  if (BLOCKED_TYPES.has(type)) fail('blocked-package-type', type);
  if (!SUPPORTED_TYPES.has(type)) fail('unsupported-package-type', type);
  if (Array.isArray(options.allowedTypes) && options.allowedTypes.length && !options.allowedTypes.includes(type)) {
    fail('package-type-not-allowed-here', type);
  }
  const id = cleanString(pkg.id, 120, 'invalid-package-id', { required: true });
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(id)) fail('invalid-package-id');
  const title = cleanString(pkg.title, 120, 'invalid-package-title', { required: true });
  const packageVersion = cleanString(pkg.packageVersion || pkg.version || '1.0.0', 40, 'invalid-package-version', { required: true });
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) fail('invalid-package-version');
  const cardScope = cleanString(pkg.cardScope || 'xingyue', 80, 'invalid-card-scope', { required: true });
  const payload = isObject(pkg.payload) ? clone(pkg.payload) : fail('package-payload-required');
  const openingByScope = cardScope === OPENING_CARD_SCOPE;
  const openingByTarget = type === 'world_factor' && payload.target === OPENING_TARGET;
  if (openingByScope !== openingByTarget) fail('opening-scope-target-mismatch');
  if (!openingByScope && !BASE_CARD_SCOPES.has(cardScope)) fail('unsupported-card-scope', cardScope);
  let normalizedPayload = payload;
  const allowLegacyFactors = options.allowLegacyFactors !== false;
  if (openingByScope) normalizedPayload = normalizeOpeningPayload(payload, title, options.runtimeVersion, allowLegacyFactors);
  else if (type === 'world_factor') {
    normalizedPayload = clone(payload);
    normalizedPayload.worldFactors = normalizeWorldFactors(payload, { allowLegacyFactors });
    delete normalizedPayload.factors;
  } else if (type === 'user_identity') normalizedPayload = normalizeIdentityPayload(payload);
  const rating = pkg.rating === undefined ? 'general' : cleanString(pkg.rating, 20, 'invalid-package-rating', { required: true });
  if (!RATINGS.has(rating)) fail('invalid-package-rating');
  const language = pkg.language === undefined ? 'zh-CN' : cleanString(pkg.language, 24, 'invalid-package-language', { required: true });
  if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(language)) fail('invalid-package-language');
  return {
    ...pkg,
    packageVersion,
    id,
    type,
    cardScope,
    title,
    summary: cleanString(pkg.summary, 600, 'invalid-package-summary'),
    authorName: cleanString(pkg.authorName || 'anonymous', 80, 'invalid-package-author'),
    rating,
    language,
    tags: normalizeTags(pkg.tags),
    payload: normalizedPayload,
  };
}

const api = Object.freeze({
  version: '1.0.0',
  OPENING_CARD_SCOPE,
  OPENING_TARGET,
  OPENING_SCHEMA_VERSION,
  OPENING_MIN_RUNTIME_VERSION,
  compareVersions,
  normalizePackage,
});

try { globalThis.XingyueWorkshopPackageContract = api; } catch (_) {}

export default api;
export {
  OPENING_CARD_SCOPE,
  OPENING_TARGET,
  OPENING_SCHEMA_VERSION,
  OPENING_MIN_RUNTIME_VERSION,
  compareVersions,
  normalizePackage,
};
