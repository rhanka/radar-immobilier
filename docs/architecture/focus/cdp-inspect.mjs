import { writeFile } from 'node:fs/promises';

const cdpPort = process.env.CDP_PORT ?? '9222';
const targetId = process.env.TARGET_ID;
if (!targetId) throw Error('TARGET_ID is required');
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const target = targets.find(candidate => candidate.id === targetId);
if (!target) throw Error(`Target ${targetId} not found`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), events = [];
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'].includes(data.method)) events.push(data);
  const request = pending.get(data.id);
  if (request) { pending.delete(data.id); data.error ? request.reject(data.error) : request.resolve(data.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
const windowState = await call('Browser.getWindowForTarget', { targetId });
const layoutBefore = await call('Page.getLayoutMetrics');
const probe = `(() => {
  const sample = selector => {
    const element = document.querySelector(selector); if (!element) return null;
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style.display,
      visibility: style.visibility, opacity: style.opacity, color: style.color, background: style.backgroundColor };
  };
  return {
  viewport: { innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY,
    visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, visualScale: visualViewport?.scale },
  documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
  samples: Object.fromEntries(['html', 'body', '#app', '.dossier', '.masthead'].map(selector => [selector, sample(selector)])),
  topElement: document.elementFromPoint(innerWidth / 2, Math.min(innerHeight / 2, 500))?.outerHTML?.slice(0, 500) ?? null,
  url: location.href, readyState: document.readyState,
  title: document.title, bodyText: document.body?.innerText?.slice(0, 1000) ?? '',
  bodyChildren: document.body?.children.length ?? -1,
  appHtml: document.querySelector('#app')?.innerHTML?.slice(0, 2000) ?? null,
  scripts: [...document.scripts].map(script => ({ src: script.src, type: script.type })),
  resources: performance.getEntriesByType('resource').map(entry => entry.name)
  };
})()`;
const before = await evaluate(probe);
await writeFile('/out/live-before.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await call('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 1500));
const after = await evaluate(probe);
await writeFile('/out/live-after.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const summary = await evaluate(`(() => {
  const element = document.querySelector('.monthly-summary');
  if (!element) return { exists: false };
  element.scrollIntoView({ block: 'start' });
  return { exists: true, text: element.textContent.trim().slice(0, 2000), links: [...element.querySelectorAll('a')].map(link => link.href) };
})()`);
await new Promise(resolve => setTimeout(resolve, 250));
await writeFile('/out/live-summary.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const layoutAfter = await call('Page.getLayoutMetrics');
const evidence = { target: { id: target.id, url: target.url }, windowState, layoutBefore, layoutAfter, before, after, summary, events };
await writeFile('/out/live-inspection.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
ws.close();
