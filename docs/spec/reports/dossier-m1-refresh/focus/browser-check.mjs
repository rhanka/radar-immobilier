// Contrôles Chromium réels, sur la page autonome ouverte en file://.
// Même protocole que docs/architecture/focus/browser-check.mjs, réduit aux deux
// scènes de ce dossier et étendu aux choix sélectionnables de §7.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const port = process.env.CDP_PORT ?? '9241';
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
const timeout = setTimeout(() => { console.error('Browser verification timed out'); process.exit(1); }, 150000);

await mkdir('.generated', { recursive: true });
await call('Runtime.enable');
await call('Log.enable');
await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
await waitUntil(`document.querySelectorAll('.flow').length === 2 && document.querySelectorAll('[data-node-kind]').length > 0`, 'les deux scènes natives sont absentes');
await evaluate(`window.expectedGraphs=${JSON.stringify(graphs.map(graph => ({ id: graph.id, projection: graph.projection, sceneHash: graph.sceneHash, groups: graph.groups.length })))};true`);

const checkExpression = `(() => {
  const graphs = window.expectedGraphs;
  const order = graphs.map(graph => graph.id);
  const actualOrder = [...document.querySelectorAll('.scene')].map(scene => scene.dataset.scene);
  if (JSON.stringify(actualOrder) !== JSON.stringify(order)) throw Error('ordre des scènes : ' + actualOrder);
  if (document.querySelectorAll('.flow').length !== 2) throw Error('deux scènes attendues');
  if (!document.querySelector('.masthead').textContent.includes('2 SCÈNES · 7 SECTIONS')) throw Error('bandeau des deux scènes absent');
  const metrics = [];
  for (const graph of graphs) {
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
    metrics.push({ sceneId: graph.id, sceneHash: graph.sceneHash, initialScale: scale, contentInside, overlaps,
      cards: cards.length, edges: nativeEdges.length, groups: graph.groups, edgeLabels: labels.length,
      panel: { left: flowRect.left, top: flowRect.top, width: flowRect.width, height: flowRect.height },
      iconPx: Math.min(...cards.map(card => card.iconPx)), controls });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('débordement horizontal de la page');
  return metrics;
})()`;

const viewports = [];
for (const viewport of [{ width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await pause(400);
  viewports.push({ ...viewport, metrics: await evaluate(checkExpression) });
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(`.generated/dossier-preview-${viewport.width}x${viewport.height}.png`, Buffer.from(shot.data, 'base64'));
}

// Le choix de §7 : une seule réponse parmi A, B′, C′ et D′, réellement sélectionnable.
await evaluate(`(() => {
  document.querySelector('[data-question="m1-option"] [data-option="C_PRIME"] input').click();
  document.querySelector('[data-question="m1-option"] [data-option="A"] input').click();
  return true;
})()`);
await pause(400);
const choices = await evaluate(`(() => {
  const blocks = [...document.querySelectorAll('.question-block')];
  const single = blocks.filter(block => block.dataset.mode === 'single');
  const radio = document.querySelectorAll('.question-block[data-mode="single"] input[type="radio"]').length;
  const selected = [...document.querySelectorAll('[data-question="m1-option"] [data-option][data-selected="true"]')].map(option => option.dataset.option);
  const pack = JSON.parse(document.querySelector('.choice-json textarea').value);
  const answered = pack.responses.filter(response => response.decisionStatus === 'owner-draft-not-ratified').map(response => response.key);
  const m1 = pack.responses.find(response => response.key === 'm1-option');
  const persisted = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('immo-m1-decision-responses:'))) ?? '{}').selections ?? {};
  return { blocks: blocks.length, single: single.length, radio, selected, answered,
    m1Selection: m1.selection, m1Options: m1.options.map(option => option.key),
    schema: pack.schema, status: pack.status, persisted,
    options: pack.responses.reduce((total, response) => total + response.options.length, 0) };
})()`);
if (choices.blocks !== 1 || choices.single !== 1 || choices.radio !== 4
  || JSON.stringify(choices.selected) !== JSON.stringify(['A'])
  || choices.m1Selection !== 'A' || choices.answered.length !== 1
  || JSON.stringify(choices.m1Options) !== JSON.stringify(['A', 'B_PRIME', 'C_PRIME', 'D_PRIME'])
  || choices.persisted['m1-option'] !== 'A' || choices.status !== 'draft-not-ratified')
  throw Error(`choix non sélectionnables : ${JSON.stringify(choices)}`);
// Le brouillon de contrôle est effacé : la page livrée ne porte aucune réponse.
await evaluate(`(() => { localStorage.clear(); return true; })()`);

// Une capture 1:1 par scène, échelle réellement remise à 1 dans le panneau.
const oneToOne = [];
await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await pause(300);
for (const graph of graphs) {
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
await waitUntil(`document.querySelectorAll('.flow').length === 2`, 'rechargement hors ligne sans les deux scènes');
await pause(500);
const overview = [];
for (const graph of graphs) {
  const box = await evaluate(`(() => {
    const scene = document.querySelector('[data-scene="${graph.id}"]');
    scene.scrollIntoView({ block: 'center' });
    const rect = scene.querySelector('.flow').getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  })()`);
  await pause(300);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...box, scale: 1 } });
  await writeFile(`.generated/scene-vue-ensemble-${graph.id}.png`, Buffer.from(shot.data, 'base64'));
  overview.push({ sceneId: graph.id, clip: box });
}

const offline = await evaluate(`({ url: location.href, title: document.title, external: performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).length })`);
clearTimeout(timeout);
const report = {
  status: runtimeErrors.length || consoleErrors.length || externalRequests.length ? 'fail' : 'pass',
  checkedAt: new Date().toISOString(), url: focusFile, chromiumCdpPort: port,
  offline: { ...offline, blockedExternal: true },
  viewports: viewports.map(viewport => ({ width: viewport.width, height: viewport.height })),
  scenes: viewports[0].metrics, scenesAt1920: viewports[1].metrics,
  choices, oneToOne, overview,
  captures: ['.generated/dossier-preview-1440x1000.png', '.generated/dossier-preview-1920x1080.png',
    ...graphs.map(graph => `.generated/scene-1a1-${graph.id}.png`),
    ...graphs.map(graph => `.generated/scene-vue-ensemble-${graph.id}.png`)],
  consoleErrors, runtimeErrors, externalRequests,
};
await writeFile('.generated/browser-check.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, scenes: report.scenes.map(scene => ({ id: scene.sceneId, cards: scene.cards, edges: scene.edges, groups: scene.groups, labels: scene.edgeLabels, fitView: Number(scene.initialScale.toFixed(4)) })), choices: { blocks: choices.blocks, radio: choices.radio, selected: choices.selected, answered: choices.answered.length }, captures: report.captures.length, consoleErrors: consoleErrors.length, runtimeErrors: runtimeErrors.length, externalRequests: externalRequests.length }));
ws.close();
