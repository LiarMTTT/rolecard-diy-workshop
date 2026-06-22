(() => {
  const runtime = {
    id: 'statusbar-renderer',
    cardScope: 'xingyue',
    cardVersion: '2.9.0',
    runtimeVersion: '0.1.0',
    loadedAt: new Date().toISOString(),
    capabilities: ['metadata', 'compatibility-check'],
    render(root, data = {}) {
      if (!root || typeof root.appendChild !== 'function') {
        throw new Error('statusbar-renderer requires a DOM root');
      }
      const note = document.createElement('div');
      note.dataset.xingyueRuntime = 'statusbar-renderer';
      note.hidden = true;
      note.textContent = JSON.stringify({
        status: 'remote-runtime-placeholder',
        cardVersion: runtime.cardVersion,
        runtimeVersion: runtime.runtimeVersion,
        keys: Object.keys(data || {}),
      });
      root.appendChild(note);
      return note;
    },
  };

  window.XingyueRuntime = window.XingyueRuntime || {};
  window.XingyueRuntime.statusbarRenderer = runtime;
  window.dispatchEvent(new CustomEvent('xingyue:runtime-ready', {
    detail: { moduleId: runtime.id, runtimeVersion: runtime.runtimeVersion },
  }));
})();
