import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { missingMermaidLabels } from './mermaid-labels.mjs';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const order = graphs.map(graph => graph.id);
const base = 'http://127.0.0.1:9238';
const focusPort = process.env.FOCUS_PORT ?? '5188';
const focusOrigin = `http://127.0.0.1:${focusPort}`;
const focusFileRoot = process.env.FOCUS_FILE_ROOT;
if (!focusFileRoot) throw Error('FOCUS_FILE_ROOT is required');
const page = await (await fetch(`${base}/json/new?${focusOrigin}/`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), errors = [], external = [];
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
  if (data.method === 'Network.requestWillBeSent' && /^https?:/.test(data.params.request.url) && !data.params.request.url.startsWith(focusOrigin)) external.push(data.params.request.url);
  const item = pending.get(data.id);
  if (item) { pending.delete(data.id); data.error ? item.reject(data.error) : item.resolve(data.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitUntil = async (expression, failure) => {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw Error(failure);
};
const timeout = setTimeout(() => { console.error('Browser verification timed out'); process.exit(1); }, 90000);
await mkdir('.generated', { recursive: true });
await call('Runtime.enable');
await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `${focusOrigin}/` });
await waitUntil(`document.querySelectorAll('.flow').length === 4 && document.querySelectorAll('[data-node-kind]').length > 0`, 'Four native flows missing');
await evaluate(`window.checkMermaidLabels=${missingMermaidLabels.toString()};window.expectedGraphs=${JSON.stringify(graphs)};true`);

const checkExpression = `(async () => {
  const graphs = window.expectedGraphs;
  const order = graphs.map(graph => graph.id);
  const actualOrder = [...document.querySelectorAll('.scene')].map(scene => scene.dataset.scene);
  if (JSON.stringify(actualOrder) !== JSON.stringify(order)) throw Error('scene order mismatch: ' + actualOrder);
  if (document.querySelectorAll('.pair').length !== 2 || document.querySelectorAll('.flow').length !== 4 || document.querySelectorAll('.mermaid-render').length !== 4) throw Error('two pairs / four forms missing');
  if (!document.querySelector('.masthead').textContent.includes('2 PAIRES · 4 SCÈNES')) throw Error('four-scene masthead missing');
  const metrics = [];
  for (const graph of graphs) {
    const scene = document.querySelector('[data-scene="' + graph.id + '"]');
    const flow = scene.querySelector('.flow');
    const transform = getComputedStyle(flow.querySelector('.svelte-flow__viewport')).transform;
    const scale = Number((transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
    if (scale !== 1 || flow.dataset.nativeZoom !== '1' || visualViewport.scale !== 1 || devicePixelRatio !== 1) throw Error(graph.id + ': native zoom mismatch');
    const nativeNodes = [...flow.querySelectorAll('[data-node-kind]')].map(node => ({
      id: node.dataset.id, kind: node.dataset.kind, label: node.dataset.label,
      evidenceClass: node.dataset.evidenceClass, runtimeState: node.dataset.runtimeState,
      parentId: node.dataset.parentId || null, repo: node.dataset.repo.split(' + '),
    })).sort((a, b) => a.id.localeCompare(b.id));
    const nativeEdges = [...flow.querySelectorAll('g[data-canonical-edge]')].map(edge => ({
      id: edge.dataset.canonicalEdge, source: edge.dataset.source, target: edge.dataset.target, label: edge.dataset.label,
      dashed: edge.dataset.dashed === 'true', both: edge.dataset.both === 'true',
      evidenceClass: edge.dataset.evidenceClass, runtimeState: edge.dataset.runtimeState,
    })).sort((a, b) => a.id.localeCompare(b.id));
    if (JSON.stringify(nativeNodes) !== JSON.stringify(graph.projection.nodes)) throw Error(graph.id + ': native node projection differs');
    if (JSON.stringify(nativeEdges) !== JSON.stringify(graph.projection.edges)) throw Error(graph.id + ': native edge projection differs');
    const cards = [...flow.querySelectorAll('[data-node-kind="ordinary"]')].map(node => {
      const style = getComputedStyle(node), title = getComputedStyle(node.querySelector('[data-text-role="service-title"]'));
      const status = getComputedStyle(node.querySelector('[data-text-role="status"]')), repo = getComputedStyle(node.querySelector('[data-text-role="repo"]'));
      const rect = node.getBoundingClientRect(), content = [...node.querySelectorAll('header,[data-text-role="status"],[data-text-role="repo"]')].map(item => item.getBoundingClientRect());
      const value = { id: node.dataset.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, height: rect.height,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
        gapPx: parseFloat(style.gap), trailingPx: rect.bottom - parseFloat(style.paddingBottom) - Math.max(...content.map(item => item.bottom)),
        titlePx: parseFloat(title.fontSize) * scale, statusPx: parseFloat(status.fontSize) * scale, repoPx: parseFloat(repo.fontSize) * scale,
        contentRects: content.map(item => ({ x: item.x, y: item.y, width: item.width, height: item.height })) };
      const text = [...node.querySelectorAll('[data-text-role]')];
      if (value.height < 120 || value.height > 156 || value.padding.some(item => item < 6 || item > 8) || value.gapPx < 4 || value.gapPx > 6
        || value.trailingPx > 12.01 || value.titlePx < 32 || value.statusPx < 22 || value.repoPx < 24
        || text.some(item => item.getBoundingClientRect().width <= 0 || item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1)) throw Error(graph.id + '/' + value.id + ': card metric failure ' + JSON.stringify(value));
      return value;
    });
    for (const group of flow.querySelectorAll('[data-node-kind="cluster"]')) {
      if (!group.querySelector('[data-service-icon]') || !group.querySelector('[data-text-role="repo"]')) throw Error(graph.id + '/' + group.dataset.id + ': group decoration missing');
      if (parseFloat(getComputedStyle(group.querySelector('[data-text-role="subflow-title"]')).fontSize) * scale < 32) throw Error(graph.id + ': group title too small');
    }
    for (const label of flow.querySelectorAll('[data-text-role="edge-label"]')) if (parseFloat(getComputedStyle(label).fontSize) * scale < 24 || label.getBoundingClientRect().width <= 0) throw Error(graph.id + ': edge label too small or hidden');
    const nativeEdgeMetrics = [...flow.querySelectorAll('g[data-canonical-edge]')].map(edge => {
      const path = edge.querySelector('path'), length = path?.getTotalLength() ?? 0, style = path && getComputedStyle(path), matrix = path?.getScreenCTM();
      if (!path || length <= 0 || !matrix || style.stroke === 'none' || Number(style.strokeWidth.replace('px', '')) <= 0) throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ': invisible native edge');
      const samples = [];
      for (let distance = 0; distance < length; distance += 8) { const point = path.getPointAtLength(distance), screen = new DOMPoint(point.x, point.y).matrixTransform(matrix); samples.push([screen.x, screen.y]); }
      const end = path.getPointAtLength(length), screenEnd = new DOMPoint(end.x, end.y).matrixTransform(matrix); samples.push([screenEnd.x, screenEnd.y]);
      const box = path.getBoundingClientRect();
      return { id: edge.dataset.canonicalEdge, length, stroke: style.stroke, strokeWidth: style.strokeWidth,
        rect: { x: box.x, y: box.y, width: box.width, height: box.height }, sampleIntervalMaxPx: 8, samples };
    });
    const mermaid = scene.querySelector('.mermaid-render');
    if (mermaid.dataset.nativeZoom !== '1') throw Error(graph.id + ': Mermaid zoom mismatch');
    const svg = mermaid.querySelector('svg');
    if (!svg || svg.querySelectorAll('g.node').length !== graph.nodes.length || svg.querySelectorAll('g.cluster').length !== graph.groups.length) throw Error(graph.id + ': Mermaid inventory mismatch');
    const missing = window.checkMermaidLabels(svg, graph);
    if (missing.length) throw Error(graph.id + ': Mermaid lost labels ' + JSON.stringify(missing));
    const svgScale = svg.getBoundingClientRect().width / Number(svg.getAttribute('width'));
    if (Math.abs(svgScale - 1) > .01) throw Error(graph.id + ': Mermaid was scaled ' + svgScale);
    const svgTextMetrics = [...svg.querySelectorAll('text')].map(text => ({ text: text.textContent.trim(), px: parseFloat(getComputedStyle(text).fontSize) * svgScale }));
    if (svgTextMetrics.some(item => item.px < 23.99)) throw Error(graph.id + ': Mermaid text below 24px ' + JSON.stringify(svgTextMetrics.filter(item => item.px < 23.99).slice(0, 5)));
    const exactNative = nativeNodes.filter(node => node.label === 'Navigateur utilisateur').length;
    const exactMermaid = [...svg.querySelectorAll('text')].filter(text => text.textContent.replace(/\\s+/g, '') === 'Navigateurutilisateur').length;
    if (exactNative !== 1 || exactMermaid !== 1 || !graph.source.includes('"Navigateur utilisateur"') || scene.textContent.includes('UTILISATEUR / Navigateur')) throw Error(graph.id + ': exact user label failure');
    const tem = nativeNodes.find(node => node.id.endsWith('_TEM'));
    if (!tem || tem.runtimeState !== 'retained') throw Error(graph.id + ': TEM residual missing');
    if (graph.pair === 'B' && nativeEdges.some(edge => edge.source === tem.id || edge.target === tem.id)) throw Error(graph.id + ': TEM connected to refresh');
    const mermaidBoxes = [...svg.querySelectorAll('g.node,g.cluster,.edgeLabel')].filter(item => !item.classList.contains('edgeLabel') || item.textContent.trim()).map(item => { const box = item.getBBox(); if (box.width <= 0 || box.height <= 0) throw Error(graph.id + ': hidden Mermaid inventory'); return { className: item.getAttribute('class'), x: box.x, y: box.y, width: box.width, height: box.height }; });
    const mermaidEdges = [...svg.querySelectorAll('.edgePaths path')].map(path => { const length = path.getTotalLength(), style = getComputedStyle(path); if (length <= 0 || style.stroke === 'none') throw Error(graph.id + ': invisible Mermaid edge'); return { length, stroke: style.stroke, strokeWidth: style.strokeWidth }; });
    if (mermaidEdges.length !== graph.edges.length) throw Error(graph.id + ': Mermaid edge geometry mismatch');
    metrics.push({ sceneId: graph.id, sceneHash: graph.sceneHash, nativeScale: scale, mermaidScale: svgScale,
      nodes: nativeNodes.length, edges: nativeEdges.length, groups: graph.groups.length,
      cards, nativeEdgeMetrics, mermaidBoxes, mermaidEdges, mermaidText: svgTextMetrics,
      minimums: { cardHeight: Math.min(...cards.map(card => card.height)), titlePx: Math.min(...cards.map(card => card.titlePx)),
        statusPx: Math.min(...cards.map(card => card.statusPx)), repoPx: Math.min(...cards.map(card => card.repoPx)) } });
  }
  const after = document.querySelector('[data-scene="refresh-after-20260913"]');
  if (!after.textContent.includes('Production dormante') || !after.textContent.includes('modèle encore à ratifier')) throw Error('refresh gate annotation missing');
  document.querySelectorAll('.steps button')[5].click();
  await new Promise(resolve => setTimeout(resolve, 100));
  const questions = [...document.querySelectorAll('[id^="question-"]')];
  if (questions.length !== 3 || document.querySelectorAll('.question-block input[type="radio"]').length !== 9) throw Error('M1 choice surface mismatch');
  const first = [...questions[0].closest('.question-block').querySelectorAll('input[type="radio"]')].map(input => input.value);
  if (first.join('|') !== 'sonnet-comparable|luna-low|gemini38-lowest') throw Error('M1 candidate order mismatch');
  document.querySelector('input[value="sonnet-comparable"]').click();
  await new Promise(resolve => setTimeout(resolve, 60));
  const preview = JSON.parse(document.querySelector('.choice-json textarea').value);
  if (preview.revision !== 'D9' || preview.m1Decision.ratifiedOptionId !== null || preview.m1Decision.draftSelectedOptionId !== 'sonnet-comparable') throw Error('draft was confused with ratification');
  if (preview.m1Decision.candidateResults.length || preview.m1Decision.ranking.length || preview.m1Decision.attempts[0].classification !== 'not-classifiable') throw Error('Gemini no-output promoted to result');
  const summary = document.querySelector('.monthly-summary').textContent;
  for (const fact of ['10 août → 13 septembre 2026 inclus', '35 jours · 840 h', '68,88 CAD', '251,215438 CAD', 'provisoires', '320,095438 CAD', 'Production dormante', 'modèle en attente M1']) if (!summary.includes(fact)) throw Error('summary missing ' + fact);
  if (document.documentElement.scrollWidth > innerWidth) throw Error('desktop page overflow');
  return metrics;
})()`;

const viewports = [];
for (const viewport of [{ width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 100));
  viewports.push({ ...viewport, metrics: await evaluate(checkExpression) });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(`.generated/dossier-preview-${viewport.width}x${viewport.height}.png`, Buffer.from(screenshot.data, 'base64'));
}
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
for (const file of [
  `file://${focusFileRoot}/decision-focus.html`,
  `file://${focusFileRoot}/../reports/architecture-monthly/architecture-before-after-2026-09-13.html`,
]) {
  await call('Page.navigate', { url: file });
  await waitUntil(`document.querySelectorAll('.flow').length === 4`, `offline four-scene render missing: ${file}`);
}
if (errors.length || external.length) throw Error(JSON.stringify({ errors, external }));
const output = { status: 'pass', sceneOrder: order, pairs: 2, nativeSvelteFlows: 4, renderedMermaids: 4,
  viewports, offline: true, dated: true, runtimeErrors: errors.length, externalRequests: external.length };
await writeFile('.generated/browser-metrics.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: output.status, scenes: order, viewports: viewports.map(({ width, height }) => `${width}x${height}`), offline: true }));
clearTimeout(timeout);
ws.close();
await fetch(`${base}/json/close/${page.id}`);
