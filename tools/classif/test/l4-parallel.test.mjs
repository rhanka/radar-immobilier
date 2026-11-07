// L4 seat-family parallelism (dev + blind): hermetic. Seats are faked by PATH
// binaries (muse, claude, vibe, agy) that sleep then answer; temp CLASSIF_HOME in
// test mode, temp repo via CLASSIF_REPO, temp eval dir. No paid call, never the
// real data dir. The order of the calls log (intent before / result after every
// seat call, appended synchronously) is the observed timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCodes } from '../l2/run.mjs';
import { SEAT_FAMILY_ORDER, groupRoutesByFamily, runFamiliesParallel, seatFamily } from '../l4/families.mjs';
import { EVAL_ROUTES } from '../l4/dev.mjs';
import { commitAll, initTempRepo, readFixture, swapEnv, tmp, withTempHome, writeRepoFile, writeSeriesRepo } from './hermetic-helpers.mjs';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const SEATS = ['muse', 'claude', 'vibe', 'agy'];
const NON_PERTINENT = [...loadCodes()].find(([, v]) => v === 'non_pertinent')[0];

/**
 * One fake script installed as muse, claude, vibe and agy. It reads the prompt
 * (--prompt-file or stdin), sleeps, then answers in the seat's own format.
 * Deterministic per (route, item): mistral answers an unknown code (failed rows),
 * opus medium answers non_pertinent on odd items (mismatches), others P-DENSITE.
 * Every invocation is counted in `counter`.
 */
function fakeSeats(counter, sleep = '0.15') {
  const bin = tmp('l4par-bin-');
  const script = `#!/bin/sh
name=$(basename "$0")
echo x >> "${counter}"
pf=""; prev=""
for a in "$@"; do [ "$prev" = "--prompt-file" ] && pf="$a"; prev="$a"; done
if [ -n "$pf" ]; then body=$(cat "$pf"); else body=$(cat); fi
sleep ${sleep}
id=$(printf '%s' "$body" | grep -o 'item_id: [A-Za-z0-9._-]*' | head -1 | cut -d' ' -f2)
verdict=pertinent; code=P-DENSITE
case "$VIBE_ACTIVE_MODEL" in *mistral*) code=X-NOPE ;; esac
if [ "$name" = claude ]; then
  case " $* " in *" --effort medium "*) case "$id" in *[13579]) verdict=non_pertinent; code=${NON_PERTINENT} ;; esac ;; esac
fi
esc=$(printf '{"verdict":"%s","code":"%s"}' "$verdict" "$code" | sed 's/"/\\\\"/g')
case "$name" in
  claude) printf '{"result":"%s","total_cost_usd":0.01,"usage":{"input_tokens":3}}' "$esc" ;;
  vibe) printf '[{"role":"assistant","type":"message","content":[{"type":"text","text":"%s"}]}]' "$esc" ;;
  muse) printf '{"terminal":"completed","text":"%s"}\\n' "$esc" ;;
  agy) printf '{"event":"result","result":{"response":"%s"}}\\n' "$esc" ;;
esac
exit 0
`;
  for (const name of SEATS) {
    const f = path.join(bin, name);
    writeFileSync(f, script, { mode: 0o755 });
    chmodSync(f, 0o755);
  }
  const restore = swapEnv('PATH', `${bin}:${process.env.PATH}`);
  return { bin, restore: () => { restore(); rmSync(bin, { recursive: true, force: true }); } };
}

