// L4 blind infrastructure re-run (--rerun-infra-failed): hermetic. Seats are faked by
// PATH binaries; the vibe routes fail with exit 2 (HTTP 402 budget exhausted) unless the
// item id is listed in FAKE_GLM / FAKE_MISTRAL ("ok" = every item answers). Temp
// CLASSIF_HOME in test mode, temp repo via CLASSIF_REPO, temp eval dir. 252 blind items
// so the 1% rule reads as in production (at most 2 answered).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { EVAL_ROUTES } from '../l4/dev.mjs';
import { REPO_ROOT, commitAll, initTempRepo, readFixture, swapEnv, tmp, withTempHome, writeRepoFile, writeSeriesRepo } from './hermetic-helpers.mjs';

const K = '97';
const ROUTES3 = ['opus-5.5-low', 'mistral-large-4-medium', 'glm-5.3-low'];
const SKIP = EVAL_ROUTES.filter((r) => !ROUTES3.includes(r));
const N = 252;
const IDS = Array.from({ length: N }, (_, i) => `b-${String(i + 1).padStart(3, '0')}`);

function fakeSeats() {
  const bin = tmp('l4rerun-bin-');
  const script = `#!/bin/sh
name=$(basename "$0")
pf=""; prev=""
for a in "$@"; do [ "$prev" = "--prompt-file" ] && pf="$a"; prev="$a"; done
if [ -n "$pf" ]; then body=$(cat "$pf"); else body=$(cat); fi
id=$(printf '%s' "$body" | grep -o 'item_id: [A-Za-z0-9._-]*' | head -1 | cut -d' ' -f2)
mode=ok
case "$VIBE_ACTIVE_MODEL" in *glm*) mode="$FAKE_GLM" ;; *mistral*) mode="$FAKE_MISTRAL" ;; esac
if [ "$mode" != ok ]; then
  case " $mode " in *" $id "*) ;; *) echo "HTTP 402 budget exhausted" >&2; exit 2 ;; esac
fi
esc=$(printf '{"verdict":"pertinent","code":"P-DENSITE"}' | sed 's/"/\\\\"/g')
case "$name" in
  claude) printf '{"result":"%s","total_cost_usd":0.01,"usage":{"input_tokens":3}}' "$esc" ;;
  vibe) printf '[{"role":"assistant","type":"message","content":[{"type":"text","text":"%s"}]}]' "$esc" ;;
  muse) printf '{"terminal":"completed","text":"%s"}\\n' "$esc" ;;
  agy) printf '{"event":"result","result":{"response":"%s"}}\\n' "$esc" ;;
esac
exit 0
`;
  for (const name of ['muse', 'claude', 'vibe', 'agy']) {
    const f = path.join(bin, name);
    writeFileSync(f, script, { mode: 0o755 });
    chmodSync(f, 0o755);
  }
  const restore = swapEnv('PATH', `${bin}:${process.env.PATH}`);
  return () => { restore(); rmSync(bin, { recursive: true, force: true }); };
}

