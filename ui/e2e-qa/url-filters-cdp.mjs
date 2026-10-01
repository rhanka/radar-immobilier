import { chromium } from '@playwright/test';

/** Attach only the newly created test tab; never auto-attach user tabs. */
export async function dedicatedCdpPage(endpoint = 'http://127.0.0.1:9222') {
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  const control = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { control.onopen = resolve; control.onerror = reject; });
  let sequence = 0;
  const requests = new Map();
  control.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    requests.get(message.id)?.(message);
  };
  async function command(method, params) {
    const id = ++sequence;
    const reply = new Promise(resolve => {
      requests.set(id, resolve);
      control.send(JSON.stringify({ id, method, params }));
    });
    let timer;
    try {
      const result = await Promise.race([reply, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${method} timed out`)), 3000);
      })]);
      if (result.error) throw new Error(JSON.stringify(result.error));
      return result.result;
    } finally { clearTimeout(timer); requests.delete(id); }
  }
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const transport = {
    send(message) {
      if (!message.sessionId && message.method === 'Target.setAutoAttach') {
        message = { ...message, method: 'Target.attachToTarget', params: { targetId, flatten: true } };
      }
      if (!message.sessionId && message.method === 'Target.getTargetInfo') message.params = { targetId };
      ws.send(JSON.stringify(message));
    },
    close() { ws.close(); },
    onmessage: undefined, onclose: undefined,
  };
  ws.onmessage = ({ data }) => transport.onmessage?.(JSON.parse(data));
  ws.onclose = () => transport.onclose?.();
  let browser;
  try {
    browser = await chromium.connectOverCDP(transport, { noDefaults: true, timeout: 10000 });
    const page = browser.contexts()[0].pages()[0];
    if (!page) throw new Error('Dedicated CDP target was not attached');
    return {
      page, version: version.Browser, targetId,
      async close() {
        await command('Target.closeTarget', { targetId });
        await browser.close();
        control.close();
      },
    };
  } catch (error) {
    await command('Target.closeTarget', { targetId });
    ws.close(); control.close();
    throw error;
  }
}
