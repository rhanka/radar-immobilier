import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyFromEnv, readmeHashes, seal, sealToFile, unseal, sha256 } from '../lib/refc1.mjs';
import { parseWorkbook, partition, sanitizeDefinition, codebookFromMigration } from '../lib/triage.mjs';
import { run, EVAL_FILES } from '../guard/unseal.mjs';
import { openEvalSet, refuseItemListing, readAudit } from '../guard/evalset.mjs';
import { scanText } from '../lib/fingerprint.mjs';
import { MIGRATION_CODES } from '../lib/paths.mjs';
import { fakeReferenceC, fakeWorkbook, fakeRows, fakeFetchNodes, newKey } from './fixture.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'classif-test-'));

test('REFC1 round trip, tamper and wrong key are refused', () => {
  const key = newKey();
  const plain = Buffer.from('{"x":1}\n');
  const sealed = seal(key, plain);
  assert.ok(sealed.subarray(0, 5).equals(Buffer.from('REFC1')));
  assert.deepEqual(unseal(key, sealed), plain);
  const bad = Buffer.from(sealed); bad[bad.length - 1] ^= 1;
  assert.throws(() => unseal(key, bad));
  assert.throws(() => unseal(newKey(), sealed));
});

test('key is read from the environment only and never echoed', () => {
  assert.throws(() => keyFromEnv('CLASSIF_EVAL_KEY', {}), /not set/);
  const secret = 'c2hvcnQ=';
  try { keyFromEnv('K', { K: secret }); assert.fail('should throw'); } catch (e) { assert.ok(!e.message.includes(secret)); }
  assert.equal(keyFromEnv('K', { K: newKey().toString('base64') }).length, 32);
});

test('sealToFile verifies the round trip and refuses overwrite', () => {
  const dir = tmp();
  const key = newKey();
  const f = path.join(dir, 'a.sealed');
  const r = sealToFile(key, Buffer.from('abc'), f);
  assert.equal(r.plainSha256, sha256(Buffer.from('abc')));
  assert.throws(() => sealToFile(key, Buffer.from('abc'), f), /overwrite/);
});

test('README hash table is parsed', () => {
  const m = readmeHashes(`| \`reference-c.csv.sealed\` | x | \`${'f'.repeat(64)}\` |`);
  assert.equal(m.get('reference-c.csv.sealed'), 'f'.repeat(64));
});

test('workbook parse and partition: 124 → 121 retained → 113 evaluation', () => {
  const wb = parseWorkbook(fakeWorkbook());
  assert.equal(wb.rows.length, 124);
  assert.equal(wb.codes.length, 28);
  const { retained, evaluation } = partition(wb.rows);
  assert.equal(retained.length, 121);
  assert.equal(evaluation.length, 113);
  assert.ok(!evaluation.some((r) => [14, 55, 58, 18, 27, 77, 82, 93, 104, 112, 119].includes(r.lineNo)));
  assert.throws(() => partition(wb.rows.slice(1)), /partition check failed/);
});

test('codebook of the migration has the 28 codes', () => {
  assert.equal(codebookFromMigration(readFileSync(MIGRATION_CODES, 'utf8')).length, 28);
});

