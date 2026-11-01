import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// R2-P1a — L0 draws refuse without the fingerprint guard (fail closed, no un-scanned draw).
test('R2-P1a L0 PV and signal draws refuse without fingerprints.json', async () => {
  const { requireFingerprints } = await import('../lib/draw.mjs');
  const empty = tmp();
  assert.throws(() => requireFingerprints(empty), /fingerprints\.json.*fail closed/);
  rmSync(empty, { recursive: true, force: true });
  const home = tmp();
  const prev = process.env.CLASSIF_HOME;
  process.env.CLASSIF_HOME = home;
  try {
    const pvs = await import('../l0/pvs.mjs');
    await assert.rejects(pvs.main([]), /fingerprints\.json.*fail closed/);
    mkdirSync(path.join(home, 'guard'), { recursive: true });
    writeFileSync(path.join(home, 'guard', 'exclusions.json'), JSON.stringify({ citySlugs: [], nodeIds: [], docShas: [], bylaws: [] }));
    const signals = await import('../l0/signals.mjs');
    await assert.rejects(signals.main([]), /fingerprints\.json.*fail closed/);
  } finally {
    if (prev === undefined) delete process.env.CLASSIF_HOME; else process.env.CLASSIF_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

// R2-P1b — amendment: proposals and votes from non-zero exits contribute nothing.
test('R2-P1b amendment ignores proposals and votes from non-zero exits', async () => {
  const { parseProposalList, parseBallot, tallyAmendments } = await import('../l2/amend.mjs');
  assert.deepEqual(parseProposalList({ code: 1, text: '{"amendments":[{"rule":"Do X.","rationale":"Y"}]}' }), []);
  assert.deepEqual(parseProposalList({ code: 0, text: 'not json' }), []);
  assert.deepEqual(parseBallot({ code: 1, text: '{"votes":{"X1":true}}' }), {});
  assert.deepEqual(parseBallot({ code: 0, text: '{"votes":{"X1":true}}' }), { X1: true });
  // Review scenario: one clean yes, one yes with exit 1, one clean no → not adopted.
  const union = [{ id: 'X1', rule: 'Adopt rule one.', rationale: '' }];
  const review = [
    { code: 0, text: '{"votes":{"X1":true}}' },
    { code: 1, text: '{"votes":{"X1":true}}' },
    { code: 0, text: '{"votes":{"X1":false}}' },
  ];
  assert.deepEqual(tallyAmendments(union, review).adopted, []);
  const clean = [
    { code: 0, text: '{"votes":{"X1":true}}' },
    { code: 0, text: '{"votes":{"X1":true}}' },
    { code: 0, text: '{"votes":{"X1":false}}' },
  ];
  assert.equal(tallyAmendments(union, clean).adopted.length, 1);
});

// R2-P2a — locateQuote: a present prefix completed by an invented passage never matches.
test('R2-P2a invented completions of a present prefix never match', async () => {
  const { locateQuote } = await import('../l2/annotation.mjs');
  const { actMatched } = await import('../l3/reference.mjs');
  const prefix = 'avis de motion du reglement de zonage numero 1234-5 afin de permettre la construction de logements multiples dans la zone visee par';
  const item = { input: `ouverture de la seance ${prefix} la suite du proces-verbal sans rapport avec la fin inventee` };
  const tail = 'une tour de trente etages avec heliport et casino municipal flambant neuf';
  const q1 = `${prefix} ${tail} variante alpha`;
  const q2 = `${prefix} ${tail} variante beta`;
  assert.equal(locateQuote(item.input, q1).found, false);
  assert.equal(locateQuote(item.input, q2).found, false);
  const v = (quote) => ({ valid: true, quote });
  assert.equal(actMatched(item, [v(q1), v(q2), null]), false);
  const verbatim = 'avis de motion du reglement de zonage numero 1234-5';
  assert.deepEqual(locateQuote(`premiere page\f${item.input}`, verbatim), { found: true, page: 2 });
});

// R2-P2b — revalidate: atomic rewrite, non-zero-exit lots stay inadmissible.
test('R2-P2b revalidate rewrites atomically and keeps failed exits inadmissible', async () => {
  const src = readFileSync(new URL('../l2/revalidate.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('atomicWrite'), 'revalidate must rewrite final lots atomically');
  const { main: revalidate } = await import('../l2/revalidate.mjs');
  const { ANNOTATORS, loadCodes } = await import('../l2/run.mjs');
  const codes = loadCodes();
  const code = [...codes.keys()][0];
  const home = tmp();
  const prev = process.env.CLASSIF_HOME;
  process.env.CLASSIF_HOME = home;
  try {
    const items = [
      { itemId: 'i1', kind: 'signal', anchor: { id: 'n1' }, input: 't1' },
      { itemId: 'i2', kind: 'signal', anchor: { id: 'n2' }, input: 't2' },
    ];
    mkdirSync(path.join(home, 'l0'), { recursive: true });
    writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), `${items.map((i) => JSON.stringify(i)).join('\n')}\n`);
    for (const a of ANNOTATORS) {
      const exitCode = a === ANNOTATORS[0] ? 1 : 0;
      const d = path.join(home, 'l2', 'pass1', a);
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 's001.json'), JSON.stringify({
        pass: 1, annotator: a, lotId: 's001', exitCode, attempts: 3,
        annotations: items.map((i) => ({ itemId: i.itemId, kind: i.kind, valid: true, issues: [], code, verdict: codes.get(code), ambiguous: false, cause: null, quote: null, reason: null, changed: null, quoteFound: null })),
      }));
      const w = path.join(home, 'l1', 'engram-work', 'runs', 'pass1', a);
      mkdirSync(w, { recursive: true });
      writeFileSync(path.join(w, 's001.json'), JSON.stringify({ nodes: [], edges: [] }));
    }
    const stats = await revalidate(['--pass', '1']);
    assert.equal(stats.nonZeroExit, 1);
    const bad = JSON.parse(readFileSync(path.join(home, 'l2', 'pass1', ANNOTATORS[0], 's001.json'), 'utf8'));
    assert.ok(bad.annotations.every((an) => an.valid === false && an.issues.includes('non-zero-exit')));
    const good = JSON.parse(readFileSync(path.join(home, 'l2', 'pass1', ANNOTATORS[2], 's001.json'), 'utf8'));
    assert.ok(good.annotations.every((an) => an.valid === true));
    for (const a of ANNOTATORS) assert.deepEqual(readdirSync(path.join(home, 'l2', 'pass1', a)).filter((f) => f.includes('.tmp-')), []);
  } finally {
    if (prev === undefined) delete process.env.CLASSIF_HOME; else process.env.CLASSIF_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

// R2-P2c — classif-down with a stubbed docker: unreachable daemon fails, absent volume succeeds.
test('R2-P2c classif-down fails when docker is unreachable, succeeds when absent', async () => {
  const mk = readFileSync(new URL('../classif.mk', import.meta.url), 'utf8');
  assert.match(mk, /no such volume/i);
  assert.ok(mk.includes('exit 1'));
  const lines = mk.split('\n');
  const start = lines.findIndex((l) => l.startsWith('classif-down:'));
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (!/^\t/.test(l)) break;
    body.push(l.replace(/^\t/, '').replace(/^@/, ''));
  }
  const script = body.join('\n').split('$(CLASSIF_DEPS_VOLUME)').join('testvol-972').split('$$').join('$');
  const bin = tmp();
  writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
if [ "$1" = "volume" ] && [ "$2" = "inspect" ]; then
  if [ "$DOCKER_STUB_MODE" = "absent" ]; then echo "Error: No such volume: $3" >&2; exit 1; fi
  if [ "$DOCKER_STUB_MODE" = "down" ]; then echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1; fi
  echo '[{"Name":"'"$3"'"}]'; exit 0
fi
if [ "$1" = "volume" ] && [ "$2" = "rm" ]; then echo "$3"; exit 0; fi
exit 0
`, { mode: 0o755 });
  try {
    const run = (mode) => spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_STUB_MODE: mode } });
    const absent = run('absent');
    assert.equal(absent.status, 0);
    assert.match(absent.stdout, /absent/);
    assert.notEqual(run('down').status, 0);
    assert.equal(run('present').status, 0);
  } finally { rmSync(bin, { recursive: true, force: true }); }
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

// R3-P1 — L0 firewall parity: an allowed-city document citing an excluded city and bylaw
// is refused by both scanText (L0) and scanFile (sandbox) with identical hit counts.
test('R3-P1 L0 scanText matches the sandbox scanner on city and bylaw mentions', async () => {
  const { buildFingerprints, scanText } = await import('../lib/fingerprint.mjs');
  const { scanFile } = await import('../guard/sandbox-build.mjs');
  const { fingerprintHits } = await import('../lib/draw.mjs');
  const salt = 'r3-p1-salt';
  const fps = buildFingerprints(salt, {
    nodeIds: ['signal-ville-x-1'], docShas: ['e'.repeat(64)], citySlugs: ['saint-exemple'],
    bylaws: ['9001-1'], inputs: ['un jeu de mots completement different sans rapport avec le texte teste ici presentement'],
  });
  const guard = { salt, fps };
  const text = 'Document de Ville-Autorisee : le proces-verbal cite la ville de Saint-Exemple et le reglement 9001-1 pour comparaison.';
  const a = scanText(salt, fps, text, { citySlugs: ['ville-autorisee'] });
  const b = scanFile(guard, text);
  assert.deepEqual(a, b);
  assert.ok(a.citySlugs > 0, `expected a city hit, got ${JSON.stringify(a)}`);
  assert.ok(a.bylaws > 0, `expected a bylaw hit, got ${JSON.stringify(a)}`);
  assert.equal(a.nodeIds, 0);
  assert.equal(a.docShas, 0);
  const hits = fingerprintHits(guard, text, ['ville-autorisee']);
  assert.ok(hits && hits.citySlugs > 0 && hits.bylaws > 0);
  const clean = 'Document de Ville-Autorisee : proces-verbal local sans mention exterieure ni numero, douze mots neutres pour completer ici presentement.';
  assert.deepEqual(scanText(salt, fps, clean), scanFile(guard, clean));
  assert.equal(fingerprintHits(guard, clean, ['ville-autorisee']), null);
});

// R3-P2 — JSONL resume: a truncated last line is dropped before append, readers stay tolerant.
test('R3-P2 truncated manifest tail is repaired before append and never throws', async () => {
  const { appendJsonlRecord, parseJsonlTolerant, repairTruncatedJsonl } = await import('../lib/jsonl.mjs');
  const { readManifestDone } = await import('../l2/scrape.mjs');
  const { loadComplements } = await import('../l2/converge.mjs');
  const dir = tmp();
  const home = path.join(dir, 'home');
  mkdirSync(path.join(home, 'l2'), { recursive: true });
  const excerptA = path.join(home, 'l2', 'a.excerpt.txt');
  writeFileSync(excerptA, 'extrait A conserve');
  const manifest = path.join(home, 'l2', 'scrape-manifest.jsonl');
  const recA = { itemId: 'a', status: 'ok', url: 'https://x.invalid/a', fetchedAt: '2026-01-01T00:00:00.000Z', sha256: 'a'.repeat(64), excerptPath: excerptA };
  writeFileSync(manifest, `${JSON.stringify(recA)}\n{"itemId":"b","status":"ok","url":`);
  // Tolerant read: the complete record is kept, the truncated tail is skipped, no throw.
  assert.deepEqual([...readManifestDone(manifest)], ['a']);
  assert.doesNotThrow(() => loadComplements(home));
  assert.ok(loadComplements(home).has('a'));
  // Resume: repair drops the partial line, the next append stays a readable record.
  repairTruncatedJsonl(manifest);
  const excerptB = path.join(home, 'l2', 'b.excerpt.txt');
  writeFileSync(excerptB, 'extrait B conserve');
  appendJsonlRecord(manifest, { itemId: 'b', status: 'ok', url: 'https://x.invalid/b', fetchedAt: '2026-01-01T00:00:00.000Z', sha256: 'b'.repeat(64), excerptPath: excerptB });
  const lines = readFileSync(manifest, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => JSON.parse(l).itemId).sort(), ['a', 'b']);
  assert.deepEqual([...readManifestDone(manifest)].sort(), ['a', 'b']);
  assert.doesNotThrow(() => loadComplements(home));
  assert.deepEqual([...loadComplements(home).keys()].sort(), ['a', 'b']);
  assert.deepEqual(parseJsonlTolerant('{"x":1}\n{"x":'), [{ x: 1 }]);
  rmSync(dir, { recursive: true, force: true });
});

// R3-P3 — EPIPE on child.stdin fails that call only, never the runner.
test('R3-P3 early seat exit (EPIPE on stdin) resolves as a call failure', async () => {
  const { callSeat } = await import('../run-seat.mjs');
  const epipeChild = () => {
    const child = new EventEmitter();
    child.pid = 99998;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const stdin = new EventEmitter();
    // Sync emit: the call attaches the stdin error handler before end(), so the
    // EPIPE is recorded; close follows so the call resolves as a failure.
    stdin.end = () => { stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); };
    child.stdin = stdin;
    child.kill = () => true;
    setTimeout(() => { child.emit('close', 1); }, 20);
    return child;
  };
  const base = tmp();
  const r1 = await callSeat('muse-wonder-max', 'prompt', { base, timeoutMs: 5000, closeGraceMs: 2000, spawnImpl: () => epipeChild() });
  assert.equal(r1.code, 1);
  assert.match(String(r1.stderrTail ?? ''), /EPIPE/);
  // The runner survives: a second call after the EPIPE still resolves.
  const r2 = await callSeat('muse-wonder-max', 'prompt', { base, timeoutMs: 5000, closeGraceMs: 2000, spawnImpl: () => epipeChild() });
  assert.equal(r2.code, 1);
  rmSync(base, { recursive: true, force: true });
});
