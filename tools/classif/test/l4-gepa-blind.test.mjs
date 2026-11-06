// GEPA series in dev and blind (series-<k>.json method gepa): hermetic, fake data only
// (l4-blind-fixture.mjs PATH seats + a fake `codex` for sol-6.1-low / luna-6-low). The blind
// verdict passes only with 0 blind miss on each of the 5 GEPA routes and a call failure share
// <= 5 %; precision is reported in the private aggregates, never a floor. Classic series are
// unchanged (their own tests run as before).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { GEPA_ROUTES } from '../l4/gepa-common.mjs';
import { buildBlindManifest, gepaBlindRouteGate } from '../l4/blind.mjs';
import { commitAll, swapEnv, tmp, withTempHome, writeRepoFile } from './hermetic-helpers.mjs';
import { SCORE_KEYS, blindIds, blindPass, readAggregates, setupBlind } from './l4-blind-fixture.mjs';

const K = '96';
const N = 40;
const IDS = blindIds(N);

/** Fake codex: answers pertinent, non_pertinent for ids in FAKE_<SEAT>_NP, exit 3 for ids in FAKE_<SEAT>_FAIL, a command event (well-formed answer kept) for ids in FAKE_<SEAT>_TOOL. */
function fakeCodex() {
  const bin = tmp('gepa-codex-bin-');
  const f = path.join(bin, 'codex');
  writeFileSync(f, `#!/bin/sh
out=""; prev=""; model=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; [ "$prev" = "-m" ] && model="$a"; prev="$a"; done
body=$(cat)
id=$(printf '%s' "$body" | grep -o 'item_id: [A-Za-z0-9._-]*' | head -1 | cut -d' ' -f2)
case "$model" in *sol*) np="$FAKE_SOL_NP"; fail="$FAKE_SOL_FAIL"; tool="$FAKE_SOL_TOOL" ;; *) np="$FAKE_LUNA_NP"; fail="$FAKE_LUNA_FAIL"; tool="$FAKE_LUNA_TOOL" ;; esac
case " $fail " in *" $id "*) echo "quota" >&2; exit 3 ;; esac
verdict=pertinent; code=P-DENSITE
case " $np " in *" $id "*) verdict=non_pertinent; code=N-ADMIN ;; esac
printf '{"verdict":"%s","code":"%s"}' "$verdict" "$code" > "$out"
echo '{"type":"thread.started"}'
case " $tool " in *" $id "*) echo '{"type":"item.completed","item":{"type":"command_execution","command":"cat ../../l3b/reference-d.jsonl"}}' ;; esac
echo '{"type":"turn.completed","usage":{"input_tokens":3}}'
exit 0
`, { mode: 0o755 });
  chmodSync(f, 0o755);
  const restore = swapEnv('PATH', `${bin}:${process.env.PATH}`);
  return () => { restore(); rmSync(bin, { recursive: true, force: true }); };
}

/** Blind fixture turned into a GEPA series: method gepa, the 5 GEPA routes, ceiling 5 %, no floors. */
async function setupGepa(home) {
  const s = await setupBlind(home, { k: K, routes: GEPA_ROUTES, ids: IDS, supports: { recall: 10, precision: 10 } });
  const rel = `tools/classif/l4/manifests/series-${K}.json`;
  const { floors: _floors, ...m } = JSON.parse(readFileSync(path.join(s.repo, rel), 'utf8'));
  writeRepoFile(s.repo, rel, JSON.stringify({ ...m, method: 'gepa', failureCeiling: 0.05 }));
  commitAll(s.repo, 'gepa series');
  const restoreCodex = fakeCodex();
  return { ...s, cleanup: () => { restoreCodex(); s.cleanup(); } };
}

const answering = (n) => IDS.slice(0, n).join(' ');

