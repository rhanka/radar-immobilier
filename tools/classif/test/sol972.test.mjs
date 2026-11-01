import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = () => {
  try { return mkdtempSync(path.join(os.tmpdir(), 'sol972-')); }
  catch (e) { if (e?.code !== 'EROFS' && e?.code !== 'EACCES') throw e; return mkdtempSync(path.join('/tmp', 'sol972-')); }
};

// P1.1 — a missing fingerprint guard refuses (fail closed), never ok.
test('P1.1 missing fingerprints refuse every excerpt (fail closed)', async () => {
  const { fingerprintVerdict } = await import('../l2/scrape.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  assert.deepEqual(fingerprintVerdict(null, 'any excerpt text').refused, true);
  assert.equal(fingerprintVerdict(null, 'any excerpt text').reason, 'missing-fingerprints');
  assert.deepEqual(fingerprintVerdict(undefined, '').refused, true);
  const salt = 'sol972-salt';
  const input = 'Avis de motion du reglement fictif numero 9001-1 visant la zone fictive avec des habitations multifamiliales de six logements douze mots ici pour shingle test suite';
  const guard = { salt, fps: buildFingerprints(salt, { nodeIds: ['signal-ville-x-1'], docShas: ['d'.repeat(64)], citySlugs: ['saint-exemple'], bylaws: ['9001-1'], inputs: [input] }) };
  const dirty = fingerprintVerdict(guard, `Voir signal-ville-x-1, document ${'d'.repeat(64)}, Saint-Exemple, reglement 9001-1. ${input}`);
  assert.equal(dirty.refused, true);
  assert.equal(dirty.reason, 'fingerprint-hit');
  const clean = fingerprintVerdict(guard, 'Un texte neutre sans rapport, a propos de la ville de Nulle-Part et du reglement 1-2.');
  assert.equal(clean.refused, false);
});

// P1.1b — loadFingerprints returns null when the guard material is absent.
test('P1.1b absent guard material loads as null (scrape must refuse)', async () => {
  const { loadFingerprints } = await import('../lib/draw.mjs');
  const dir = tmp();
  assert.equal(loadFingerprints(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

// P2.5 — per-item resume: only items without a manifest record are reprocessed.
test('P2.5 manifest records resume per item, not per step', async () => {
  const { readManifestDone } = await import('../l2/scrape.mjs');
  const dir = tmp();
  const manifest = path.join(dir, 'scrape-manifest.jsonl');
  writeFileSync(manifest, '{"itemId":"a","status":"ok"}\n\nnot-json\n{"itemId":"b","status":"robots-disallowed"}\n{"noId":1}\n');
  const done = readManifestDone(manifest);
  assert.ok(done.has('a') && done.has('b') && !done.has('c'));
  assert.equal(readManifestDone(path.join(dir, 'missing.jsonl')).size, 0);
  rmSync(dir, { recursive: true, force: true });
});

// P1.3 — a non-zero seat exit makes every vote of the lot inadmissible.
test('P1.3 non-zero seat exit nulls every answer (fail-closed exit policy)', async () => {
  const { applyExitPolicy } = await import('../l2/run.mjs');
  const pairs = [{ item: { itemId: 'x' }, answer: { code: 'S-PLANIFIE' } }, { item: { itemId: 'y' }, answer: { code: 'P-DENSITE' } }];
  const ok = applyExitPolicy(pairs, { code: 0 });
  assert.equal(ok.exitAdmissible, true);
  assert.deepEqual(ok.pairs, pairs);
  for (const code of [1, 3, null]) {
    const bad = applyExitPolicy(pairs, { code });
    assert.equal(bad.exitAdmissible, false);
    assert.ok(bad.pairs.every((p) => p.answer === null));
    assert.deepEqual(bad.pairs.map((p) => p.item.itemId), ['x', 'y']);
  }
});

// P2.7 — atomic write leaves no truncated final file.
test('P2.7 atomicWrite leaves no tmp file and keeps content', async () => {
  const { atomicWrite } = await import('../l2/run.mjs');
  const dir = tmp();
  const file = path.join(dir, 'out.json');
  atomicWrite(file, '{"a":1}', { mode: 0o600 });
  assert.equal(readFileSync(file, 'utf8'), '{"a":1}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  atomicWrite(file, '{"a":2}', { mode: 0o600 });
  assert.equal(readFileSync(file, 'utf8'), '{"a":2}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  rmSync(dir, { recursive: true, force: true });
});

// P2.4 — an unlocated quote never matches, even when lexically close.
test('P2.4 actMatched ignores unlocated quotes', async () => {
  const { actMatched } = await import('../l3/reference.mjs');
  const item = { input: 'page un\fpage deux : adoption du reglement 3-4 afin d\u2019augmenter la densite.' };
  const v = (quote) => ({ valid: true, quote });
  assert.ok(actMatched(item, [v('adoption du reglement 3-4 afin d\u2019augmenter'), v('reglement 3-4 afin d\u2019augmenter la densite'), null]));
  const absent = 'texte absent du document source qui ressemble beaucoup au premier texte absent';
  const absent2 = 'texte absent du document source qui ressemble beaucoup au second texte absent';
  assert.equal(actMatched(item, [v(absent), v(absent2), null]), false);
  assert.equal(actMatched(item, [v('adoption du reglement 3-4 afin d\u2019augmenter'), v(absent), null]), false);
});

// P1.2 — L3 reads the last converged pass and computes external use.
test('P1.2 lastConvergedPass reads the highest pass, refUsesExternal is computed', async () => {
  const { lastConvergedPass, refUsesExternalForItem, buildReferenceRows } = await import('../l3/reference.mjs');
  const { ANNOTATORS } = await import('../l2/run.mjs');
  const dir = tmp();
  mkdirSync(path.join(dir, 'l2'), { recursive: true });
  writeFileSync(path.join(dir, 'l2', 'converge-pass1.json'), '{}');
  writeFileSync(path.join(dir, 'l2', 'converge-pass3.json'), '{}');
  writeFileSync(path.join(dir, 'l2', 'converge-pass2.json'), '{}');
  assert.equal(lastConvergedPass(dir), 3);
  const empty = tmp();
  mkdirSync(path.join(empty, 'l2'), { recursive: true });
  assert.throws(() => lastConvergedPass(empty), /converge-pass/);
  rmSync(empty, { recursive: true, force: true });
  const latest = new Map(ANNOTATORS.map((a) => [a, new Map([['i1', { pass: 1 }], ['i2', { pass: 2 }]])]));
  const complements = new Map([['i1', [{ url: 'https://x.invalid/a' }]], ['i2', [{ url: 'https://x.invalid/b' }]]]);
  assert.equal(refUsesExternalForItem('i1', latest, complements), false);
  assert.equal(refUsesExternalForItem('i2', latest, complements), true);
  assert.equal(refUsesExternalForItem('missing', latest, complements), false);
  const rows = buildReferenceRows({
    items: [{ itemId: 'i1', kind: 'signal', input: 't' }], codes: new Map([['S-A', 'a_surveiller']]),
    rows: [{ itemId: 'i1', kind: 'i1-kind', codeMaj: null, verdictMaj: null, ambiguous33: false }], latest, complements,
    signalStrata: new Map(), pass: 3,
  });
  assert.equal(rows[0].refUsesExternal, false);
  assert.equal(rows[0].pass, 3);
  rmSync(dir, { recursive: true, force: true });
});

// P2.6 — forced kill reaches the process group and the close wait is bounded.
test('P2.6 killSeatTree signals the group, falls back to direct kill', async () => {
  const { killSeatTree, callSeat } = await import('../run-seat.mjs');
  const killed = [];
  const realKill = process.kill;
  try {
    process.kill = (pid, sig) => { killed.push([pid, sig]); };
    assert.equal(killSeatTree({ pid: 1234, kill: () => { throw new Error('no'); } }, 'SIGTERM'), 'group');
    assert.deepEqual(killed[0], [-1234, 'SIGTERM']);
    process.kill = () => { throw new Error('no such group'); };
    assert.equal(killSeatTree({ pid: 1234, kill: () => true }, 'SIGTERM'), 'direct');
    assert.equal(killSeatTree({ pid: null, kill: () => true }, 'SIGTERM'), 'direct');
    assert.equal(killSeatTree({ kill: () => { throw new Error('x'); } }, 'SIGTERM'), 'none');
  } finally { process.kill = realKill; }
  let captured = null;
  const hanging = () => {
    const child = new EventEmitter();
    child.pid = 99999; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: () => {} }; child.kill = () => true;
    return child;
  };
  const fakeSpawn = (cmd, args, opts) => { captured = opts; return hanging(); };
  const base = tmp();
  const r = await callSeat('muse-wonder-max', 'prompt', { base, timeoutMs: 30, killEscalationMs: 10, closeGraceMs: 40, spawnImpl: fakeSpawn });
  assert.equal(captured.detached, true);
  assert.equal(r.timedOut, true);
  rmSync(base, { recursive: true, force: true });
});

// P2.8 — no hidden volume-removal failure: no `-` prefix, absent volume is success.
test('P2.8 classif-down has no dash prefix and tolerates an absent volume', async () => {
  const { default: _ } = await import('node:assert').catch(() => ({}));
  void _;
  const mk = readFileSync(new URL('../classif.mk', import.meta.url), 'utf8');
  assert.ok(!/^[\t ]*-docker volume rm/m.test(mk), 'dash prefix must not hide removal failures');
  assert.ok(mk.includes('docker volume rm $(CLASSIF_DEPS_VOLUME)'));
  assert.ok(mk.includes('docker volume inspect'), 'absent volume must be an explicit success path');
});

// P1.3b — exit audit: a non-zero final with valid votes is listed and excluded from recompute.
test('exit audit lists non-zero accepted votes and recomputes without them (0 LLM)', async () => {
  const { auditPass, recomputeWithout } = await import('../l2/exit-audit.mjs');
  const { ANNOTATORS } = await import('../l2/run.mjs');
  const home = tmp();
  const items = [
    { itemId: 'i1', kind: 'signal', anchor: { id: 'n1' }, input: 't1' },
    { itemId: 'i2', kind: 'signal', anchor: { id: 'n2' }, input: 't2' },
  ];
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), `${items.map((i) => JSON.stringify(i)).join('\n')}\n`);
  for (const a of ANNOTATORS) {
    const d = path.join(home, 'l2', 'pass1', a);
    mkdirSync(d, { recursive: true });
    const exitCode = a === ANNOTATORS[0] ? 1 : 0;
    writeFileSync(path.join(d, 's001.json'), JSON.stringify({
      pass: 1, annotator: a, lotId: 's001', exitCode, attempts: exitCode === 0 ? 1 : 3,
      annotations: items.map((i) => ({ itemId: i.itemId, kind: i.kind, valid: true, issues: [], code: 'S-A', verdict: 'a_surveiller', ambiguous: false, cause: null, quote: null, reason: null, changed: null, quoteFound: null })),
    }));
  }
  const { accepted } = auditPass(home, 1);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].annotator, ANNOTATORS[0]);
  assert.deepEqual([...accepted[0].itemIds].sort(), ['i1', 'i2']);
  const { before, after } = recomputeWithout(home, 1, accepted);
  assert.equal(before.metrics.executionFailures, 0);
  assert.equal(after.metrics.executionFailures, 2);
  assert.ok(after.metrics.codeConverged <= before.metrics.codeConverged);
  rmSync(home, { recursive: true, force: true });
});
