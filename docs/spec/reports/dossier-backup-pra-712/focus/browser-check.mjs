// Contrôles Chromium réels, sur la page autonome ouverte en file://.
// Même protocole que docs/architecture/focus/browser-check.mjs, réduit aux trois
// scènes de ce dossier et étendu aux choix sélectionnables D1 à D5 de §12.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// LEGIBILITY_ONLY=<étiquette> : seule la mesure de lisibilité est faite, sur la page
// désignée par FOCUS_FILE_ROOT (par exemple la page d'avant), sans autre contrôle.
const legibilityOnly = process.env.LEGIBILITY_ONLY;
const { graphs, manifest } = legibilityOnly ? { graphs: [], manifest: null } : JSON.parse(await readFile('.generated/data.json', 'utf8'));
const port = process.env.CDP_PORT ?? '9242';
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
const timeout = setTimeout(() => { console.error('Browser verification timed out'); process.exit(1); }, 300000);

await mkdir('.generated', { recursive: true });
await call('Runtime.enable');
await call('Log.enable');
await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
// Premier lecteur : aucun choix de rendu mémorisé, la page s'ouvre sur ELK.
await waitUntil(`document.querySelectorAll('.flow').length === 3`, 'les trois scènes sont absentes');
await evaluate(`(() => { localStorage.clear(); return true; })()`);
await call('Page.reload', {});
await waitUntil(`document.querySelectorAll('.flow').length === 3 && document.querySelectorAll('[data-node-kind]').length > 0`, 'les trois scènes natives sont absentes');
if (!(await evaluate(`[...document.querySelectorAll('.scene .flow')].every(flow => flow.dataset.renderer === 'xyflow-elk')`))) throw Error('rendu par défaut différent d’ELK');
// La même fonction de contrôle que le build (geometry-check.mjs), injectée dans la
// page pour mesurer la géométrie réellement rendue par chacun des deux moteurs.
const geometrySource = (await readFile('geometry-check.mjs', 'utf8')).replace(/^export /gm, '');
const inject = () => evaluate(`window.__geom = (() => { ${geometrySource}; return { checkGeometry, TOLERANCE, RATIO, checkLegibility, FORMATS, LEGIBILITY, PT_PER_PX }; })();
  window.expectedGraphs=${JSON.stringify(graphs.map(graph => ({ id: graph.id, projection: graph.projection, sceneHash: graph.sceneHash, groups: graph.groups.length })))}; true`);
await inject();
// Le rendu Graphviz a été supprimé (ARCH-7) : il n'y a plus de bascule dans la
// page, et un seul rendu à contrôler. La fonction est conservée, réduite à
// l'attente du rendu ELK, pour ne pas disperser les appels existants.
const selectRenderer = async () => {
  await waitUntil(`[...document.querySelectorAll('.scene .flow')].every(flow => flow.dataset.renderer === 'xyflow-elk')`
    + ` && document.querySelectorAll('[data-node-kind]').length > 0`, 'rendu elk absent');
  await pause(500);
};

