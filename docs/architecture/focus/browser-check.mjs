import { readFile, writeFile } from 'node:fs/promises';
import { missingMermaidLabels } from './mermaid-labels.mjs';
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
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
await evaluate(`window.checkMermaidLabels = ${missingMermaidLabels.toString()}; window.expectedGraphs = ${JSON.stringify(graphs)}; true`);
console.log(await evaluate(`(async () => {
  const settle = () => new Promise(resolve => setTimeout(resolve, 180));
  const choose = (label, value) => { const e = document.querySelector('select[aria-label="' + label + '"]'); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); };
  if (document.querySelectorAll('.steps button').length !== 8) throw Error('Eight dossier sections missing');
  if (!document.querySelector('.masthead').textContent.includes('EXÉCUTION ENGAGÉE')) throw Error('D4 execution state missing');
  const views = [...document.querySelector('select[aria-label="Vue architecture"]').options].map(o => o.value);
  let checked = 0;
  for (const view of views) {
    choose('Vue architecture', view); await settle();
    const scopes = [...document.querySelector('select[aria-label="Zoomer sur un sous-flow"]').options].map(o => o.value);
    const expected = { 'asis-1': [25, 4, 34], 'asis-2': [14, 3, 14], 'asis-3': [20, 4, 24], 'asis-4': [13, 0, 12], 'target-1': [15, 2, 19] }[view];
    const source = window.expectedGraphs.find(g => g.id === view);
    for (const item of [...source.nodes, ...source.groups]) {
      const box = document.querySelector('.svelte-flow__node[data-id="' + item.id + '"]');
      if (box.querySelector('.repo-label')?.textContent !== item.provenance.repoLabel || box.querySelector('[data-service-icon]')?.dataset.serviceIcon !== item.provenance.icon) throw Error('Missing icon/repository: ' + view + '/' + item.id);
      const card = box.querySelector('.service-node'), header = box.querySelector('.subflow-box header');
      if (card && (card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1)) throw Error('Component text overflow: ' + view + '/' + item.id);
      if (header && (header.scrollHeight > header.clientHeight + 1 || header.scrollWidth > header.clientWidth + 1)) throw Error('Subflow header overflow: ' + view + '/' + item.id);
      if (card && card.querySelector('.node-description').textContent.replace(/\\s+/g, '') !== item.label.replace(/\\s+/g, '')) throw Error('Lost SvelteFlow source text: ' + item.id);
    }
    for (const scope of scopes) {
      choose('Zoomer sur un sous-flow', scope); await settle();
      const actual = ['.svelte-flow__node-architecture', '.svelte-flow__node-subflow', '.svelte-flow__edge'].map(selector => document.querySelectorAll(selector).length);
      if (actual.some((value, index) => value !== expected[index])) throw Error('Incomplete simultaneous diagram ' + view + '/' + scope + ': ' + actual);
      checked++;
    }
    document.querySelector('.mermaid-panel').open = true; await settle();
    const svg = document.querySelector('.mermaid-render svg');
    if (!svg || svg.querySelectorAll('g.node').length !== expected[0] || svg.querySelectorAll('g.cluster').length !== expected[1]) throw Error('Mermaid rendering incomplete: ' + view);
    if (svg.querySelector('script,foreignObject,[onclick],[onload],[onerror]')) throw Error('Unsafe Mermaid');
    const missing = window.checkMermaidLabels(svg, window.expectedGraphs.find(g => g.id === view));
    if (missing.length) throw Error('Lost rendered labels ' + view + ': ' + JSON.stringify(missing));
    document.querySelector('.mermaid-panel').open = false;
  }
  choose('Vue architecture', 'asis-1'); await settle(); choose('Retrouver un composant', 'PP_DB'); await settle();
  if (!document.querySelector('.inspector').textContent.includes('PP-DB')) throw Error('DB inspector missing');
  if (!document.querySelector('.inspector').textContent.includes('repo: radar-immobilier')) throw Error('DB provenance missing');
  [...document.querySelectorAll('.cross-link')].find(b => b.textContent.includes('PV →')).click(); await settle();
  if (document.querySelector('.flow').dataset.graph !== 'asis-2' || !document.querySelector('.inspector').textContent.includes('PP-DB')) throw Error('Shared DB cross-view navigation failed');
  choose('Vue architecture', 'asis-1'); await settle();
  await settle();
  const canvas = document.querySelector('.flow').getBoundingClientRect();
  for (const node of document.querySelectorAll('.svelte-flow__node')) {
    const r = node.getBoundingClientRect();
    if (r.left < canvas.left - 1 || r.top < canvas.top - 1 || r.right > canvas.right + 1 || r.bottom > canvas.bottom + 1) throw Error('Full diagram clipped: ' + node.dataset.id);
  }
  const rectangle = id => document.querySelector('.svelte-flow__node[data-id="' + id + '"]').getBoundingClientRect();
  for (const [parent, child] of [['cloud', 'preprod'], ['preprod', 'ppminio'], ['ppminio', 'PP_RAW']]) {
    const a = rectangle(parent), b = rectangle(child);
    if (b.left < a.left || b.top < a.top || b.right > a.right + 1 || b.bottom > a.bottom + 1) throw Error('Visual nesting failed: ' + parent + '/' + child);
  }
  const full = [...document.querySelectorAll('button')].find(b => b.textContent === 'Plein écran'); full.click(); await settle();
  if (!document.querySelector('.expanded')) throw Error('Fullscreen failed');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle();
  if (document.querySelector('.expanded')) throw Error('Escape failed');
  document.querySelectorAll('.steps button')[3].click(); await settle();
  if (!document.querySelector('.choices').textContent.includes('Quelle méthode auditable doit allouer la dépense LLM')) throw Error('LLM allocation question missing');
  if (document.querySelectorAll('input[type="radio"]:checked').length) throw Error('Unexpected default owner choice');
  for (const option of ['DIRECT', 'USAGE', 'CAPACITY']) {
    document.querySelector('input[type="radio"][value="' + option + '"]').click(); await settle();
    if (document.querySelectorAll('input[type="radio"]:checked').length !== 1 || document.querySelector('input[type="radio"]:checked').value !== option) throw Error('Choice failed: ' + option);
  }
  const comment = document.querySelector('.choices textarea'); comment.value = 'Vérifier la reprise avant bascule.'; comment.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  const preview = JSON.parse(document.querySelector('.choice-json textarea').value);
  if (preview.decision.option !== 'CAPACITY' || preview.decision.key !== 'llm-allocation-method' || preview.decision.note !== comment.value || preview.options.length !== 3 || preview.status !== 'draft-not-ratified') throw Error('JSON response pack lost choice/comment');
  if (preview.fixedDecisions.executionOrder[0] !== 'T1-refresh-graphify-0.18.0' || preview.fixedDecisions.infrastructureBilling.projectedNodeCad !== 59.04 || preview.fixedDecisions.monetaryProposalAudit !== 'incomplete' || 'finalBillableCad' in preview) throw Error('JSON response pack lost fixed decisions or invented a bill');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedChoice = text; } } });
  [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier la réponse en JSON').click(); await settle();
  if (JSON.parse(window.testCopiedChoice).decision.note !== comment.value || !document.querySelector('.choices').textContent.includes('copiés en JSON')) throw Error('Copy action failed');
  document.querySelectorAll('.steps button')[2].click(); await settle(); document.querySelectorAll('.steps button')[3].click(); await settle();
  if (document.querySelector('input[type="radio"]:checked')?.value !== 'CAPACITY' || document.querySelector('.choices textarea').value !== preview.decision.note) throw Error('Draft persistence failed');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Denied'); } } });
  [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier la réponse en JSON').click(); await settle();
  if (!document.querySelector('.choice-json').open || !document.querySelector('.choices').textContent.includes('Copie refusée')) throw Error('Denied clipboard not explained');
  [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Retirer le choix').click();
  const clear = document.querySelector('.choices textarea'); clear.value = ''; clear.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  document.querySelectorAll('.steps button')[0].click(); await settle();
  const input = document.querySelector('textarea'), previous = input.value;
  input.value = 'Automated test — local draft'; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  if (!document.querySelector('.notes').textContent.includes('Brouillon enregistré')) throw Error('Local note not saved');
  input.value = previous; input.dispatchEvent(new Event('input', { bubbles: true }));
  const openEvidence = [...document.querySelectorAll('.source-links button')].find(b => b.textContent === 'decision-reviews'); openEvidence.click(); await settle();
  if (!document.querySelector('dialog[open]')?.textContent.includes('weekly')) throw Error('Embedded review evidence missing');
  document.querySelector('dialog').close(); await settle();
  if (document.querySelector('dialog')) throw Error('Dialog close failed');
  [...document.querySelectorAll('.source-links button')].find(b => b.textContent === 'transitions').click(); await settle();
  if (!document.querySelector('dialog[open]')?.textContent.includes('T1 — autonomous PV → Signal cron')) throw Error('Transition evidence missing');
  document.querySelector('dialog').close(); await settle();
  [...document.querySelectorAll('.source-links button')].find(b => b.textContent === 'architecture').click(); await settle();
  if (document.querySelectorAll('dialog .source-mermaid svg').length !== 4) throw Error('Mermaid in the source document is not rendered');
  [...document.querySelectorAll('dialog .source-mermaid svg')].forEach((svg, index) => {
    const missing = window.checkMermaidLabels(svg, window.expectedGraphs[index]);
    if (missing.length) throw Error('Lost source-document labels: ' + JSON.stringify(missing));
  });
  document.querySelector('dialog').close(); await settle();
  if (document.documentElement.scrollWidth > innerWidth) throw Error('Desktop overflow');
  document.querySelector('.explorer').scrollIntoView({ behavior: 'instant' });
  return { status: 'pass', completeNestedViews: views.length, viewportChecks: checked, mermaidRendered: 5, resourceCrossLink: true, fullscreen: true, choices: 'LLM allocation + comment + JSON + persistence', clipboard: 'action and denial simulated', evidence: 'transitions embedded and diagrams rendered' };
})()`));
await writeFile('/out/flow-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await evaluate('window.scrollTo(0, 0)');
await writeFile('/out/dossier-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
for (const [label, value, file] of [['Retrouver un composant', 'PP_DB', 'service-preview.png'], ['Zoomer sur un sous-flow', 'ppminio', 'stores-preview.png']]) {
  await evaluate(`(async () => {
    document.querySelector('.inspector .close')?.click();
    const select = document.querySelector('select[aria-label="' + ${JSON.stringify(label)} + '"]');
    select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.graph-layout').scrollIntoView({ behavior: 'instant', block: 'center' });
    await new Promise(resolve => setTimeout(resolve, 300));
  })()`);
  await writeFile('/out/' + file, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}
await evaluate(`document.querySelector('.mermaid-panel').open = true; document.querySelector('.mermaid-panel').scrollIntoView({ behavior: 'instant' }); true`);
await writeFile('/out/mermaid-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate('({ width: innerWidth, content: document.documentElement.scrollWidth })');
if (mobile.content > mobile.width) throw Error(`Mobile overflow ${JSON.stringify(mobile)}`);
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await call('Page.navigate', { url: 'file:///home/antoinefa/src/radar-immobilier/tmp/architecture-platform/docs/architecture/decision-focus.html' });
await evaluate(`new Promise((resolve, reject) => { const until = Date.now() + 2000; const check = () => document.querySelector('.svelte-flow__node') ? resolve(true) : Date.now() > until ? reject(Error('Offline native flow missing')) : requestAnimationFrame(check); check(); })`);
if (errors.length || external.length) throw Error(JSON.stringify({ errors, external }));
console.log(JSON.stringify({ mobile, offline: true, externalRequests: external.length, runtimeErrors: errors.length }));
clearTimeout(timeout); ws.close(); await fetch(`${base}/json/close/${page.id}`);
