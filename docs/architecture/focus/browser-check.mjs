import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { missingMermaidLabels } from './mermaid-labels.mjs';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const order = graphs.map(graph => graph.id);
const base = 'http://127.0.0.1:9238';
const focusFileRoot = process.env.FOCUS_FILE_ROOT;
if (!focusFileRoot) throw Error('FOCUS_FILE_ROOT is required');
const focusFile = `file://${focusFileRoot}/decision-focus.html`;
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), runtimeErrors = [], consoleErrors = [], external = [];
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.exceptionThrown') runtimeErrors.push(data.params.exceptionDetails);
  if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') consoleErrors.push(data.params.args.map(arg => arg.value ?? arg.description));
  if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') consoleErrors.push(data.params.entry);
  if (data.method === 'Network.requestWillBeSent' && /^https?:/.test(data.params.request.url)) external.push(data.params.request.url);
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
await call('Log.enable');
await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
await waitUntil(`document.querySelectorAll('.flow').length === 5 && document.querySelectorAll('[data-node-kind]').length > 0`, 'Five native flows missing');
await evaluate(`window.checkMermaidLabels=${missingMermaidLabels.toString()};window.expectedGraphs=${JSON.stringify(graphs)};true`);

const checkExpression = `(async () => {
  const graphs = window.expectedGraphs;
  const order = graphs.map(graph => graph.id);
  const actualOrder = [...document.querySelectorAll('.scene')].map(scene => scene.dataset.scene);
  if (JSON.stringify(actualOrder) !== JSON.stringify(order)) throw Error('scene order mismatch: ' + actualOrder);
  if (document.querySelectorAll('.pair').length !== 2 || document.querySelectorAll('.flow').length !== 5 || document.querySelectorAll('.mermaid-render').length !== 5) throw Error('two series / five scenes missing');
  if (!document.querySelector('.masthead').textContent.includes('2 SÉRIES · 5 SCÈNES')) throw Error('five-scene masthead missing');
  const metrics = [];
  for (const graph of graphs) {
    const scene = document.querySelector('[data-scene="' + graph.id + '"]');
    const flow = scene.querySelector('.flow');
    const transform = getComputedStyle(flow.querySelector('.svelte-flow__viewport')).transform;
    const scale = Number((transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
    if (scale >= 1 || scale < .03 || flow.dataset.zoomRange !== '0.03:2' || visualViewport.scale !== 1 || devicePixelRatio !== 1) throw Error(graph.id + ': overview zoom mismatch ' + scale);
    const flowRect = flow.getBoundingClientRect(), containerRect = flow.querySelector('.svelte-flow__container').getBoundingClientRect();
    if (innerWidth === 1920 && (flowRect.width > 1800 || flow.scrollWidth > flow.clientWidth || scene.scrollWidth > scene.clientWidth))
      throw Error(graph.id + ': scene requires horizontal scrolling at 1920px: ' + JSON.stringify({ flowWidth: flowRect.width, flowScrollWidth: flow.scrollWidth, sceneWidth: scene.clientWidth, sceneScrollWidth: scene.scrollWidth }));
    if (flowRect.height <= 0 || containerRect.height !== flowRect.height || (innerWidth === 1920 && Math.abs(flowRect.height - 900) > .01)) throw Error(graph.id + ': zero, unexpected or mismatched SvelteFlow height');
    const interactionInventory = { controlButtons: flow.querySelectorAll('.svelte-flow__controls-button').length,
      actualSize: Boolean(flow.querySelector('[data-action="actual-size"]')), minimap: Boolean(flow.querySelector('.svelte-flow__minimap')) };
    if (interactionInventory.controlButtons < 3 || !interactionInventory.actualSize || !interactionInventory.minimap) throw Error(graph.id + ': interactive controls missing ' + JSON.stringify(interactionInventory));
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
    // One ratified template A': 460x200 with 5 text lines (code, rôle, nom,
    // détail, repo), an icon as tall as the two first lines, a short gap and a
    // rule. No status line anywhere.
    const TEMPLATE = { A: { width: 460, height: 200, lines: 5 } };
    const TYPE_PX = { code: 22, 'service-title': 32, name: 24, detail: 24, repo: 24 };
    const cards = [...flow.querySelectorAll('[data-node-kind="ordinary"]')].map(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      const text = [...node.querySelectorAll('[data-text-role]')];
      const content = text.map(item => item.getBoundingClientRect());
      const expected = TEMPLATE[node.dataset.card];
      // The icon must be exactly as tall as the two first lines and start the
      // card: lines 1 and 2 begin to its right, the rest runs full width.
      const iconBox = node.querySelector('[data-service-icon]').getBoundingClientRect();
      const codeBox = node.querySelector('[data-text-role="code"]').getBoundingClientRect();
      const titleBox = node.querySelector('[data-text-role="service-title"]').getBoundingClientRect();
      const nameBox = node.querySelector('[data-text-role="name"]').getBoundingClientRect();
      const value = { id: node.dataset.id, template: node.dataset.card,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        width: rect.width / scale, height: rect.height / scale, lines: text.length,
        iconPx: iconBox.height / scale, twoLinePx: (titleBox.bottom - codeBox.top) / scale,
        iconSquarePx: iconBox.width / scale,
        headStartPx: (codeBox.left - rect.left) / scale, fullWidthLeftPx: (nameBox.left - rect.left) / scale,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
        trailingPx: (rect.bottom - Math.max(...content.map(item => item.bottom))) / scale - parseFloat(style.paddingBottom),
        typePx: Object.fromEntries(text.map(item => [item.dataset.textRole, parseFloat(getComputedStyle(item).fontSize)])),
        contentRects: content.map(item => ({ x: item.x, y: item.y, width: item.width, height: item.height })) };
      if (!expected || value.lines !== expected.lines
        || Math.abs(value.width - expected.width) > .05 || Math.abs(value.height - expected.height) > .05
        || Math.abs(value.iconPx - value.twoLinePx) > 1 || Math.abs(value.iconPx - value.iconSquarePx) > .05
        || Math.abs(value.fullWidthLeftPx - 16) > .05
        || value.headStartPx < value.fullWidthLeftPx + value.iconPx
        || node.querySelector('[data-text-role="status"]')
        || value.padding.some(item => Math.abs(item - 8) > .01) || value.trailingPx > 12.01
        || Object.entries(value.typePx).some(([role, px]) => Math.abs(px - TYPE_PX[role]) > .01)
        || text.some(item => item.getBoundingClientRect().width <= 0 || item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1)) throw Error(graph.id + '/' + value.id + ': card metric failure ' + JSON.stringify(value));
      return value;
    });
    for (let left = 0; left < cards.length; left++) for (let right = left + 1; right < cards.length; right++) {
      const a = cards[left].rect, b = cards[right].rect;
      const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlap) throw Error(graph.id + ': ordinary cards overlap ' + cards[left].id + '/' + cards[right].id);
    }
    for (const node of flow.querySelectorAll('[data-node-kind]')) {
      const rect = node.getBoundingClientRect();
      if (rect.left < flowRect.left - 1 || rect.top < flowRect.top - 1 || rect.right > flowRect.right + 1 || rect.bottom > flowRect.bottom + 1)
        throw Error(graph.id + '/' + node.dataset.id + ': node outside visible scene');
    }
    for (const group of flow.querySelectorAll('[data-node-kind="cluster"]')) {
      if (!group.querySelector('[data-service-icon]') || !group.querySelector('[data-text-role="repo"]')) throw Error(graph.id + '/' + group.dataset.id + ': group decoration missing');
      if (parseFloat(getComputedStyle(group.querySelector('[data-text-role="subflow-title"]')).fontSize) !== 32) throw Error(graph.id + ': group title must be 32px');
    }
    for (const label of flow.querySelectorAll('[data-text-role="edge-label"]')) {
      const rect = label.getBoundingClientRect();
      if (parseFloat(getComputedStyle(label).fontSize) !== 24 || rect.width <= 0
        || rect.left < flowRect.left - 1 || rect.top < flowRect.top - 1 || rect.right > flowRect.right + 1 || rect.bottom > flowRect.bottom + 1)
        throw Error(graph.id + ': edge label must be visible inside the scene at 24px: ' + JSON.stringify({ text: label.textContent, label: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, flow: { left: flowRect.left, top: flowRect.top, right: flowRect.right, bottom: flowRect.bottom } }));
      for (const node of flow.querySelectorAll('[data-node-kind="ordinary"]')) {
        const box = node.getBoundingClientRect();
        if (rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top)
          throw Error(graph.id + ': edge label overlaps node ' + node.dataset.id + ' / ' + label.textContent);
      }
    }
    const nativeEdgeMetrics = [...flow.querySelectorAll('g[data-canonical-edge]')].map(edge => {
      const path = edge.querySelector('path'), length = path?.getTotalLength() ?? 0, style = path && getComputedStyle(path), matrix = path?.getScreenCTM();
      if (!path || length <= 0 || !matrix || style.stroke === 'none' || Number(style.strokeWidth.replace('px', '')) <= 0) throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ': invisible native edge');
      const samples = [];
      for (let distance = 0; distance < length; distance += 8) { const point = path.getPointAtLength(distance), screen = new DOMPoint(point.x, point.y).matrixTransform(matrix); samples.push([screen.x, screen.y]); }
      const end = path.getPointAtLength(length), screenEnd = new DOMPoint(end.x, end.y).matrixTransform(matrix); samples.push([screenEnd.x, screenEnd.y]);
      const routePoints = JSON.parse(edge.dataset.routePoints);
      if (routePoints.slice(1).some((point, index) => point.x !== routePoints[index].x && point.y !== routePoints[index].y))
        throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ': route is not orthogonal');
      for (const node of flow.querySelectorAll('[data-node-kind="ordinary"]')) {
        if (node.dataset.id === edge.dataset.source || node.dataset.id === edge.dataset.target) continue;
        const rect = node.getBoundingClientRect();
        if (samples.some(([x, y]) => x > rect.left + 1 && x < rect.right - 1 && y > rect.top + 1 && y < rect.bottom - 1))
          throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ': route crosses node ' + node.dataset.id);
      }
      const box = path.getBoundingClientRect();
      if (box.left < flowRect.left - 2 || box.top < flowRect.top - 2 || box.right > flowRect.right + 2 || box.bottom > flowRect.bottom + 2)
        throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ': edge outside visible scene');
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
    const contentElements = [...flow.querySelectorAll('[data-node-kind], g[data-canonical-edge] path, [data-text-role="edge-label"]')];
    const contentBoxes = contentElements.map(element => element.getBoundingClientRect()).filter(box => box.width > 0 || box.height > 0);
    const content = { left: Math.min(...contentBoxes.map(box => box.left)), top: Math.min(...contentBoxes.map(box => box.top)),
      right: Math.max(...contentBoxes.map(box => box.right)), bottom: Math.max(...contentBoxes.map(box => box.bottom)) };
    const contentInside = content.left >= flowRect.left - 1 && content.top >= flowRect.top - 1 && content.right <= flowRect.right + 1 && content.bottom <= flowRect.bottom + 1;
    if (!contentInside) throw Error(graph.id + ': complete content is not inside overview panel ' + JSON.stringify({ content, flow: { left: flowRect.left, top: flowRect.top, right: flowRect.right, bottom: flowRect.bottom } }));
    metrics.push({ sceneId: graph.id, sceneHash: graph.sceneHash, initialScale: scale, mermaidScale: svgScale, contentInside,
      content, panel: { left: flowRect.left, top: flowRect.top, right: flowRect.right, bottom: flowRect.bottom },
      flow: { width: flowRect.width, height: flowRect.height, clientWidth: flow.clientWidth, scrollWidth: flow.scrollWidth },
      nodes: nativeNodes.length, edges: nativeEdges.length, groups: graph.groups.length,
      cards, nativeEdgeMetrics, mermaidBoxes, mermaidEdges, mermaidText: svgTextMetrics,
      templates: { A: cards.filter(card => card.template === 'A').length },
      iconPx: Math.min(...cards.map(card => card.iconPx)),
      minimums: { cardHeight: Math.min(...cards.map(card => card.height)), cardWidth: Math.min(...cards.map(card => card.width)),
        typePx: Math.min(...cards.flatMap(card => Object.values(card.typePx))) } });
  }
  const after = document.querySelector('[data-scene="pipeline-after-20260913"]');
  if (!after.textContent.includes('Production dormante') || !after.textContent.includes('PR #682')) throw Error('pipeline production gate annotation missing');
  const summary = document.querySelector('.monthly-summary').textContent;
  for (const fact of ['10 août → 13 septembre 2026 inclus', '35 jours · 840 h', '1 × r2-15', 'Sans MinIO', 'Accepté', 'DORMANT', 'Production dormante', 'PR #682', 'rapport de coûts séparé']) if (!summary.includes(fact)) throw Error('summary missing ' + fact);
  if (document.documentElement.scrollWidth > innerWidth) throw Error('desktop page overflow');
  return metrics;
})()`;