// ——— Lisibilité, mesurée sur le DOM rendu, scène ajustée à la vue ———
// Pour chaque texte : taille calculée (getComputedStyle) × facteur de zoom
// réellement appliqué à l'élément (rapport de sa largeur rendue à sa largeur de
// mise en page pour le DOM xyflow ; le second moteur ayant été retiré, il n'y a
// plus qu'un rendu à mesurer).
// Rôles : code, titre, detail (nom et détail), depot (« repo: »), liaison, conteneur.
const legibilityExpression = format => `(() => {
  const ROLE = { code: 'code', 'service-title': 'titre', name: 'detail', detail: 'detail', repo: 'depot', 'subflow-title': 'conteneur', 'edge-label': 'liaison' };
  const CARD_ROLES = ['code', 'titre', 'detail', 'detail', 'depot'];
  const out = [];
  for (const scene of document.querySelectorAll('.scene')) {
    const flow = scene.querySelector('.flow');
    const panel = flow.getBoundingClientRect();
    const texts = [];
    let frame, blocks = 0, cards = 0, scale, frameScreen;
    if (flow.dataset.renderer === 'xyflow-elk') {
      const viewport = flow.querySelector('.svelte-flow__viewport');
      scale = Number((getComputedStyle(viewport).transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
      for (const element of flow.querySelectorAll('[data-text-role]')) {
        const rect = element.getBoundingClientRect();
        // Largeur de mise en page non arrondie (offsetWidth l'arrondit au pixel).
        const layoutWidth = parseFloat(getComputedStyle(element).width) || element.offsetWidth;
        if (!layoutWidth || !rect.width) continue;
        texts.push({ role: ROLE[element.dataset.textRole], size: parseFloat(getComputedStyle(element).fontSize), applied: rect.width / layoutWidth });
      }
      frame = JSON.parse(flow.dataset.canvas);
      frameScreen = frame.width * frame.height * scale * scale;
      for (const node of flow.querySelectorAll('[data-node-kind]')) {
        const rect = node.getBoundingClientRect();
        if (!node.dataset.parentId) blocks += rect.width * rect.height;
        if (node.dataset.nodeKind === 'ordinary') cards += rect.width * rect.height;
      }
    } else {
      const svg = flow.querySelector('svg');
      const view = svg.viewBox.baseVal, root = svg.getScreenCTM();
      scale = root.a;
      const push = (role, text) => texts.push({ role, size: parseFloat(getComputedStyle(text).fontSize), applied: text.getScreenCTM().a });
      for (const node of svg.querySelectorAll('g.node')) [...node.querySelectorAll('text')].forEach((text, index) => push(CARD_ROLES[index], text));
      for (const text of svg.querySelectorAll('g.edge text')) push('liaison', text);
      for (const text of svg.querySelectorAll('g.cluster > text')) push('conteneur', text);
      frame = { width: view.width / 0.75, height: view.height / 0.75 };
      frameScreen = view.width * view.height * scale * scale;
      const clusters = [...svg.querySelectorAll('g.cluster > polygon')].map(polygon => polygon.getBoundingClientRect());
      const inside = (a, b) => a !== b && a.left >= b.left - .5 && a.right <= b.right + .5 && a.top >= b.top - .5 && a.bottom <= b.bottom + .5;
      for (const rect of clusters) if (!clusters.some(other => inside(rect, other))) blocks += rect.width * rect.height;
      for (const polygon of svg.querySelectorAll('g.node > polygon')) { const rect = polygon.getBoundingClientRect(); cards += rect.width * rect.height; }
    }
    const byRolePx = {};
    for (const text of texts) byRolePx[text.role] = Math.min(byRolePx[text.role] ?? Infinity, text.size * text.applied);
    const [minRole, minPx] = Object.entries(byRolePx).reduce((low, entry) => entry[1] < low[1] ? entry : low, ['', Infinity]);
    const measure = { format: '${format}', minPx, minRole, byRolePx };
    out.push({ sceneId: scene.dataset.scene, renderer: 'elk', format: '${format}',
      texts: texts.length, zoom: scale, minPx, minRole, minPt: window.__geom.FORMATS['${format}'].medium === 'print' ? minPx * window.__geom.PT_PER_PX : null,
      byRolePx, fill: { blocks: blocks / frameScreen, cards: cards / frameScreen },
      frameRatio: frame.width / frame.height, panel: { width: panel.width, height: panel.height }, panelRatio: panel.width / panel.height,
      faults: window.__geom.checkLegibility(measure) });
  }
  return out;
})()`;
const waitFit = () => waitUntil(`(() => { const now = [...document.querySelectorAll('.scene .svelte-flow__viewport')].map(v => getComputedStyle(v).transform).join('|');
  const same = now === window.__lastFit; window.__lastFit = now; return same; })()`, 'cadrage instable');
