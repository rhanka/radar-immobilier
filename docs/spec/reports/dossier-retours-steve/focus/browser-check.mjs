// Contrôles Chromium réels, sur la page autonome ouverte en file://.
// Même protocole que docs/architecture/focus/browser-check.mjs pour les deux scènes de
// composants (SvelteFlow) ; contrôles propres à la matrice, au diagramme entité-relation
// et à l'architecture en couloirs ; décisions D1 à D16 et leur copie en YAML ; thèmes
// clair et sombre. Onglet neuf, fermé à la fin.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const port = process.env.CDP_PORT ?? '9243';
const base = `http://127.0.0.1:${port}`;
const focusFileRoot = process.env.FOCUS_FILE_ROOT;
if (!focusFileRoot) throw Error('FOCUS_FILE_ROOT is required');
const focusFile = `file://${focusFileRoot}/decision-focus.html`;

const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), runtimeErrors = [], consoleErrors = [], externalRequests = [];
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.exceptionThrown') runtimeErrors.push(data.params.exceptionDetails.text ?? 'exception');
  if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') consoleErrors.push(data.params.args.map(arg => arg.value ?? arg.description).join(' '));
  if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') consoleErrors.push(data.params.entry.text);
  if (data.method === 'Network.requestWillBeSent' && /^https?:/.test(data.params.request.url)) externalRequests.push(data.params.request.url);
  const item = pending.get(data.id);
  if (item) { pending.delete(data.id); data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result); }
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
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw Error(failure);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sceneBox = selector => evaluate(`(() => { const element = document.querySelector('${selector}'); element.scrollIntoView({ block: 'start' });
  const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; })()`);
const capture = async (box, file) => {
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...box, scale: 1 } });
  await writeFile(file, Buffer.from(shot.data, 'base64'));
};
const timeout = setTimeout(() => { console.error('Browser verification timed out'); process.exit(1); }, 150000);

await mkdir('.generated', { recursive: true });
await call('Runtime.enable');
await call('Log.enable');
await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
const READY = `document.querySelectorAll('.scene').length === 5 && document.querySelectorAll('.flow').length === 1 && document.querySelectorAll('[data-diagram]').length === 4 && document.querySelectorAll('[data-node-kind]').length > 0`;
await waitUntil(READY, 'les cinq scènes sont absentes');
const expectedGraphs = `window.expectedGraphs=${JSON.stringify(graphs.map(graph => ({ id: graph.id, kind: graph.kind, projection: graph.projection, sceneHash: graph.sceneHash, groups: (graph.groups ?? []).length })))};true`;
await evaluate(expectedGraphs);