test('gepa blind: pass on every route at 0 miss, precision reported privately, repo manifest marked gepa without scores', withTempHome(async (home) => {
  const s = await setupGepa(home);
  try {
    const r = await blindPass(home, { k: K, routes: GEPA_ROUTES, fake: { FAKE_GLM: answering(N - 2) } });
    assert.equal(r.error, null, r.error?.stack);
    const agg = readAggregates(home, K);
    assert.deepEqual(Object.keys(agg.perRoute).sort(), [...GEPA_ROUTES].sort());
    for (const route of GEPA_ROUTES) {
      assert.equal(agg.perRoute[route].verdict, 'pass', route);
      assert.equal(agg.perRoute[route].misses, 0);
      assert.equal(typeof agg.perRoute[route].precision, 'number', 'precision reported');
    }
    assert.equal(agg.perRoute['glm-5.3-low'].failureShare, 0.05, '2/40 failures sit exactly at the 5 % ceiling');
    assert.equal(agg.gepa.verdict, 'pass');
    assert.deepEqual(Object.keys(agg.s113).sort(), [...GEPA_ROUTES].sort(), 'S113 secondary still measured');
    assert.equal(r.manifest.method, 'gepa');
    assert.deepEqual(r.manifest.routes, GEPA_ROUTES);
    const blob = JSON.stringify(r.manifest);
    for (const bad of [...SCORE_KEYS, 'misses', 'failureShare']) assert.ok(!blob.includes(bad), `repo manifest must not contain ${bad}`);
    // A resumed pass makes no seat call and keeps the GEPA gate fields.
    const again = await blindPass(home, { k: K, routes: GEPA_ROUTES, fake: { FAKE_GLM: answering(N - 2) } });
    assert.equal(again.error, null, again.error?.stack);
    assert.equal(again.calls.length, 0);
    assert.equal(again.manifest.aggregatesSha256, r.manifest.aggregatesSha256);
  } finally { s.cleanup(); }
}));

test('gepa blind: one miss on a single route fails it, over 5 % failures fails it, the series fails', withTempHome(async (home) => {
  const s = await setupGepa(home);
  try {
    const r = await blindPass(home, { k: K, routes: GEPA_ROUTES, fake: { FAKE_LUNA_NP: 'b-007', FAKE_MISTRAL: answering(N - 3) } });
    assert.equal(r.error, null, r.error?.stack);
    const agg = readAggregates(home, K);
    assert.deepEqual([agg.perRoute['luna-6-low'].verdict, agg.perRoute['luna-6-low'].misses], ['fail', 1]);
    assert.ok(agg.perRoute['luna-6-low'].recall > 0.97, 'a high recall does not rescue a single miss');
    assert.deepEqual([agg.perRoute['mistral-large-4-low'].verdict, agg.perRoute['mistral-large-4-low'].misses, agg.perRoute['mistral-large-4-low'].failureShare],
      ['fail', 0, 3 / 40], 'failures count as shown (no miss) but exceed the 5 % ceiling');
    for (const route of ['opus-5.5-low', 'glm-5.3-low', 'sol-6.1-low']) assert.equal(agg.perRoute[route].verdict, 'pass');
    assert.deepEqual([agg.gepa.verdict, agg.gepa.failing.sort()], ['fail', ['luna-6-low', 'mistral-large-4-low']]);
  } finally { s.cleanup(); }
}));

test('gepa dev: a gepa series evaluates the 5 GEPA routes with the 0-miss verdict', withTempHome(async (home) => {
  const s = await setupGepa(home);
  try {
    mkdirSync(path.join(home, 'l3b'), { recursive: true });
    const tuning = [{ itemId: 'rr-tuning-1', half: 'tuning', status: 'resolved', code: 'P-DENSITE', verdict: 'pertinent' }];
    writeFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), `${tuning.map((r) => JSON.stringify(r)).join('\n')}\n`);
    appendFileSync(path.join(home, 'l0', 'dev-items.jsonl'), `${JSON.stringify({ itemId: 'rr-tuning-1', input: 'texte tuning six logements zone H-9.' })}\n`);
    const { main } = await import('../l4/dev.mjs');
    const restore = swapEnv('FAKE_SOL_NP', 'rr-tuning-1');
    let m;
    try { m = await main(['--series', K, '--concurrency', '2']); } finally { restore(); }
    assert.equal(m.method, 'gepa');
    assert.deepEqual(m.routes, GEPA_ROUTES);
    assert.deepEqual([m.aggregates['sol-6.1-low'].verdict, m.aggregates['sol-6.1-low'].misses], ['fail', 1]);
    for (const route of GEPA_ROUTES.filter((x) => x !== 'sol-6.1-low')) assert.equal(m.aggregates[route].verdict, 'pass', route);
    assert.deepEqual([m.gepa.verdict, m.gepa.failing], ['fail', ['sol-6.1-low']]);
  } finally { s.cleanup(); }
}));