const legibility = [], fitCaptures = [];
const tag = legibilityOnly ? `-${legibilityOnly}` : '';
for (const format of ['1440x900', '1920x1080', 'A4-paysage']) {
  const size = format === 'A4-paysage' ? { width: 1440, height: 900 } : { width: Number(format.split('x')[0]), height: Number(format.split('x')[1]) };
  await call('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: focusFile });
  await waitUntil(`document.querySelectorAll('.scene .flow').length === 3`, 'rechargement sans les trois scènes');
  await inject();
  if (format === 'A4-paysage') await call('Emulation.setEmulatedMedia', { media: 'print' });
  for (const renderer of ['elk']) {
    await selectRenderer(renderer);
    await pause(400);
    if (renderer === 'elk') { await waitFit(); await pause(150); await waitFit(); }
    const measured = await evaluate(legibilityExpression(format));
    legibility.push(...measured);
    // Capture de chaque scène, ajustée à la vue, à 1440 × 900.
    if (format === '1440x900') for (const scene of measured) {
      const box = await evaluate(`(() => { const scene = document.querySelector('[data-scene="${scene.sceneId}"]'); scene.scrollIntoView({ block: 'center' });
        const rect = scene.querySelector('.flow').getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; })()`);
      await pause(250);
      const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...box, scale: 1 } });
      const file = `.generated/scene-ajustee-1440x900-${renderer}-${scene.sceneId}${tag}.png`;
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      fitCaptures.push(file);
    }
  }
  if (format === 'A4-paysage') await call('Emulation.setEmulatedMedia', { media: '' });
}
await evaluate(`(() => { localStorage.clear(); return true; })()`);
if (legibilityOnly) {
  await writeFile(`.generated/legibility${tag}.json`, `${JSON.stringify({ url: focusFile, checkedAt: new Date().toISOString(), legibility, fitCaptures,
    consoleErrors, runtimeErrors, externalRequests }, null, 2)}\n`);
  console.log(JSON.stringify(legibility.map(item => `${item.format}/${item.renderer}/${item.sceneId}: ${item.minPx.toFixed(2)} px (${item.minRole})`)));
  ws.close();
  process.exit(0);
}
// Le modèle du build (fitScale, geometry-check.mjs) doit donner ce que Chromium
// mesure : même zone d'affichage, même taille effective, à 0,05 px près.
const legibilityFaults = [];
for (const item of legibility) {
  const model = manifest.layoutMetrics[item.sceneId][item.renderer].legibility.formats.find(entry => entry.format === item.format);
  const panel = { '1440x900': { width: 1345, height: 720 }, '1920x1080': { width: 1800, height: 900 }, 'A4-paysage': null }[item.format];
  item.modelPx = model.minPx;
  item.modelGapPx = Math.abs(model.minPx - item.minPx);
  if (item.modelGapPx > 0.05) throw Error(`${item.format}/${item.renderer}/${item.sceneId} : mesure ${item.minPx.toFixed(3)} px, modèle du build ${model.minPx.toFixed(3)} px`);
  if (panel && (Math.abs(item.panel.width - panel.width) > .5 || Math.abs(item.panel.height - panel.height) > .5)) throw Error(`${item.format} : zone d'affichage ${JSON.stringify(item.panel)}`);
  legibilityFaults.push(...item.faults.map(fault => `${item.renderer}/${item.sceneId} ${fault}`));
}
// Porte de lisibilité : comme au build, une scène sous le seuil arrête le contrôle,
// sauf dérogation explicite inscrite au build (LEGIBILITE_DEROGATION), reportée ici.
const derogation = manifest.legibility?.derogation ?? null;
if (legibilityFaults.length && !derogation) throw Error(`lisibilité :\n${legibilityFaults.join('\n')}`);
// Retour à l'état d'ouverture (1440 × 900, rendu ELK) pour les contrôles suivants.
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
await waitUntil(`document.querySelectorAll('.flow').length === 3 && document.querySelectorAll('[data-node-kind]').length > 0`, 'retour sans les trois scènes');
await inject();
// Géométrie DOM du rendu ELK, à l'échelle 1 (bouton 1:1) : boîtes, routes et étiquettes.
const elkDomGeometry = sceneId => evaluate(`(() => {
  const scene = document.querySelector('[data-scene="${sceneId}"]');
  const flow = scene.querySelector('.flow');
  const viewport = flow.querySelector('.svelte-flow__viewport');
  const scale = Number((getComputedStyle(viewport).transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
  const origin = viewport.getBoundingClientRect();
  const toFlow = rect => ({ x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale, width: rect.width / scale, height: rect.height / scale });
  const elements = [...flow.querySelectorAll('[data-node-kind]')];
  const parent = new Map(elements.map(node => [node.dataset.id, node.dataset.parentId || null]));
  const ancestors = id => { const out = []; let p = parent.get(id); while (p) { out.push(p); p = parent.get(p); } return out; };
  const boxes = elements.map(node => ({ id: node.dataset.id, ...toFlow(node.getBoundingClientRect()), ancestors: ancestors(node.dataset.id),
    group: node.dataset.nodeKind === 'cluster' }));
  const edges = [...flow.querySelectorAll('g[data-canonical-edge]')].map(edge => {
    const label = flow.querySelector('[data-text-role="edge-label"][data-edge="' + edge.dataset.canonicalEdge + '"]');
    return { id: edge.dataset.canonicalEdge, source: edge.dataset.source, target: edge.dataset.target,
      points: JSON.parse(edge.dataset.routePoints), label: label ? toFlow(label.getBoundingClientRect()) : null };
  });
  const all = [...boxes, ...edges.filter(edge => edge.label).map(edge => edge.label)];
  const canvas = { width: Math.max(...all.map(box => box.x + box.width)) - Math.min(...all.map(box => box.x)),
    height: Math.max(...all.map(box => box.y + box.height)) - Math.min(...all.map(box => box.y)) };
  const result = window.__geom.checkGeometry({ boxes, edges, canvas });
  return { scale, boxes: boxes.length, edges: edges.length, labels: edges.filter(edge => edge.label).length, canvas, ...result };
})()`);