const checkExpression = `(() => {
  const graphs = window.expectedGraphs;
  const order = graphs.map(graph => graph.id);
  const actualOrder = [...document.querySelectorAll('.scene')].map(scene => scene.dataset.scene);
  if (JSON.stringify(actualOrder) !== JSON.stringify(order)) throw Error('ordre des scènes : ' + actualOrder);
  if (document.querySelectorAll('.flow').length !== 1 || document.querySelectorAll('[data-diagram]').length !== 4) throw Error('une scène SvelteFlow et quatre diagrammes attendus');
  const inside = (inner, outer, pad = 1) => inner.left >= outer.left - pad && inner.top >= outer.top - pad && inner.right <= outer.right + pad && inner.bottom <= outer.bottom + pad;
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const orthogonal = points => points.slice(1).every((point, index) => point.x === points[index].x || point.y === points[index].y);
  // Texts of a box must stay inside it; labels must not cover any box.
  const textsInside = (box, texts, name) => { for (const text of texts) if (text.textContent.trim() && !inside(text.getBoundingClientRect(), box, 0.5)) throw Error(name + ' : texte hors de sa boîte : ' + text.textContent); };
  const checkDiagram = graph => {
    const root = document.querySelector('[data-scene="' + graph.id + '"] [data-diagram]');
    if (!root || root.dataset.diagramKind !== graph.kind) throw Error(graph.id + ' : diagramme ' + graph.kind + ' absent');
    const frame = root.getBoundingClientRect();
    if (graph.kind === 'matrix') {
      const rows = [...root.querySelectorAll('tbody tr[data-row]')].map(row => ({ criterion: row.dataset.row, coverage: row.dataset.coverage, noise: Number(row.dataset.noise) }));
      const expected = graph.projection.rows.map(row => ({ criterion: row.criterion, coverage: row.coverage, noise: row.noise }));
      if (JSON.stringify(rows) !== JSON.stringify(expected)) throw Error(graph.id + ' : lignes de la matrice différentes');
      if (Number(root.querySelector('tfoot tr').dataset.noise) !== graph.projection.total.noise) throw Error(graph.id + ' : total de bruit');
      if (root.scrollWidth > root.clientWidth + 1) throw Error(graph.id + ' : matrice plus large que son panneau');
      return { sceneId: graph.id, kind: 'matrix', sceneHash: graph.sceneHash, rows: rows.length, coverage: rows.map(row => row.coverage) };
    }
    const svg = root.querySelector('svg');
    const scale = svg.getBoundingClientRect().width / Number(root.dataset.canvasWidth);
    if (root.querySelector('[data-action="fit"]').getAttribute('aria-pressed') !== 'true' || scale <= 0 || scale > 1.0001 || svg.getBoundingClientRect().width > frame.width + 1) throw Error(graph.id + ' : vue d’ensemble hors panneau ' + scale);
    if (!root.querySelector('[data-action="actual-size"]') || !root.querySelector('[data-action="fit"]')) throw Error(graph.id + ' : boutons de zoom absents');
    const routes = [...root.querySelectorAll('[data-route-points]')];
    for (const route of routes) {
      const path = route.querySelector('path'), style = getComputedStyle(path);
      if (path.getTotalLength() <= 0 || style.stroke === 'none') throw Error(graph.id + ' : lien invisible ' + (route.dataset.relation || route.dataset.laneEdge));
      if (!orthogonal(JSON.parse(route.dataset.routePoints))) throw Error(graph.id + ' : route non orthogonale');
    }
    if (graph.kind === 'er') {
      const entities = [...root.querySelectorAll('[data-entity]')];
      const ids = entities.map(entity => entity.dataset.entity).sort();
      if (JSON.stringify(ids) !== JSON.stringify(graph.projection.entities.map(entity => entity.id).sort())) throw Error(graph.id + ' : tables différentes');
      const relations = [...root.querySelectorAll('[data-relation]')].map(relation => [relation.dataset.relation, relation.dataset.sourceCardinality, relation.dataset.targetCardinality, relation.dataset.identifying].join('|')).sort();
      const expected = graph.projection.relations.map(relation => [relation.id, relation.sourceCardinality, relation.targetCardinality, String(relation.identifying)].join('|')).sort();
      if (JSON.stringify(relations) !== JSON.stringify(expected)) throw Error(graph.id + ' : relations différentes');
      const boxes = entities.map(entity => ({ id: entity.dataset.entity, rect: entity.querySelector('.er-body').getBoundingClientRect() }));
      for (const [index, a] of boxes.entries()) {
        textsInside(a.rect, entities[index].querySelectorAll('text'), graph.id + '/' + a.id);
        for (const b of boxes.slice(index + 1)) if (hit(a.rect, b.rect)) throw Error(graph.id + ' : tables superposées ' + a.id + '/' + b.id);
      }
      const labels = [...root.querySelectorAll('[data-relation-label] rect')];
      for (const label of labels) for (const box of boxes) if (hit(label.getBoundingClientRect(), box.rect)) throw Error(graph.id + ' : libellé sur la table ' + box.id);
      for (const [index, a] of labels.entries()) for (const b of labels.slice(index + 1)) if (hit(a.getBoundingClientRect(), b.getBoundingClientRect())) throw Error(graph.id + ' : libellés superposés');
      return { sceneId: graph.id, kind: 'er', sceneHash: graph.sceneHash, initialScale: scale, tables: entities.length, relations: relations.length, labels: labels.length,
        existing: entities.filter(entity => entity.dataset.existing === 'true').map(entity => entity.dataset.entity) };
    }
    // Swimlanes: lanes left to right in the agreed order, oracle band below all of them.
    const lanes = [...root.querySelectorAll('[data-lane-kind]')].map(lane => ({ id: lane.dataset.lane, kind: lane.dataset.laneKind, rect: lane.querySelector('.lane-bg').getBoundingClientRect() }));
    if (JSON.stringify(lanes.map(lane => lane.kind)) !== JSON.stringify(graph.projection.laneKinds)) throw Error(graph.id + ' : ordre des couloirs');
    if (lanes.some((lane, index) => index && lane.rect.left < lanes[index - 1].rect.right - 1)) throw Error(graph.id + ' : couloirs non alignés de gauche à droite');
    const band = root.querySelector('[data-band] .band-bg').getBoundingClientRect();
    const lanesBox = { left: lanes[0].rect.left, right: lanes.at(-1).rect.right, bottom: Math.max(...lanes.map(lane => lane.rect.bottom)) };
    if (band.top < lanesBox.bottom || band.width < (lanesBox.right - lanesBox.left) * .95) throw Error(graph.id + ' : bande oracle pas en bas ni transversale');
    // Scène à deux zones : la zone « application » contient tous les couloirs, la bande est dessous.
    const zoneElement = root.querySelector('[data-zone] rect');
    if (Boolean(zoneElement) !== Boolean(graph.projection.zone)) throw Error(graph.id + ' : zone application');
    if (zoneElement) { const zone = zoneElement.getBoundingClientRect();
      if (lanes.some(lane => !inside(lane.rect, zone)) || band.top < zone.bottom) throw Error(graph.id + ' : couloirs hors de la zone application ou bande non séparée'); }
    const nodes = [...root.querySelectorAll('[data-lane-node]')];
    const projected = graph.projection.nodes.map(node => node.id + '|' + node.lane + '|' + node.evidence).sort();
    if (JSON.stringify(nodes.map(node => node.dataset.laneNode + '|' + node.dataset.lane + '|' + node.dataset.evidence).sort()) !== JSON.stringify(projected)) throw Error(graph.id + ' : blocs différents');
    const laneRect = Object.fromEntries(lanes.map(lane => [lane.id, lane.rect]));
    const boxes = nodes.map(node => ({ id: node.dataset.laneNode, rect: node.querySelector('.node-body').getBoundingClientRect(), lane: node.dataset.lane }));
    for (const [index, box] of boxes.entries()) {
      if (!inside(box.rect, laneRect[box.lane] ?? band)) throw Error(graph.id + '/' + box.id + ' : bloc hors de son couloir');
      textsInside(box.rect, nodes[index].querySelectorAll('text'), graph.id + '/' + box.id);
      for (const other of boxes.slice(index + 1)) if (hit(box.rect, other.rect)) throw Error(graph.id + ' : blocs superposés ' + box.id + '/' + other.id);
    }
    const data = laneRect[lanes.find(lane => lane.kind === 'data').id];
    const stores = [...root.querySelectorAll('[data-container]')].map(store => ({ id: store.dataset.container, rect: store.querySelector('rect').getBoundingClientRect(), label: store.querySelector('text').textContent }));
    if (stores.length !== graph.projection.stores || stores.some(store => !inside(store.rect, data))) throw Error(graph.id + ' : magasins de données hors du couloir données');
    const edges = [...root.querySelectorAll('[data-lane-edge]')].map(edge => edge.dataset.laneEdge).sort();
    if (JSON.stringify(edges) !== JSON.stringify(graph.projection.edges.map(edge => edge.id).sort())) throw Error(graph.id + ' : liens différents');
    const labels = [...root.querySelectorAll('[data-edge-label] rect')];
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      if (!inside(rect, svg.getBoundingClientRect())) throw Error(graph.id + ' : libellé hors du canevas');
      for (const box of boxes) if (hit(rect, box.rect)) throw Error(graph.id + ' : libellé sur le bloc ' + box.id + ' : ' + label.nextElementSibling.textContent);
    }
    return { sceneId: graph.id, kind: 'lanes', sceneHash: graph.sceneHash, initialScale: scale, lanes: lanes.map(lane => lane.kind), stores: stores.map(store => store.label),
      zone: graph.projection.zone, band: { below: true, widthShare: Number((band.width / (lanesBox.right - lanesBox.left)).toFixed(3)) }, nodes: nodes.length, edges: edges.length, labels: labels.length };
  };
  if (!document.querySelector('.masthead').textContent.includes('5 SCÈNES · 12 SECTIONS · 16 DÉCISIONS')) throw Error('bandeau absent');
  const metrics = [];
  for (const graph of graphs) {
    if (graph.kind !== 'flow') { metrics.push(checkDiagram(graph)); continue; }
    const scene = document.querySelector('[data-scene="' + graph.id + '"]');
    const flow = scene.querySelector('.flow');
    const transform = getComputedStyle(flow.querySelector('.svelte-flow__viewport')).transform;
    const scale = Number((transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
    if (scale >= 1 || scale < .03 || flow.dataset.zoomRange !== '0.03:2' || visualViewport.scale !== 1 || devicePixelRatio !== 1)
      throw Error(graph.id + ' : fitView hors plage ' + scale);
    const flowRect = flow.getBoundingClientRect();
    if (flowRect.height <= 0) throw Error(graph.id + ' : panneau sans hauteur');
    const controls = { boutons: flow.querySelectorAll('.svelte-flow__controls-button').length,
      unUn: Boolean(flow.querySelector('[data-action="actual-size"]')), minimap: Boolean(flow.querySelector('.svelte-flow__minimap')) };
    if (controls.boutons < 3 || !controls.unUn || !controls.minimap) throw Error(graph.id + ' : contrôles absents ' + JSON.stringify(controls));
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
    if (JSON.stringify(nativeNodes) !== JSON.stringify(graph.projection.nodes)) throw Error(graph.id + ' : projection des cartes différente');
    if (JSON.stringify(nativeEdges) !== JSON.stringify(graph.projection.edges)) throw Error(graph.id + ' : projection des arêtes différente');
    // Gabarit unique A' : 460 x 200, cinq lignes, icône haute comme les deux
    // premières, aucune ligne de statut, aucune ellipse.
    const TYPE_PX = { code: 22, 'service-title': 32, name: 24, detail: 24, repo: 24 };
    const cards = [...flow.querySelectorAll('[data-node-kind="ordinary"]')].map(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      const text = [...node.querySelectorAll('[data-text-role]')];
      const iconBox = node.querySelector('[data-service-icon]').getBoundingClientRect();
      const codeBox = node.querySelector('[data-text-role="code"]').getBoundingClientRect();
      const titleBox = node.querySelector('[data-text-role="service-title"]').getBoundingClientRect();
      const nameBox = node.querySelector('[data-text-role="name"]').getBoundingClientRect();
      const value = { id: node.dataset.id, template: node.dataset.card, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        width: rect.width / scale, height: rect.height / scale, lines: text.length,
        iconPx: iconBox.height / scale, twoLinePx: (titleBox.bottom - codeBox.top) / scale, iconSquarePx: iconBox.width / scale,
        headStartPx: (codeBox.left - rect.left) / scale, fullWidthLeftPx: (nameBox.left - rect.left) / scale,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
        typePx: Object.fromEntries(text.map(item => [item.dataset.textRole, parseFloat(getComputedStyle(item).fontSize)])) };
      if (value.template !== 'A' || value.lines !== 5
        || Math.abs(value.width - 460) > .05 || Math.abs(value.height - 200) > .05
        || Math.abs(value.iconPx - value.twoLinePx) > 1 || Math.abs(value.iconPx - value.iconSquarePx) > .05
        || Math.abs(value.fullWidthLeftPx - 16) > .05 || value.headStartPx < value.fullWidthLeftPx + value.iconPx
        || node.querySelector('[data-text-role="status"]')
        || value.padding.some(item => Math.abs(item - 8) > .01)
        || Object.entries(value.typePx).some(([role, px]) => Math.abs(px - TYPE_PX[role]) > .01)
        || text.some(item => item.getBoundingClientRect().width <= 0 || item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1))
        throw Error(graph.id + '/' + value.id + ' : carte hors gabarit ' + JSON.stringify(value));
      return value;
    });
    let overlaps = 0;
    for (let left = 0; left < cards.length; left++) for (let right = left + 1; right < cards.length; right++) {
      const a = cards[left].rect, b = cards[right].rect;
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
        overlaps++; throw Error(graph.id + ' : cartes superposées ' + cards[left].id + '/' + cards[right].id);
      }
    }
    for (const node of flow.querySelectorAll('[data-node-kind]')) {
      const rect = node.getBoundingClientRect();
      if (rect.left < flowRect.left - 1 || rect.top < flowRect.top - 1 || rect.right > flowRect.right + 1 || rect.bottom > flowRect.bottom + 1)
        throw Error(graph.id + '/' + node.dataset.id + ' : carte hors du panneau');
    }
    for (const group of flow.querySelectorAll('[data-node-kind="cluster"]')) {
      if (!group.querySelector('[data-service-icon]') || !group.querySelector('[data-text-role="repo"]')) throw Error(graph.id + '/' + group.dataset.id + ' : conteneur sans icône ou repo');
      if (parseFloat(getComputedStyle(group.querySelector('[data-text-role="subflow-title"]')).fontSize) !== 32) throw Error(graph.id + ' : titre de conteneur hors 32px');
    }
    const labels = [...flow.querySelectorAll('[data-text-role="edge-label"]')];
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      if (parseFloat(getComputedStyle(label).fontSize) !== 24 || rect.width <= 0
        || rect.left < flowRect.left - 1 || rect.top < flowRect.top - 1 || rect.right > flowRect.right + 1 || rect.bottom > flowRect.bottom + 1)
        throw Error(graph.id + ' : libellé d’arête invisible ou hors panneau : ' + label.textContent);
      for (const node of flow.querySelectorAll('[data-node-kind="ordinary"]')) {
        const box = node.getBoundingClientRect();
        if (rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top)
          throw Error(graph.id + ' : libellé sur la carte ' + node.dataset.id + ' / ' + label.textContent);
      }
    }
    for (const edge of flow.querySelectorAll('g[data-canonical-edge]')) {
      const path = edge.querySelector('path'), length = path?.getTotalLength() ?? 0, style = path && getComputedStyle(path);
      if (!path || length <= 0 || style.stroke === 'none' || Number(style.strokeWidth.replace('px', '')) <= 0) throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ' : arête invisible');
      const routePoints = JSON.parse(edge.dataset.routePoints);
      if (routePoints.slice(1).some((point, index) => point.x !== routePoints[index].x && point.y !== routePoints[index].y))
        throw Error(graph.id + '/' + edge.dataset.canonicalEdge + ' : route non orthogonale');
    }
    const contentBoxes = [...flow.querySelectorAll('[data-node-kind], g[data-canonical-edge] path, [data-text-role="edge-label"]')]
      .map(element => element.getBoundingClientRect()).filter(box => box.width > 0 || box.height > 0);
    const content = { left: Math.min(...contentBoxes.map(box => box.left)), top: Math.min(...contentBoxes.map(box => box.top)),
      right: Math.max(...contentBoxes.map(box => box.right)), bottom: Math.max(...contentBoxes.map(box => box.bottom)) };
    const contentInside = content.left >= flowRect.left - 1 && content.top >= flowRect.top - 1
      && content.right <= flowRect.right + 1 && content.bottom <= flowRect.bottom + 1;
    if (!contentInside) throw Error(graph.id + ' : le contenu complet sort du panneau ' + JSON.stringify({ content, flowRect }));
    metrics.push({ sceneId: graph.id, kind: 'flow', sceneHash: graph.sceneHash, initialScale: scale, contentInside, overlaps,
      cards: cards.length, edges: nativeEdges.length, groups: graph.groups, edgeLabels: labels.length,
      panel: { left: flowRect.left, top: flowRect.top, width: flowRect.width, height: flowRect.height },
      iconPx: Math.min(...cards.map(card => card.iconPx)), controls });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('débordement horizontal de la page');
  return metrics;
})()`;

