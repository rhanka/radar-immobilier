// Contrôles Chromium réels, sur la page autonome ouverte en file://.
// Même protocole que docs/architecture/focus/browser-check.mjs, réduit à la scène de ce
// dossier, étendu à la Figure 2, au Tableau 3, aux décisions D1 à D7 et à leur copie en
// YAML, et passé deux fois : thème clair puis thème sombre (prefers-color-scheme).
// Onglet neuf, fermé à la fin.
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
const timeout = setTimeout(() => { console.error('Browser verification timed out'); process.exit(1); }, 150000);

await mkdir('.generated', { recursive: true });
await call('Runtime.enable');
await call('Log.enable');
await call('Network.enable');
await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
await waitUntil(`document.querySelectorAll('.flow').length === 1 && document.querySelectorAll('[data-node-kind]').length > 0`, 'la scène native est absente');
await evaluate(`window.expectedGraphs=${JSON.stringify(graphs.map(graph => ({ id: graph.id, projection: graph.projection, sceneHash: graph.sceneHash, groups: graph.groups.length })))};true`);

const checkExpression = `(() => {
  const graphs = window.expectedGraphs;
  const order = graphs.map(graph => graph.id);
  const actualOrder = [...document.querySelectorAll('.scene')].map(scene => scene.dataset.scene);
  if (JSON.stringify(actualOrder) !== JSON.stringify(order)) throw Error('ordre des scènes : ' + actualOrder);
  if (document.querySelectorAll('.flow').length !== 1) throw Error('une scène attendue');
  if (!document.querySelector('.masthead').textContent.includes('1 SCÈNE · 1 FIGURE · 9 SECTIONS · 7 DÉCISIONS')) throw Error('bandeau absent');
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

// Figure 2 (tables) et Tableau 3 (groupes) : présents, lisibles, textes contenus dans leurs cases.
const figureExpression = `(() => {
  const figure = document.querySelector('[data-figure="tables"]');
  if (!figure) throw Error('Figure 2 absente');
  const svg = figure.querySelector('svg'), rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw Error('Figure 2 sans taille');
  for (const id of ['graph_nodes', 'graph_edges']) if (!figure.querySelector('[data-table="' + id + '"]')) throw Error('table absente ' + id);
  for (const id of ['gore', 'barkmere']) if (!figure.querySelector('[data-file="' + id + '"]')) throw Error('fichier absent ' + id);
  const collision = figure.querySelector('[data-collision="bylaw-242"]');
  if (!collision || !collision.textContent.includes('city_slug = gore')) throw Error('ligne partagée absente');
  if (figure.querySelectorAll('[data-effect]').length !== 3) throw Error('trois effets attendus');
  if (figure.querySelector('[data-node-kind]')) throw Error('carte de composant dans la Figure 2');
  const overflow = [...figure.querySelectorAll('text[data-fit]')].filter(text => text.getComputedTextLength() > Number(text.dataset.fit) + .5)
    .map(text => text.textContent + ' ' + Math.round(text.getComputedTextLength()) + '/' + text.dataset.fit);
  if (overflow.length) throw Error('texte hors case : ' + overflow.join(' | '));
  const table = document.querySelector('[data-groups-table]');
  const rows = [...table.querySelectorAll('tbody tr')].map(row => ({ id: row.dataset.group, cities: Number(row.querySelector('.count').textContent) }));
  const total = Number(table.querySelector('tfoot .count').textContent);
  if (rows.length !== 8 || total !== 226 || rows.reduce((sum, row) => sum + row.cities, 0) !== 226) throw Error('Tableau 3 incohérent ' + JSON.stringify(rows));
  return { texts: figure.querySelectorAll('text').length, width: rect.width, height: rect.height, groups: rows, total };
})()`;

// Thème : fond, texte et cartes lus dans le DOM rendu ; contraste WCAG calculé.
const themeExpression = `(() => {
  const rgb = value => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
  const root = document.querySelector('[data-st-theme]'), style = getComputedStyle(root);
  const background = rgb(style.backgroundColor), text = rgb(style.color);
  const secondary = rgb(getComputedStyle(document.querySelector('.eyebrow')).color);
  const card = document.querySelector('[data-node-kind="ordinary"]'), cardStyle = getComputedStyle(card);
  const cardBackground = rgb(cardStyle.backgroundColor), cardText = rgb(cardStyle.color);
  const figureText = rgb(getComputedStyle(document.querySelector('[data-figure="tables"] text.cell')).fill);
  const figureBox = rgb(getComputedStyle(document.querySelector('[data-figure="tables"] rect.box')).fill);
  const option = rgb(getComputedStyle(document.querySelector('.option')).backgroundColor);
  const badge = rgb(getComputedStyle(document.querySelector('.badge')).backgroundColor);
  const body = rgb(getComputedStyle(document.body).backgroundColor);
  return { scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    backgroundLuminance: Number(lum(background).toFixed(4)), bodyLuminance: Number(lum(body).toFixed(4)),
    contrast: { text: Number(ratio(text, background).toFixed(2)), secondary: Number(ratio(secondary, background).toFixed(2)),
      card: Number(ratio(cardText, cardBackground).toFixed(2)), figure: Number(ratio(figureText, figureBox).toFixed(2)),
      badge: Number(ratio(text, badge).toFixed(2)), option: Number(ratio(text, option).toFixed(2)) } };
})()`;

const themes = [];
const viewports = [];
let figure = null;
for (const mode of ['light', 'dark']) {
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: focusFile });
  await waitUntil(`document.querySelectorAll('.flow').length === 1 && document.querySelectorAll('[data-node-kind]').length > 0`, `${mode} : scène absente`);
  await evaluate(`window.expectedGraphs=${JSON.stringify(graphs.map(graph => ({ id: graph.id, projection: graph.projection, sceneHash: graph.sceneHash, groups: graph.groups.length })))};true`);
  await pause(500);
  const theme = await evaluate(themeExpression);
  const darkOk = theme.backgroundLuminance < .03 && theme.bodyLuminance < .03;
  const lightOk = theme.backgroundLuminance > .9 && theme.bodyLuminance > .9;
  const contrastOk = theme.contrast.text >= 7 && theme.contrast.secondary >= 4.5 && theme.contrast.card >= 7
    && theme.contrast.figure >= 7 && theme.contrast.badge >= 4.5 && theme.contrast.option >= 7;
  if (theme.scheme !== mode || !(mode === 'dark' ? darkOk : lightOk) || !contrastOk) throw Error(`thème ${mode} : ${JSON.stringify(theme)}`);
  const modeViewports = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    // mobile: false keeps the layout viewport at the device width, so an overflow is measured, not zoomed out.
  await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    await pause(450);
    const metrics = viewport.width < 600
      ? await evaluate(`(() => { if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('débordement horizontal à ' + innerWidth); return []; })()`)
      : await evaluate(checkExpression);
    modeViewports.push({ ...viewport, metrics });
    const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(`.generated/dossier-preview-${viewport.width}x${viewport.height}-${mode}.png`, Buffer.from(shot.data, 'base64'));
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  figure = await evaluate(figureExpression);
  const box = await evaluate(`(() => { const element = document.querySelector('[data-figure="tables"]'); element.scrollIntoView({ block: 'start' });
    const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; })()`);
  await pause(250);
  const figureShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...box, scale: 1 } });
  await writeFile(`.generated/figure-tables-${mode}.png`, Buffer.from(figureShot.data, 'base64'));
  // Une capture 1:1 de la scène, échelle réellement remise à 1 dans le panneau.
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  for (const graph of graphs) {
    const overviewBox = await evaluate(`(() => { const scene = document.querySelector('[data-scene="${graph.id}"]'); scene.scrollIntoView({ block: 'center' });
      const rect = scene.querySelector('.flow').getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; })()`);
    await pause(300);
    const overview = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...overviewBox, scale: 1 } });
    await writeFile(`.generated/scene-vue-ensemble-${graph.id}-${mode}.png`, Buffer.from(overview.data, 'base64'));
    await evaluate(`(() => { document.querySelector('[data-scene="${graph.id}"] [data-action="actual-size"]').click(); return true; })()`);
    await pause(350);
    const scale = await evaluate(`Number((getComputedStyle(document.querySelector('[data-scene="${graph.id}"] .svelte-flow__viewport')).transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1)`);
    if (Math.abs(scale - 1) > 0.001) throw Error(`${graph.id} : le bouton 1:1 ne remet pas l’échelle à 1 (${scale})`);
    const oneToOne = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...overviewBox, scale: 1 } });
    await writeFile(`.generated/scene-1a1-${graph.id}-${mode}.png`, Buffer.from(oneToOne.data, 'base64'));
  }
  themes.push({ mode, status: 'pass', theme: theme.scheme, backgroundLuminance: theme.backgroundLuminance, contrast: theme.contrast,
    viewports: modeViewports.map(viewport => ({ width: viewport.width, height: viewport.height })) });
  viewports.push(...modeViewports.map(viewport => ({ ...viewport, mode })));
}
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: focusFile });
await waitUntil(`document.querySelectorAll('.flow').length === 1`, 'rechargement hors ligne sans la scène');
await pause(500);

// Les décisions : une réponse par décision, réellement sélectionnable, copiée en YAML.
// EXPECT : ce que le dossier porte (décisions, options, filtres « Je suis », PR cible).
const EXPECT = {
  picks: [['D2', 'B'], ['D2', 'C'], ['D3', 'a']], selectedQuestion: 'D2', selectedOption: 'C', persisted: [['D2', 'C'], ['D3', 'a']],
  storagePrefix: 'immo-villes-ecart-decision-responses:', blocks: 7, options: 19, recommended: 7, decides: { Fabien: 7 },
  url: 'https://github.com/rhanka/radar-immobilier/pull/815', mine: { Fabien: 7, Farid: 0 },
  answered: ['D2', 'D3'], roles: { D2: 'decide', D3: 'decide', D7: 'decide' }, allOptions: { D2: 'C', D3: 'a' },
};
const pickScript = picks => `(() => { ${picks.map(([question, option]) =>
  `document.querySelector('[data-question="${question}"] [data-option="${option}"] input').click();`).join(' ')} return true; })()`;
const readExport = `(() => {
  const text = document.querySelector('#decisions-yaml').value;
  const field = (chunk, key) => (chunk.match(new RegExp('^    ' + key + ': (.*)$', 'm')) || [])[1];
  const entries = text.split(/^  - id: /m).slice(1).map(chunk => ({ id: chunk.split('\\n')[0],
    role: field(chunk, 'role'), option: field(chunk, 'option'), statut: field(chunk, 'statut') }));
  const lines = text.split('\\n');
  const top = key => (lines.find(line => line.startsWith(key + ':')) || '').slice(key.length + 2);
  return { text, entries, first: lines.slice(0, 2), decideur: top('decideur'), collerDans: top('coller_dans'),
    quoted: /^\\s*(- )?\\w+: ["']/m.test(text), empty: lines.includes('decisions: []') };
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
  const details = blocks.map(block => { const detail = block.querySelector('[data-detail]'); const head = [...(detail?.querySelectorAll('th') ?? [])].map(th => th.textContent.trim());
    return { key: block.dataset.question, open: Boolean(detail?.open), avantages: head.includes('Avantages') && head.includes('Inconvénients'),
      recommendation: /Recommandation/.test(detail?.textContent ?? '') }; });
  const link = document.querySelector('a[data-export-target]');
  const exported = ${readExport};
  const persisted = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('${EXPECT.storagePrefix}'))) ?? '{}').selections ?? {};
  return { blocks: blocks.length, single: single.length, radio, recommended, selected, decides, details, persisted,
    defer: document.querySelectorAll('.question-block input[data-defer]').length,
    jsonControls: [...document.querySelectorAll('.choices button, .choices summary, .choices a')].filter(element => /JSON/i.test(element.textContent)).length,
    copyButton: document.querySelector('[data-export-copy]')?.textContent.trim(),
    steps: document.querySelector('.export .steps-line')?.textContent.trim(),
    person: document.querySelector('[data-export-person]').value, scope: document.querySelector('[data-export-scope]').value,
    link: link && { href: link.getAttribute('href'), target: link.target, rel: link.rel, text: link.textContent.trim() },
    first: exported.first, decideur: exported.decideur, collerDans: exported.collerDans, quoted: exported.quoted, entries: exported.entries,
    answered: exported.entries.filter(entry => entry.statut === 'tranchee').map(entry => entry.id) };
})()`);
const own = Object.fromEntries(choices.entries.map(entry => [entry.id, entry]));
if (choices.blocks !== EXPECT.blocks || choices.single !== EXPECT.blocks || choices.radio !== EXPECT.options || choices.recommended !== EXPECT.recommended
  || choices.defer !== EXPECT.blocks || JSON.stringify(choices.selected) !== JSON.stringify([EXPECT.selectedOption])
  || choices.details.some(detail => !detail.open || !detail.avantages || !detail.recommendation)
  || EXPECT.persisted.some(([question, option]) => choices.persisted[question] !== option)
  || Object.entries(EXPECT.decides).some(([name, count]) => choices.decides.filter(value => value === name).length !== count)
  || choices.jsonControls !== 0 || choices.copyButton !== 'Copier mes décisions (YAML)'
  || choices.steps !== '1. Copier, 2. ouvrir la PR, 3. coller dans un commentaire.'
  || choices.person !== 'Fabien' || choices.scope !== 'mine'
  || !choices.link || choices.link.href !== EXPECT.url || choices.link.target !== '_blank' || !choices.link.rel.split(' ').includes('noopener')
  || choices.first[0] !== '```yaml' || choices.first[1] !== 'dossier: >-' || choices.decideur !== 'Fabien'
  || choices.collerDans !== EXPECT.url || choices.quoted
  || choices.entries.length !== EXPECT.mine.Fabien || JSON.stringify(choices.answered) !== JSON.stringify(EXPECT.answered)
  || own[EXPECT.selectedQuestion]?.option !== EXPECT.selectedOption
  || Object.entries(EXPECT.roles).some(([id, role]) => own[id]?.role !== role))
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