test('definitions are stripped of examples and counts', () => {
  const s = sanitizeDefinition('Zone nouvelle (ex. ligne 12). Ex : cas 3. Vu sur #45 et 7 lignes.');
  assert.ok(!/ex|#|\d/i.test(s.replace(/Zone nouvelle/, '')), s);
});

test('guard run on a synthetic sealed fixture: seals, round-trips, leaves no plaintext, no label in output', async () => {
  const root = tmp();
  const refKey = newKey();
  const evalKey = newKey();
  const refcDir = path.join(root, 'refc');
  fakeReferenceC(refcDir, refKey);
  const evalDir = path.join(root, 'eval');
  const home = path.join(root, 'home');
  const env = { REFERENCE_C_KEY: refKey.toString('base64'), CLASSIF_EVAL_KEY: evalKey.toString('base64') };
  const logs = [];
  const summary = await run({ env, refcDir, evalDir, home, fetchNodes: fakeFetchNodes, log: (s) => logs.push(s) });
  assert.equal(summary.evalSet.rows, 113);
  // Only sealed files, README and access log in the eval folder.
  assert.deepEqual(readdirSync(evalDir).sort(), ['README.md', 'access-log.jsonl', `${EVAL_FILES.expected}.sealed`, `${EVAL_FILES.inputs}.sealed`].sort());
  // Printed output and guard material carry no verdict and no code.
  const printed = logs.join('\n');
  const guardText = ['exclusions.json', 'fingerprints.json'].map((f) => readFileSync(path.join(home, 'guard', f), 'utf8')).join('\n');
  for (const t of [printed, guardText, readFileSync(path.join(evalDir, 'README.md'), 'utf8')]) {
    assert.ok(!/Pertinent|surveiller|P-VILLE|V2-PRECEDENT|N-NON-RES/.test(t));
  }
  assert.equal(statSync(path.join(home, 'guard')).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(home, 'guard', 'exclusions.json')).mode & 0o777, 0o600);
  // Executor opening: role required, hashes checked, access logged.
  assert.throws(() => openEvalSet({ purpose: 't', evalDir, env }), /test-executor/);
  const set = openEvalSet({ purpose: 'selftest', evalDir, env: { ...env, CLASSIF_ROLE: 'test-executor' } });
  assert.equal(set.inputs.length, 113);
  assert.equal(set.expected.length, 113);
  assert.ok(set.inputs.every((i) => !('verdict' in i) && !('code' in i)));
  assert.equal(set.inputs.filter((i) => i.input === null).length, 1); // item20 not in the fake graph
  assert.equal(readAudit(evalDir).length, 2);
  assert.throws(() => refuseItemListing('eval'), /refused/);
  // Fingerprints flag an evaluation-set input but not an unrelated text.
  const salt = readFileSync(path.join(home, 'guard', 'salt'), 'utf8').trim();
  const fps = JSON.parse(readFileSync(path.join(home, 'guard', 'fingerprints.json'), 'utf8'));
  assert.ok(scanText(salt, fps, set.inputs[0].input).shingles > 0);
  assert.equal(scanText(salt, fps, 'un texte sans rapport aucun avec le jeu de référence scellé ni ses villes ni ses documents de test').shingles, 0);
  // A second run refuses to overwrite.
  await assert.rejects(run({ env, refcDir, evalDir, home, fetchNodes: fakeFetchNodes, log: () => {} }), /overwrite/);
  rmSync(root, { recursive: true, force: true });
});

test('guard refuses when a key is missing, equal keys, or a README hash differs, and writes nothing', async () => {
  const root = tmp();
  const refKey = newKey();
  const refcDir = path.join(root, 'refc');
  fakeReferenceC(refcDir, refKey, fakeRows());
  const evalDir = path.join(root, 'eval');
  const home = path.join(root, 'home');
  await assert.rejects(run({ env: { REFERENCE_C_KEY: refKey.toString('base64') }, refcDir, evalDir, home, fetchNodes: fakeFetchNodes }), /CLASSIF_EVAL_KEY/);
  await assert.rejects(run({ env: { REFERENCE_C_KEY: refKey.toString('base64'), CLASSIF_EVAL_KEY: refKey.toString('base64') }, refcDir, evalDir, home, fetchNodes: fakeFetchNodes }), /differ/);
  writeFileSync(path.join(refcDir, 'README.md'), `| \`reference-c.xlsx.sealed\` | x | \`${'0'.repeat(64)}\` |\n`);
  await assert.rejects(run({ env: { REFERENCE_C_KEY: refKey.toString('base64'), CLASSIF_EVAL_KEY: newKey().toString('base64') }, refcDir, evalDir, home, fetchNodes: fakeFetchNodes }), /differs/);
  assert.ok(!existsSync(evalDir) || readdirSync(evalDir).length === 0);
  assert.ok(!existsSync(path.join(home, 'guard')));
  rmSync(root, { recursive: true, force: true });
});