// Graphiques du texte et options détaillées : présents, lisibles, rien ne déborde.
const contentExpression = `(() => {
  for (const details of document.querySelectorAll('details.dossier-section')) details.open = true;
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const charts = [...document.querySelectorAll('[data-chart]')].map(chart => {
    const svg = chart.querySelector('svg').getBoundingClientRect();
    const bars = [...chart.querySelectorAll('rect[data-value]')];
    if (!bars.length || bars.some(bar => bar.getBoundingClientRect().right > svg.right + 1)) throw Error('graphique ' + chart.dataset.chart + ' : barres hors cadre');
    const fills = new Set(bars.map(bar => getComputedStyle(bar).fill));
    if (fills.has('none') || fills.has('rgb(0, 0, 0)')) throw Error('graphique ' + chart.dataset.chart + ' : couleur absente');
    for (const text of chart.querySelectorAll('svg text')) if (!hit(text.getBoundingClientRect(), svg)) throw Error('graphique ' + chart.dataset.chart + ' : texte hors cadre');
    return { id: chart.dataset.chart, kind: chart.dataset.chartKind, bars: bars.length };
  });
  const descriptions = document.querySelectorAll('.question-block [data-description]').length;
  const minis = [...document.querySelectorAll('[data-mini-diagram]')].map(mini => {
    const svg = mini.querySelector('svg').getBoundingClientRect();
    const boxes = [...mini.querySelectorAll('.er-body')].map(box => box.getBoundingClientRect());
    for (const label of mini.querySelectorAll('[data-relation-label] rect')) for (const box of boxes) if (hit(label.getBoundingClientRect(), box)) throw Error(mini.dataset.miniDiagram + ' : libellé sur une table');
    for (const entity of mini.querySelectorAll('[data-entity]')) { const body = entity.querySelector('.er-body').getBoundingClientRect();
      for (const text of entity.querySelectorAll('text')) if (text.textContent.trim()) { const r = text.getBoundingClientRect(); if (r.right > body.right + 1 || r.left < body.left - 1) throw Error(mini.dataset.miniDiagram + ' : texte hors table'); } }
    return { id: mini.dataset.miniDiagram, tables: boxes.length, scale: Number((svg.width / Number(mini.dataset.canvasWidth)).toFixed(3)) };
  });
  if (charts.length !== 4 || descriptions !== 48 || minis.length !== 7) throw Error('contenu : ' + JSON.stringify({ charts: charts.length, descriptions, minis: minis.length }));
  if (minis.some(mini => mini.scale < .6)) throw Error('schéma d’option trop réduit : ' + JSON.stringify(minis));
  return { charts, descriptions, minis };
})()`;
const content = await evaluate(contentExpression);
const contentCaptures = [];
for (const [name, selector] of [['graphique-sens', '[data-chart="sens-classement"]'], ['graphique-bruit', '[data-chart="bruit-familles"]'], ['decision-D2', '[data-question="D2"]'], ['decision-D3', '[data-question="D3"]']]) {
  await capture(await sceneBox(selector), `.generated/${name}.png`);
  contentCaptures.push(`.generated/${name}.png`);
}

