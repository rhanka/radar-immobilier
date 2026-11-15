// Preprod artifact catalogue union wired into the real restore Jobs (owner
// rule 2026-11-15): the restore Job stashes the live preprod catalogue before
// the schema reset, the catalogue Job imports it in union after the
// migrations. Synthetic cluster only; prod never gets either side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';
const success = r => assert.equal(r.status, 0, r.stdout + r.stderr);
const save = (f, state) => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
const job = (f, step) => f.state().objects.find(o => o.kind === 'Job' && o.metadata.name.endsWith(`-${step}`));
const container = (j, name) => j.spec.template.spec.containers.find(c => c.name === name);
const env = (c, name) => c.env.find(e => e.name === name);
const catalogueScript = readFileSync('deploy/cutover/artifacts-catalogue.sh', 'utf8');
const blobsScript = readFileSync('deploy/cutover/artifacts-blobs.sh', 'utf8');
// The shell wrapper runs `bash -c <script>`: the script is the last argument.
const script = c => c.args.at(-1);

function assertRestoreStashes(j) {
  const restore = container(j, 'restore');
  assert.equal(env(restore, 'CATALOGUE_DIR').value, '/work/catalogue');
  assert.equal(env(restore, 'CATALOGUE_SCRIPT').value, '/work/artifacts-catalogue.sh');
  assert.equal(env(restore, 'CATALOGUE_STASH').value, '1');
  assert.match(env(restore, 'CATALOGUE_STASH_TAG').value, /^[0-9a-f-]{36}:[0-9a-f]{16}$/, 'stash bound to the run and its backup pin');
  const body = script(restore);
  const embedded = body.match(/cat > \/work\/artifacts-catalogue\.sh <<'ARTIFACTS_CATALOGUE_EOF'\n([\s\S]*?)\nARTIFACTS_CATALOGUE_EOF\n/);
  assert.ok(embedded, 'catalogue script written before the atomic restore');
  assert.equal(embedded[1].trimEnd(), catalogueScript.trimEnd(), 'embedded catalogue script is byte-identical');
  assert.ok(body.indexOf('ARTIFACTS_CATALOGUE_EOF') < body.indexOf('reset_schemas()'), 'script in place before the reset');
}

function assertCatalogueImport(f, expectedDb) {
  const steps = f.state().jobCreation.map(j => j.step);
  const at = s => steps.lastIndexOf(s);
  assert.ok(at('catalogue') > at('restore') && at('catalogue') > at('ddl') && at('catalogue') > at('data'),
    `catalogue import runs after restore, ddl and data: ${steps.join(',')}`);
  const c = container(job(f, 'catalogue'), 'catalogue');
  assert.equal(env(c, 'CATALOGUE_DIR').value, '/work/catalogue');
  assert.match(script(c), /bash \/work\/artifacts-catalogue\.sh import-stash --work "\/work\/catalogue"/);
  assert.equal(c.image, 'postgis/postgis:16-3.4', 'same native-tools image as the restore container');
  assert.match(script(c), /--rewrite-from "radar-immobilier" --rewrite-to "radar-immobilier-preprod"/);
  assert.match(script(c), /--blob-keys \/work\/preprod-blob-keys\.txt/);
  const blobs = job(f, 'catalogue').spec.template.spec.initContainers.find(i => i.name === 'blobs');
  assert.ok(blobs, 'blob copy runs before the import (init container)');
  assert.equal(blobs.image, 'peakcom/s5cmd:v2.2.2');
  assert.equal(env(blobs, 'SRC_BUCKET').value, 'radar-immobilier-artifacts');
  assert.equal(env(blobs, 'DST_BUCKET').value, 'radar-immobilier-artifacts-preprod');
  assert.equal(env(blobs, 'DST_SCOPE').value, 'radar-immobilier-preprod');
  assert.ok(env(blobs, 'FORBIDDEN_DST_BUCKETS').value.split(',').includes('radar-immobilier-artifacts'), 'prod bucket is a forbidden destination');
  assert.equal(env(blobs, 'AWS_ACCESS_KEY_ID').valueFrom.secretKeyRef.name, 'radar-artifacts-restore-copy');
  assert.equal(script(blobs).trimEnd(), blobsScript.trimEnd(), 'embedded blob script is byte-identical');
  const db = env(c, 'PGDATABASE');
  if (expectedDb) assert.equal(db.value, expectedDb);
  else assert.equal(db.valueFrom.secretKeyRef.key, 'POSTGRES_DB');
}

test('daily MODE=restore: restore Job stashes the catalogue, catalogue Job imports it after the migrations', () => {
  const f = fixture();
  try {
    success(f.run('run'));
    assertRestoreStashes(job(f, 'restore'));
    assertCatalogueImport(f, null);
    const coherent = f.state().jobCreation.map(j => j.step);
    assert.ok(coherent.indexOf('catalogue') > coherent.indexOf('restore'), 'after the coherence gate (which follows the restore Job)');
  } finally { f.cleanup(); }
});

test('prepare: candidate stash exported from the live database, union import into the prepared database', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const restore = job(f, 'restore');
    assertRestoreStashes(restore);
    assert.equal(env(container(restore, 'restore'), 'LIVE_DB').value, 'radar');
    assert.equal(env(container(restore, 'restore'), 'TARGET_DB').value, 'radar_next');
    assertCatalogueImport(f, 'radar_next');
  } finally { f.cleanup(); }
});

test('prod never stashes nor imports a catalogue', () => {
  const f = fixture({ url: 'https://immo.sent-tech.ca' });
  try {
    const state = f.state();
    const ingress = state.objects.find(o => o.kind === 'Ingress');
    ingress.spec.rules[0].host = 'immo.sent-tech.ca'; ingress.spec.tls[0].hosts = ['immo.sent-tech.ca'];
    save(f, state);
    success(f.run('prepare', [], 'prod'));
    assert.ok(f.state().jobCreation.every(j => !['restore', 'catalogue'].includes(j.step)));
  } finally { f.cleanup(); }
  const render = readFileSync('tools/make/cutover-render.sh', 'utf8');
  assert.match(render, /export CATALOGUE_SCRIPT CATALOGUE_DIR=\n/, 'CATALOGUE_DIR empty by default');
  assert.match(render, /if \[\[ \$ENV == preprod \]\]; then CATALOGUE_DIR=\/work\/catalogue; fi/, 'only preprod enables the hook');
  const hook = readFileSync('deploy/cutover/catalogue-import-job.tmpl.yaml', 'utf8');
  assert.match(hook, /\[ -n "\$CATALOGUE_DIR" \] \|\| exit 2/, 'the catalogue Job refuses without CATALOGUE_DIR');
});

test('daily restore: a failed catalogue import keeps preprod closed (no reopening without the preprod artifacts)', () => {
  const f = fixture({ failJob: 'catalogue' });
  try {
    const result = f.run('run');
    assert.notEqual(result.status, 0);
    const out = result.stdout + result.stderr;
    assert.doesNotMatch(out, /REOPENED WITHOUT RESTORE/, out);
    assert.match(out, /Automatic reopening refused/, out);
    const steps = f.state().jobCreation.map(j => j.step);
    assert.equal(steps.filter(s => s === 'catalogue').length, 2, `import retried once by the reopening, then held: ${steps.join(',')}`);
    assert.ok(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), 'recovery lock retained');
  } finally { f.cleanup(); }
});