const checkExpression = `(() => {
  const graphs = window.expectedGraphs;
  const order = graphs.map(graph => graph.id);
  const actualOrder = [...document.querySelectorAll('.scene')].map(scene => scene.dataset.scene);
  if (JSON.stringify(actualOrder) !== JSON.stringify(order)) throw Error('ordre des scènes : ' + actualOrder);
  if (document.querySelectorAll('.flow').length !== 3) throw Error('trois scènes attendues');
  if (!document.querySelector('.masthead').textContent.includes('3 SCÈNES · 13 SECTIONS')) throw Error('bandeau des trois scènes absent');
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
      value.why = [
        value.template !== 'A' && 'template',
        value.lines !== 5 && ('lines=' + value.lines),
        Math.abs(value.width - 460) > .05 && 'width',
        Math.abs(value.height - 200) > .05 && 'height',
        Math.abs(value.iconPx - value.twoLinePx) > 1 && 'icon/twoLine',
        Math.abs(value.iconPx - value.iconSquarePx) > .05 && 'iconSquare',
        Math.abs(value.fullWidthLeftPx - 16) > .05 && 'fullWidthLeft',
        value.headStartPx < value.fullWidthLeftPx + value.iconPx && 'headStart',
        node.querySelector('[data-text-role="status"]') && 'status',
        value.padding.some(item => Math.abs(item - 8) > .01) && 'padding',
        Object.entries(value.typePx).some(([role, px]) => Math.abs(px - TYPE_PX[role]) > .01) && 'typePx',
        ...text.map(item => (item.getBoundingClientRect().width <= 0 && ('zero:' + item.dataset.textRole))
          || (item.scrollWidth > item.clientWidth + 1 && ('overW:' + item.dataset.textRole + ':' + item.scrollWidth + '>' + item.clientWidth + ':' + item.textContent))
          || (item.scrollHeight > item.clientHeight + 1 && ('overH:' + item.dataset.textRole + ':' + item.scrollHeight + '>' + item.clientHeight + ':' + item.textContent))),
      ].filter(Boolean);
      if (value.template !== 'A' || value.lines !== 5
        || Math.abs(value.width - 460) > .05 || Math.abs(value.height - 200) > .05
        || Math.abs(value.iconPx - value.twoLinePx) > 1 || Math.abs(value.iconPx - value.iconSquarePx) > .05
        || Math.abs(value.fullWidthLeftPx - 16) > .05 || value.headStartPx < value.fullWidthLeftPx + value.iconPx
        || node.querySelector('[data-text-role="status"]')
        || value.padding.some(item => Math.abs(item - 8) > .01)
        || Object.entries(value.typePx).some(([role, px]) => Math.abs(px - TYPE_PX[role]) > .01)
        || text.some(item => item.getBoundingClientRect().width <= 0 || item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1))
        (window.__tplFaults ??= []).push(graph.id + '/' + value.id + ' : ' + value.why.join(' ; '));
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
  // Toutes les cartes hors gabarit sont rapportées ensemble : s'arrêter à la
  // première oblige à relancer le contrôle autant de fois qu'il y a de fautes.
  if (window.__tplFaults?.length) throw Error('cartes hors gabarit : ' + window.__tplFaults.join(' || '));
  if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('débordement horizontal de la page');
  return metrics;
})()`;