async function setup(home) {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { newKey } = await import('./fixture.mjs');
  const { sealToFile } = await import('../lib/refc1.mjs');
  const { sealBlindSet } = await import('../lib/blind.mjs');
  const blindRows = IDS.map((id) => ({ itemId: id, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved' }));
  const corpus = IDS.map((id) => ({ itemId: id, kind: 'signal', anchor: { id: `n-${id}`, citySlug: 'v' }, input: `texte blind ${id} six logements zone H-9.` }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const cbody = `${corpus.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), cbody);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: corpus.length, sha256: sha256(cbody) }));
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'rr-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('rr-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif rerun'] })));
  const evalKey = newKey();
  const restores = [swapEnv('CLASSIF_ROLE', 'test-executor'), swapEnv('CLASSIF_ACTOR', 'l4rerun-test'),
    swapEnv('CLASSIF_BLIND_KEY', newKey().toString('base64')), swapEnv('CLASSIF_EVAL_KEY', evalKey.toString('base64'))];
  const seal = sealBlindSet(blindRows, { home, env: process.env });
  const repo = initTempRepo();
  restores.push(swapEnv('CLASSIF_REPO', repo));
  const { promptSha256 } = writeSeriesRepo({ repo, k: K, routes: ROUTES3, tuningIds: ['rr-tuning-1'], blindIds: IDS,
    promptText: readFixture('l4/prompts/P98.md'), supports: { recall: 30, precision: 30 } });
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${K}-dev.json`, JSON.stringify({ kind: 'l4-dev', series: K, promptSha256, routes: ROUTES3 }));
  writeRepoFile(repo, 'tools/classif/l3/manifests/reference-d.json', JSON.stringify({ hashes: { blindPlain: seal.plainSha256, blindSealed: seal.sealedSha256 } }));
  commitAll(repo);
  const evalDir = tmp('l4rerun-eval-');
  restores.push(swapEnv('CLASSIF_EVAL_DIR', evalDir));
  const rows = ['eval-1', 'eval-2'].map((evalId) => ({ evalId, input: `avis de motion, dossier ${evalId}, six logements zone H-9.` }));
  const inR = sealToFile(evalKey, Buffer.from(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`), path.join(evalDir, 'eval-inputs.jsonl.sealed'));
  const exR = sealToFile(evalKey, Buffer.from(`${rows.map((r) => JSON.stringify({ evalId: r.evalId, verdict: 'pertinent', code: 'P-DENSITE' })).join('\n')}\n`),
    path.join(evalDir, 'eval-expected.jsonl.sealed'));
  writeFileSync(path.join(evalDir, 'README.md'),
    `| Sealed file | Content | SHA-256 of plaintext |\n|---|---|---|\n| \`eval-inputs.jsonl.sealed\` | x | \`${inR.plainSha256}\` |\n| \`eval-expected.jsonl.sealed\` | x | \`${exR.plainSha256}\` |\n`);
  const restoreSeats = fakeSeats();
  return { repo, cleanup: () => { restoreSeats(); while (restores.length) restores.pop()(); rmSync(repo, { recursive: true, force: true }); rmSync(evalDir, { recursive: true, force: true }); } };
}

const callsOf = (home) => {
  const f = path.join(home, 'l2', 'calls.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const auditOf = (home) => readFileSync(path.join(home, 'blind', 'access-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const blindIntents = (calls, route) => calls.filter((c) => c.intent && c.phase === `l4-blind-s${K}` && c.route === route).length;

/** One blind pass with the vibe seats in the given modes. Returns { manifest, error, calls (new) }. */
async function pass(home, { glm = 'ok', mistral = 'ok', argv = [] } = {}) {
  const r1 = swapEnv('FAKE_GLM', glm);
  const r2 = swapEnv('FAKE_MISTRAL', mistral);
  const before = callsOf(home).length;
  const { main } = await import('../l4/blind.mjs');
  let manifest = null;
  let error = null;
  try { manifest = await main(['--series', K, '--deferred', SKIP.join(','), '--concurrency', '8', ...argv]); }
  catch (e) { error = e; }
  finally { r1(); r2(); }
  return { manifest, error, calls: callsOf(home).slice(before) };
}
const aggregates = (home) => JSON.parse(readFileSync(path.join(home, 'blind', `series-${K}-aggregates.json`), 'utf8'));
const SCORE_KEYS = ['perRoute', 's113', '"stats"', 'recall', 'precision', '"failures"', 'verdict', 'withUnresolved'];

test('infra re-run: allowed at <= 2 answered, archives, audits, reuses caches, recomputes aggregates; refused a second time', withTempHome(async (home) => {
  const s = await setup(home);
  try {
    // Series pass 1: glm answers nothing, mistral answers 2 of 252 (the 1% bound).
    const first = await pass(home, { glm: 'fail', mistral: 'fail b-001 b-002' });
    assert.equal(first.error, null, first.error?.stack);
    const agg1 = aggregates(home);
    assert.equal(agg1.perRoute['glm-5.3-low'].failures, N);
    assert.equal(agg1.perRoute['mistral-large-4-medium'].failures, N - 2);
    assert.ok(!('infraReruns' in first.manifest));
    // A plain re-run skips every route (completed audits), as before.
    const plain = await pass(home);
    assert.equal(plain.error, null, plain.error?.stack);
    assert.equal(plain.calls.length, 0, 'a plain re-run makes no seat call');
    assert.equal(plain.manifest.aggregatesSha256, first.manifest.aggregatesSha256);

    const re = await pass(home, { argv: ['--rerun-infra-failed', 'glm-5.3-low,mistral-large-4-medium'] });
    assert.equal(re.error, null, re.error?.stack);
    assert.equal(blindIntents(re.calls, 'opus-5.5-low'), 0, 'the other route is not re-run');
    assert.equal(blindIntents(re.calls, 'glm-5.3-low'), N);
    assert.equal(blindIntents(re.calls, 'mistral-large-4-medium'), N - 2, 'cached answers are reused, failures retried');
    assert.equal(re.calls.filter((c) => c.phase !== `l4-blind-s${K}`).length, 0, 'S113 is not re-run');
    const agg2 = aggregates(home);
    assert.notEqual(re.manifest.aggregatesSha256, first.manifest.aggregatesSha256, 'aggregates sha recomputed');
    assert.equal(agg2.aggregatesSha256, re.manifest.aggregatesSha256);
    assert.equal(agg2.perRoute['glm-5.3-low'].failures, 0);
    assert.equal(agg2.perRoute['mistral-large-4-medium'].failures, 0);
    assert.deepEqual(agg2.perRoute['opus-5.5-low'], agg1.perRoute['opus-5.5-low']);
    assert.deepEqual(agg2.s113, agg1.s113);
    // Archives (mode 600) and audit trail.
    const files = readdirSync(path.join(home, 'blind'));
    for (const route of ['glm-5.3-low', 'mistral-large-4-medium']) {
      const arch = files.filter((f) => new RegExp(`^series-${K}-${route.replace(/\./g, '\\.')}\\.infra-failed\\..+\\.json$`).test(f));
      assert.equal(arch.length, 1, `one archive for ${route}`);
      assert.equal(statSync(path.join(home, 'blind', arch[0])).mode & 0o777, 0o600);
    }
    assert.equal(files.filter((f) => f.includes('opus-5.5-low.infra-failed')).length, 0);
    const log = auditOf(home);
    const allow = log.filter((e) => e.action === 'blind-rerun-infra');
    assert.deepEqual(allow.map((e) => [e.route, e.previousAnswered]).sort(), [['glm-5.3-low', 0], ['mistral-large-4-medium', 2]]);
    const glmAllow = allow.find((e) => e.route === 'glm-5.3-low');
    assert.deepEqual(glmAllow.counts.exitCodes, { 2: N });
    assert.equal(glmAllow.counts.callsAnswered, 0);
    assert.match(glmAllow.reason, /exit codes 2x252/);
    const { ROUTES } = await import('../run-seat.mjs');
    const runsOf = (route) => log.filter((e) => e.action === 'blind-run' && e.model === ROUTES[route].model && e.effort === ROUTES[route].effort).length;
    assert.equal(log.filter((e) => e.action === 'blind-run').length, 5, '3 first runs + 2 infra re-runs');
    assert.equal(log.filter((e) => e.action === 'blind-run' && e.infraRerun).length, 2);
    assert.deepEqual(ROUTES3.map(runsOf), [1, 2, 2]);
    // Repo manifest: infraReruns, no score.
    const repoManifest = JSON.parse(readFileSync(path.join(s.repo, 'tools', 'classif', 'l4', 'manifests', `series-${K}-blind.json`), 'utf8'));
    assert.deepEqual(repoManifest.infraReruns.map((e) => [e.route, e.previousAnswered]).sort(), [['glm-5.3-low', 0], ['mistral-large-4-medium', 2]]);
    for (const e of repoManifest.infraReruns) assert.deepEqual(Object.keys(e).sort(), ['previousAnswered', 'reason', 'route']);
    const blob = JSON.stringify(repoManifest);
    for (const bad of SCORE_KEYS) assert.ok(!blob.includes(bad), `repo manifest must not contain ${bad}`);
    // A later plain pass keeps infraReruns (read from the audit) and re-runs nothing.
    const after = await pass(home);
    assert.equal(after.calls.length, 0);
    assert.equal(after.manifest.aggregatesSha256, re.manifest.aggregatesSha256);
    assert.equal(after.manifest.infraReruns.length, 2);
    // Second infra re-run: refused, typed, nothing called or written.
    const acts = () => auditOf(home).filter((e) => e.action !== 'open-blind-set').length;
    const actsBefore = acts();
    const again = await pass(home, { argv: ['--rerun-infra-failed', 'glm-5.3-low'] });
    assert.equal(again.error?.name, 'BlindRerunRefused');
    assert.equal(again.error?.code, 'already-rerun');
    assert.equal(again.calls.length, 0);
    assert.equal(acts(), actsBefore, 'no new run or re-run audit');
  } finally { s.cleanup(); }
}));

test('infra re-run: refused when the previous run answered more than 2 of 252', withTempHome(async (home) => {
  const s = await setup(home);
  try {
    const first = await pass(home, { glm: 'fail', mistral: 'fail b-001 b-002 b-003' });
    assert.equal(first.error, null, first.error?.stack);
    const filesBefore = readdirSync(path.join(home, 'blind')).sort();
    const re = await pass(home, { argv: ['--rerun-infra-failed', 'glm-5.3-low,mistral-large-4-medium'] });
    assert.equal(re.error?.name, 'BlindRerunRefused');
    assert.equal(re.error?.code, 'answered-above-threshold');
    assert.match(re.error.message, /mistral-large-4-medium answered 3 of 252/);
    assert.equal(re.calls.length, 0, 'fail closed: no seat call for any route');
    assert.deepEqual(readdirSync(path.join(home, 'blind')).sort(), filesBefore, 'nothing archived');
    assert.equal(auditOf(home).filter((e) => e.action === 'blind-rerun-infra').length, 0);
    // A route that answered everything is refused as well.
    const opus = await pass(home, { argv: ['--rerun-infra-failed', 'opus-5.5-low'] });
    assert.equal(opus.error?.code, 'answered-above-threshold');
    // Unknown or deferred routes are refused before anything.
    const unknown = await pass(home, { argv: ['--rerun-infra-failed', 'gemini-4-argon-low'] });
    assert.equal(unknown.error?.code, 'not-a-route');
  } finally { s.cleanup(); }
}));

test('infra re-run: refused when calls.jsonl does not corroborate the route file', withTempHome(async (home) => {
  const s = await setup(home);
  try {
    const first = await pass(home, { glm: 'fail' });
    assert.equal(first.error, null, first.error?.stack);
    // Drop the glm terminal records: the route file failures are no longer backed by seat exit codes.
    const f = path.join(home, 'l2', 'calls.jsonl');
    const kept = callsOf(home).filter((c) => !(c.route === 'glm-5.3-low' && c.intent === false));
    writeFileSync(f, `${kept.map((c) => JSON.stringify(c)).join('\n')}\n`);
    const re = await pass(home, { argv: ['--rerun-infra-failed', 'glm-5.3-low'] });
    assert.equal(re.error?.code, 'calls-mismatch');
    assert.equal(re.calls.length, 0);
  } finally { s.cleanup(); }
}));

test('classif.mk wires RERUN_INFRA_FAILED to classif-l4-blind', () => {
  const dry = (vars) => spawnSync('make', ['-s', '-n', '-f', 'tools/classif/classif.mk', 'classif-l4-blind', 'SERIES=1', 'CLASSIF_ROLE=test-executor', ...vars, 'ENV=preprod'],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CLASSIF_HOME: tmp('mk-home-') } });
  const on = dry(['RERUN_INFRA_FAILED=glm-5.3-low,mistral-large-4-medium']);
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /l4\/blind\.mjs --series 1 .*--rerun-infra-failed glm-5\.3-low,mistral-large-4-medium/);
  const off = dry([]);
  assert.equal(off.status, 0, off.stderr);
  assert.ok(!off.stdout.includes('--rerun-infra-failed'));
});
