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

const sha256 = value => createHash('sha256').update(value).digest('hex');
// The YAML export quotes the page's own sha256 (`version`). A file cannot contain its
// own digest, so the embedded value is the sha256 of this file with that value set
// back to the 64-zero placeholder of build-map.mjs: zero it, hash, compare.
const HTML_SHA256_PLACEHOLDER = '0'.repeat(64);
if (html.split(HTML_SHA256_PLACEHOLDER).length !== 2) throw Error('Expected the html sha256 placeholder exactly once');
const embeddedSha256 = sha256(html);
html = html.replace(HTML_SHA256_PLACEHOLDER, embeddedSha256);
if (sha256(html.replace(embeddedSha256, HTML_SHA256_PLACEHOLDER)) !== embeddedSha256) throw Error('Embedded html sha256 does not verify');
await writeFile('../decision-focus.html', html);
const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
await writeFile('.generated/portable.json', `${JSON.stringify({
  output: 'docs/spec/reports/dossier-villes-ecart/decision-focus.html',
  bytes: Buffer.byteLength(html), htmlSha256: sha256(html),
  embeddedSha256, embeddedSha256Rule: 'sha256 of the file with the embedded value replaced by 64 zeros',
  dossierHash: manifest.dossierHash, artifactInputHash: manifest.artifactInputHash,
  graphs: manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows, sceneHash: graph.sceneHash })),
}, null, 2)}\n`);
console.log(`Dossier villes en écart Focus portable : ${Buffer.byteLength(html)} octets ; ${sha256(html)}`);
