// Client CDP borné à la cible dédiée ; aucun en-tête ni corps réseau conservé.
export async function connectTarget(url, WebSocketClass, onEvent) {
  const socket = new WebSocketClass(url), pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.method) { onEvent(message.method, message.params ?? {}); return; }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    message.error ? request.reject(new Error('cdp_command_failed')) : request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('cdp_connection_timeout')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); socket.close(); reject(new Error('cdp_connection_failed')); }, { once: true });
  });
  return {
    call(method, params = {}, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('cdp_timeout')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error('cdp_send_failed')); }
      });
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('cdp_closed')); }
      pending.clear(); socket.close();
    },
  };
}
export function networkObserver(config, cases) {
  const requests = new Map(), failures = [];
  const paths = new Set(cases.map(x => x.path.split('?')[0]
    .replaceAll(':workspaceId', encodeURIComponent(config.workspaceId))
    .replaceAll(':citySlug', encodeURIComponent(config.citySlug))));
  return { failures, observe(method, params) {
    if (method === 'Network.requestWillBeSent') {
      try {
        const url = new URL(params.request.url);
        if (url.origin === config.origin && paths.has(url.pathname)) requests.set(params.requestId, url.pathname);
      } catch { /* Aucun contenu de requête n'est journalisé. */ }
    }
    if (method === 'Network.loadingFailed' && requests.has(params.requestId)) {
      const errorText = /^net::ERR_[A-Z0-9_]+$/.test(params.errorText) ? params.errorText : 'network_error';
      failures.push({ path: requests.get(params.requestId), errorText,
        blockedReason: /^[a-z-]{1,80}$/.test(params.blockedReason ?? '') ? params.blockedReason : undefined,
        corsError: /^[A-Za-z]{1,80}$/.test(params.corsErrorStatus?.corsError ?? '') ? params.corsErrorStatus.corsError : undefined });
    }
  } };
}