const invocations = (counter) => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
const callsLog = (home) => {
  const f = path.join(home, 'l2', 'calls.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

/** Sweep of the calls log: per-family max in flight, global max, per-route [first intent, last result] indices. */
function timeline(calls) {
  const inFlight = {};
  const maxFamily = {};
  let global = 0;
  let maxGlobal = 0;
  const span = {};
  calls.forEach((c, i) => {
    const fam = seatFamily(c.route);
    span[c.route] ??= { start: Infinity, end: -1 };
    if (c.intent) {
      inFlight[fam] = (inFlight[fam] ?? 0) + 1;
      global++;
      span[c.route].start = Math.min(span[c.route].start, i);
    } else {
      inFlight[fam]--;
      global--;
      span[c.route].end = Math.max(span[c.route].end, i);
    }
    maxFamily[fam] = Math.max(maxFamily[fam] ?? 0, inFlight[fam]);
    maxGlobal = Math.max(maxGlobal, global);
  });
  return { maxFamily, maxGlobal, span };
}
const overlap = (a, b) => a.start < b.end && b.start < a.end;

/** Dev home: n tuning items (refs pertinent/P-DENSITE), fingerprints, temp series repo for all routes. */
async function setupDev(home, n = 4) {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const items = Array.from({ length: n }, (_, i) => ({ itemId: `par-i${i + 1}`, kind: 'signal',
    anchor: { id: `n${i + 1}`, citySlug: 'ville-test' },
    input: `avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier par-${i + 1}.` }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), body);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: items.length, sha256: sha256(body) }));
  mkdirSync(path.join(home, 'l3b'), { recursive: true });
  const ref = items.map((i) => ({ itemId: i.itemId, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved', half: 'tuning' }));
  writeFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), `${ref.map((r) => JSON.stringify(r)).join('\n')}\n`);
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'par-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('par-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif parallele'] })));
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  writeSeriesRepo({ repo, k: '98', routes: EVAL_ROUTES, tuningIds: items.map((i) => i.itemId), blindIds: ['par-blind-1'],
    promptText: readFixture('l4/prompts/P98.md'), supports: { recall: 30, precision: 30 } });
  return { items, repo, cleanup: () => { restoreRepo(); rmSync(repo, { recursive: true, force: true }); } };
}

/** Reads every private dev output + the repo manifest (createdAt dropped). */
function devOutputs(home, repo) {
  const dir = path.join(home, 'l4', 'series-98');
  const files = Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(path.join(dir, f), 'utf8')]));
  const manifest = JSON.parse(readFileSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', 'series-98-dev.json'), 'utf8'));
  delete manifest.createdAt;
  return { files, manifest };
}

/** Order-free view of the calls log (at/latency dropped). */
const callsMultiset = (calls) => calls.map((c) => JSON.stringify({ ...c, at: undefined, latencyMs: undefined })).sort();

async function runDev(argv, { sleep } = {}) {
  let out;
  await withTempHome(async (home) => {
    const setup = await setupDev(home);
    const counter = path.join(home, 'seat-count');
    const fb = fakeSeats(counter, sleep);
    try {
      const { main: devMain } = await import('../l4/dev.mjs');
      const manifest = await devMain(['--series', '98', '--concurrency', '2', ...argv]);
      out = { manifest, outputs: devOutputs(home, setup.repo), calls: callsLog(home), invocations: invocations(counter) };
    } finally {
      fb.restore();
      setup.cleanup();
    }
  })();
  return out;
}

test('l4 families: routes grouped by seat family, input order kept inside a family', () => {
  const groups = groupRoutesByFamily(EVAL_ROUTES);
  assert.deepEqual(groups, [
    { family: 'muse', routes: ['muse-spark-1.3-low', 'muse-spark-1.3-medium'] },
    { family: 'claude', routes: ['opus-5.5-low', 'opus-5.5-medium'] },
    { family: 'vibe', routes: ['mistral-large-4-medium', 'glm-5.3-low'] },
    { family: 'agy', routes: ['gemini-4-argon-low', 'gemini-4-argon-medium'] },
  ]);
  assert.deepEqual(SEAT_FAMILY_ORDER, ['muse', 'claude', 'vibe', 'agy']);
  assert.equal(seatFamily('astra-max'), 'other', 'an unknown prefix never joins a known seat family');
  assert.deepEqual(groupRoutesByFamily(['glm-5.3-low']), [{ family: 'vibe', routes: ['glm-5.3-low'] }]);
  assert.deepEqual(groupRoutesByFamily([]), []);
});

