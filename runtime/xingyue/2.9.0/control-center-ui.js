(() => {
  const runtime = {
    id: 'control-center-ui',
    cardScope: 'xingyue',
    cardVersion: '2.9.0',
    runtimeVersion: '0.1.0',
    loadedAt: new Date().toISOString(),
    capabilities: ['metadata', 'workshop-gateway-contract'],
    gatewayContract: {
      publicIndex: 'GET /api/workshop/packages',
      publicDetail: 'GET /api/workshop/packages/:id',
      publish: 'POST /api/workshop/packages',
      update: 'PUT /api/workshop/packages/:id with X-Package-Revision',
      withdraw: 'DELETE /api/workshop/packages/:id',
      ownerList: 'GET /api/workshop/me/packages',
    },
    attach(root) {
      if (!root || typeof root.appendChild !== 'function') {
        throw new Error('control-center-ui requires a DOM root');
      }
      const marker = document.createElement('div');
      marker.dataset.xingyueRuntime = 'control-center-ui';
      marker.hidden = true;
      marker.textContent = 'remote-runtime-placeholder';
      root.appendChild(marker);
      return marker;
    },
  };

  window.XingyueRuntime = window.XingyueRuntime || {};
  window.XingyueRuntime.controlCenterUi = runtime;
  window.dispatchEvent(new CustomEvent('xingyue:runtime-ready', {
    detail: { moduleId: runtime.id, runtimeVersion: runtime.runtimeVersion },
  }));
})();
