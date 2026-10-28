// Client CDP borné à la cible dédiée ; aucun en-tête ni corps réseau conservé.
export async function connectTarget(url, WebSocketClass) {
  const socket = new WebSocketClass(url), pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.method) return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    message.error ? request.reject(new Error('cdp_command_failed')) : request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('cdp_connection_closed')); }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('cdp_connection_timeout')); }, 5000);
    socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('cdp_connection_closed')); }, { once: true });
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