// Filtre « Je suis » : Farid n'a aucune décision à son nom ; « toutes » garde les sept.
await evaluate(setSelect('[data-export-person]', 'Farid'));
await pause(200);
const farid = await evaluate(readExport);
const faridHint = await evaluate(`Boolean(document.querySelector('[data-export-empty]'))`);
await evaluate(setSelect('[data-export-scope]', 'all'));
await pause(200);
const all = await evaluate(readExport);
const exportFilter = { fabienMine: choices.entries.length, faridMine: farid.entries.length, faridEmpty: farid.empty, faridHint,
  faridDecideur: farid.decideur, all: all.entries.length,
  allOptions: Object.fromEntries(all.entries.filter(entry => entry.option !== 'null').map(entry => [entry.id, entry.option])),
  allRoles: [...new Set(all.entries.map(entry => entry.role))] };
if (exportFilter.faridMine !== EXPECT.mine.Farid || !exportFilter.faridEmpty || !exportFilter.faridHint || exportFilter.faridDecideur !== 'Farid'
  || exportFilter.all !== EXPECT.blocks || JSON.stringify(exportFilter.allOptions) !== JSON.stringify(EXPECT.allOptions)
  || JSON.stringify(exportFilter.allRoles) !== JSON.stringify(['null']))
  throw Error(`filtre « Je suis » : ${JSON.stringify(exportFilter)}`);
