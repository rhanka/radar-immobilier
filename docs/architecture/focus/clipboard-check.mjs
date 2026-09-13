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
  const waitUntil = async (expression, failure) => {
    const until = Date.now() + 3000;
    do {
      try { if (await evaluate(expression)) return; }
      catch (error) { if (error?.code !== -32000) throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < until);
    throw Error(failure);
  };
  await waitUntil(`Boolean(document.querySelector('.steps button'))`, 'Dossier missing');
  console.log(await evaluate(`(async () => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 120));
    const previousClipboard = await navigator.clipboard.readText();
    try {
      document.querySelectorAll('.steps button')[7].click(); await settle();
      const note = document.querySelector('.choices textarea'); note.value = 'Frontière précédente et cutoff à vérifier.'; note.dispatchEvent(new Event('input', { bubbles: true })); await settle();
      [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier les instructions en JSON').click(); await settle();
      const pack = JSON.parse(await navigator.clipboard.readText());
      if (pack.revision !== 'D5' || pack.ownerCorrection.option !== null || pack.note !== note.value || pack.fixedInstructions.reporting.start !== null || pack.fixedInstructions.reporting.captureCutoffs.architectureRuntime !== '2026-09-13T15:38:00Z' || pack.fixedInstructions.reporting.captureCutoffs.transitionImplementation !== '2026-09-13T15:39:00Z' || pack.fixedInstructions.reporting.captureCutoffs.latestTransitionAudit !== null || pack.fixedInstructions.reporting.captureCutoffs.unifiedDeliveryTokenBilling !== null || pack.fixedInstructions.transitionEvidence.t2.decision !== 'MIGRATE+RETAIN' || pack.fixedInstructions.transitionEvidence.t3.verdict !== 'NO-GO today' || pack.fixedInstructions.billing.node.projectedAmountCad !== null || 'decision' in pack || 'options' in pack) throw Error('Real clipboard content mismatch');
      document.querySelector('.choices').scrollIntoView({ behavior: 'instant' });
      return { actualClipboard: 'pass', revision: pack.revision, priorOption: pack.ownerCorrection.option, comment: 'exact', currentAmount: pack.fixedInstructions.billing.node.projectedAmountCad, status: pack.status };
    } finally { await navigator.clipboard.writeText(previousClipboard); }
  })()`));
  await writeFile('/out/choices-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'));
} finally { clearTimeout(timeout); await call('Target.disposeBrowserContext', { browserContextId }); ws.close(); }