test('Triage numbering: real-layout variants (no "#" in column A, "N°" elsewhere, shuffled rows)', () => {
  for (const layout of ['id-in-A', 'hash-in-A', 'hash-in-S']) {
    const wb = parseWorkbook(fakeWorkbook(fakeRows(), { layout }));
    const { retained, evaluation } = partition(wb.rows);
    assert.equal(retained.length, 121, layout);
    assert.equal(evaluation.length, 113, layout);
    assert.equal(wb.rows.find((r) => r.lineNo === 55).citySlug, 'mont-saint-hilaire', layout);
  }
  assert.equal(parseWorkbook(fakeWorkbook(fakeRows(), { layout: 'id-in-A' })).numberingSource, 'excel order');
  assert.match(parseWorkbook(fakeWorkbook(fakeRows(), { layout: 'hash-in-S' })).numberingSource, /column S/);
});

test('Triage numbering: the conductor failure (column A read as "#") cannot recur silently', () => {
  // Reading column A digits on the "id-in-A" layout gives 124 distinct numbers and none of the
  // expected lines: exactly the failing run. The anchor check now refuses any such numbering.
  const rows = fakeRows().map((r) => ({ ...r, city: r.line === 14 ? 'Ville Fictive 99' : r.city }));
  assert.throws(() => parseWorkbook(fakeWorkbook(rows, { layout: 'id-in-A' })), (e) => {
    assert.match(e.message, /anchor cities/);
    assert.match(e.message, /Row-5 headers/);
    assert.ok(!/Pertinent|surveiller|P-VILLE|V2-PRECEDENT/.test(e.message));
    return true;
  });
});

test('sandbox scanner refuses files hitting a fingerprint list, accepts clean ones', async () => {
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { scanFile } = await import('../guard/sandbox-build.mjs');
  const salt = 'test-salt';
  const input = 'Avis de motion du règlement fictif numéro 9001-1 visant la zone fictive avec des habitations multifamiliales de six logements';
  const fps = buildFingerprints(salt, { nodeIds: ['signal-ville-x-1'], docShas: ['d'.repeat(64)], citySlugs: ['saint-exemple'], bylaws: ['9001-1'], inputs: [input] });
  const guard = { salt, fps };
  const clean = scanFile(guard, 'Un texte neutre sans rapport, à propos de la ville de Nulle-Part et du règlement 1-2.');
  assert.equal(Object.values(clean).reduce((a, b) => a + b, 0), 0);
  const dirty = scanFile(guard, `Voir signal-ville-x-1, document ${'d'.repeat(64)}, Saint-Exemple, règlement 9001-1. ${input}`);
  assert.deepEqual(Object.keys(dirty).filter((k) => dirty[k] > 0).sort(), ['bylaws', 'citySlugs', 'docShas', 'nodeIds', 'shingles']);
});

test('draw helpers: committed seed check, seeded order is stable, allocation sums to target', async () => {
  const { seededOrder, regionBand } = await import('../lib/draw.mjs');
  const { allocate } = await import('../l0/signals.mjs');
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}` }));
  assert.deepEqual(seededOrder('s', items), seededOrder('s', [...items].reverse()));
  assert.notDeepEqual(seededOrder('s', items), seededOrder('t', items));
  const a = allocate(192, { a: 1000, b: 30, c: 170 });
  assert.equal(Object.values(a).reduce((x, y) => x + y, 0), 192);
  assert.equal(allocate(10, { a: 3, b: 2 }).a, 3);
  assert.equal(regionBand(10), 'lt50km');
  assert.equal(regionBand(null), 'unknown');
});

test('probe answer validation: code partition, boolean ambiguity, citation', async () => {
  const { validate } = await import('../l0/probe.mjs');
  assert.ok(validate('```json\n{"verdict":"pertinent","code":"P-DENSITE","ambiguous":false,"citation":"x"}\n```').ok);
  assert.equal(validate('{"verdict":"non_pertinent","code":"P-DENSITE","ambiguous":false,"citation":"x"}').ok, false);
  assert.equal(validate('{"verdict":"pertinent","code":"P-NOPE","ambiguous":false,"citation":"x"}').ok, false);
  assert.equal(validate('no json').ok, false);
});