test('gepa blind gate: unresolved rows are not misses; classic blind manifests carry no method', () => {
  const blind = [{ itemId: 'a', verdict: 'pertinent', status: 'resolved' }, { itemId: 'b', verdict: 'pertinent', status: 'unresolved' }];
  const np = { failed: false, pred: { verdict: 'non_pertinent' } };
  assert.deepEqual(gepaBlindRouteGate(blind, [{ failed: false, pred: { verdict: 'pertinent' } }, np], 0.05), { verdict: 'pass', misses: 0, failureShare: 0 });
  assert.equal(gepaBlindRouteGate(blind, [np, np], 0.05).verdict, 'fail');
  assert.ok(!('method' in buildBlindManifest({ k: '4', promptSha: 'x', routes: [], blindItems: 0, aggregatesSha256: 'y' })));
});

test('review B1a: blind and S113 count a codex answer carrying a tool event as failed and never cache it', withTempHome(async (home) => {
  const s = await setupGepa(home);
  try {
    const r = await blindPass(home, { k: K, routes: GEPA_ROUTES, fake: { FAKE_SOL_TOOL: 'b-003 eval-1' } });
    assert.equal(r.error, null, r.error?.stack);
    const agg = readAggregates(home, K);
    assert.equal(agg.perRoute['sol-6.1-low'].failures, 1, 'the tool-event answer is a failure');
    assert.equal(agg.perRoute['luna-6-low'].failures, 0);
    const files = readdirSync(path.join(home, 'blind'));
    assert.ok(!files.includes(`blind-s${K}-sol-6.1-low.b-003.json`), 'never cached');
    assert.ok(files.includes(`blind-s${K}-sol-6.1-low.b-004.json`));
    // S113 prompts now carry the evalId as item_id (they used to read "undefined").
    assert.ok(!files.includes(`s113-s${K}-sol-6.1-low.eval-1.json`), 'S113: never cached either');
    assert.ok(files.includes(`s113-s${K}-sol-6.1-low.eval-2.json`));
    const s113Calls = r.calls.filter((c) => c.intent && c.phase === `l4-s113-s${K}`);
    assert.ok(s113Calls.length > 0);
    const results = r.calls.filter((c) => c.intent === false && c.route === 'sol-6.1-low' && c.itemId === 'b-003');
    assert.ok(results.every((c) => c.toolEvents > 0), 'the calls log keeps the tool-event count');
  } finally { s.cleanup(); }
}));

test('review B1a: dev counts a codex answer carrying a tool event as failed and never caches it', withTempHome(async (home) => {
  const s = await setupGepa(home);
  try {
    mkdirSync(path.join(home, 'l3b'), { recursive: true });
    writeFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), `${JSON.stringify({ itemId: 'rr-tuning-1', half: 'tuning', status: 'resolved', code: 'P-DENSITE', verdict: 'pertinent' })}\n`);
    appendFileSync(path.join(home, 'l0', 'dev-items.jsonl'), `${JSON.stringify({ itemId: 'rr-tuning-1', input: 'texte tuning six logements zone H-9.' })}\n`);
    const { main } = await import('../l4/dev.mjs');
    const restore = swapEnv('FAKE_LUNA_TOOL', 'rr-tuning-1');
    let m;
    try { m = await main(['--series', K, '--concurrency', '2']); } finally { restore(); }
    assert.equal(m.aggregates['luna-6-low'].failures, 1);
    assert.deepEqual([m.aggregates['luna-6-low'].verdict, m.aggregates['luna-6-low'].misses], ['fail', 0], '1/1 failures exceed the ceiling');
    const dir = path.join(home, 'l4', `series-${K}`);
    const row = JSON.parse(readFileSync(path.join(dir, 'dev-luna-6-low.jsonl'), 'utf8').trim());
    assert.deepEqual([row.failed, row.why, row.pred], [true, 'tool-events', null]);
    assert.ok(!existsSync(path.join(dir, 'dev-luna-6-low.rr-tuning-1.json')), 'never cached');
    assert.ok(existsSync(path.join(dir, 'dev-sol-6.1-low.rr-tuning-1.json')));
  } finally { s.cleanup(); }
}));