test('l4 families: a failed family does not cancel the others, first error rethrown after all settle', async () => {
  const done = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (route) => {
    if (route === 'opus-5.5-low') { await sleep(5); throw new Error('claude family down'); }
    await sleep(20);
    done.push(route);
    return route.toUpperCase();
  };
  await assert.rejects(runFamiliesParallel(groupRoutesByFamily(EVAL_ROUTES), run), /claude family down/);
  assert.ok(!done.includes('opus-5.5-medium'), 'routes after the failure inside the failed family do not start');
  for (const r of EVAL_ROUTES.filter((x) => !x.startsWith('opus-'))) assert.ok(done.includes(r), `${r} (other family) still completes`);
  const ok = await runFamiliesParallel(groupRoutesByFamily(['glm-5.3-low', 'opus-5.5-low']), async (r) => r.length);
  assert.deepEqual([...ok.entries()].sort(), [['glm-5.3-low', 11], ['opus-5.5-low', 12]]);
});

test('l4 dev parallel: families overlap in time, routes of one family never overlap, per-seat limit 2', async () => {
  const par = await runDev([]);
  const { maxFamily, maxGlobal, span } = timeline(par.calls);
  for (const fam of SEAT_FAMILY_ORDER) assert.ok(maxFamily[fam] <= 2, `family ${fam} in flight ${maxFamily[fam]} > 2`);
  assert.ok(maxGlobal > 2, `families must run concurrently (max in flight ${maxGlobal})`);
  for (const { routes } of groupRoutesByFamily(EVAL_ROUTES)) {
    assert.ok(span[routes[0]].end < span[routes[1]].start, `${routes[0]} must finish before ${routes[1]} starts`);
  }
  const groups = groupRoutesByFamily(EVAL_ROUTES);
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      assert.ok(overlap(span[groups[a].routes[0]], span[groups[b].routes[0]]),
        `first routes of ${groups[a].family} and ${groups[b].family} must overlap in time`);
    }
  }
  // Intent before every paid call: each result follows its own intent.
  const seen = new Set();
  for (const c of par.calls) {
    const key = `${c.route}|${c.itemId}`;
    if (c.intent) seen.add(key); else assert.ok(seen.has(key), `result without prior intent ${key}`);
  }
  assert.equal(par.invocations, EVAL_ROUTES.length * 4);
});

test('l4 dev parallel: outputs, caches, calls log and manifest identical to --sequential', async () => {
  const seq = await runDev(['--sequential']);
  const par = await runDev([]);
  // The sequential run really is one route at a time.
  assert.equal(timeline(seq.calls).maxGlobal, 2);
  assert.deepEqual(Object.keys(par.outputs.files), Object.keys(seq.outputs.files));
  for (const f of Object.keys(seq.outputs.files)) assert.equal(par.outputs.files[f], seq.outputs.files[f], `private file ${f} differs`);
  assert.deepEqual(par.outputs.manifest, seq.outputs.manifest);
  assert.deepEqual(Object.keys(par.manifest.aggregates), EVAL_ROUTES.filter((r) => par.manifest.aggregates[r]), 'aggregates keep the route order');
  assert.deepEqual(callsMultiset(par.calls), callsMultiset(seq.calls));
  // The fixture is not trivial: failures, mismatches and costs are present.
  assert.equal(seq.manifest.aggregates['mistral-large-4-medium'].failures, 4);
  assert.ok(JSON.parse(seq.outputs.files['errors.json'])['opus-5.5-medium'].length > 0);
  assert.ok(seq.manifest.aggregates['opus-5.5-low'].costUsd > 0);
});

test('l4 dev parallel: budget refusal stops every family before any seat call', withTempHome(async (home) => {
  const setup = await setupDev(home);
  const counter = path.join(home, 'seat-count');
  const fb = fakeSeats(counter);
  try {
    mkdirSync(path.join(home, 'l2'), { recursive: true });
    const { BUDGET_CAP } = await import('../lib/budget.mjs');
    const line = `${JSON.stringify({ intent: true, phase: 'filler' })}\n`;
    appendFileSync(path.join(home, 'l2', 'calls.jsonl'), line.repeat(BUDGET_CAP - 5));
    const before = callsLog(home).length;
    const { main: devMain } = await import('../l4/dev.mjs');
    await assert.rejects(devMain(['--series', '98', '--concurrency', '2']), /pilot budget refused/);
    assert.equal(invocations(counter), 0, 'no seat call in any family');
    assert.equal(callsLog(home).length, before, 'no new intent in any family');
    assert.ok(!existsSync(path.join(home, 'l4', 'series-98')) || readdirSync(path.join(home, 'l4', 'series-98')).length === 0);
  } finally {
    fb.restore();
    setup.cleanup();
  }
}));

