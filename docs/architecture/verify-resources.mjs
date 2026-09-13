import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// These are the resources whose identity must survive the infrastructure-to-PV zoom.
const requiredShared = ['PP-DB', 'PP-MINIO', 'PP-RAW', 'PP-DOCS', 'PP-GROUND',
  'PP-GRAPH', 'LEGACY-POC', 'GEO-S3', 'PP-GEO-S3', 'PP-API', 'PP-UI', 'PP-GEO',
  'PP-SCRAPE', 'PP-PROJECT', 'PP-PUBLISH', 'WS-IMMO'];

function resources(source) {
  const result = new Map();
  const definitions = /^\s*(?:subgraph\s+)?(\w+)\[(?:\()?"\[([A-Z][A-Z0-9-]+)\]([^"\n]*)"/gm;
  for (const [, node, id, label] of source.matchAll(definitions)) {
    assert(!result.has(id), `Resource ${id} defined twice in one diagram`);
    result.set(id, { node, label });
  }
  return result;
}

function compare(overview, zoom) {
  for (const [id, definition] of zoom) {
    assert(overview.has(id), `Zoom resource ${id} missing from infrastructure view`);
    assert.deepEqual(definition, overview.get(id), `Resource ${id} changes identity between views`);
  }
}

// Regression fixtures: missing resources and bucket-name drift must be rejected.
const fixture = resources('PP_DB[("[PP-DB] radar-postgres")]');
assert.throws(() => compare(new Map(), fixture), /missing from infrastructure/);
assert.throws(() => compare(fixture,
  resources('PP_DB[("[PP-DB] a-different-database")]')), /changes identity/);
assert.throws(() => resources('PP_DB["[PP-DB] db"]\nOTHER["[PP-DB] db"]'), /defined twice/);
compare(fixture, fixture);

const markdown = readFileSync(process.argv[2] ?? '/docs/architecture.md', 'utf8');
const diagrams = [...markdown.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map(m => m[1]);
assert.equal(diagrams.length, 4, 'Expected four architecture views');
const [overview, immo, geo] = diagrams.slice(0, 3).map(resources);
for (const id of requiredShared) {
  assert(overview.has(id), `Infrastructure resource ${id} missing`);
  assert(immo.has(id), `Immo zoom resource ${id} missing`);
}
compare(overview, immo);
compare(overview, geo);
for (const id of ['PP-DB', 'PP-MINIO', 'PP-RAW', 'PP-DOCS', 'PP-GROUND',
  'PP-GRAPH', 'LEGACY-POC', 'GEO-S3', 'PP-GEO-S3']) {
  assert(markdown.includes(`| \`${id}\` |`), `Resource register entry ${id} missing`);
}
console.log(JSON.stringify({ status: 'pass', diagrams: diagrams.length,
  sharedInfrastructureImmoResources: requiredShared.length, geoResources: geo.size,
  negativeRegressionFixtures: 3 }));
