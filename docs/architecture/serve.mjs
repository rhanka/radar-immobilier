import http from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['architecture/decision-focus.html', 'text/html']],
  ['/decision-focus.html', ['architecture/decision-focus.html', 'text/html']],
  ['/architecture.html', ['architecture/architecture.html', 'text/html']],
  ['/architecture.md', ['architecture.md', 'text/plain']],
  ['/style.css', ['architecture/style.css', 'text/css']],
  ['/viewer.js', ['architecture/viewer.js', 'text/javascript']],
  ...['storage-audit.md', 'decision-dossier.md', 'continuation-audit.md', 'decision-reviews.md', 'decision-review-codex.md', 'proposal.md', 'README.md', 'focus-verification.md', 'gemini-review/response-findings.md',
    'gemini-review/response-mapping.md', 'gemini-review/review-inline.md'].map(name =>
    [`/architecture/${name}`, [`architecture/${name}`, 'text/plain']]),
  ...['marked.min.js', 'purify.min.js', 'mermaid.min.js'].map(name => [`/vendor/${name}`, [`architecture/vendor/${name}`, 'text/javascript']]),
]);
http.createServer(async (req, res) => {
  const entry = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!entry || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(`/docs/${entry[0]}`);
    res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Preview file missing. Run the render/assets targets.'); }
}).listen(8080, '0.0.0.0', () => console.log('Focus architecture preview ready on container port 8080.'));
