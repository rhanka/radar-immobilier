import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { marked } from 'marked';

const reportBase = '../../reports/architecture-monthly/report-through-2026-09-13';
const markdown = await readFile(`${reportBase}.md`, 'utf8');
const focusHtml = await readFile('../decision-focus.html', 'utf8');
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const renderer = new marked.Renderer();
renderer.html = () => '';
const body = marked.parse(markdown, { renderer });
const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  const item = pending.get(data.id);
  if (item) {
    pending.delete(data.id);
    data.error ? item.reject(data.error) : item.resolve(data.result);
  }
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
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw Error(`Timed out: ${expression}`);
};

await mkdir('.generated', { recursive: true });
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 16000, height: 9000, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `data:text/html;base64,${Buffer.from(focusHtml).toString('base64')}` });
await waitFor(`document.querySelectorAll('.flow').length === 4 && document.querySelectorAll('[data-node-kind]').length === ${graphs.reduce((sum, graph) => sum + graph.nodes.length + graph.groups.length, 0)}`);

const captures = [];
for (const graph of graphs) {
  const metrics = await evaluate(`(async () => {
    const sceneId = ${JSON.stringify(graph.id)};
    document.querySelector('.dossier').style.cssText = 'max-width:none;width:16000px;padding:0;margin:0';
    document.querySelectorAll('.pair').forEach(pair => { pair.style.cssText = 'display:block;border:0;padding:0;margin:0'; });
    document.querySelectorAll('.pair-grid').forEach(grid => { grid.style.cssText = 'display:block'; });
    document.querySelectorAll('.scene').forEach(scene => { scene.style.display = scene.dataset.scene === sceneId ? 'block' : 'none'; });
    const scene = document.querySelector('[data-scene="' + sceneId + '"]');
    scene.style.cssText += ';width:16000px;padding:0;margin:0;border:0';
    [...scene.children].forEach(child => { if (!child.classList.contains('flow')) child.style.display = 'none'; });
    const flow = scene.querySelector('.flow');
    flow.style.cssText = 'width:16000px;height:8800px;overflow:visible;background:#eef4f5';
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 240));
    const transform = getComputedStyle(flow.querySelector('.svelte-flow__viewport')).transform;
    const scale = Number((transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
    const elements = [...flow.querySelectorAll('[data-node-kind], g[data-canonical-edge] path, [data-text-role="edge-label"]')];
    const boxes = elements.map(element => element.getBoundingClientRect()).filter(box => box.width > 0 || box.height > 0);
    const flowBox = flow.getBoundingClientRect(), pad = 48;
    const left = Math.max(flowBox.left, Math.min(...boxes.map(box => box.left)) - pad);
    const top = Math.max(flowBox.top, Math.min(...boxes.map(box => box.top)) - pad);
    const right = Math.min(flowBox.right, Math.max(...boxes.map(box => box.right)) + pad);
    const bottom = Math.min(flowBox.bottom, Math.max(...boxes.map(box => box.bottom)) + pad);
    const ordinary = [...flow.querySelectorAll('[data-node-kind="ordinary"]')].map(node => {
      const style = getComputedStyle(node), title = getComputedStyle(node.querySelector('[data-text-role="service-title"]'));
      const status = getComputedStyle(node.querySelector('[data-text-role="status"]')), repo = getComputedStyle(node.querySelector('[data-text-role="repo"]'));
      return { id: node.dataset.id, height: node.getBoundingClientRect().height, paddingTop: parseFloat(style.paddingTop),
        paddingRight: parseFloat(style.paddingRight), paddingBottom: parseFloat(style.paddingBottom), paddingLeft: parseFloat(style.paddingLeft),
        titlePx: parseFloat(title.fontSize) * scale, statusPx: parseFloat(status.fontSize) * scale, repoPx: parseFloat(repo.fontSize) * scale };
    });
    const edgeLabels = [...flow.querySelectorAll('[data-text-role="edge-label"]')].map(label => parseFloat(getComputedStyle(label).fontSize) * scale);
    return { clip: { x: left + scrollX, y: top + scrollY, width: Math.ceil(right - left), height: Math.ceil(bottom - top) },
      scale, visualViewportScale: visualViewport.scale, devicePixelRatio, ordinary, edgeLabels,
      nodes: flow.querySelectorAll('[data-node-kind="ordinary"]').length,
      groups: flow.querySelectorAll('[data-node-kind="cluster"]').length,
      edges: flow.querySelectorAll('g[data-canonical-edge]').length };
  })()`);
  if (metrics.scale !== 1 || metrics.visualViewportScale !== 1 || metrics.devicePixelRatio !== 1) throw Error(`${graph.id}: non-native capture scale`);
  if (metrics.clip.width > 16000 || metrics.clip.height > 8800) throw Error(`${graph.id}: capture exceeds native canvas`);
  if (metrics.nodes !== graph.nodes.length || metrics.groups !== graph.groups.length || metrics.edges !== graph.edges.length) throw Error(`${graph.id}: incomplete native capture inventory`);
  for (const card of metrics.ordinary) {
    if (card.height < 120 || card.height > 156) throw Error(`${graph.id}/${card.id}: card height ${card.height}`);
    if ([card.paddingTop, card.paddingRight, card.paddingBottom, card.paddingLeft].some(value => value < 6 || value > 8)) throw Error(`${graph.id}/${card.id}: padding outside 6–8px`);
    if (card.titlePx < 32 || card.statusPx < 22 || card.repoPx < 24) throw Error(`${graph.id}/${card.id}: typography below owner minimum`);
  }
  if (metrics.edgeLabels.some(value => value < 24)) throw Error(`${graph.id}: edge typography below owner minimum`);
  const pngResult = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...metrics.clip, scale: 1 } });
  const png = Buffer.from(pngResult.data, 'base64');
  const file = `.generated/report-scene-${graph.id}.png`;
  await writeFile(file, png);
  captures.push({ id: graph.id, pair: graph.pair, date: graph.date, sceneHash: graph.sceneHash,
    file, png, captureSha256: sha256(png), width: metrics.clip.width, height: metrics.clip.height, metrics });
}

