(() => {
  const DEFAULT_ALLOWED_HOSTS = [
    'liarmttt.github.io',
    'raw.githubusercontent.com',
  ];
  const CACHE_PREFIX = 'xingyue-runtime-cache:';

  function bytesToHex(buffer) {
    return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
  }

  function assertAllowedUrl(rawUrl, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
    const url = new URL(rawUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported runtime protocol');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('remote runtime must use HTTPS');
    }
    if (!allowedHosts.includes(url.hostname) && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error(`runtime host is not allowed: ${url.hostname}`);
    }
    return url.toString();
  }

  function injectScriptText(text, moduleId) {
    const script = document.createElement('script');
    script.textContent = `${text}\n//# sourceURL=xingyue-runtime-${moduleId}.js`;
    document.head.appendChild(script);
    script.remove();
  }

  async function fetchModuleText(moduleConfig, allowedHosts) {
    const url = assertAllowedUrl(moduleConfig.url, allowedHosts);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`runtime fetch failed: ${moduleConfig.id} ${res.status}`);
    const text = await res.text();
    if (moduleConfig.sha256) {
      const actual = await sha256(text);
      if (actual !== moduleConfig.sha256) throw new Error(`runtime sha256 mismatch: ${moduleConfig.id}`);
    }
    return { text, url };
  }

  async function loadRuntimeManifest(manifestUrl, options = {}) {
    const manifestRes = await fetch(assertAllowedUrl(manifestUrl, options.allowedHosts), { cache: 'no-store' });
    if (!manifestRes.ok) throw new Error(`manifest fetch failed: ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    const loaded = [];
    const failed = [];
    for (const moduleConfig of manifest.modules || []) {
      if (!moduleConfig.url || moduleConfig.required === false && options.skipOptional === true) continue;
      const cacheKey = `${CACHE_PREFIX}${manifest.cardScope}:${manifest.cardVersion}:${moduleConfig.id}`;
      try {
        const fetched = await fetchModuleText(moduleConfig, options.allowedHosts);
        injectScriptText(fetched.text, moduleConfig.id);
        localStorage.setItem(cacheKey, JSON.stringify({
          url: fetched.url,
          sha256: moduleConfig.sha256 || '',
          text: fetched.text,
          cachedAt: new Date().toISOString(),
        }));
        loaded.push(moduleConfig.id);
      } catch (error) {
        const cached = localStorage.getItem(cacheKey);
        if (cached && options.allowCacheFallback !== false) {
          const parsed = JSON.parse(cached);
          injectScriptText(parsed.text, moduleConfig.id);
          loaded.push(`${moduleConfig.id}:cache`);
        } else {
          failed.push({ id: moduleConfig.id, error: error.message });
          if (moduleConfig.required) throw error;
        }
      }
    }
    return { manifest, loaded, failed };
  }

  window.XingyueRuntimeLoader = {
    loadRuntimeManifest,
    assertAllowedUrl,
  };
})();
