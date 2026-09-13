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
  if (!document.querySelector('.masthead').textContent.includes('CIBLE COMPLÈTE PROPOSÉE')) throw Error('D5 target state missing');
  if (document.querySelector('.flow').dataset.graph !== 'target-3') throw Error('Complete final target is not the default');
  const path = [...document.querySelectorAll('.journey button')].map(button => button.textContent.trim());
  if (path.join('|') !== '0Existant|1T1 refresh|2T2 objets OVH|3T3 cible 1 nœud') throw Error('Sequential path missing: ' + path);
  const views = [...document.querySelector('select[aria-label="Vue architecture"]').options].map(o => o.value);
  if (views.join('|') !== 'asis-1|asis-2|asis-3|asis-4|target-1|target-2|target-3|detail-1') throw Error('D5 graph set/order mismatch: ' + views);
  let checked = 0;
  for (const view of views) {
    choose('Vue architecture', view); await settle();
    const scopes = [...document.querySelector('select[aria-label="Zoomer sur un sous-flow"]').options].map(o => o.value);
    const source = window.expectedGraphs.find(g => g.id === view);
    const expected = [source.nodes.length, source.groups.length, source.edges.length];
    const initialCanvas = document.querySelector('.flow').getBoundingClientRect();
    for (const node of document.querySelectorAll('.svelte-flow__node')) { const r = node.getBoundingClientRect(); if (r.left < initialCanvas.left - 1 || r.top < initialCanvas.top - 1 || r.right > initialCanvas.right + 1 || r.bottom > initialCanvas.bottom + 1) throw Error('Initial full graph clipped: ' + view + '/' + node.dataset.id); }
    for (const item of [...source.nodes, ...source.groups]) {
      const box = document.querySelector('.svelte-flow__node[data-id="' + item.id + '"]');
      if (box.querySelector('.repo-label')?.textContent !== item.provenance.repoLabel || box.querySelector('[data-service-icon]')?.dataset.serviceIcon !== item.provenance.icon) throw Error('Missing icon/repository: ' + view + '/' + item.id);
      const card = box.querySelector('.service-node'), header = box.querySelector('.subflow-box header');
      if (card && (card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1)) throw Error('Component text overflow: ' + view + '/' + item.id);
      if (header && (header.scrollHeight > header.clientHeight + 1 || header.scrollWidth > header.clientWidth + 1)) throw Error('Subflow header overflow: ' + view + '/' + item.id + ' ' + JSON.stringify({ clientWidth: header.clientWidth, scrollWidth: header.scrollWidth, clientHeight: header.clientHeight, scrollHeight: header.scrollHeight }));
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
  document.querySelectorAll('.steps button')[7].click(); await settle();
  const instructions = document.querySelector('.choices');
  if (!instructions.textContent.includes('Aucun choix DIRECT / USAGE / CAPACITY') || !instructions.textContent.includes('0,082 CAD/h') || !instructions.textContent.includes('59,04 CAD est une ancienne illustration')) throw Error('Fixed billing instructions missing');
  if (document.querySelectorAll('input[type="radio"]').length) throw Error('D5 must not force an allocation choice');
  const comment = document.querySelector('.choices textarea'); comment.value = 'Vérifier la reprise avant bascule.'; comment.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  const preview = JSON.parse(document.querySelector('.choice-json textarea').value);
  if (preview.revision !== 'D5' || preview.ownerCorrection.option !== null || preview.note !== comment.value || preview.fixedInstructions.billing.allocationMethodChoiceRequired !== false) throw Error('JSON instructions lost provenance/comment');
  if (preview.fixedInstructions.reporting.start !== null || preview.fixedInstructions.billing.node.periodHours !== null || preview.fixedInstructions.billing.node.projectedAmountCad !== null || preview.fixedInstructions.billing.historicalIllustrationOnly.currentPeriodAmount !== false || 'decision' in preview || 'options' in preview || 'finalBillableCad' in preview) throw Error('JSON instructions invented a period, vote or bill');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.testCopiedChoice = text; } } });
  [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier les instructions en JSON').click(); await settle();
  if (JSON.parse(window.testCopiedChoice).note !== comment.value || !document.querySelector('.choices').textContent.includes('copiés en JSON')) throw Error('Copy action failed');
  document.querySelectorAll('.steps button')[2].click(); await settle(); document.querySelectorAll('.steps button')[7].click(); await settle();
  if (document.querySelector('.choices textarea').value !== preview.note) throw Error('Instruction comment persistence failed');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Denied'); } } });
  [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Copier les instructions en JSON').click(); await settle();
  if (!document.querySelector('.choice-json').open || !document.querySelector('.choices').textContent.includes('Copie refusée')) throw Error('Denied clipboard not explained');
  [...document.querySelectorAll('.choices button')].find(b => b.textContent === 'Effacer le commentaire').click(); await settle();
  if (document.querySelector('.choices textarea').value) throw Error('Instruction comment clear failed');
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
  [...document.querySelectorAll('.source-links button')].find(b => b.textContent === 'transitions-target').click(); await settle();
  if (document.querySelectorAll('dialog .source-mermaid svg').length !== 3) throw Error('Three transition Mermaid sources are not rendered');
  [...document.querySelectorAll('dialog .source-mermaid svg')].forEach((svg, index) => {
    const missing = window.checkMermaidLabels(svg, window.expectedGraphs[index + 4]);
    if (missing.length) throw Error('Lost transition-source labels: ' + JSON.stringify(missing));
  });
  document.querySelector('dialog').close(); await settle();
  [...document.querySelectorAll('.source-links button')].find(b => b.textContent === 'architecture').click(); await settle();
  if (document.querySelectorAll('dialog .source-mermaid svg').length !== 4) throw Error('Mermaid in the source document is not rendered');
  [...document.querySelectorAll('dialog .source-mermaid svg')].forEach((svg, index) => {
    const missing = window.checkMermaidLabels(svg, window.expectedGraphs[index]);
    if (missing.length) throw Error('Lost source-document labels: ' + JSON.stringify(missing));
  });
  document.querySelector('dialog').close(); await settle();
  if (document.documentElement.scrollWidth > innerWidth) throw Error('Desktop overflow');
  choose('Vue architecture', 'target-3'); await settle();
  if (!document.querySelector('.svelte-flow__node[data-id="T3_CARD"]') || !document.querySelector('.svelte-flow__node[data-id="PP_RAW_OVH"]') || document.querySelector('.svelte-flow__node[data-id="ppminio"]')) throw Error('Final target entry content mismatch');
  document.querySelector('.explorer').scrollIntoView({ behavior: 'instant' });
  return { status: 'pass', defaultView: 'target-3', sequentialPath: true, completeNestedViews: views.length, viewportChecks: checked, mermaidRendered: views.length, resourceCrossLink: true, fullscreen: true, instructions: 'fixed billing + comment + JSON + persistence', clipboard: 'action and denial simulated', evidence: 'current plus transition diagrams rendered' };
})()`));
await writeFile('/out/flow-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await evaluate('window.scrollTo(0, 0)');
await writeFile('/out/dossier-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
for (const [label, value, file] of [['Retrouver un composant', 'PP_DB', 'service-preview.png'], ['Zoomer sur un sous-flow', 'OVH_OBJECTS', 'stores-preview.png']]) {
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
await call('Page.navigate', { url: 'file:///home/antoinefa/src/radar-immobilier/tmp/architecture-platform/docs/reports/architecture-monthly/architecture-transition-2026-09-13.html' });
await evaluate(`new Promise((resolve, reject) => { const until = Date.now() + 2000; const check = () => document.querySelector('.flow')?.dataset.graph === 'target-3' && document.body.textContent.includes('CIBLE COMPLÈTE PROPOSÉE') ? resolve(true) : Date.now() > until ? reject(Error('Dated monthly D5 Focus rendering missing')) : requestAnimationFrame(check); check(); })`);
if (errors.length || external.length) throw Error(JSON.stringify({ errors, external }));
console.log(JSON.stringify({ mobile, offline: true, monthlyDatedRendering: true, externalRequests: external.length, runtimeErrors: errors.length }));
clearTimeout(timeout); ws.close(); await fetch(`${base}/json/close/${page.id}`);
