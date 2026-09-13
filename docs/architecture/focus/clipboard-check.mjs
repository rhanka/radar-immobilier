import { writeFile } from 'node:fs/promises';
const version = await (await fetch('http://127.0.0.1:9238/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const d = JSON.parse(event.data), p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.reject(d.error) : p.resolve(d.result); } };
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { browserContextId } = await call('Target.createBrowserContext');
const timeout = setTimeout(() => { console.error('Clipboard test timed out'); process.exit(1); }, 15000);
try {
  await call('Browser.grantPermissions', { browserContextId, origin: 'http://127.0.0.1:5188', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const { targetId } = await call('Target.createTarget', { browserContextId, url: 'http://127.0.0.1:5188/' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Page.bringToFront', {}, sessionId);
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await evaluate(`new Promise((resolve, reject) => { const end = Date.now() + 2000; const check = () => document.querySelector('.steps button') ? resolve(true) : Date.now() > end ? reject(Error('Dossier missing')) : requestAnimationFrame(check); check(); })`);
  console.log(await evaluate(`(async () => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 120));
    const previousClipboard = await navigator.clipboard.readText();
    try {
      document.querySelectorAll('.steps button')[3].click(); await settle();
      document.querySelector('input[type="radio"][value="USAGE"]').click(); await settle();
      const note = document.querySelector('.choices textarea'); note.value = 'Usage — sous réserve de la déduplication.'; note.dispatchEvent(new Event('input', { bubbles: true })); await settle();
      [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier la réponse en JSON').click(); await settle();
      const pack = JSON.parse(await navigator.clipboard.readText());
      if (pack.decision.option !== 'USAGE' || pack.decision.key !== 'llm-allocation-method' || pack.decision.note !== note.value || pack.options.length !== 3 || pack.status !== 'draft-not-ratified') throw Error('Real clipboard content mismatch');
      document.querySelector('.choices').scrollIntoView({ behavior: 'instant' });
      return { actualClipboard: 'pass', choice: pack.decision.option, comment: 'exact', allOptions: pack.options.length, status: pack.status };
    } finally { await navigator.clipboard.writeText(previousClipboard); }
  })()`));
  await writeFile('/out/choices-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'));
} finally { clearTimeout(timeout); await call('Target.disposeBrowserContext', { browserContextId }); ws.close(); }
