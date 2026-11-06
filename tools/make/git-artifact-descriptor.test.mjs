// G0 v3 §4.1 / §7.2 (OP2): the root build descriptor and its recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARTIFACT_ENV, artifactEnv, dotenvFiles, leaks } from './ui-artifact-env.mjs';

const CLOSED_FIELDS = ['version', 'buildScript', 'outputDir', 'lockfilePath', 'entry', 'publicEnvNames'];
const REQUIRED_FIELDS = ['version', 'buildScript', 'outputDir', 'lockfilePath'];
const ACCEPTED_IMMO = {
  version: 1,
  buildScript: 'build:artifact',
  outputDir: 'ui/dist',
  lockfilePath: 'package-lock.json',
  entry: 'index.html',
};

// Mirror of the GB1 validation refusals (typed, zero execution).
function validateDescriptor(d, { scripts, exists }) {
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return 'build_descriptor_invalid';
  if (Object.keys(d).some(k => !CLOSED_FIELDS.includes(k))) return 'build_descriptor_invalid';
  if (REQUIRED_FIELDS.some(k => !(k in d))) return 'build_descriptor_invalid';
  if (d.version !== 1) return 'build_descriptor_invalid';
  if (typeof d.buildScript !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(d.buildScript)) return 'build_descriptor_invalid';
  const relative = p => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.split('/').some(s => s === '..' || s === '.' || s === '');
  if (!relative(d.outputDir) || !relative(d.lockfilePath)) return 'build_descriptor_invalid';
  if ('entry' in d && (typeof d.entry !== 'string' || d.entry === '')) return 'build_descriptor_invalid';
  if ('publicEnvNames' in d && (!Array.isArray(d.publicEnvNames) || d.publicEnvNames.some(n => !/^[A-Z][A-Z0-9_]*$/.test(n)))) return 'build_descriptor_invalid';
  if (!(d.buildScript in scripts)) return 'build_script_missing';
  if (!exists(d.lockfilePath)) return 'lock_missing';
  return null;
}

const descriptorText = readFileSync('sentropic.artifact.json', 'utf8');
const descriptor = JSON.parse(descriptorText);
const rootPkg = JSON.parse(readFileSync('package.json', 'utf8'));
const ctx = { scripts: rootPkg.scripts, exists: existsSync };

test('the root descriptor is exactly the accepted Immo descriptor', () => {
  assert.deepEqual(descriptor, ACCEPTED_IMMO);
  assert.deepEqual(Object.keys(descriptor), Object.keys(ACCEPTED_IMMO), 'field order as in §4.1');
  assert.equal(descriptorText, `${JSON.stringify(ACCEPTED_IMMO, null, 2)}\n`);
  assert.equal('publicEnvNames' in descriptor, false, 'the accepted Immo descriptor carries no publicEnvNames');
});

test('the root descriptor passes the closed-field validation', () => {
  assert.equal(validateDescriptor(descriptor, ctx), null);
  for (const k of Object.keys(descriptor)) assert.ok(CLOSED_FIELDS.includes(k), k);
});

test('descriptor validation refuses typed, with zero execution', () => {
  const cases = [
    [{ ...ACCEPTED_IMMO, command: 'npm run build' }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, args: ['--x'] }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, env: { VITE_X: '1' } }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, version: 2 }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, buildScript: 'build && curl x' }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, outputDir: '../dist' }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, outputDir: '/abs' }, 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, publicEnvNames: ['VITE_X=1'] }, 'build_descriptor_invalid'],
    [(({ lockfilePath, ...rest }) => rest)(ACCEPTED_IMMO), 'build_descriptor_invalid'],
    [{ ...ACCEPTED_IMMO, buildScript: 'build:absent' }, 'build_script_missing'],
    [{ ...ACCEPTED_IMMO, lockfilePath: 'missing-lock.json' }, 'lock_missing'],
  ];
  for (const [d, code] of cases) assert.equal(validateDescriptor(d, ctx), code, JSON.stringify(d));
});

test('build:artifact builds the ui workspace through the allowlisted environment', () => {
  assert.equal(rootPkg.scripts['build:artifact'], 'node tools/make/ui-artifact-env.mjs npm run build -w ui');
});

test('the artifact environment is an allowlist of exactly three VITE_* variables', () => {
  const inherited = {
    PATH: '/usr/bin', HOME: '/home/x', GITHUB_PAGES: 'true', QA_HARNESS: '1',
    VITE_RADAR_ONTOLOGY_WRITE_TOKEN: 'secret-value-123', VITE_GEO_OGC_BASE_URL: 'https://x', VITE_ANYTHING: 'y',
    VITE_API_BASE_URL: 'https://override.invalid',
  };
  const { env, dropped } = artifactEnv(inherited);
  assert.deepEqual(Object.keys(env).filter(k => k.startsWith('VITE_')).sort(), ['VITE_API_BASE_URL', 'VITE_ARTIFACT_MODE', 'VITE_BASEMAP_TILE_URL']);
  assert.deepEqual(ARTIFACT_ENV, {
    VITE_ARTIFACT_MODE: '1', VITE_API_BASE_URL: '/__app', VITE_BASEMAP_TILE_URL: '/__artifacts/tiles/v1/osm/{z}/{x}/{y}',
  });
  for (const [k, v] of Object.entries(ARTIFACT_ENV)) assert.equal(env[k], v, k);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/x');
  for (const k of ['GITHUB_PAGES', 'QA_HARNESS', 'VITE_RADAR_ONTOLOGY_WRITE_TOKEN', 'VITE_GEO_OGC_BASE_URL', 'VITE_ANYTHING']) {
    assert.equal(k in env, false, k);
    assert.ok(k in dropped, k);
  }
});

test('a ui/.env* file is detected and a dropped value in the bundle is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-artifact-env-'));
  writeFileSync(join(dir, 'index.html'), '');
  assert.deepEqual(dotenvFiles(dir), []);
  for (const n of ['.env', '.env.local', '.env.production', '.env.artifact.local']) writeFileSync(join(dir, n), 'VITE_X=1');
  writeFileSync(join(dir, '.envrc-not-vite'), '');
  assert.deepEqual(dotenvFiles(dir), ['.env', '.env.artifact.local', '.env.local', '.env.production']);
  const dist = mkdtempSync(join(tmpdir(), 'ui-artifact-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'a.js'), 'const t="secret-value-123";');
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  assert.deepEqual(leaks(dist, { VITE_RADAR_ONTOLOGY_WRITE_TOKEN: 'secret-value-123', VITE_SHORT: '1' }),
    [{ file: 'assets/a.js', variable: 'VITE_RADAR_ONTOLOGY_WRITE_TOKEN' }]);
  assert.deepEqual(leaks(dist, { VITE_RADAR_ONTOLOGY_WRITE_TOKEN: 'absent-value-456' }), []);
});

test('the app build is untouched and the Make target delegates to the one recipe', () => {
  const ui = JSON.parse(readFileSync('ui/package.json', 'utf8'));
  assert.equal(ui.scripts.build, 'vite build');
  const makefile = readFileSync('Makefile', 'utf8');
  const target = makefile.slice(makefile.indexOf('build-ui-artifact:'), makefile.indexOf('.PHONY: smoke-ui-bundle'));
  assert.ok(target.includes('run --rm --no-deps -T api npm run build:artifact'));
  assert.equal(/-e VITE_/.test(target), false, 'no second copy of the artifact variables');
  assert.ok(makefile.includes('\t$(COMPOSE_RUN_API_NODEPS) npm run build --workspace=ui\n'), 'make build unchanged');
});
