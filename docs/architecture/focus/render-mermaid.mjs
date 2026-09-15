import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { missingMermaidLabels } from './mermaid-labels.mjs';
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const runtime = await readFile('node_modules/mermaid/dist/mermaid.min.js', 'utf8');
const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data), p = pending.get(data.id);
  if (p) { pending.delete(data.id); data.error ? p.reject(data.error) : p.resolve(data.result); }
};
const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const timeout = setTimeout(() => { console.error('Mermaid build timed out'); process.exit(1); }, 45000);
try {
  await call('Network.enable'); await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await evaluate(runtime);
  // Mermaid 11's node renderer reads the global flag; flowchart-only leaves HTML labels.
  await evaluate(`mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false,
    themeVariables: { fontSize: '24px', fontFamily: 'Arial, sans-serif' },
    themeCSS: 'text,.nodeLabel,.edgeLabel,.cluster-label text{font-size:24px!important}',
    flowchart: { htmlLabels: false, useMaxWidth: false, nodeSpacing: 90, rankSpacing: 120, diagramPadding: 24 } }); true`);
  const rendered = {};
  for (const graph of graphs) {
    const result = await evaluate(`(async () => {
      const { svg } = await mermaid.render(${JSON.stringify(`mermaid-${graph.id}`)}, ${JSON.stringify(graph.source)});
      const rawHost = document.createElement('div'); rawHost.innerHTML = svg;
      if (rawHost.querySelector('script,foreignObject,a')) throw Error('forbidden Mermaid element');
      for (const element of rawHost.querySelectorAll('*')) for (const attribute of element.attributes) {
        if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name) || /url\\(\\s*["']?https?:/i.test(attribute.value)) throw Error('forbidden Mermaid attribute');
      }
      const clean = rawHost.innerHTML;
      const host = rawHost;
      const missing = (${missingMermaidLabels.toString()})(host, ${JSON.stringify(graph)});
      return { svg: clean, missing, nodes: host.querySelectorAll('g.node').length, groups: host.querySelectorAll('g.cluster').length };
    })()`);
    if (result.nodes !== graph.nodes.length || result.groups !== graph.groups.length) throw Error(`Mermaid completeness mismatch: ${graph.id}`);
    if (result.missing.length) throw Error(`Mermaid labels missing: ${graph.id} ${JSON.stringify(result.missing)}`);
    rendered[graph.id] = { ...result, sourceHash: createHash('sha256').update(graph.source).digest('hex') };
  }
  await writeFile('.generated/mermaid.json', JSON.stringify(rendered));
  console.log(JSON.stringify({ mermaid: '11.17.2', securityLevel: 'strict', diagrams: Object.keys(rendered).length, nodesGroupsAndLabels: 'all matched', network: 'blocked' }));
} finally { clearTimeout(timeout); ws.close(); await fetch(`${base}/json/close/${page.id}`); }