// ---- blind: fresh multi-family run (blind half + S113) ----

const BLIND_ROUTES = ['opus-5.5-low', 'opus-5.5-medium', 'mistral-large-4-medium', 'glm-5.3-low', 'muse-spark-1.3-low'];

async function setupBlind(home) {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { newKey } = await import('./fixture.mjs');
  const { sealToFile } = await import('../lib/refc1.mjs');
  const { Buffer } = await import('node:buffer');
  const blindIds = ['bpar-1', 'bpar-2', 'bpar-3'];
  const blindRows = blindIds.map((id) => ({ itemId: id, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved' }));
  const corpus = blindRows.map((r) => ({ itemId: r.itemId, kind: 'signal', anchor: { id: `n-${r.itemId}`, citySlug: 'v' }, input: `texte blind ${r.itemId} six logements zone H-9.` }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const cbody = `${corpus.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), cbody);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: corpus.length, sha256: sha256(cbody) }));
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'par-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('par-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif blind par'] })));
  // Fixed keys: two homes seal the same plaintext (sealed bytes may differ, hashes of plaintext do not).
  const restores = [swapEnv('CLASSIF_ROLE', 'test-executor'), swapEnv('CLASSIF_ACTOR', 'l4par-test'),
    swapEnv('CLASSIF_BLIND_KEY', newKey().toString('base64'))];
  const evalKey = newKey();
  restores.push(swapEnv('CLASSIF_EVAL_KEY', evalKey.toString('base64')));
  const { sealBlindSet } = await import('../lib/blind.mjs');
  const seal = sealBlindSet(blindRows, { home, env: process.env });
  const promptText = readFixture('l4/prompts/P98.md');
  const repo = initTempRepo();
  restores.push(swapEnv('CLASSIF_REPO', repo));
  const { promptSha256 } = writeSeriesRepo({ repo, k: '98', routes: BLIND_ROUTES, tuningIds: ['par-tuning-1'],
    blindIds, promptText, supports: { recall: 30, precision: 30 } });
  writeRepoFile(repo, 'tools/classif/l4/manifests/series-98-dev.json', JSON.stringify({ kind: 'l4-dev', series: '98', promptSha256, routes: BLIND_ROUTES }));
  writeRepoFile(repo, 'tools/classif/l3/manifests/reference-d.json', JSON.stringify({ hashes: { blindPlain: seal.plainSha256, blindSealed: seal.sealedSha256 } }));
  commitAll(repo);
  const evalDir = tmp('l4par-eval-');
  restores.push(swapEnv('CLASSIF_EVAL_DIR', evalDir));
  const rows = ['eval-1', 'eval-2'].map((evalId) => ({ evalId, input: `avis de motion, dossier ${evalId}, six logements zone H-9.`, verdict: 'pertinent', code: 'P-DENSITE' }));
  const inBlob = Buffer.from(`${rows.map((r) => JSON.stringify({ evalId: r.evalId, input: r.input })).join('\n')}\n`);
  const exBlob = Buffer.from(`${rows.map((r) => JSON.stringify({ evalId: r.evalId, verdict: r.verdict, code: r.code })).join('\n')}\n`);
  const inR = sealToFile(evalKey, inBlob, path.join(evalDir, 'eval-inputs.jsonl.sealed'));
  const exR = sealToFile(evalKey, exBlob, path.join(evalDir, 'eval-expected.jsonl.sealed'));
  writeFileSync(path.join(evalDir, 'README.md'),
    `| Sealed file | Content | SHA-256 of plaintext |\n|---|---|---|\n| \`eval-inputs.jsonl.sealed\` | x | \`${inR.plainSha256}\` |\n| \`eval-expected.jsonl.sealed\` | x | \`${exR.plainSha256}\` |\n`);
  const cleanup = () => {
    while (restores.length) restores.pop()();
    rmSync(repo, { recursive: true, force: true });
    rmSync(evalDir, { recursive: true, force: true });
  };
  return { repo, evalDir, cleanup };
}

const auditView = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .map((e) => JSON.stringify({ ...e, at: undefined })).sort();

async function runBlind(argv, { budgetFill = 0 } = {}) {
  let out;
  await withTempHome(async (home) => {
    const setup = await setupBlind(home);
    const counter = path.join(home, 'seat-count');
    const fb = fakeSeats(counter, '0.1');
    try {
      if (budgetFill) {
        mkdirSync(path.join(home, 'l2'), { recursive: true });
        appendFileSync(path.join(home, 'l2', 'calls.jsonl'), `${JSON.stringify({ intent: true, phase: 'filler' })}\n`.repeat(budgetFill));
      }
      const { main: blindMain } = await import('../l4/blind.mjs');
      const { blindDir } = await import('../lib/blind.mjs');
      const skip = EVAL_ROUTES.filter((r) => !BLIND_ROUTES.includes(r));
      const callsBefore = callsLog(home).length;
      let manifest = null;
      let error = null;
      try { manifest = await blindMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '2', ...argv]); }
      catch (e) { error = e; }
      const bdir = blindDir(home);
      const aggFile = path.join(bdir, 'series-98-aggregates.json');
      out = { manifest, error, calls: callsLog(home).slice(callsBefore), invocations: invocations(counter),
        aggregates: existsSync(aggFile) ? JSON.parse(readFileSync(aggFile, 'utf8')) : null,
        blindAudit: readdirSync(bdir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => auditView(path.join(bdir, f))
          .filter((l) => /blind-run/.test(l))),
        evalAudit: existsSync(path.join(setup.evalDir, 'access-log.jsonl')) ? auditView(path.join(setup.evalDir, 'access-log.jsonl')) : [] };
    } finally {
      fb.restore();
      setup.cleanup();
    }
  })();
  return out;
}

test('l4 blind parallel: aggregates, audit lines and calls identical to --sequential, families overlap', async () => {
  const seq = await runBlind(['--sequential']);
  const par = await runBlind([]);
  assert.equal(seq.error, null, seq.error?.stack);
  assert.equal(par.error, null, par.error?.stack);
  assert.equal(par.manifest.aggregatesSha256, seq.manifest.aggregatesSha256);
  assert.deepEqual(par.aggregates, seq.aggregates);
  assert.deepEqual(Object.keys(par.aggregates.perRoute), EVAL_ROUTES.filter((r) => BLIND_ROUTES.includes(r)), 'perRoute keeps the route order');
  assert.deepEqual(par.blindAudit, seq.blindAudit);
  assert.equal(par.blindAudit.filter((l) => l.includes('"blind-run"')).length, BLIND_ROUTES.length);
  assert.deepEqual(par.evalAudit.filter((l) => l.includes('"eval-run"')), seq.evalAudit.filter((l) => l.includes('"eval-run"')));
  assert.deepEqual(callsMultiset(par.calls), callsMultiset(seq.calls));
  assert.equal(timeline(seq.calls).maxGlobal, 2);
  const t = timeline(par.calls);
  assert.ok(t.maxGlobal > 2, `blind families must run concurrently (max ${t.maxGlobal})`);
  for (const fam of ['muse', 'claude', 'vibe']) assert.ok(t.maxFamily[fam] <= 2);
  assert.equal(par.aggregates.perRoute['mistral-large-4-medium'].failures, 3, 'fixture carries failures');
});

test('l4 blind parallel: budget refusal stops every family before any seat call or run audit', async () => {
  const { BUDGET_CAP } = await import('../lib/budget.mjs');
  const r = await runBlind([], { budgetFill: BUDGET_CAP - 3 });
  assert.match(String(r.error?.message), /pilot budget refused/);
  assert.equal(r.invocations, 0, 'no seat call in any family');
  assert.equal(r.calls.length, 0, 'no new intent in any family');
  assert.deepEqual(r.blindAudit, [], 'no blind-run-started in any family');
});
