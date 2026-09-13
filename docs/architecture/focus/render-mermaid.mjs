import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const runtime = await readFile('../vendor/mermaid.min.js', 'utf8');
const purifier = await readFile('../vendor/purify.min.js', 'utf8');
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
  await evaluate(runtime); await evaluate(purifier);
  await evaluate(`mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', flowchart: { htmlLabels: false, useMaxWidth: false } }); true`);
  const rendered = {};
  for (const graph of graphs) {
    const result = await evaluate(`(async () => {
      const { svg } = await mermaid.render(${JSON.stringify(`mermaid-${graph.id}`)}, ${JSON.stringify(graph.source)});
      const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject', 'a'], FORBID_ATTR: ['href', 'xlink:href', 'onclick', 'onload', 'onerror'] });
      const host = document.createElement('div'); host.innerHTML = clean;
      return { svg: clean, nodes: host.querySelectorAll('g.node').length, groups: host.querySelectorAll('g.cluster').length };
    })()`);
    if (result.nodes !== graph.nodes.length || result.groups !== graph.groups.length) throw Error(`Mermaid completeness mismatch: ${graph.id}`);
    rendered[graph.id] = { ...result, sourceHash: createHash('sha256').update(graph.source).digest('hex') };
  }
  await writeFile('.generated/mermaid.json', JSON.stringify(rendered));
  console.log(JSON.stringify({ mermaid: '11.12.0', securityLevel: 'strict', diagrams: Object.keys(rendered).length, nodesAndGroups: 'all matched', network: 'blocked' }));
} finally { clearTimeout(timeout); ws.close(); await fetch(`${base}/json/close/${page.id}`); }
