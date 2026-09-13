import { writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?http://127.0.0.1:5188/`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(), errors = [], external = [];
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
  if (data.method === 'Network.requestWillBeSent' && /^https?:/.test(data.params.request.url) && !data.params.request.url.startsWith('http://127.0.0.1:5188')) external.push(data.params.request.url);
  if (pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(data.error) : p.resolve(data.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const timeout = setTimeout(() => { console.error('Browser verification timed out'); process.exit(1); }, 45000);
await call('Runtime.enable'); await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await evaluate(`new Promise((resolve, reject) => { const until = Date.now() + 2000; const check = () => document.querySelector('.svelte-flow__node') ? resolve(true) : Date.now() > until ? reject(Error('Native flow missing')) : requestAnimationFrame(check); check(); })`);
console.log(await evaluate(`(async () => {
  const settle = () => new Promise(resolve => setTimeout(resolve, 180));
  const choose = (label, value) => { const e = document.querySelector('select[aria-label="' + label + '"]'); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); };
  if (document.querySelectorAll('.steps button').length !== 8) throw Error('Eight dossier sections missing');
  const views = [...document.querySelector('select[aria-label="Vue architecture"]').options].map(o => o.value);
  let checked = 0;
  for (const view of views) {
    choose('Vue architecture', view); await settle();
    const scopes = [...document.querySelector('select[aria-label="Ouvrir un sous-flow"]').options].map(o => o.value);
    for (const scope of scopes) {
      choose('Ouvrir un sous-flow', scope); await settle();
      if (!document.querySelector('.svelte-flow__node-architecture')) throw Error('Empty flow ' + view + '/' + scope);
      if (scope && !document.querySelector('.svelte-flow__node-group')) throw Error('Native parentId group absent');
      checked++;
    }
  }
  choose('Vue architecture', 'asis-1'); await settle(); choose('Retrouver un composant', 'PP_DB'); await settle();
  if (!document.querySelector('.inspector').textContent.includes('PP-DB')) throw Error('DB inspector missing');
  [...document.querySelectorAll('.cross-link')].find(b => b.textContent.includes('PV →')).click(); await settle();
  if (document.querySelector('.flow').dataset.graph !== 'asis-2' || !document.querySelector('.inspector').textContent.includes('PP-DB')) throw Error('Shared DB cross-view navigation failed');
  const full = [...document.querySelectorAll('button')].find(b => b.textContent === 'Plein écran'); full.click(); await settle();
  if (!document.querySelector('.expanded')) throw Error('Fullscreen failed');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle();
  if (document.querySelector('.expanded')) throw Error('Escape failed');
  const input = document.querySelector('textarea'), previous = input.value;
  input.value = 'Automated test — local draft'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  if (!document.querySelector('.notes').textContent.includes('Brouillon enregistré')) throw Error('Local note not saved');
  input.value = previous; input.dispatchEvent(new Event('input', { bubbles: true }));
  const openEvidence = [...document.querySelectorAll('.source-links button')].find(b => b.textContent === 'decision-reviews'); openEvidence.click(); await settle();
  if (!document.querySelector('dialog[open]')?.textContent.includes('weekly')) throw Error('Embedded review evidence missing');
  document.querySelector('dialog').close(); await settle();
  if (document.querySelector('dialog')) throw Error('Dialog close failed');
  if (document.documentElement.scrollWidth > innerWidth) throw Error('Desktop overflow');
  document.querySelector('.explorer').scrollIntoView({ behavior: 'instant' });
  return { status: 'pass', views: views.length, nativeScenes: checked, resourceCrossLink: true, fullscreen: true, notes: 'local-only', evidence: 'embedded' };
})()`));
await writeFile('/out/flow-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await evaluate('window.scrollTo(0, 0)');
await writeFile('/out/dossier-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate('({ width: innerWidth, content: document.documentElement.scrollWidth })');
if (mobile.content > mobile.width) throw Error(`Mobile overflow ${JSON.stringify(mobile)}`);
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await call('Page.navigate', { url: 'file:///home/antoinefa/src/radar-immobilier/tmp/architecture-platform/docs/architecture/decision-focus.html' });
await evaluate(`new Promise((resolve, reject) => { const until = Date.now() + 2000; const check = () => document.querySelector('.svelte-flow__node') ? resolve(true) : Date.now() > until ? reject(Error('Offline native flow missing')) : requestAnimationFrame(check); check(); })`);
if (errors.length || external.length) throw Error(JSON.stringify({ errors, external }));
console.log(JSON.stringify({ mobile, offline: true, externalRequests: external.length, runtimeErrors: errors.length }));
clearTimeout(timeout); ws.close();
