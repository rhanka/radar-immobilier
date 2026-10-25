// CT-7 qualification uses only the runner's disposable source copy and DBs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const journalPath = 'drizzle/meta/_journal.json', testPath = 'src/services/facets/lots/lot-cutover-journal-db.test.ts';
const journalBytes = readFileSync(journalPath);
const testBytes = readFileSync(testPath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const journal = JSON.parse(journalBytes);
const cutover = journal.entries.findIndex(e => e.tag === '0022_facet_lot_cutover');
assert.ok(cutover > 0);
const prefix = journal.entries.slice(0, cutover);
let clock = Math.max(...prefix.map(e => e.when));
const suffix = journal.entries.slice(cutover);
const synthetic = ['synthetic_ct7_before_cutover', 'synthetic_ct7_before_fence'];
const files = synthetic.map(tag => `drizzle/${tag}.sql`);
const fixedSql = ['0022_facet_lot_cutover', '0023_facet_lot_versions_fence']
  .map(tag => ({ tag, hash: hash(readFileSync(`drizzle/${tag}.sql`)) }));
const entries = [...prefix];
for (const entry of suffix) {
  const gap = entry.tag === '0022_facet_lot_cutover' ? synthetic[0]
    : entry.tag === '0023_facet_lot_versions_fence' ? synthetic[1] : undefined;
  if (gap) entries.push({ ...entry, tag: gap, idx: entries.length, when: ++clock });
  entries.push({ ...entry, idx: entries.length, when: ++clock });
}
const relative = / {4}const prerequisites = \["0020_facet_projection_revisions"[\s\S]*? {4}const source =/;
const obsolete = `    const cutover = journal.entries.find((item) => item.tag === "0022_facet_lot_cutover")!;
    expect(journal.entries[cutover.idx - 1]!.tag).toBe("0021_facet_lot_history");
    expect(journal.entries[cutover.idx - 2]!.tag).toBe("0020_facet_projection_revisions");
    expect(journal.entries[cutover.idx + 1]!.tag).toBe("0023_facet_lot_versions_fence");
    expect(entry.when).toBeGreaterThan(Math.max(
      ...journal.entries.slice(0, entry.idx).map((item) => item.when)));
    const source =`;
function command(binary, args) {
  const result = spawnSync(binary, args, { stdio: 'inherit', env: process.env });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result.status;
}
function run(label, passes) {
  const path = `/evidence/ct7-${label}.json`;
  const status = command('../node_modules/.bin/vitest', ['run', '--config', 'vitest.isolated.config.ts',
    '--reporter=default', '--reporter=json', `--outputFile.json=${path}`, testPath]);
  const report = JSON.parse(readFileSync(path));
  const tests = report.testResults.flatMap(s => s.assertionResults ?? []);
  assert.equal(tests.length, 2);
  if (passes) {
    assert.equal(status, 0);
    assert.ok(tests.every(t => t.status === 'passed'));
  } else {
    assert.equal(status, 1);
    assert.ok(tests.every(t => t.status === 'failed' && t.failureMessages.some(m =>
      m.includes('AssertionError') && m.includes('synthetic_ct7_before_cutover') &&
      m.includes('0021_facet_lot_history'))));
  }
  console.log(`CT7 ${label}: exit=${status}, assertions=${tests.length}`);
}
try {
  files.forEach((file, i) => writeFileSync(file,
    `CREATE TABLE IF NOT EXISTS synthetic_ct7_probe_${i}(id integer PRIMARY KEY);`));
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries }));
  console.log('CT7 original journal sha256=' + hash(journalBytes));
  console.log('CT7 synthetic journal sha256=' + hash(readFileSync(journalPath)));
  console.log('CT7 fixed SQL hashes=' + JSON.stringify(fixedSql));
  assert.equal(command('node', ['../tools/make/base-api-ct8.mjs']), 0);
  run('baseline', true);
  assert.ok(relative.test(testBytes.toString()));
  const mutant = testBytes.toString().replace(relative, obsolete);
  writeFileSync('/evidence/ct7-control.ts', testBytes);
  writeFileSync('/evidence/ct7-mutant.ts', mutant);
  writeFileSync(testPath, mutant);
  run('adjacency-mutant', false);
  writeFileSync(testPath, testBytes);
  assert.equal(hash(readFileSync(testPath)), hash(testBytes));
  run('restored', true);
  console.log('CT7 restored test sha256=' + hash(testBytes));
} finally {
  writeFileSync(testPath, testBytes);
  writeFileSync(journalPath, journalBytes);
  files.forEach(file => unlinkSync(file));
  fixedSql.forEach(({ tag, hash: expected }) => assert.equal(hash(readFileSync(`drizzle/${tag}.sql`)), expected));
  assert.equal(hash(readFileSync(journalPath)), hash(journalBytes));
}
