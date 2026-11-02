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
const run = (args, env = {}) =>
  spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', ...env } });

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

test('stable and pinned URL derivation still keys on artifact and release ids', () => {
  const composition = fs.readFileSync(path.join(root, 'packages/artifacts-host/src/composition.ts'), 'utf8');
  assert.match(composition, /stableUrl: `https:\/\/\$\{artifactId\}/);
  assert.match(composition, /pinnedUrl: `https:\/\/\$\{releaseId\}\.pinned\./);
});
