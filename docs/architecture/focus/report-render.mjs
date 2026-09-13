import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { marked } from 'marked';

const reportBase = '../../reports/architecture-monthly/report-through-2026-09-13';
const markdown = await readFile(`${reportBase}.md`, 'utf8');
const diagrams = JSON.parse(await readFile('.generated/mermaid.json', 'utf8'));
const renderer = new marked.Renderer();
renderer.html = () => '';
const body = marked.parse(markdown, { renderer });
const diagram = (title, id) => `<section class="diagram"><h2>${title}</h2>${diagrams[id].svg}</section>`;
const htmlSource = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rapport architecture · 10 août – 13 septembre 2026</title><style>
@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}body{font:14px/1.48 Arial,sans-serif;color:#172033;max-width:1040px;margin:auto;padding:32px}h1{font-size:30px;border-bottom:4px solid #145f68;padding-bottom:12px}h2{font-size:21px;color:#145f68;margin-top:30px;break-after:avoid}h3{font-size:17px}a{color:#0b6873}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{border:1px solid #bdcad0;padding:7px;vertical-align:top}th{background:#eaf3f4;text-align:left}code{background:#edf1f3;padding:1px 4px}blockquote{border-left:4px solid #e0a02b;padding-left:12px}.state-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.state{border:1px solid #8aa3aa;border-radius:8px;padding:12px}.state b{display:block;color:#145f68}.icons{font-size:22px;letter-spacing:5px}.diagram{break-before:page}.diagram svg{width:100%;height:auto;max-height:235mm}pre{white-space:pre-wrap;background:#edf1f3;padding:10px}@media print{body{padding:0}.state-strip{grid-template-columns:repeat(3,1fr)}a{color:inherit}.diagram{break-before:page}}
</style></head><body><div class="state-strip"><div class="state"><span class="icons">🌐 🗄️ 💻</span><b>Avant</b>MinIO + poste LLM</div><div class="state"><span class="icons">☸️ ⏱️ 🪣</span><b>Transition effective</b>RAW OVH; T1 pré-LLM; DOCS diff</div><div class="state"><span class="icons">🪣 🐘 ☸️</span><b>Après cible</b>Objets OVH puis un b3-8</div></div>${body}${diagram('Diagramme statique · transition effective', 'target-1')}${diagram('Diagramme statique · après cible', 'target-3')}</body></html>`;
const html = htmlSource.replace(/>\s+</g, '><');
await writeFile(`${reportBase}.html`, html);

const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const data = JSON.parse(event.data); const item = pending.get(data.id); if (item) { pending.delete(data.id); data.error ? item.reject(data.error) : item.resolve(data.result); } };
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
try {
  await call('Page.enable');
  await call('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  await new Promise(resolve => setTimeout(resolve, 250));
  const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  await writeFile(`${reportBase}.pdf`, Buffer.from(pdf.data, 'base64'));
} finally { ws.close(); await fetch(`${base}/json/close/${page.id}`); }

const sha256 = value => createHash('sha256').update(value).digest('hex');
const manifestPath = '../../reports/architecture-monthly/evidence-manifest-2026-09-13.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pdf = await readFile(`${reportBase}.pdf`);
manifest.report = { markdown: 'report-through-2026-09-13.md', html: 'report-through-2026-09-13.html', pdf: 'report-through-2026-09-13.pdf',
  markdownSha256: sha256(markdown), htmlSha256: sha256(html), pdfSha256: sha256(pdf), staticDiagrams: ['target-1', 'target-3'] };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ htmlBytes: Buffer.byteLength(html), pdfBytes: pdf.length, hashes: manifest.report }));
