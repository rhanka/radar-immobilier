import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { marked } from 'marked';

const reportBase = '../../reports/architecture-monthly/report-through-2026-09-13';
const markdown = await readFile(`${reportBase}.md`, 'utf8');
const focusHtml = await readFile('../decision-focus.html', 'utf8');
const renderer = new marked.Renderer(); renderer.html = () => '';
const body = marked.parse(markdown, { renderer });
const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const data = JSON.parse(event.data), item = pending.get(data.id); if (item) { pending.delete(data.id); data.error ? item.reject(data.error) : item.resolve(data.result); } };
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
const waitFor = async expression => { const until = Date.now() + 5000; while (Date.now() < until) { try { if (await evaluate(expression)) return; } catch {} await new Promise(resolve => setTimeout(resolve, 80)); } throw Error(`Timed out: ${expression}`); };

await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 2600, height: 1800, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `data:text/html;base64,${Buffer.from(focusHtml).toString('base64')}` });
await waitFor(`document.querySelector('.flow')?.dataset.graph === 'asis-1'`);
await evaluate(`document.querySelector('.dossier').style.maxWidth='2600px';document.querySelector('.flow').style.height='1600px';true`);
const capture = async (title, graph, scope = '') => {
  await evaluate(`(() => { const set=(label,value)=>{const e=document.querySelector('select[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};set('Vue architecture',${JSON.stringify(graph)});set('Zoomer sur un sous-flow',${JSON.stringify(scope)});return true;})()`);
  await new Promise(resolve => setTimeout(resolve, 350));
  const rect = await evaluate(`(() => { const flow=document.querySelector('.flow').getBoundingClientRect();if(${JSON.stringify(scope)}!=='')return{x:flow.left+scrollX,y:flow.top+scrollY,width:flow.width,height:flow.height};const boxes=[...document.querySelectorAll('.svelte-flow__node')].map(node=>node.getBoundingClientRect());const pad=28,left=Math.max(flow.left,Math.min(...boxes.map(box=>box.left))-pad),top=Math.max(flow.top,Math.min(...boxes.map(box=>box.top))-pad),right=Math.min(flow.right,Math.max(...boxes.map(box=>box.right))+pad),bottom=Math.min(flow.bottom,Math.max(...boxes.map(box=>box.bottom))+pad);return{x:left+scrollX,y:top+scrollY,width:right-left,height:bottom-top};})()`);
  const png = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...rect, scale: 2 } });
  return { title, graph, data: png.data, width: rect.width * 2, height: rect.height * 2 };
};
const before = await capture('Architecture AVANT · schéma complet', 'asis-1');
const after = await capture('Architecture APRÈS · schéma complet', 'target-3');
const partitions = source => [
  { label: 'haut gauche', x: 0, y: 0 }, { label: 'haut droite', x: .42, y: 0 },
  { label: 'bas gauche', x: 0, y: .42 }, { label: 'bas droite', x: .42, y: .42 },
].map(({ label, x, y }) => ({ ...source, title: `${source.title.replace('schéma complet', 'partition')} · ${label}`, partition: { label, x: x * source.width, y: y * source.height, width: .58 * source.width, height: .58 * source.height } }));
const pages = [before, ...partitions(before), after, ...partitions(after)];
const diagram = ({ title, graph, data, width, height, partition }) => {
  const visual = partition
    ? `<svg role="img" aria-label="${title}" viewBox="${partition.x} ${partition.y} ${partition.width} ${partition.height}"><image href="data:image/png;base64,${data}" width="${width}" height="${height}"/></svg>`
    : `<img alt="${title}" src="data:image/png;base64,${data}">`;
  return `<section class="diagram"><h2>${title}</h2><p>Vue SvelteFlow native ${partition ? 'agrandie avec recouvrement central' : 'intégrale'} · icônes, provenance <code>repo:</code>, relations et sous-flows imbriqués.</p>${visual}</section>`;
};
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rapport architecture D8 · 10 août – 13 septembre 2026</title><style>
@page{size:A4;margin:14mm 12mm}@page architecture{size:A3 landscape;margin:8mm}*{box-sizing:border-box}body{font:14px/1.48 Arial,sans-serif;color:#172033;max-width:1040px;margin:auto;padding:32px}h1{font-size:30px;border-bottom:4px solid #145f68;padding-bottom:12px}h2{font-size:21px;color:#145f68;margin-top:30px;break-after:avoid}h3{font-size:17px}a{color:#0b6873}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{border:1px solid #bdcad0;padding:7px;vertical-align:top}th{background:#eaf3f4;text-align:left}code{background:#edf1f3;padding:1px 4px}blockquote{border-left:4px solid #e0a02b;padding-left:12px}.state-strip{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:18px 0}.state{border:1px solid #8aa3aa;border-radius:8px;padding:12px}.state b{display:block;color:#145f68}.icons{font-size:22px;letter-spacing:5px}.diagram{page:architecture;break-before:page;break-after:page}.diagram h2{margin:0 0 3mm}.diagram p{margin:0 0 3mm}.diagram img,.diagram svg{display:block;width:100%;height:238mm;object-fit:contain;margin:auto;border:1px solid #bdcad0}pre{white-space:pre-wrap;background:#edf1f3;padding:10px}@media print{body{padding:0}a{color:inherit}}
</style></head><body><div class="state-strip"><div class="state"><span class="icons">🌐 🗄️ 💻</span><b>Architecture AVANT</b>MinIO + poste LLM</div><div class="state"><span class="icons">🪣 🐘 ☸️</span><b>Architecture APRÈS</b>Objets OVH puis un b3-8 après gates</div></div>${body}${pages.map(diagram).join('')}</body></html>`.replace(/>\s+</g, '><');
await writeFile(`${reportBase}.html`, html);
const frameTree = await call('Page.getFrameTree');
await call('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html });
await waitFor(`document.images.length === 2 && [...document.images].every(image => image.complete) && document.querySelectorAll('svg image').length === 8`);
const printed = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
await writeFile(`${reportBase}.pdf`, Buffer.from(printed.data, 'base64'));
ws.close(); await fetch(`${base}/json/close/${page.id}`);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const manifestPath = '../../reports/architecture-monthly/evidence-manifest-2026-09-13.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pdf = await readFile(`${reportBase}.pdf`);
manifest.report = { markdown: 'report-through-2026-09-13.md', html: 'report-through-2026-09-13.html', pdf: 'report-through-2026-09-13.pdf',
  markdownSha256: sha256(markdown), htmlSha256: sha256(html), pdfSha256: sha256(pdf), staticDiagrams: ['asis-1', 'target-3'],
  nativeDiagramPages: pages.map(({ title, graph, partition }) => ({ title, graph, partition: partition?.label ?? null })), diagramPage: 'A3 landscape' };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ htmlBytes: Buffer.byteLength(html), pdfBytes: pdf.length, nativeDiagramPages: pages.length, hashes: manifest.report }));
