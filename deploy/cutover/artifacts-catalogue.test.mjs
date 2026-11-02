// Hermetic tests for the preprod artifact catalogue preservation tool.
// No database, no cluster, no network: file-only subcommands plus static
// guards (destructive-path registry, forbidden dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const script = path.join(here, 'artifacts-catalogue.sh');

// Hermetic by construction: the script gets an explicit minimal PATH, never the
// host environment (keeps eslint clean without config changes outside scope).
const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const run = (args, env = {}) =>
  spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: BASE_PATH, ...env } });

function makeExportDir(tamper) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-hermetic-'));
  const files = {
    'journal.tsv': '1792100000002:abc\n',
    'subjects.tsv': 'witness-owner\tapproved\n',
    'digests.txt': 'deadbeef\n',
    'order.tsv': 'artifacts\n',
    'fingerprints.tsv': 'table\trows\tfingerprint\nartifacts\t1\tfp\n',
  };
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'artifacts.columns'), 'id\n');
  fs.writeFileSync(path.join(dir, 'data', 'artifacts.copy'), 'row\n');
  fs.writeFileSync(path.join(dir, 'catalogue.dump'), tamper ? 'tampered' : 'dump');
  const manifest = {
    formatVersion: tamper ? 2 : 1,
    generator: 'test',
    scope: 's',
    createdAt: 't',
    generation: 'g',
    sourceDatabase: 'db',
    journal: [],
    tables: [],
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const lines = ['manifest.json', 'catalogue.dump', ...Object.keys(files), 'data/artifacts.columns', 'data/artifacts.copy']
    .map((f) => `${createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}  ${f}\n`)
    .join('');
  fs.writeFileSync(path.join(dir, 'manifest.sha256'), lines);
  if (tamper === 'byte') fs.appendFileSync(path.join(dir, 'catalogue.dump'), 'x');
  return dir;
}

test('catalogue script passes bash syntax and carries no forbidden dependency', () => {
  const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const body = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(body, /\.env/, 'never reads .env');
  assert.doesNotMatch(body, /\bpython\b/i, 'no Python anywhere');
  assert.doesNotMatch(body, /\bkubectl\b/, 'no cluster access');
  assert.doesNotMatch(body, /\bdocker\b/, 'no new container image');
});

test('destructive-path registry covers every schema/database drop in executable sources', () => {
  const listed = spawnSync('bash', ['-c', `source <(sed -n '/^catalogue_destructive_paths/,/^}/p' "${script}"); catalogue_destructive_paths`], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const entries = listed.stdout.trim().split('\n').map((l) => l.split('|'));
  assert.ok(entries.length >= 4);
  for (const [p] of entries) assert.ok(fs.existsSync(path.join(root, p)), `registry path exists: ${p}`);
  const hits = spawnSync('bash', ['-c', `grep -rln --include='*.sh' --include='*.cjs' --include='*.mjs' -E 'DROP SCHEMA|DROP DATABASE' deploy tools api packages | grep -v test || true`], { cwd: root, encoding: 'utf8' });
  const found = hits.stdout.trim().split('\n').filter(Boolean)
    .filter((f) => !f.includes('bascule-preprod') && !f.includes('backup'));
  for (const f of found) {
    assert.ok(entries.some(([p]) => p === f), `destructive path registered: ${f}`);
  }
  const hook = fs.readFileSync(path.join(root, 'deploy/cutover/atomic-restore.sh'), 'utf8');
  assert.match(hook, /CATALOGUE_DIR/, 'atomic-restore preserves the catalogue through its hook');
});

test('manifest-check accepts a sealed export and refuses tampering', () => {
  const good = makeExportDir(false);
  const ok = run(['manifest-check', '--in-dir', good]);
  assert.equal(ok.status, 0, ok.stderr);
  const tampered = makeExportDir('byte');
  const bad = run(['manifest-check', '--in-dir', tampered]);
  assert.notEqual(bad.status, 0, 'tampered archive must be refused');
  assert.match(bad.stderr, /checksum mismatch/);
  const wrongVersion = makeExportDir(true);
  const versioned = run(['manifest-check', '--in-dir', wrongVersion]);
  assert.notEqual(versioned.status, 0, 'unknown format version must be refused');
});

test('map-check enforces explicit validated correspondence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-map-'));
  const subjects = path.join(dir, 'subjects.tsv');
  fs.writeFileSync(subjects, 'alice\tapproved\nbob\t\n');
  const goodMap = path.join(dir, 'map.tsv');
  fs.writeFileSync(goodMap, 'alice\tapproved\nbob\n');
  assert.equal(run(['map-check', '--map', goodMap, '--subjects', subjects]).status, 0);
  const uncovered = path.join(dir, 'uncovered.tsv');
  fs.writeFileSync(uncovered, 'alice\n');
  const missing = run(['map-check', '--map', uncovered, '--subjects', subjects]);
  assert.notEqual(missing.status, 0, 'subjects without explicit mapping must be refused');
  const dup = path.join(dir, 'dup.tsv');
  fs.writeFileSync(dup, 'alice\nALICE\n'.toLowerCase() + 'alice\n');
  assert.notEqual(run(['map-check', '--map', dup]).status, 0, 'duplicate subjects must be refused');
  const badStatus = path.join(dir, 'bad.tsv');
  fs.writeFileSync(badStatus, 'alice\tsuperuser\n');
  const refused = run(['map-check', '--map', badStatus]);
  assert.notEqual(refused.status, 0, 'unknown forced status must be refused');
  assert.match(refused.stderr, /bad status/);
});

