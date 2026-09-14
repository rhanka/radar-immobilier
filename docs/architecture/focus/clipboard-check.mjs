import { writeFile } from 'node:fs/promises';
const version = await (await fetch('http://127.0.0.1:9238/json/version')).json();
const focusPort = process.env.FOCUS_PORT ?? '5188';
const focusOrigin = `http://127.0.0.1:${focusPort}`;
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const d = JSON.parse(event.data), p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.reject(d.error) : p.resolve(d.result); } };
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { browserContextId } = await call('Target.createBrowserContext');
const timeout = setTimeout(() => { console.error('Clipboard test timed out'); process.exit(1); }, 15000);
try {
  await call('Browser.grantPermissions', { browserContextId, origin: focusOrigin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const { targetId } = await call('Target.createTarget', { browserContextId, url: `${focusOrigin}/` });
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
      document.querySelectorAll('.steps button')[5].click(); await settle();
      const radios = document.querySelectorAll('.question-block input[type="radio"]'); if (radios.length !== 9) throw Error('Expected 9 radios, got ' + radios.length + ': ' + document.querySelector('.decision-content').textContent.slice(0, 500)); radios[0].click(); radios[3].click();
      const note = document.querySelector('.question-block textarea'); note.value = 'Frontière précédente et cutoff à vérifier.'; note.dispatchEvent(new Event('input', { bubbles: true })); await settle();
      [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier les réponses en JSON').click(); await settle();
      const pack = JSON.parse(await navigator.clipboard.readText());
      const t2 = pack.fixedInstructions.transitionEvidence.t2;
      if (pack.revision !== 'D8' || pack.responses[0].selection !== 'KEEP_VERIFIED' || pack.responses[0].comment !== note.value || pack.responses[2].decisionStatus !== 'open-non-blocking' || pack.fixedInstructions.reporting.startInclusive !== '2026-08-10T00:00:00-04:00' || pack.fixedInstructions.reporting.hours !== 840 || pack.fixedInstructions.transitionEvidence.t1.firstKubernetesRun !== 'failed-before-LLM' || t2.rawOvhRebind !== true || t2.preproduction.objects !== 59017 || t2.preproduction.bytes !== 12534514457 || t2.preproduction.failed !== 0 || t2.preproduction.canonicalManifestSha256 !== '52646a7b…0425' || t2.production.status !== 'in-progress' || pack.fixedInstructions.transitionEvidence.t3.status !== 'gated' || pack.fixedInstructions.billing.node.projectedAmountCad !== 68.88 || pack.fixedInstructions.billing.llm.totalFacturableCad !== 251.21543767641742) throw Error('Real clipboard content mismatch');
      document.querySelector('.choices').scrollIntoView({ behavior: 'instant' });
      return { actualClipboard: 'pass', revision: pack.revision, response: pack.responses[0].selection, comment: 'exact', currentAmount: pack.fixedInstructions.billing.node.projectedAmountCad, status: pack.status };
    } finally { await navigator.clipboard.writeText(previousClipboard); }
  })()`));
  await writeFile('/out/choices-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'));
} finally { clearTimeout(timeout); await call('Target.disposeBrowserContext', { browserContextId }); ws.close(); }
