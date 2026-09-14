// Export versionné des cinq scènes canoniques, en trois formats par scène :
//   <scene>.mmd        — le bloc Mermaid source, exact, tel qu'il figure dans docs/architecture.md ;
//   <scene>.graph.json — le graphe formel (conteneurs, cartes, arêtes) avec les
//                        champs métier et les positions Dagre, trié et stable ;
//   <scene>.png        — la capture Chromium à échelle 1, pleine résolution native,
//                        par le mécanisme exact de l'image d'annexe de report-render.mjs.
// Rien n'est réinventé : la géométrie vient de sceneFor() (scenes.js), les
// métadonnées de decorateGraph() (scene-metadata.js), la capture de Chromium.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sceneFor } from './scenes.js';

const OUT_DIR = '../../reports/assets/2026-09/archi';
// Même surface de capture que report-render.mjs : Chromium compose une surface
// trop grande en tuiles et en perd, donc elle reste juste au-dessus de la plus
// large scène (5 472 px pour pipeline-before).
const CANVAS = { width: 5700, height: 2400 };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const round = value => Math.round(value * 100) / 100;

const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

// Reprise de l'inlining de portable.mjs, mais en mémoire : l'export ne doit
// réécrire aucun fichier suivi par git hors de son propre dossier.
async function standaloneHtml() {
  let html = await readFile('dist/index.html', 'utf8');
  const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/)?.[0];
  const css = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/)?.[0];
  if (!script || !css) throw Error('dist/index.html: un seul script et une seule feuille attendus');
  const asset = tag => `dist/${tag.match(/(?:src|href)="([^"]+)"/)[1].replace(/^\.\//, '')}`;
  const code = (await readFile(asset(script), 'utf8')).replaceAll('</script', '<\\/script');
  const style = (await readFile(asset(css), 'utf8')).replaceAll('</style', '<\\/style');
  html = html.replace(script, () => `<script type="module">${code}</script>`)
    .replace(css, () => `<style>${style}</style>`);
  const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/gi, '').replace(/<style>[\s\S]*?<\/style>/gi, '');
  if (/<(?:script|link|img)\b[^>]+(?:src|href)=/i.test(shell)) throw Error('ressource externe restante dans le document autonome');
  return html;
}

// ---------------------------------------------------------------- graphe formel
function formalGraph(graph) {
  const scene = sceneFor(graph);
  const placed = new Map(scene.absoluteNodes.map(node => [node.id, node]));
  const local = new Map(scene.nodes.map(node => [node.id, node]));
  const geometry = id => {
    const absolute = placed.get(id), relative = local.get(id);
    return { size: { width: absolute.width, height: absolute.height },
      position: { x: round(relative.position.x), y: round(relative.position.y) },
      absolutePosition: { x: round(absolute.position.x), y: round(absolute.position.y) } };
  };
  const common = item => ({ id: item.id, label: item.label, parentId: item.parent,
    kind: item.metadata.kind, repo: item.metadata.repo,
    evidenceClass: item.metadata.evidenceClass, runtimeState: item.metadata.runtimeState,
    mermaidLine: item.line, ...geometry(item.id) });
  const byId = (left, right) => left.id.localeCompare(right.id);
  const labelPoint = edge => {
    const point = scene.edges.find(placedEdge => placedEdge.id === edge.id)?.data?.labelPoint;
    return point ? { x: round(point.x), y: round(point.y) } : null;
  };
  return {
    schema: 'immo-archi-scene-graph/v1',
    sceneId: graph.id, title: graph.title, pair: graph.pair, date: graph.date,
    sceneHash: graph.sceneHash,
    source: { file: 'docs/architecture.md', block: `### \`${graph.id}\``, mermaid: `${graph.id}.mmd` },
    layout: { engine: 'dagre-d3-es', rankdir: 'LR', nodesep: 24, ranksep: 72,
      subflowHeaderSpace: 96, cardBox: { width: 460, height: 200 },
      units: 'px, origine en haut à gauche ; position = relative au parent, absolutePosition = repère de la scène',
      canvas: { width: scene.canvas.width, height: scene.canvas.height } },
    counts: { containers: graph.groups.length, nodes: graph.nodes.length, edges: graph.edges.length },
    containers: graph.groups.map(group => ({ ...common(group), card: group.metadata.card,
      title: group.label.split('\n')[0] })).sort(byId),
    nodes: graph.nodes.map(node => ({ ...common(node), card: node.metadata.card, icon: node.metadata.icon,
      code: node.metadata.code, role: node.metadata.role, name: node.metadata.name,
      detail: node.metadata.detail, store: node.store })).sort(byId),
    edges: graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
      label: edge.label, dashed: edge.dashed, bidirectional: edge.both,
      evidenceClass: edge.metadata.evidenceClass, runtimeState: edge.metadata.runtimeState,
      mermaidLine: edge.line, labelPosition: labelPoint(edge) })).sort(byId),
  };
}