function makeS5cmdStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-s5cmd-'));
  const bin = path.join(dir, 's5cmd');
  fs.writeFileSync(bin, `#!/bin/bash
echo "s5cmd $*" >> "$STUB_LOG"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint-url) shift 2 ;;
    sync|cp) echo "op=upload dest=\${@: -1}" >> "$STUB_LOG"; exit "\${STUB_EXIT:-0}" ;;
    ls) command cat "$STUB_LS"; exit 0 ;;
    cat) command cat "$STUB_CAT"; exit 0 ;;
    *) echo "unexpected: $1" >> "$STUB_LOG"; exit 9 ;;
  esac
done
`);
  fs.chmodSync(bin, 0o755);
  return dir;
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

function makeArchiveFixture() {
  const dir = makeExportDir(false);
  const stubDir = makeS5cmdStub();
  const log = path.join(stubDir, 'calls.log');
  fs.writeFileSync(log, '');
  const ls = path.join(stubDir, 'ls.txt');
  fs.writeFileSync(ls, Array.from({ length: countFiles(dir) }, (_, i) => `file-${i}`).join('\n') + '\n');
  const baseEnv = {
    PATH: `${stubDir}:${BASE_PATH}`,
    STUB_LOG: log,
    STUB_EXIT: '0',
    STUB_LS: ls,
    STUB_CAT: path.join(dir, 'manifest.json'),
  };
  return { dir, stubDir, log, baseEnv };
}

const archiveArgs = (dir, stubDir, extra = {}) => ([
  'archive', '--in-dir', dir,
  '--bucket', 'sentropic-pgbackup-preprod', '--prefix', 'catalogue',
  '--endpoint-url', 'https://s3.bhs.io.cloud.ovh.net', '--s5cmd', path.join(stubDir, 's5cmd'),
  ...Object.entries(extra).flatMap(([k, v]) => [`--${k}`, v]),
]);

test('archive uploads a sealed export and proves the read-back', () => {
  const { dir, stubDir, log, baseEnv } = makeArchiveFixture();
  const ok = run(archiveArgs(dir, stubDir), baseEnv);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /archived generation g to s3:\/\/sentropic-pgbackup-preprod\/catalogue\/g\//);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /--endpoint-url https:\/\/s3\.bhs\.io\.cloud\.ovh\.net.*sync/);
  assert.match(calls, /op=upload dest=s3:\/\/sentropic-pgbackup-preprod\/catalogue\/g\//);
});

test('archive refuses an unsealed export before touching s5cmd', () => {
  const { stubDir, log, baseEnv } = makeArchiveFixture();
  const tampered = makeExportDir('byte');
  const refused = run(archiveArgs(tampered, stubDir), baseEnv);
  assert.notEqual(refused.status, 0, 'unsealed export must be refused');
  assert.match(refused.stderr, /checksum mismatch/);
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /op=upload/);
});

test('archive refuses upload failures, count drift and generation drift', () => {
  const up = makeArchiveFixture();
  const failed = run(archiveArgs(up.dir, up.stubDir), { ...up.baseEnv, STUB_EXIT: '1' });
  assert.notEqual(failed.status, 0, 's5cmd failure must be refused');
  assert.match(failed.stderr, /upload refused/);

  const short = makeArchiveFixture();
  fs.writeFileSync(path.join(short.stubDir, 'ls.txt'), 'only-one\n');
  const drifted = run(archiveArgs(short.dir, short.stubDir), short.baseEnv);
  assert.notEqual(drifted.status, 0, 'object count drift must be refused');
  assert.match(drifted.stderr, /read-back count/);

  const gen = makeArchiveFixture();
  const other = path.join(gen.stubDir, 'other.json');
  fs.writeFileSync(other, '{"generation":"other"}');
  const diverged = run(archiveArgs(gen.dir, gen.stubDir), { ...gen.baseEnv, STUB_CAT: other });
  assert.notEqual(diverged.status, 0, 'generation drift must be refused');
  assert.match(diverged.stderr, /read-back generation/);
});

test('archive refuses prod buckets and missing arguments', () => {
  const { dir, stubDir, log, baseEnv } = makeArchiveFixture();
  const prod = run(archiveArgs(dir, stubDir, { bucket: 'x-prod-x' }), baseEnv);
  assert.notEqual(prod.status, 0, 'prod bucket must be refused');
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /op=upload/);
  const missing = run(['archive', '--in-dir', dir, '--bucket', 'b'], { PATH: `${stubDir}:${BASE_PATH}` });
  assert.notEqual(missing.status, 0, 'missing arguments must be refused');
});

test('stable and pinned URL derivation still keys on artifact and release ids', () => {
  const composition = fs.readFileSync(path.join(root, 'packages/artifacts-host/src/composition.ts'), 'utf8');
  assert.match(composition, /stableUrl: `https:\/\/\$\{artifactId\}/);
  assert.match(composition, /pinnedUrl: `https:\/\/\$\{releaseId\}\.pinned\./);
});