// Zoom : chaque diagramme s'ouvre en plein écran, se zoome, se ferme par Échap, sans
// débordement ni erreur ; zoom direct dans la page ; déplacement à la souris ; mobile 390 px.
const zoomOne = async (id, { drag = false, shot = null } = {}) => {
  const sel = `[data-zoom="${id}"]`;
  await evaluate(`(() => { const frame = document.querySelector('${sel}'); frame.scrollIntoView({ block: 'center' });
    frame.querySelector('[data-action="expand"]').click(); return true; })()`);
  await pause(250);
  const opened = await evaluate(`(() => { const frame = document.querySelector('${sel}'), rect = frame.getBoundingClientRect();
    return { open: frame.dataset.zoomOpen, mode: frame.dataset.zoomMode, scale: Number(frame.dataset.scale), rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      locked: document.documentElement.classList.contains('zoom-frame-open'), flowH: frame.querySelector('.flow')?.getBoundingClientRect().height ?? null,
      focus: document.activeElement?.dataset.action ?? null }; })()`);
  const W = await evaluate('innerWidth'), H = await evaluate('innerHeight');
  if (opened.open !== 'true' || !opened.locked || Math.abs(opened.rect.left) > 1 || Math.abs(opened.rect.top) > 1 || Math.abs(opened.rect.width - W) > 1 || Math.abs(opened.rect.height - H) > 1 || opened.focus !== 'close')
    throw Error(`plein écran ${id} : ${JSON.stringify(opened)}`);
  if (opened.mode === 'native' && opened.flowH < H * 0.7) throw Error(`plein écran ${id} : scène trop petite ${opened.flowH}`);
  // Capture at the fitted full-screen view, before zooming.
  if (shot) await capture({ x: 0, y: await evaluate('scrollY'), width: W, height: H }, shot);
  let zoomed = null, moved = null;
  if (opened.mode === 'transform') {
    await evaluate(`(() => { const frame = document.querySelector('${sel}'); frame.querySelector('[data-action="zoom-in"]').click(); frame.querySelector('[data-action="zoom-in"]').click(); return true; })()`);
    await pause(120);
    zoomed = await evaluate(`Number(document.querySelector('${sel}').dataset.scale)`);
    if (!(zoomed > opened.scale * 1.4)) throw Error(`zoom ${id} : ${opened.scale} → ${zoomed}`);
    if (drag) {
      const before = await evaluate(`document.querySelector('${sel} .zoom-stage').style.transform`);
      const at = await evaluate(`(() => { const r = document.querySelector('${sel} .zoom-viewport').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 120, y: at.y - 80, button: 'left' });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x - 120, y: at.y - 80, button: 'left', clickCount: 1 });
      await pause(100);
      moved = await evaluate(`document.querySelector('${sel} .zoom-stage').style.transform`);
      if (moved === before) throw Error(`déplacement ${id} sans effet`);
    }
  }
  const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth + 1');
  await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  await pause(200);
  const closed = await evaluate(`({ open: document.querySelector('${sel}').dataset.zoomOpen, locked: document.documentElement.classList.contains('zoom-frame-open') })`);
  if (overflow || closed.open !== 'false' || closed.locked) throw Error(`fermeture ${id} : ${JSON.stringify({ overflow, ...closed })}`);
  return { id, mode: opened.mode, fit: opened.scale || null, zoomed, dragged: Boolean(moved) };
};
const zoomIds = await evaluate(`[...document.querySelectorAll('[data-zoom]')].map(frame => frame.dataset.zoom)`);
if (zoomIds.length !== 16) throw Error(`16 diagrammes zoomables attendus, ${zoomIds.length}`);
const zoom = [];
for (const id of zoomIds) zoom.push(await zoomOne(id, { drag: id === 'flux-import-oracle', shot: id === 'affichage-abc' ? '.generated/zoom-plein-ecran-affichage-abc.png' : null }));
// Zoom direct dans la page, sur un grand diagramme : le panneau ne déborde pas.
const inPage = await evaluate(`(() => { const frame = document.querySelector('[data-zoom="modele-donnees"]'), before = Number(frame.dataset.scale);
  frame.querySelector('[data-action="zoom-in"]').click(); return before; })()`);
await pause(150);
const inPageAfter = await evaluate(`(() => { const frame = document.querySelector('[data-zoom="modele-donnees"]'), panel = frame.querySelector('.zoom-viewport').getBoundingClientRect(), outer = frame.getBoundingClientRect();
  const result = { scale: Number(frame.dataset.scale), inside: panel.right <= outer.right + 1, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  frame.querySelector('[data-action="fit"]').click(); return result; })()`);
if (!(inPageAfter.scale > inPage) || !inPageAfter.inside || inPageAfter.overflow) throw Error(`zoom dans la page : ${JSON.stringify({ inPage, ...inPageAfter })}`);
// Mobile 390 px : pas de défilement horizontal, plein écran utilisable.
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await pause(500);
const mobileOverflow = await evaluate('document.documentElement.scrollWidth - innerWidth');
if (mobileOverflow > 1) throw Error(`mobile 390 px : débordement horizontal de ${mobileOverflow}px`);
const mobile = [await zoomOne('modele-donnees', { shot: '.generated/zoom-mobile-modele-donnees.png' }), await zoomOne('criteres-steve')];
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await pause(400);

const viewports = [];
for (const viewport of [{ width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await pause(400);
  viewports.push({ ...viewport, metrics: await evaluate(checkExpression) });
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(`.generated/dossier-preview-${viewport.width}x${viewport.height}.png`, Buffer.from(shot.data, 'base64'));
}

// Les décisions : une réponse par décision, réellement sélectionnable, copiée en YAML.
// EXPECT : ce que le dossier porte (décisions, options, filtres « Je suis », PR cible).
const EXPECT = {
  picks: [['D12', 'b'], ['D12', 'a'], ['D9', '1']], selectedQuestion: 'D12', selectedOption: 'a', persisted: [['D12', 'a'], ['D9', '1']],
  storagePrefix: 'immo-steve-decision-responses:', blocks: 16, options: 48, recommended: 15, decides: { Farid: 10, Fabien: 6 },
  url: 'https://github.com/rhanka/radar-immobilier/pull/794', mine: { Farid: 10, Fabien: 6 },
  faridAnswered: ['D12'], notFarid: ['D9'], faridRoles: { D12: 'decide' }, fabienRoles: { D9: 'decide' }, allOptions: { D9: '1', D12: 'a' },
  headerKeys: ['dossier', 'fichier', 'version', 'decideur', 'date', 'coller_dans'],
  title: 'Analyse des retours d\'usage du 21 septembre 2026 : capitalisation des données annotées, vers de nouveaux critères de ciblage',
};
const pickScript = picks => `(() => { ${picks.map(([question, option]) =>
  `document.querySelector('[data-question="${question}"] [data-option="${option}"] input').click();`).join(' ')} return true; })()`;
const readExport = `(() => {
  const text = document.querySelector('#decisions-yaml').value;
  // A value is plain on its line, or a block scalar (>- or |-) on the next, indented line.
  const field = (chunk, key, indent = '    ') => {
    const match = chunk.match(new RegExp('^' + indent + key + ': (.*)(?:\\n' + indent + '  +(.*))?$', 'm'));
    return match ? (/^[>|]2?-$/.test(match[1]) ? match[2] : match[1]) : undefined;
  };
  const entries = text.split(/^  - id: /m).slice(1).map(chunk => ({ id: chunk.split('\\n')[0],
    role: field(chunk, 'role'), option: field(chunk, 'option'), statut: field(chunk, 'statut') }));
  const head = text.split('\\ndecisions:')[0];
  const header = { fenced: text.startsWith('\`\`\`yaml\\n'), keys: [...head.matchAll(/^([a-z_]+):/gm)].map(match => match[1]),
    dossierStyle: (head.match(/^dossier: (.*)$/m) || [])[1], dossier: field(head, 'dossier', ''), decideur: field(head, 'decideur', ''),
    coller_dans: field(head, 'coller_dans', ''), decisions: text.includes('\\ndecisions:\\n'), doubleQuotes: text.includes('"') };
  return { text, entries, header };
})()`;
const setSelect = (selector, value) => `(() => { const select = document.querySelector('${selector}');
  select.value = '${value}'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
await call('Emulation.setFocusEmulationEnabled', { enabled: true });
await evaluate(pickScript(EXPECT.picks));
await pause(400);
const choices = await evaluate(`(() => {
  const blocks = [...document.querySelectorAll('.question-block')];
  const single = blocks.filter(block => block.dataset.mode === 'single');
  const radio = document.querySelectorAll('.question-block[data-mode="single"] input[type="radio"]').length;
  const recommended = [...document.querySelectorAll('.question-block .option .badge.warning')].length;
  const selected = [...document.querySelectorAll('[data-question="${EXPECT.selectedQuestion}"] [data-option][data-selected="true"]')].map(option => option.dataset.option);
  const decides = blocks.map(block => block.querySelector('.roles').dataset.decides);
  const link = document.querySelector('a[data-export-target]');
  const exported = ${readExport};
  const persisted = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('${EXPECT.storagePrefix}'))) ?? '{}').selections ?? {};
  return { blocks: blocks.length, single: single.length, radio, recommended, selected, decides, persisted,
    defer: document.querySelectorAll('.question-block input[data-defer]').length,
    jsonControls: [...document.querySelectorAll('.choices button, .choices summary, .choices a')].filter(element => /JSON/i.test(element.textContent)).length,
    copyButton: document.querySelector('[data-export-copy]')?.textContent.trim(),
    steps: document.querySelector('.export .steps-line')?.textContent.trim(),
    person: document.querySelector('[data-export-person]').value, scope: document.querySelector('[data-export-scope]').value,
    link: link && { href: link.getAttribute('href'), target: link.target, rel: link.rel, text: link.textContent.trim() },
    header: exported.header, entries: exported.entries,
    answered: exported.entries.filter(entry => entry.statut === 'tranchee').map(entry => entry.id) };
})()`);
const own = Object.fromEntries(choices.entries.map(entry => [entry.id, entry]));
if (choices.blocks !== EXPECT.blocks || choices.single !== EXPECT.blocks || choices.radio !== EXPECT.options || choices.recommended !== EXPECT.recommended
  || choices.defer !== EXPECT.blocks || JSON.stringify(choices.selected) !== JSON.stringify([EXPECT.selectedOption])
  || EXPECT.persisted.some(([question, option]) => choices.persisted[question] !== option)
  || Object.entries(EXPECT.decides).some(([name, count]) => choices.decides.filter(value => value === name).length !== count)
  || choices.jsonControls !== 0 || choices.copyButton !== 'Copier mes décisions (YAML)'
  || choices.steps !== '1. Copier, 2. ouvrir la PR, 3. coller dans un commentaire.'
  || choices.person !== 'Farid' || choices.scope !== 'mine'
  || !choices.link || choices.link.href !== EXPECT.url || choices.link.target !== '_blank' || !choices.link.rel.split(' ').includes('noopener')
  || !choices.header.fenced || JSON.stringify(choices.header.keys) !== JSON.stringify(EXPECT.headerKeys) || choices.header.doubleQuotes
  || choices.header.dossierStyle !== '>-' || choices.header.dossier !== EXPECT.title || choices.header.decideur !== 'Farid'
  || choices.header.coller_dans !== EXPECT.url || !choices.header.decisions
  || choices.entries.length !== EXPECT.mine.Farid || JSON.stringify(choices.answered) !== JSON.stringify(EXPECT.faridAnswered)
  || own[EXPECT.selectedQuestion]?.option !== EXPECT.selectedOption || own[EXPECT.selectedQuestion]?.role !== 'decide'
  || EXPECT.notFarid.some(id => own[id]) || Object.entries(EXPECT.faridRoles).some(([id, role]) => own[id]?.role !== role))
  throw Error(`choix non sélectionnables ou export YAML incorrect : ${JSON.stringify(choices)}`);

// Clic réel sur « Copier mes décisions (YAML) » : la zone en lecture seule porte le même bloc.
try { await call('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch {}
const copyAt = await evaluate(`(() => { const button = document.querySelector('[data-export-copy]'); button.scrollIntoView({ block: 'center' });
  const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
await pause(250);
for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: copyAt.x, y: copyAt.y, button: 'left', clickCount: 1 });
await pause(600);
const readZone = `(() => { const area = document.querySelector('#decisions-yaml');
  return { status: document.querySelector('.export [role="status"]').textContent.trim(), refused: Boolean(document.querySelector('.export .copy-error')),
    hasDecisions: area.value.includes('\\ndecisions:'), fenced: area.value.startsWith('\`\`\`yaml\\n') && area.value.endsWith('\\n\`\`\`'),
    focused: document.activeElement === area, selectedAll: area.selectionStart === 0 && area.selectionEnd === area.value.length, value: area.value }; })()`;
const clicked = await evaluate(readZone);
let clipboardMatchesZone = null;
if (!clicked.refused) clipboardMatchesZone = await evaluate(`navigator.clipboard.readText().then(text => text === document.querySelector('#decisions-yaml').value, () => null)`);
if (!clicked.hasDecisions || !clicked.fenced || (!clicked.refused && !/copiée\(s\) en YAML/.test(clicked.status)) || clipboardMatchesZone === false)
  throw Error(`clic sur le bouton de copie : ${JSON.stringify({ ...clicked, value: clicked.value.slice(0, 200), clipboardMatchesZone })}`);
// Presse-papiers refusé (cas d'un artefact) : message clair, bloc sélectionné dans la zone.
await evaluate(`(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
  document.querySelector('[data-export-copy]').click(); return true; })()`);
await pause(400);
const refused = await evaluate(readZone);
if (!refused.refused || !refused.status.startsWith('Copie refusée par le navigateur') || !refused.focused || !refused.selectedAll || !refused.hasDecisions)
  throw Error(`repli presse-papiers refusé : ${JSON.stringify({ ...refused, value: refused.value.slice(0, 200) })}`);
const copy = { realClick: clicked.refused ? 'refused' : 'copied', clipboardMatchesZone, status: clicked.status,
  forcedRefusal: { message: refused.status, focused: refused.focused, selectedAll: refused.selectedAll }, hasDecisions: clicked.hasDecisions && refused.hasDecisions };

// Filtre « Je suis » : les miennes (décide ou valide) ou toutes.
await evaluate(setSelect('[data-export-scope]', 'all'));
await pause(200);
const all = await evaluate(readExport);
await evaluate(setSelect('[data-export-person]', 'Fabien'));
await evaluate(setSelect('[data-export-scope]', 'mine'));
await pause(200);
const fabien = await evaluate(readExport);
const exportFilter = { faridMine: choices.entries.length, all: all.entries.length, fabienMine: fabien.entries.length,
  fabienDecideur: fabien.header.decideur, fabienRoles: Object.fromEntries(fabien.entries.map(entry => [entry.id, entry.role])),
  allOptions: Object.fromEntries(all.entries.filter(entry => entry.option !== 'null').map(entry => [entry.id, entry.option])) };
if (exportFilter.all !== EXPECT.blocks || exportFilter.fabienMine !== EXPECT.mine.Fabien || exportFilter.fabienDecideur !== 'Fabien' || all.header.doubleQuotes
  || JSON.stringify(exportFilter.allOptions) !== JSON.stringify(EXPECT.allOptions)
  || Object.entries(EXPECT.fabienRoles).some(([id, role]) => exportFilter.fabienRoles[id] !== role))
  throw Error(`filtre « Je suis » : ${JSON.stringify(exportFilter)}`);
// Le brouillon de contrôle est effacé : la page livrée ne porte aucune réponse.
await evaluate(`(() => { localStorage.clear(); return true; })()`);

// Une capture 1:1 par scène, échelle réellement remise à 1 dans le panneau.
const oneToOne = [];
await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await pause(300);
// Matrice, tables et couloirs : clic réel sur 1:1, l'échelle du SVG doit valoir 1.
for (const graph of graphs.filter(item => item.kind !== 'flow')) {
  if (graph.kind === 'matrix') {
    await capture(await sceneBox(`[data-scene="${graph.id}"] [data-diagram]`), `.generated/scene-1a1-${graph.id}.png`);
    oneToOne.push({ sceneId: graph.id, scale: 1 });
    continue;
  }
  await evaluate(`(() => { document.querySelector('[data-scene="${graph.id}"] [data-action="actual-size"]').click(); return true; })()`);
  await pause(250);
  const scale = await evaluate(`(() => { const root = document.querySelector('[data-scene="${graph.id}"] [data-diagram]');
    return root.querySelector('svg').getBoundingClientRect().width / Number(root.dataset.canvasWidth); })()`);
  if (Math.abs(scale - 1) > 0.001) throw Error(`${graph.id} : le bouton 1:1 ne remet pas l’échelle à 1 (${scale})`);
  await capture(await sceneBox(`[data-scene="${graph.id}"] [data-diagram] svg`), `.generated/scene-1a1-${graph.id}.png`);
  oneToOne.push({ sceneId: graph.id, scale });
}
for (const graph of graphs.filter(item => item.kind === 'flow')) {
  const box = await evaluate(`(() => {
    const scene = document.querySelector('[data-scene="${graph.id}"]');
    scene.scrollIntoView({ block: 'center' });
    const flow = scene.querySelector('.flow');
    flow.querySelector('[data-action="actual-size"]').click();
    const rect = flow.getBoundingClientRect();
    // Page.captureScreenshot attend des coordonnées de page, pas de fenêtre.
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  })()`);
  await pause(350);
  const scale = await evaluate(`Number((getComputedStyle(document.querySelector('[data-scene="${graph.id}"] .svelte-flow__viewport')).transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1)`);
  if (Math.abs(scale - 1) > 0.001) throw Error(`${graph.id} : le bouton 1:1 ne remet pas l’échelle à 1 (${scale})`);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...box, scale: 1 } });
  await writeFile(`.generated/scene-1a1-${graph.id}.png`, Buffer.from(shot.data, 'base64'));
  oneToOne.push({ sceneId: graph.id, scale, clip: box });
}

// Vue d'ensemble par scène, après retour au fitView (rechargement de la page).
await call('Page.navigate', { url: focusFile });
await waitUntil(READY, 'rechargement hors ligne sans les cinq scènes');
await pause(500);
const overview = [];
for (const graph of graphs) {
  const box = await evaluate(`(() => {
    const scene = document.querySelector('[data-scene="${graph.id}"]');
    scene.scrollIntoView({ block: 'center' });
    const rect = (scene.querySelector('.flow') ?? scene.querySelector('[data-diagram]')).getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  })()`);
  await pause(300);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...box, scale: 1 } });
  await writeFile(`.generated/scene-vue-ensemble-${graph.id}.png`, Buffer.from(shot.data, 'base64'));
  overview.push({ sceneId: graph.id, clip: box });
}

// Thème sombre : préférence système émulée, mêmes contrôles de géométrie, contraste vérifié,
// une capture de page et une capture par scène.
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
await waitUntil(READY, 'thème sombre : scènes absentes');
await pause(500);
await evaluate(expectedGraphs);
const darkMetrics = await evaluate(checkExpression);
const luminance = `(color => { const [r, g, b] = color.match(/[\\d.]+/g).map(Number).map(value => value / 255).map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; })`;
const dark = await evaluate(`(() => { const theme = document.querySelector('[data-st-theme]'), style = getComputedStyle(theme);
  const lum = ${luminance};
  return { background: style.backgroundColor, text: style.color, backgroundLum: lum(style.backgroundColor), textLum: lum(style.color),
    diagram: getComputedStyle(document.querySelector('[data-diagram]')).backgroundColor }; })()`);
if (dark.backgroundLum > .05 || dark.textLum < .6) throw Error(`thème sombre non appliqué : ${JSON.stringify(dark)}`);
await capture({ x: 0, y: 0, width: 1440, height: 1000 }, '.generated/dossier-preview-dark-1440x1000.png');
const darkContent = await evaluate(contentExpression);
const darkZoom = await zoomOne('modele-donnees', { shot: '.generated/sombre-zoom-plein-ecran-modele-donnees.png' });
const darkCaptures = [];
for (const [name, selector] of [['graphique-sens', '[data-chart="sens-classement"]'], ['decision-D2', '[data-question="D2"]']]) {
  await capture(await sceneBox(selector), `.generated/sombre-${name}.png`);
  darkCaptures.push(`.generated/sombre-${name}.png`);
}
for (const graph of graphs) {
  await capture(await sceneBox(`[data-scene="${graph.id}"]`), `.generated/scene-sombre-${graph.id}.png`);
  darkCaptures.push(`.generated/scene-sombre-${graph.id}.png`);
}
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

const offline = await evaluate(`({ url: location.href, title: document.title, external: performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).length })`);
clearTimeout(timeout);
const report = {
  status: runtimeErrors.length || consoleErrors.length || externalRequests.length ? 'fail' : 'pass',
  checkedAt: new Date().toISOString(), url: focusFile, chromiumCdpPort: port,
  offline: { ...offline, blockedExternal: true },
  viewports: viewports.map(viewport => ({ width: viewport.width, height: viewport.height })),
  scenes: viewports[0].metrics, scenesAt1920: viewports[1].metrics,
  dark: { ...dark, scenes: darkMetrics, content: darkContent, zoom: darkZoom }, content, zoom: { frames: zoom, inPage: { before: inPage, ...inPageAfter }, mobile }, choices, copy, exportFilter, oneToOne, overview,
  captures: ['.generated/dossier-preview-1440x1000.png', '.generated/dossier-preview-1920x1080.png',
    ...graphs.map(graph => `.generated/scene-1a1-${graph.id}.png`),
    ...graphs.map(graph => `.generated/scene-vue-ensemble-${graph.id}.png`),
    '.generated/dossier-preview-dark-1440x1000.png', ...darkCaptures, ...contentCaptures,
    '.generated/zoom-plein-ecran-affichage-abc.png', '.generated/zoom-mobile-modele-donnees.png', '.generated/sombre-zoom-plein-ecran-modele-donnees.png'],
  consoleErrors, runtimeErrors, externalRequests,
};
await writeFile('.generated/browser-check.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, scenes: report.scenes.map(scene => ({ id: scene.sceneId, kind: scene.kind, cards: scene.cards ?? scene.tables ?? scene.nodes ?? scene.rows, edges: scene.edges ?? scene.relations, labels: scene.edgeLabels ?? scene.labels, fitView: scene.initialScale && Number(scene.initialScale.toFixed(4)) })), dark: { background: dark.background, scenes: darkMetrics.length }, zoom: { frames: zoom.length, mobile: mobile.length }, choices: { blocks: choices.blocks, radio: choices.radio, recommended: choices.recommended, selected: choices.selected, answered: choices.answered }, yaml: { copy: copy.realClick, clipboardMatchesZone: copy.clipboardMatchesZone, forcedRefusalHandled: true, hasDecisions: copy.hasDecisions, link: choices.link.href, faridMine: exportFilter.faridMine, fabienMine: exportFilter.fabienMine, all: exportFilter.all }, captures: report.captures.length, consoleErrors: consoleErrors.length, runtimeErrors: runtimeErrors.length, externalRequests: externalRequests.length }));
ws.close();
// L'onglet de contrôle est refermé : le Chromium partagé ou isolé ne garde rien.
await fetch(`${base}/json/close/${page.id}`).catch(() => {});