// Le brouillon de contrôle est effacé : la page livrée ne porte aucune réponse.
await evaluate(`(() => { localStorage.clear(); return true; })()`);

const offline = await evaluate(`({ url: location.href, title: document.title, external: performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).length })`);
clearTimeout(timeout);
const captures = [
  ...['light', 'dark'].flatMap(mode => ['1440x1000', '1920x1080', '390x844'].map(size => `.generated/dossier-preview-${size}-${mode}.png`)),
  ...['light', 'dark'].map(mode => `.generated/figure-tables-${mode}.png`),
  ...['light', 'dark'].flatMap(mode => graphs.flatMap(graph => [`.generated/scene-1a1-${graph.id}-${mode}.png`, `.generated/scene-vue-ensemble-${graph.id}-${mode}.png`])),
];
const report = {
  status: runtimeErrors.length || consoleErrors.length || externalRequests.length ? 'fail' : 'pass',
  checkedAt: new Date().toISOString(), url: focusFile, chromiumCdpPort: port,
  offline: { ...offline, blockedExternal: true },
  themes, viewports: viewports.map(viewport => ({ mode: viewport.mode, width: viewport.width, height: viewport.height })),
  scenes: viewports[0].metrics, scenesAt1920: viewports[1].metrics, figure,
  choices, copy, exportFilter, captures,
  consoleErrors, runtimeErrors, externalRequests,
};
await writeFile('.generated/browser-check.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, themes: themes.map(theme => ({ mode: theme.mode, status: theme.status, contrast: theme.contrast })),
  scenes: report.scenes.map(scene => ({ id: scene.sceneId, cards: scene.cards, edges: scene.edges, labels: scene.edgeLabels, fitView: Number(scene.initialScale.toFixed(4)) })),
  figure: { texts: figure.texts, total: figure.total }, choices: { blocks: choices.blocks, radio: choices.radio, recommended: choices.recommended, selected: choices.selected, answered: choices.answered },
  yaml: { copy: copy.realClick, clipboardMatchesZone: copy.clipboardMatchesZone, link: choices.link.href, fabienMine: exportFilter.fabienMine, faridMine: exportFilter.faridMine, all: exportFilter.all },
  captures: captures.length, consoleErrors: consoleErrors.length, runtimeErrors: runtimeErrors.length, externalRequests: externalRequests.length }));
ws.close();
// L'onglet de contrôle est refermé : le Chromium partagé ou isolé ne garde rien.
await fetch(`${base}/json/close/${page.id}`).catch(() => {});