const viewports = [];
const geometry = [];
const RENDERER_KEYS = ['elk'];
for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  // Page neuve avant de mesurer la géométrie : la boucle de lisibilité qui précède
  // passe par l'émulation d'impression, qui redimensionne le panneau du schéma
  // (26 × 17,5 cm). Revenir au média écran ne relance pas l'ajustement de xyflow,
  // et la mesure porterait alors sur une mise en page restée à l'échelle du papier.
  await call('Page.navigate', { url: focusFile });
  await waitUntil(`document.querySelectorAll('.scene .flow').length === 3`, 'rechargement sans les trois scènes');
  await inject();
  await pause(600);
  for (const renderer of RENDERER_KEYS) {
    await selectRenderer(renderer);
    if (renderer === 'elk') viewports.push({ ...viewport, metrics: await evaluate(checkExpression) });
    for (const graph of graphs) {
      if (renderer === 'elk') {
        await evaluate(`(() => { const scene = document.querySelector('[data-scene="${graph.id}"]'); scene.scrollIntoView({ block: 'center' });
          scene.querySelector('[data-action="actual-size"]').click(); return true; })()`);
        await pause(350);
      }
      const measured = await elkDomGeometry(graph.id);
      if (measured.faults.length) throw Error(`${renderer}/${graph.id} à ${viewport.width} : ${measured.faults.join(' ; ')}`);
      geometry.push({ viewport: `${viewport.width}x${viewport.height}`, renderer, sceneId: graph.id,
        ratio: Number(measured.ratio.toFixed(3)), offBorder: measured.offBorder, crossings: measured.crossings,
        detachedLabels: measured.detached, labelsOnCards: measured.labelOnCard, worstSingleLinkCenterPx: Number(measured.worstCenterPx.toFixed(2)),
        worstLabelDistancePx: Number(measured.worstLabelPx.toFixed(2)), singleLinkBoxes: measured.singleLinkBoxes,
        bends: measured.bends, boxes: measured.boxes, edges: measured.edges, labels: measured.labels });
    }
    // Retour au fitView avant la capture d'ensemble de la page.
    await call('Page.reload', {});
    await waitUntil(`document.querySelectorAll('.scene .flow').length === 3`, 'rechargement sans les trois scènes');
    await inject();
    await pause(500);
    const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(`.generated/dossier-preview-${renderer}-${viewport.width}x${viewport.height}.png`, Buffer.from(shot.data, 'base64'));
  }
  await selectRenderer('elk');
}

// Dossier recentré sur l'ÉTAPE 1 : le panneau ne pose AUCUNE question. Il expose,
// en lecture seule, le design statué (les décisions comme des faits) et les deux
// étapes — « ce qu'on fait maintenant » et « ce qu'il faudra faire après ». Le
// contrôle vérifie qu'il n'y a plus aucun bouton de question, et que le JSON
// exporté porte bien le design statué de la première vague.
const panel = await evaluate(`(() => {
  const section = document.querySelector('#decision-etape-1');
  const record = JSON.parse(section.querySelector('.choice-json textarea').value);
  return {
    questionBlocks: document.querySelectorAll('.question-block').length,
    inputs: section.querySelectorAll('input, textarea:not([readonly])').length,
    dataQuestions: section.dataset.questions,
    decisions: [...section.querySelectorAll('[data-decision]')].map(node => node.dataset.decision),
    etapes: [...section.querySelectorAll('[data-etape]')].map(node => node.dataset.etape),
    hasPrincipe: Boolean(section.querySelector('[data-principe]')),
    hasCible: Boolean(section.querySelector('[data-cible]')),
    hasReady: Boolean(section.querySelector('[data-pret]')) && Boolean(section.querySelector('[data-construire]')),
    schema: record.schema, status: record.status, recordQuestions: record.questions.length,
  };
})()`);
if (panel.questionBlocks !== 0 || panel.inputs !== 0 || panel.dataQuestions !== '0'
  || panel.decisions.length < 5 || JSON.stringify(panel.etapes) !== JSON.stringify(['1', '2'])
  || !panel.hasPrincipe || !panel.hasCible || !panel.hasReady
  || panel.recordQuestions !== 0
  || panel.schema !== 'immo-712-backup-pra-etape1-decisions/v1'
  || !/statué/.test(panel.status))
  throw Error(`panneau étape 1 non conforme (zéro question) : ${JSON.stringify(panel)}`);
// Aucune donnée locale après le contrôle : la page livrée reste vierge.
await evaluate(`(() => { localStorage.clear(); return true; })()`);

// Une capture 1:1 par scène, échelle réellement remise à 1 dans le panneau.
const oneToOne = [];
await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await pause(300);
await selectRenderer('elk');
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
  await writeFile(`.generated/scene-1a1-elk-${graph.id}.png`, Buffer.from(shot.data, 'base64'));
  oneToOne.push({ sceneId: graph.id, scale, clip: box });
}