// ------------------------------------------------------------------- capture PNG
const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data);
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
const waitFor = async expression => {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw Error(`Délai dépassé : ${expression}`);
};

await mkdir(OUT_DIR, { recursive: true });
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: CANVAS.width, height: CANVAS.height, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `data:text/html;base64,${Buffer.from(await standaloneHtml()).toString('base64')}` });
await waitFor(`document.querySelectorAll('.flow').length === ${graphs.length} && document.querySelectorAll('[data-node-kind]').length === ${graphs.reduce((sum, graph) => sum + graph.nodes.length + graph.groups.length, 0)}`);

const exported = [];
for (const graph of graphs) {
  // Isolement de la scène puis retour à l'échelle 1 (« actual-size »), exactement
  // comme report-render.mjs avant la capture native de l'annexe.
  const measure = () => evaluate(`(async () => {
    const sceneId = ${JSON.stringify(graph.id)};
    document.querySelector('.dossier').style.cssText = 'max-width:none;width:${CANVAS.width}px;padding:0;margin:0';
    document.querySelectorAll('.pair').forEach(pair => { pair.style.cssText = 'display:block;border:0;padding:0;margin:0'; });
    document.querySelectorAll('.pair-grid').forEach(grid => { grid.style.cssText = 'display:block'; });
    document.querySelectorAll('.scene').forEach(scene => { scene.style.display = scene.dataset.scene === sceneId ? 'block' : 'none'; });
    const scene = document.querySelector('[data-scene="' + sceneId + '"]');
    scene.style.cssText += ';width:${CANVAS.width}px;padding:0;margin:0;border:0';
    [...scene.children].forEach(child => { if (!child.classList.contains('flow')) child.style.display = 'none'; });
    const flow = scene.querySelector('.flow');
    flow.style.cssText = 'width:${CANVAS.width}px;height:${CANVAS.height}px;overflow:visible;background:#eef4f5';
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 500));
    flow.querySelector('[data-action="actual-size"]').click();
    await new Promise(resolve => setTimeout(resolve, 500));
    flow.querySelector('[data-action="actual-size"]').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    const transform = getComputedStyle(flow.querySelector('.svelte-flow__viewport')).transform;
    const scale = Number((transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
    const elements = [...flow.querySelectorAll('[data-node-kind], g[data-canonical-edge] path, [data-text-role="edge-label"]')];
    const boxes = elements.map(element => element.getBoundingClientRect()).filter(box => box.width > 0 || box.height > 0);
    const flowBox = flow.getBoundingClientRect(), pad = 40;
    const left = Math.max(flowBox.left, Math.min(...boxes.map(box => box.left)) - pad);
    const top = Math.max(flowBox.top, Math.min(...boxes.map(box => box.top)) - pad);
    const right = Math.min(flowBox.right, Math.max(...boxes.map(box => box.right)) + pad);
    const bottom = Math.min(flowBox.bottom, Math.max(...boxes.map(box => box.bottom)) + pad);
    return { clip: { x: left + scrollX, y: top + scrollY, width: Math.ceil(right - left), height: Math.ceil(bottom - top) },
      scale, visualViewportScale: visualViewport.scale, devicePixelRatio,
      nodes: flow.querySelectorAll('[data-node-kind="ordinary"]').length,
      groups: flow.querySelectorAll('[data-node-kind="cluster"]').length,
      edges: flow.querySelectorAll('g[data-canonical-edge]').length };
  })()`);
  let metrics = await measure();
  for (let attempt = 0; attempt < 3 && metrics.scale !== 1; attempt++) metrics = await measure();
  if (metrics.scale !== 1 || metrics.visualViewportScale !== 1 || metrics.devicePixelRatio !== 1)
    throw Error(`${graph.id} : capture hors échelle native`);
  if (metrics.clip.width > CANVAS.width || metrics.clip.height > CANVAS.height)
    throw Error(`${graph.id} : capture ${metrics.clip.width}x${metrics.clip.height} au-delà de la surface ${CANVAS.width}x${CANVAS.height}`);
  if (metrics.nodes !== graph.nodes.length || metrics.groups !== graph.groups.length || metrics.edges !== graph.edges.length)
    throw Error(`${graph.id} : inventaire de capture incomplet`);
  const pngResult = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...metrics.clip, scale: 1 } });
  const png = Buffer.from(pngResult.data, 'base64');
  // Le PNG déclare lui-même ses dimensions : on les relit dans l'en-tête IHDR
  // plutôt que de faire confiance au clip demandé.
  if (png.subarray(12, 16).toString('latin1') !== 'IHDR') throw Error(`${graph.id} : PNG sans en-tête IHDR`);
  const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20);
  if (pngWidth !== metrics.clip.width || pngHeight !== metrics.clip.height)
    throw Error(`${graph.id} : PNG ${pngWidth}x${pngHeight} au lieu de ${metrics.clip.width}x${metrics.clip.height}`);

  const mermaid = graph.source.endsWith('\n') ? graph.source : `${graph.source}\n`;
  const formal = formalGraph(graph);
  const json = `${JSON.stringify(formal, null, 2)}\n`;
  await writeFile(`${OUT_DIR}/${graph.id}.png`, png);
  await writeFile(`${OUT_DIR}/${graph.id}.mmd`, mermaid);
  await writeFile(`${OUT_DIR}/${graph.id}.graph.json`, json);
  exported.push({ sceneId: graph.id, sceneHash: graph.sceneHash,
    png: { width: pngWidth, height: pngHeight, bytes: png.length, sha256: sha256(png), scale: 1 },
    mmd: { bytes: Buffer.byteLength(mermaid), sha256: sha256(mermaid) },
    graphJson: { bytes: Buffer.byteLength(json), sha256: sha256(json), ...formal.counts } });
}

ws.close();
await fetch(`${base}/json/close/${page.id}`);

// Le dossier ne contient que l'export : trois fichiers par scène et le README.
const present = (await readdir(OUT_DIR)).sort();
const expected = [...graphs.flatMap(graph => [`${graph.id}.graph.json`, `${graph.id}.mmd`, `${graph.id}.png`]), 'README.md'].sort();
const unexpected = present.filter(file => !expected.includes(file));
if (unexpected.length) throw Error(`${OUT_DIR} : fichier hors export ${unexpected.join(', ')}`);
const missing = expected.filter(file => file !== 'README.md' && !present.includes(file));
if (missing.length) throw Error(`${OUT_DIR} : fichier manquant ${missing.join(', ')}`);

const summary = { schema: 'immo-archi-scene-export/v1', outputDir: 'docs/reports/assets/2026-09/archi',
  capture: { engine: 'Chromium CDP Page.captureScreenshot', scale: 1, deviceScaleFactor: 1, surface: CANVAS },
  totalPngBytes: exported.reduce((sum, item) => sum + item.png.bytes, 0), scenes: exported };
await writeFile('.generated/export-scenes.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