const viewports = [];
for (const viewport of [{ width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 350));
  viewports.push({ ...viewport, metrics: await evaluate(checkExpression) });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(`.generated/dossier-preview-${viewport.width}x${viewport.height}.png`, Buffer.from(screenshot.data, 'base64'));
}
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
const offlineProofs = [];
for (const file of [
  `file://${focusFileRoot}/decision-focus.html`,
  `file://${focusFileRoot}/../reports/architecture-monthly/architecture-before-after-2026-09-13.html`,
]) {
 await call('Page.navigate', { url: file });
 await waitUntil(`document.querySelectorAll('.flow').length === 5`, `offline five-scene render missing: ${file}`);
  await new Promise(resolve => setTimeout(resolve, 300));
  offlineProofs.push(await evaluate(`(() => ({
    url: location.href, title: document.title, zoom: visualViewport.scale, devicePixelRatio,
    documentHeight: document.documentElement.scrollHeight,
    flows: [...document.querySelectorAll('.flow')].map(flow => {
      const rect = flow.getBoundingClientRect(), container = flow.querySelector('.svelte-flow__container').getBoundingClientRect();
      const nodes = [...flow.querySelectorAll('[data-node-kind]')];
      const edges = [...flow.querySelectorAll('g[data-canonical-edge] path')];
      return { scene: flow.dataset.graph, height: rect.height, containerHeight: container.height,
        nodes: nodes.length, nodesInside: nodes.filter(node => { const box = node.getBoundingClientRect();
          return box.left >= rect.left - 1 && box.top >= rect.top - 1 && box.right <= rect.right + 1 && box.bottom <= rect.bottom + 1; }).length,
        edges: edges.length, drawnEdges: edges.filter(path => path.getTotalLength() > 0 && getComputedStyle(path).stroke !== 'none').length };
    })
  }))()`));
}
await call('Page.navigate', { url: `file://${focusFileRoot}/decision-focus.html` });
await waitUntil(`document.querySelectorAll('.flow').length === 5`, 'offline interactive scene render missing');
await new Promise(resolve => setTimeout(resolve, 350));
await evaluate(`document.querySelector('.flow').scrollIntoView({block:'start'}); true`);
const offlineShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
await writeFile('browser-proof-direct-file.png', Buffer.from(offlineShot.data, 'base64'));