const maxWidth = Math.max(...captures.map(capture => capture.width));
const maxHeight = Math.max(...captures.map(capture => capture.height));
const paper = { width: maxWidth + 96, height: maxHeight + 184 };
const diagram = capture => `<section class="diagram" data-scene="${capture.id}" data-scene-hash="${capture.sceneHash}"><header><h2>${capture.pair} · ${capture.date} · ${capture.id}</h2><p>SvelteFlow natif · scale(1) · SHA-256 scène <code>${capture.sceneHash}</code> · capture <code>${capture.captureSha256}</code></p></header><img alt="Schéma complet ${capture.id}" src="data:image/png;base64,${capture.png.toString('base64')}" width="${capture.width}" height="${capture.height}"></section>`;
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport architecture · 10 août → 13 septembre 2026</title><style>
@page report{size:A4;margin:14mm 12mm}@page graph{size:${paper.width}px ${paper.height}px;margin:0}*{box-sizing:border-box}body{font:14px/1.48 Arial,sans-serif;color:#172033;margin:0}.report-copy{page:report}h1{font-size:30px;border-bottom:4px solid #145f68;padding-bottom:12px}h2{font-size:21px;color:#145f68;margin-top:30px;break-after:avoid}h3{font-size:17px}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{border:1px solid #bdcad0;padding:7px;vertical-align:top}th{background:#eaf3f4;text-align:left}code{background:#edf1f3;padding:1px 4px}pre{white-space:pre-wrap;background:#edf1f3;padding:10px}.diagram{page:graph;break-before:page;width:${paper.width}px;height:${paper.height}px;padding:24px 48px;overflow:hidden}.diagram header{height:112px}.diagram h2{font-size:32px;line-height:1;margin:0 0 12px}.diagram p{font-size:22px;line-height:1.15;margin:0}.diagram img{display:block;object-fit:none;object-position:left top;border:1px solid #bdcad0}@media print{a{color:inherit}}
</style></head><body><main class="report-copy">${body}</main>${captures.map(diagram).join('')}</body></html>`.replace(/>\s+</g, '><');
await writeFile(`${reportBase}.html`, html);
const frameTree = await call('Page.getFrameTree');
await call('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html });
await waitFor(`document.images.length === 4 && [...document.images].every(image => image.complete)`);
const printed = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
const currentPdf = Buffer.from(printed.data, 'base64');
await writeFile('.generated/current-report.pdf', currentPdf);
const output = { schema: 'immo-report-native-captures/v1', chromium: { zoom: 1, deviceScaleFactor: 1 },
  paper, currentPdfSha256: sha256(currentPdf), captures: captures.map(({ png, ...capture }) => capture) };
await writeFile('.generated/report-render.json', `${JSON.stringify(output, null, 2)}\n`);
ws.close();
await fetch(`${base}/json/close/${page.id}`);
console.log(JSON.stringify({ currentPdfBytes: currentPdf.length, graphs: output.captures.map(capture => ({ id: capture.id, width: capture.width, height: capture.height, sha256: capture.captureSha256 })) }));
