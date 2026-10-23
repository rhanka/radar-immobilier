// Retain the 6L2 verifier's UI regression and MCP compatibility profile.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
assert.equal(process.cwd(), '/workspace');
assert.equal(process.env.LOT_MIGRATION_DB_TEST, '1');
function command(binary, args, cwd = '/workspace') {
  console.log(JSON.stringify({ binary, args, cwd }));
  const result = spawnSync(binary, args, { cwd, env: process.env, stdio: 'inherit' });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
}
function executed(path) {
  const report = JSON.parse(readFileSync(path));
  assert.ok(report.numPassedTests > 0);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0);
  console.log(`6L2 regression PASS ${path}: ${report.numPassedTests} tests`);
}
if (process.argv[2] !== '6l2-mcp') {
writeFileSync('ui/vitest.isolated.config.ts', `import config from './vitest.config.js';
export default { ...config, envDir: false,
  test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };\n`);
const profile = ['facets', '6a-head', '6b-version', 'signaux-reglements', 'signal-facets-client',
  'SignalFacetControls', 'selection-bucket', 'selection-camera', 'signal-facet-scope',
  'signal-facet-workspace', 'signal-projection', 'signal-projection-invalidation'];
// These retained map fixtures derive two city identities from the catalog.
// Supply invented municipalities without opening the operational geography file.
writeFileSync('packages/radar-sources/src/geo/municipalities.qc.json', JSON.stringify(
  [0, 1].map(index => ({ slug: `synthetic-b2-city-${index}`, name: `Synthetic B2 city ${index}`,
    mrc: 'Synthetic MRC', lat: 45 + index, lon: -73 - index, population: 1000,
    distanceToMtlKm: 10 + index, priorityRank: index + 1,
    excluded: false, excludedReason: null, deprioritized: false }))));
command('../node_modules/.bin/vitest', ['run', '--config', 'vitest.isolated.config.ts',
  '--reporter=default', '--reporter=json', '--outputFile.json=/evidence/6l2-ui.json', ...profile], '/workspace/ui');
executed('/evidence/6l2-ui.json');
}
command('../../node_modules/.bin/tsc', ['--noEmit', '-p', 'tsconfig.json'], '/workspace/packages/immo-mcp');
command('../../node_modules/.bin/vitest', ['run', '--config', '/workspace/api/vitest.isolated.config.ts',
  '--reporter=default', '--reporter=json', '--outputFile.json=/evidence/6l2-mcp.json', 'src'], '/workspace/packages/immo-mcp');
executed('/evidence/6l2-mcp.json');