const sceneMetrics = sceneId => evaluate(`(() => {
  const sceneId = ${JSON.stringify(sceneId)};
  const scene = document.querySelector('[data-scene="' + sceneId + '"]'), flow = scene.querySelector('.flow');
  const rect = flow.getBoundingClientRect(), viewport = flow.querySelector('.svelte-flow__viewport');
  const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
  const elements = [...flow.querySelectorAll('[data-node-kind], g[data-canonical-edge] path, [data-text-role="edge-label"]')];
  const boxes = elements.map(element => element.getBoundingClientRect()).filter(box => box.width > 0 || box.height > 0);
  const content = { left: Math.min(...boxes.map(box => box.left)), top: Math.min(...boxes.map(box => box.top)),
    right: Math.max(...boxes.map(box => box.right)), bottom: Math.max(...boxes.map(box => box.bottom)) };
  const contentInside = content.left >= rect.left - 1 && content.top >= rect.top - 1 && content.right <= rect.right + 1 && content.bottom <= rect.bottom + 1;
  const cards = [...flow.querySelectorAll('[data-node-kind="ordinary"]')].map(node => { const box = node.getBoundingClientRect(); return { template: node.dataset.card, width: box.width, height: box.height }; });
  return { viewport: { width: innerWidth, height: innerHeight }, scale: matrix.a, x: matrix.e, y: matrix.f, content, contentInside,
    panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, cards,
    flow: { clientWidth: flow.clientWidth, scrollWidth: flow.scrollWidth },
    scene: { clientWidth: scene.clientWidth, scrollWidth: scene.scrollWidth, scrollLeft: scene.scrollLeft },
    document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth } };
})()`);
const capture = async file => {
  const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
};
const interactionProofs = [];
for (const sceneId of order) {
  await evaluate(`(() => { const scene = document.querySelector('[data-scene="${sceneId}"]'), flow = scene.querySelector('.flow'); scene.scrollLeft = 0; flow.scrollIntoView({ block: 'start', inline: 'nearest' }); return true; })()`);
  await new Promise(resolve => setTimeout(resolve, 160));
  const overview = await sceneMetrics(sceneId);
  if (overview.viewport.width !== 1920 || overview.viewport.height !== 1080 || overview.scale >= 1 || !overview.contentInside
    || overview.panel.height !== 900 || overview.panel.width > 1800 || overview.panel.left < 0 || overview.panel.right > 1920
    || overview.flow.scrollWidth > overview.flow.clientWidth || overview.scene.scrollWidth > overview.scene.clientWidth
    || overview.scene.scrollLeft !== 0 || overview.document.scrollWidth > overview.document.clientWidth)
    throw Error(sceneId + ': invalid overview proof ' + JSON.stringify(overview));
  const overviewFile = `.generated/v8-${sceneId}-overview-1920x1080.png`;
  await capture(overviewFile);

  await evaluate(`document.querySelector('[data-scene="${sceneId}"] [data-action="actual-size"]').click(); true`);
  await new Promise(resolve => setTimeout(resolve, 260));
  const actualSize = await sceneMetrics(sceneId);
  const TEMPLATE_BOX = { A: { width: 460, height: 200 } };
  if (Math.abs(actualSize.scale - 1) > .01 || actualSize.cards.some(card => !TEMPLATE_BOX[card.template]
    || Math.abs(card.width - TEMPLATE_BOX[card.template].width) > .05 || Math.abs(card.height - TEMPLATE_BOX[card.template].height) > .05))
    throw Error(sceneId + ': 1:1 control failed ' + JSON.stringify(actualSize));
  const actualSizeFile = `.generated/v8-${sceneId}-1to1-1920x1080.png`;
  await capture(actualSizeFile);

  await evaluate(`document.querySelectorAll('[data-scene="${sceneId}"] .svelte-flow__controls-button')[0].click(); true`);
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterPlus = await sceneMetrics(sceneId);
  await evaluate(`document.querySelectorAll('[data-scene="${sceneId}"] .svelte-flow__controls-button')[1].click(); true`);
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterMinus = await sceneMetrics(sceneId);
  await evaluate(`document.querySelectorAll('[data-scene="${sceneId}"] .svelte-flow__controls-button')[2].click(); true`);
  await new Promise(resolve => setTimeout(resolve, 280));
  const fitted = await sceneMetrics(sceneId);
  if (afterPlus.scale <= actualSize.scale || afterMinus.scale >= afterPlus.scale || Math.abs(fitted.scale - overview.scale) > .02 || !fitted.contentInside)
    throw Error(sceneId + ': +/-/fit controls failed ' + JSON.stringify({ overview, afterPlus, afterMinus, fitted }));

  const wheelPoint = { x: Math.round((fitted.panel.left + fitted.panel.right) / 2), y: Math.round((fitted.panel.top + fitted.panel.bottom) / 2) };
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...wheelPoint });
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -360 });
  await new Promise(resolve => setTimeout(resolve, 280));
  const wheel = await sceneMetrics(sceneId);
  if (wheel.scale <= fitted.scale || wheel.scale > 2.001) throw Error(sceneId + ': wheel zoom failed ' + JSON.stringify({ fitted, wheel }));
  const wheelFile = `.generated/v8-${sceneId}-wheel-zoom-1920x1080.png`;
  await capture(wheelFile);

  const panPoint = await evaluate(`(() => {
    const flow = document.querySelector('[data-scene="${sceneId}"] .flow'), rect = flow.getBoundingClientRect();
    for (let y = Math.max(rect.top + 60, 60); y < Math.min(rect.bottom - 60, innerHeight - 60); y += 50) for (let x = rect.left + 120; x < rect.right - 120; x += 80) {
      const element = document.elementFromPoint(x, y);
      if (element && flow.contains(element) && element.closest('.svelte-flow__pane') && !element.closest('.svelte-flow__node,.svelte-flow__controls,.svelte-flow__minimap,[data-action="actual-size"]')) return { x, y };
    }
    return null;
  })()`);
  if (!panPoint) throw Error(sceneId + ': no pane point available for pan');
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...panPoint, button: 'left', buttons: 1, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panPoint.x + 80, y: panPoint.y + 40, button: 'left', buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panPoint.x + 80, y: panPoint.y + 40, button: 'left', buttons: 0, clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 180));
  const panned = await sceneMetrics(sceneId);
  if (Math.abs(panned.scale - wheel.scale) > .001 || (Math.abs(panned.x - wheel.x) < 10 && Math.abs(panned.y - wheel.y) < 10))
    throw Error(sceneId + ': drag pan failed ' + JSON.stringify({ wheel, panned }));
  interactionProofs.push({ sceneId, overviewFile, actualSizeFile, wheelFile, overview, actualSize, wheel, panned, controls: { plus: afterPlus.scale, minus: afterMinus.scale, fit: fitted.scale } });
}
await call('Emulation.setEmulatedMedia', { media: 'print' });
const printControlsHidden = await evaluate(`[...document.querySelectorAll('.svelte-flow__controls,.svelte-flow__minimap,[data-action="actual-size"]')].every(element => getComputedStyle(element).display === 'none')`);
await call('Emulation.setEmulatedMedia', { media: 'screen' });
if (!printControlsHidden) throw Error('interactive controls remain visible in print media');
if (runtimeErrors.length || consoleErrors.length || external.length) throw Error(JSON.stringify({ runtimeErrors, consoleErrors, external }));
const output = { status: 'pass', sceneOrder: order, series: 2, nativeSvelteFlows: 5, renderedMermaids: 5,
  viewports, offline: true, offlineProofs, directFileScreenshot: 'docs/architecture/focus/browser-proof-direct-file.png',
  interactionProofs, printControlsHidden,
  dated: true, runtimeErrors: runtimeErrors.length, consoleErrors: consoleErrors.length, externalRequests: external.length };
await writeFile('.generated/browser-metrics.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: output.status, scenes: order, viewports: viewports.map(({ width, height }) => `${width}x${height}`), offline: true }));
clearTimeout(timeout);
ws.close();
await fetch(`${base}/json/close/${page.id}`);