// Vue d'ensemble par scène, après retour au fitView (rechargement de la page).
await call('Page.navigate', { url: focusFile });
await waitUntil(`document.querySelectorAll('.flow').length === 3`, 'rechargement hors ligne sans les trois scènes');
await pause(500);
const overview = [];
for (const renderer of RENDERER_KEYS) {
await selectRenderer(renderer);
for (const graph of graphs) {
  const box = await evaluate(`(() => {
    const scene = document.querySelector('[data-scene="${graph.id}"]');
    scene.scrollIntoView({ block: 'center' });
    const rect = scene.querySelector('.flow').getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  })()`);
  await pause(300);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...box, scale: 1 } });
  await writeFile(`.generated/scene-vue-ensemble-${renderer}-${graph.id}.png`, Buffer.from(shot.data, 'base64'));
  overview.push({ renderer, sceneId: graph.id, clip: box });
}
}
// Impression : un PDF par rendu, en média « print » (feuille de style d'impression).
const printed = [];
for (const renderer of RENDERER_KEYS) {
  await selectRenderer(renderer);
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  await pause(600);
  // Chaque schéma imprimé doit tenir entier dans son panneau.
  const printFit = await evaluate(`[...document.querySelectorAll('.scene .flow')].map(flow => {
    const panel = flow.getBoundingClientRect();
    const items = [...flow.querySelectorAll('[data-node-kind]')].map(item => item.getBoundingClientRect());
    const inside = items.every(box => box.left >= panel.left - 1 && box.right <= panel.right + 1 && box.top >= panel.top - 1 && box.bottom <= panel.bottom + 1);
    return { graph: flow.dataset.graph, inside, panel: [Math.round(panel.width), Math.round(panel.height)] };
  })`);
  if (printFit.some(item => !item.inside)) throw Error(`impression ${renderer} : schéma rogné ${JSON.stringify(printFit)}`);
  const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const bytes = Buffer.from(pdf.data, 'base64');
  await writeFile(`.generated/impression-${renderer}.pdf`, bytes);
  const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (!pages) throw Error(`impression ${renderer} vide`);
  await evaluate(`(() => { localStorage.clear(); return true; })()`);
  printed.push({ renderer, bytes: bytes.length, pages, printFit });
  await call('Emulation.setEmulatedMedia', { media: '' });
}

const offline = await evaluate(`({ url: location.href, title: document.title, external: performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).length })`);
clearTimeout(timeout);
const report = {
  status: runtimeErrors.length || consoleErrors.length || externalRequests.length ? 'fail' : 'pass',
  checkedAt: new Date().toISOString(), url: focusFile, chromiumCdpPort: port,
  offline: { ...offline, blockedExternal: true },
  viewports: viewports.map(viewport => ({ width: viewport.width, height: viewport.height })),
  scenes: viewports[0].metrics, scenesAt1920: viewports[1].metrics,
  decisionPanel: panel, oneToOne, overview, geometry, printed,
  legibility, legibilityFaults, legibilityDerogation: derogation,
  captures: [...RENDERER_KEYS.flatMap(renderer => ['1440x900', '1920x1080'].map(size => `.generated/dossier-preview-${renderer}-${size}.png`)),
    ...graphs.map(graph => `.generated/scene-1a1-elk-${graph.id}.png`),
    ...RENDERER_KEYS.flatMap(renderer => graphs.map(graph => `.generated/scene-vue-ensemble-${renderer}-${graph.id}.png`)),
    ...RENDERER_KEYS.map(renderer => `.generated/impression-${renderer}.pdf`), ...fitCaptures],
  consoleErrors, runtimeErrors, externalRequests,
};
await writeFile('.generated/browser-check.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, scenes: report.scenes.map(scene => ({ id: scene.sceneId, cards: scene.cards, edges: scene.edges, groups: scene.groups, labels: scene.edgeLabels, fitView: Number(scene.initialScale.toFixed(4)) })), decisionPanel: { questions: panel.dataQuestions, decisions: panel.decisions.length, etapes: panel.etapes }, geometry: geometry.map(item => `${item.viewport}/${item.renderer}/${item.sceneId}: ${item.ratio} · ${item.bends} coudes`),
  legibility: legibility.map(item => `${item.format}/${item.renderer}/${item.sceneId}: ${item.minPx.toFixed(2)} px (${item.minRole}, modèle ±${item.modelGapPx.toFixed(3)})`), legibilityFaults: legibilityFaults.length, printed, captures: report.captures.length, consoleErrors: consoleErrors.length, runtimeErrors: runtimeErrors.length, externalRequests: externalRequests.length }));
ws.close();
