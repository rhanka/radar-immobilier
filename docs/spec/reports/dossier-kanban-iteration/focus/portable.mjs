// Même recette que docs/architecture/focus/portable.mjs : un seul fichier HTML,
// script et style inclus, aucune ressource externe, ouvrable en file://.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

let html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/)?.[0];
const css = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/)?.[0];
if (!script || !css) throw Error('Expected one bundled JS and CSS asset');
const asset = tag => `dist/${tag.match(/(?:src|href)="([^"]+)"/)[1].replace(/^\.\//, '')}`;
html = html.replace(script, () => '<script type="module"></script>');
const code = (await readFile(asset(script), 'utf8')).replaceAll('</script', '<\\/script');
html = html.replace('<script type="module"></script>', () => `<script type="module">${code}</script>`);
html = html.replace(css, () => '<style></style>');
const style = (await readFile(asset(css), 'utf8')).replaceAll('</style', '<\\/style');
html = html.replace('<style></style>', () => `<style>${style}</style>`);
const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/gi, '').replace(/<style>[\s\S]*?<\/style>/gi, '');
if (/<(?:script|link|img)\b[^>]+(?:src|href)=/i.test(shell)) throw Error('External asset remains');

await writeFile('../decision-focus.html', html);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
await writeFile('.generated/portable.json', `${JSON.stringify({
  output: 'docs/spec/reports/dossier-kanban-iteration/decision-focus.html',
  bytes: Buffer.byteLength(html), htmlSha256: sha256(html),
  dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash,
  graphs: manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows, sceneHash: graph.sceneHash })),
}, null, 2)}\n`);
console.log(`Dossier Kanban Focus portable : ${Buffer.byteLength(html)} octets ; ${sha256(html)}`);
