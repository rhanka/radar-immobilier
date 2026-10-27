import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const storage = `${process.cwd()}/packages/immo-mcp/node_modules/@sentropic/cluster-mesh/dist/storage/`;
const source = readFileSync(`${storage}common-contract.js`, 'utf8');
assert.match(source, /const COMMON_V1_MODULE_IDS = Object\.freeze\(\['comments', 'engram-live'\]\)/);
const { validateCommonManifestBody } = await import(pathToFileURL(`${storage}common-contract.js`));
const { STORAGE_MODULE_IDS } = await import(pathToFileURL(`${storage}contracts.js`));
const body = {
  commonContract: '1', manifestVersion: '1', scope: { tenantId: 'tenant', workspaceId: 'workspace' },
  surface: 'transactional', incarnation: 'one', publicationId: 'publication', predecessorRoot: null,
  sourceBoundary: { kind: 'journal-head', ref: 'head' }, schemaVersion: '1', descriptorVersion: '1',
  encodingVersion: '1', units: [], objects: [], terminal: { count: '0', complete: true },
};
for (const module of ['comments', 'engram-live']) {
  assert.equal(validateCommonManifestBody({ ...body, module }).ok, true);
}
assert.ok(STORAGE_MODULE_IDS.includes('engram-memory'));
assert.equal(validateCommonManifestBody({ ...body, module: 'engram-memory' }).ok, false);
// A future shared storage module must not widen the frozen common-v1 contract.
STORAGE_MODULE_IDS.push('future-proof-module');
try {
  assert.equal(validateCommonManifestBody({ ...body, module: 'future-proof-module' }).ok, false);
} finally {
  STORAGE_MODULE_IDS.pop();
}

const commonNames = [...source.matchAll(/export const (\w+)/g)].map((match) => match[1])
  .filter((name) => /[Cc][Oo][Mm][Mm][Oo][Nn]/.test(name));
const forbidden = new RegExp(`\\b(?:${commonNames.join('|')}|COMMON_V1_MODULE_IDS|isCommonV1ModuleId|STORAGE_MODULE_IDS|isStorageModuleId)\\b|engram-memory|engram-live|storage/common-contract|@sentropic/comments|cluster-mesh/(?:comments|compose/comments|loaders/comments)|\\b(?:create|compose|load)Comments\\w*`);
const files = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) visit(path);
    else if (/\.(?:[cm]?[jt]sx?|svelte|json)$/.test(entry.name)) files.push(path);
  }
}
for (const directory of ['api/src', 'api/tests', 'ui/src', 'packages']) visit(directory);
files.sort();
assert.ok(files.length > 1000);
const digest = createHash('sha256');
const genericComments = [];
for (const path of files) {
  const bytes = readFileSync(path);
  digest.update(path).update('\0').update(bytes).update('\0');
  assert.equal(forbidden.test(bytes.toString()), false, `unexpected cluster integration reference: ${path}`);
  bytes.toString().split('\n').forEach((line, index) => {
    if (/\bcomments\b/i.test(line)) genericComments.push({ path, line: index + 1, text: line.trim() });
  });
}
writeFileSync('/evidence/mesh-isolation-proof.json', JSON.stringify({
  passed: true, commonV1: ['comments', 'engram-live'], engramMemoryRejected: true,
  futureStorageModuleRejected: true, scannedFiles: files.length, corpusSha256: digest.digest('hex'),
  forbiddenPattern: forbidden.source, integrationReferences: 0, genericComments,
}, null, 2));
console.log(`PASS: frozen common-v1 and zero integration references across ${files.length} Radar files`);
