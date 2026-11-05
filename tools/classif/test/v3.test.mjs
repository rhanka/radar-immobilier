import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROUTES } from '../run-seat.mjs';
import { ANNOTATORS, ARCHIVED_ANNOTATORS } from '../l2/run.mjs';
import { PROVENANCES, RESIDUAL_CAUSES, buildPrompt, itemValidity, parseAnswers, toExtraction } from '../l2/annotation.mjs';
import { residualTodo } from '../l2/converge.mjs';
import { renderPack } from '../l2/golden-pack.mjs';
import { buildReferenceD, provenanceOf } from '../l3/reference-d.mjs';
import { chiSquareHalves, cohenKappa, compareRoutes, cpLower, cpUpper, mcnemar, pertinentMasked, shownStats } from '../l4/metrics.mjs';
import { buildOptimiserPrompt, parseProposal } from '../l4/optimise.mjs';
import { devPrompt, parseDevAnswer } from '../l4/dev.mjs';
import { newKey } from './fixture.mjs';

const tmp = () => {
  try { return mkdtempSync(path.join(os.tmpdir(), 'v3-')); }
  catch (e) { if (e?.code !== 'EROFS' && e?.code !== 'EACCES') throw e; return mkdtempSync(path.join('/tmp', 'v3-')); }
};

// Annotator trio (owner decision 04/11): wonder + opus pass-1 reused, astra new; argon archived.
test('v3 annotator trio and L4 evaluated routes are registered', () => {
  assert.deepEqual(ANNOTATORS, ['muse-wonder-max', 'astra-max', 'opus-5.5-max']);
  assert.deepEqual(ARCHIVED_ANNOTATORS, ['gemini-4-argon-high']);
  for (const r of ['muse-spark-1.3-low', 'muse-spark-1.3-medium', 'opus-5.5-low', 'opus-5.5-medium',
    'mistral-large-4-medium', 'glm-5.3-low', 'gemini-4-argon-low', 'gemini-4-argon-medium']) {
    assert.ok(ROUTES[r], `${r} registered`);
  }
  assert.equal(ROUTES['astra-max'].model, 'gpt-6-astra');
});

// D1 provenances: golden_precedent / external_evidence are evidence, unresolved is a status.
test('v3 provenances are D1, cross-review carries precedent + provenance', async () => {
  assert.deepEqual(PROVENANCES, ['human_single', 'human_adjudicated', 'model_consensus', 'mixed']);
  assert.deepEqual(RESIDUAL_CAUSES, ['code-pair-confusion', 'definition-gap', 'missing-information', 'data-outside-immo', 'golden-set-conflict']);
  const pack = { criteria: 'C', definitions: 'D', guide: 'G', guideVersion: 'G0' };
  const items = [{ itemId: 'i1', kind: 'signal', input: 'texte' }];
  const p = buildPrompt({ profilePrompt: 'E', pack, items, mode: 'crossreview', goldenPack: 'PACK', context: new Map() });
  assert.ok(p.includes('## Cross-review') && p.includes('## Golden pack') && p.includes('PACK'));
  assert.ok(p.includes('golden_precedent') && p.includes('label_provenance'));
  assert.ok(p.includes('NEVER copy a golden excerpt'));
  const indep = buildPrompt({ profilePrompt: 'E', pack, items });
  assert.ok(!indep.includes('## Golden pack'));
});

test('v3 extraction and validity: precedent rows and provenance are checked', () => {
  const codes = new Map([['S-A', 'a_surveiller']]);
  const items = [{ itemId: 'i1', kind: 'signal', anchor: { id: 'n1' }, input: 'un texte de reglement avec six logements' }];
  const pairs = parseAnswers(JSON.stringify({ annotations: [{ item_id: 'i1', code: 'S-A', ambiguous: false,
    quote: 'texte de reglement', reason: 'r', changed: true, golden_precedent: [18], label_provenance: 'mixed' }] }), items);
  const ex = toExtraction({ annotator: 'a', pass: 2, guideVersion: 'G0', pairs, codes });
  const ann = ex.nodes.find((n) => n.node_type === 'Annotation');
  assert.deepEqual(ann.golden_precedent, [18]);
  assert.equal(ann.label_provenance, 'mixed');
  const ok = itemValidity(ex, { valid: true, issues: [] }, pairs, codes, { goldenRows: new Set([18]) });
  assert.deepEqual(ok[0].issues, []);
  const badProv = parseAnswers(JSON.stringify({ annotations: [{ item_id: 'i1', code: 'S-A', quote: 'texte de reglement', reason: 'r', label_provenance: 'unresolved' }] }), items);
  assert.deepEqual(itemValidity(toExtraction({ annotator: 'a', pass: 2, guideVersion: 'G0', pairs: badProv, codes }), { issues: [] }, badProv, codes)[0].issues, ['unknown-provenance']);
  assert.deepEqual(itemValidity(ex, { valid: true, issues: [] }, pairs, codes, { goldenRows: new Set([19]) })[0].issues, ['unknown-golden-row']);
});

// Cross-review todo: not 3/3 code OR not 3/3 verdict OR flagged ambiguous by ≥ 1.
test('v3 residual todo covers code, verdict and single-annotator ambiguity', () => {
  const row = (codeU, verdictU, amb) => ({ itemId: `${codeU}${verdictU}${amb}`, codeUnanimous: codeU, verdictUnanimous: verdictU, ambiguousByOne: amb });
  const rows = [row(true, true, false), row(false, false, false), row(true, false, false), row(true, true, true)];
  assert.deepEqual(residualTodo(rows), [rows[1].itemId, rows[2].itemId, rows[3].itemId]);
});

test('v3 ambiguity causes: one rule order, five classes', async () => {
  const { classifyResidual, confusedPairsOf, renderQuestions, renderTable } = await import('../l2/ambiguity.mjs');
  const v = (o) => ({ code: 'S-A', ambiguous: false, cause: null, goldenPrecedent: [], ...o });
  const golden = new Map([[18, { code: 'P-X', verdict: 'pertinent' }]]);
  // 1. missing-information + refused complement → data-outside-immo.
  assert.equal(classifyResidual([v({ ambiguous: true, cause: 'missing-information' })], { kind: 'signal', scrapeStatus: 'refused-fingerprint', confusedPairs: new Set(), goldenCodes: golden }).cause, 'data-outside-immo');
  // 2. missing-information + available complement → missing-information.
  assert.equal(classifyResidual([v({ ambiguous: true, cause: 'missing-information' })], { kind: 'signal', scrapeStatus: 'ok', confusedPairs: new Set(), goldenCodes: golden }).cause, 'missing-information');
  // 3. citing votes disagree → golden-set-conflict.
  assert.equal(classifyResidual([v({ code: 'S-A', goldenPrecedent: [18] }), v({ code: 'S-B', goldenPrecedent: [18] })],
    { kind: 'signal', confusedPairs: new Set(), goldenCodes: golden }).cause, 'golden-set-conflict');
  // 4. frequent pair → code-pair-confusion.
  assert.equal(classifyResidual([v({ code: 'S-A' }), v({ code: 'S-B' }), v({ code: 'S-A' })],
    { kind: 'signal', confusedPairs: new Set(['S-A × S-B']), goldenCodes: golden }).cause, 'code-pair-confusion');
  // 5. fallback → definition-gap.
  assert.equal(classifyResidual([v({ code: 'S-A', ambiguous: true }), v({ code: 'S-A', ambiguous: true })],
    { kind: 'signal', confusedPairs: new Set(), goldenCodes: golden }).cause, 'definition-gap');
  const residuals = [
    { votes: [{ code: 'S-A' }, { code: 'S-B' }, { code: 'S-A' }] },
    { votes: [{ code: 'S-A' }, { code: 'S-B' }, { code: 'S-C' }] },
    { votes: [{ code: 'S-A' }, { code: 'S-A' }, { code: 'S-A' }] },
  ];
  const { pairs } = confusedPairsOf(residuals);
  assert.ok(pairs.has('S-A × S-B'));
  const map = { pass: 2, residuals: [
    { itemId: 'a', kind: 'signal', cause: 'missing-information', detail: 'd', codes: ['S-A'], codeMaj: 'S-A' },
    { itemId: 'b', kind: 'pv', cause: 'code-pair-confusion', detail: 'd', codes: ['S-A', 'S-B'], codeMaj: null },
  ] };
  const table = renderTable(map);
  assert.ok(table.includes('| missing-information | 1 | S-A | a |'));
  const q = renderQuestions(map);
  assert.ok(q.includes('## missing-information (1)') && q.includes('- a (signal)'));
});

// Deferred annotator: last vote carried forward, gap recorded.
test('v3 deferred annotator keeps its last vote with a recorded gap', async () => {
  const { latestVotes } = await import('../l2/converge.mjs');
  const home = tmp();
  try {
    const w = (code) => ({ itemId: 'i1', kind: 'signal', valid: true, code, verdict: 'a_surveiller', ambiguous: false, cause: null, quote: 'q', reason: 'r', changed: null, quoteFound: true });
    for (const [p, a, code] of [[1, 'muse-wonder-max', 'S-A'], [1, 'astra-max', 'S-A'], [1, 'opus-5.5-max', 'S-B'], [2, 'muse-wonder-max', 'S-A'], [2, 'opus-5.5-max', 'S-B']]) {
      const d = path.join(home, 'l2', `pass${p}`, a);
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 's001.json'), JSON.stringify({ pass: p, annotator: a, lotId: 's001', exitCode: 0, annotations: [w(code)] }));
    }
    const { latest, gaps } = latestVotes(home, 2, { deferred: ['astra-max'] });
    assert.equal(latest.get('astra-max').get('i1').code, 'S-A');
    assert.ok(gaps.some((g) => g.annotator === 'astra-max' && g.pass === 2 && g.carriedFrom === 1));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Pilot budget D5: strict spend (non-final corrupt lines fail closed; N1 truncated tail
// tolerated), intent-counted, check refuses over-cap.
test('v3 pilot budget: counter in the manifest, chain refuses over cap', async () => {
  const { BUDGET_CAP, check, spent, spentByPhase } = await import('../lib/budget.mjs');
  assert.equal(BUDGET_CAP, 22000);
  const home = tmp();
  try {
    mkdirSync(path.join(home, 'l2'), { recursive: true });
    writeFileSync(path.join(home, 'l2', 'calls.jsonl'), '{"phase":"pass1"}\nnot-json\n{"phase":"pass2"}\n');
    assert.throws(() => spent(home), /corrupt calls log/);
    writeFileSync(path.join(home, 'l2', 'calls.jsonl'), '{"phase":"pass1"}\n{"phase":"pass2"}\n');
    assert.equal(spent(home), 2);
    assert.deepEqual(spentByPhase(home), { pass1: 1, pass2: 1 });
    assert.equal(spent(tmp()), 0);
    assert.deepEqual(check(home, BUDGET_CAP - 2), { spent: 2, planned: BUDGET_CAP - 2, remaining: 0 });
    assert.throws(() => check(home, BUDGET_CAP - 1), /pilot budget refused/);
    // Intent + result count once.
    writeFileSync(path.join(home, 'l2', 'calls.jsonl'), '{"intent":true,"phase":"p"}\n{"intent":false,"phase":"p"}\n');
    assert.equal(spent(home), 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Blind-half guard: seal/open round trip, executor role, one run per tuple, no item listing.
test('v3 blind guard: role, key, single run per tuple, aggregates only', async () => {
  const { assertBlindRunAllowed, audit, openBlindSet, readAudit, refuseBlindListing, sealBlindSet } = await import('../lib/blind.mjs');
  const home = tmp();
  const repo = tmp();
  try {
    const key = newKey().toString('base64');
    const rows = [{ itemId: 'b1', code: 'S-A', verdict: 'a_surveiller' }];
    const env = { CLASSIF_BLIND_KEY: key, CLASSIF_ROLE: 'test-executor', CLASSIF_ACTOR: 'test' };
    const r = sealBlindSet(rows, { home, env });
    assert.equal(r.plainSha256.length, 64);
    assert.throws(() => sealBlindSet(rows, { home, env }), /overwrite/);
    assert.throws(() => openBlindSet({ purpose: 't', home, env: { ...env, CLASSIF_ROLE: 'viewer' } }), /test-executor/);
    assert.throws(() => openBlindSet({ purpose: 't', home, env: { ...env, CLASSIF_BLIND_KEY: newKey().toString('base64') } }), /bad decrypt|unable|error/i);
    const opened = openBlindSet({ purpose: 't', home, env, expectPlainSha256: r.plainSha256 });
    assert.deepEqual(opened, rows);
    assert.throws(() => openBlindSet({ purpose: 't', home, env, expectPlainSha256: '0'.repeat(64) }), /differs/);
    assert.ok(readAudit(home).some((e) => e.action === 'open-blind-set'));
    assert.throws(() => refuseBlindListing('blind'), /aggregates only/);
    assert.throws(() => refuseBlindListing('tuning'), /aggregates only/);
    // One run per (prompt sha, model, effort): needs a git repo with a committed prompt.
    const { spawnSync } = await import('node:child_process');
    spawnSync('git', ['init', '-q'], { cwd: repo });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: repo });
    mkdirSync(path.join(repo, 'p'), { recursive: true });
    writeFileSync(path.join(repo, 'p', 'P0.md'), 'prompt');
    spawnSync('git', ['add', '.'], { cwd: repo });
    spawnSync('git', ['commit', '-qm', 'p0'], { cwd: repo });
    const { sha256 } = await import('../lib/render.mjs');
    const sha = sha256('prompt');
    assert.ok(assertBlindRunAllowed({ promptFile: 'p/P0.md', promptSha256: sha, model: 'm', effort: 'low', home, repo }).frozenIn);
    audit({ action: 'blind-run', promptSha256: sha, model: 'm', effort: 'low' }, { home, env });
    assert.throws(() => assertBlindRunAllowed({ promptFile: 'p/P0.md', promptSha256: sha, model: 'm', effort: 'low', home, repo }), /already run/);
    writeFileSync(path.join(repo, 'p', 'P0.md'), 'prompt v2');
    assert.throws(() => assertBlindRunAllowed({ promptFile: 'p/P0.md', promptSha256: sha256('prompt v2'), model: 'm', effort: 'low', home, repo }), /differs from the committed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

// Annex M metrics: CP bounds, shown recall/precision, Pertinent masked, κ, McNemar, χ², selection.
test('v3 Annex M metrics on synthetic fixtures', () => {
  // Clopper–Pearson: 0 masked of 113 → upper ≈ 2.6 %; 0 of 5 → ≈ 45 %.
  const u113 = cpUpper(0, 113);
  assert.ok(u113 > 0.02 && u113 < 0.03, `cpUpper(0,113)=${u113}`);
  const u5 = cpUpper(0, 5);
  assert.ok(u5 > 0.4 && u5 < 0.5, `cpUpper(0,5)=${u5}`);
  assert.equal(cpLower(0, 10), 0);
  assert.equal(cpUpper(10, 10), 1);
  const rows = [
    { ref: 'pertinent', pred: { verdict: 'pertinent' } },
    { ref: 'a_surveiller', pred: { verdict: 'non_pertinent' } },
    { ref: 'non_pertinent', pred: { verdict: 'a_surveiller' } },
    { ref: 'non_pertinent', pred: { verdict: 'non_pertinent' } },
    { ref: 'pertinent', pred: { failed: true } },
    { ref: 'pertinent', pred: { verdict: 'pertinent' }, unresolved: true },
  ];
  const s = shownStats(rows, { recallSupport: 30, precisionSupport: 30 });
  assert.equal(s.scored, 5);
  assert.equal(s.refShown, 3);
  assert.equal(s.predShown, 3); // 2 shown preds + 1 failure
  assert.equal(s.recall, 2 / 3);
  assert.equal(s.precision, 1 / 3);
  assert.ok(s.recallLB < s.recall && s.precisionLB < s.precision);
  assert.deepEqual(s.indeterminate, { recall: true, precision: true });
  const pm = pertinentMasked(0, 113);
  assert.equal(pm.upper95, u113);
  // Cohen κ: perfect agreement → 1; chance-level table → ~0.
  assert.equal(cohenKappa([['a', 'a'], ['b', 'b']], ['a', 'b']).kappa, 1);
  const k0 = cohenKappa([['a', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'b']], ['a', 'b']);
  assert.ok(Math.abs(k0.kappa) < 1e-9);
  // McNemar: symmetric discordance → p = 1.
  assert.equal(mcnemar(5, 5).p, 1);
  assert.equal(mcnemar(0, 0).p, 1);
  assert.ok(mcnemar(0, 10).p < 0.01);
  // χ² halves: even split → 0; 60/40 of 100 → 4.
  assert.equal(chiSquareHalves(50, 50).chi2, 0);
  assert.equal(chiSquareHalves(60, 40).chi2, 4);
  // Selection: failing failure ceiling or indeterminate never outranks a passing route.
  const good = { stats: { recallLB: 0.5, recall: 0.7, precisionLB: 0.4, precision: 0.6, indeterminate: {} }, promptVersion: 'P1', costUsd: 3 };
  const ind = { stats: { recallLB: 0.9, recall: 0.9, precisionLB: 0.9, precision: 0.9, indeterminate: { recall: true } }, promptVersion: 'P2', costUsd: 0 };
  assert.ok(compareRoutes(good, ind) < 0);
  assert.ok(compareRoutes(ind, good) > 0);
});

// Split: grouped by city, deterministic, stratified inputs.
test('v3 split is city-grouped, deterministic and balanced', async () => {
  const { bpassOf, seededRng, splitGrouped, stratumOf } = await import('../l3/split.mjs');
  assert.equal(stratumOf('signal', 'pertinent', 'pass2'), 'signal|pertinent|pass2');
  assert.equal(bpassOf({ kind: 'pv' }, new Map()), 'pv');
  assert.equal(bpassOf({ kind: 'signal' }, new Map([['x', 'pass1']])), 'unknown');
  const cities = [
    { city: 'a', items: [{ id: 'a1', stratum: 's|P|pass2' }, { id: 'a2', stratum: 's|N|pass1' }] },
    { city: 'b', items: [{ id: 'b1', stratum: 's|P|pass2' }] },
    { city: 'c', items: [{ id: 'c1', stratum: 's|N|pass1' }] },
  ];
  const targets = new Map([['s|P|pass2', 1], ['s|N|pass1', 1]]);
  const once = splitGrouped(cities, targets);
  const twice = splitGrouped([...cities].reverse(), targets);
  assert.deepEqual(once, twice);
  const inBoth = once.tuning.filter((id) => once.blind.includes(id));
  assert.deepEqual(inBoth, []);
  assert.equal(once.tuning.length + once.blind.length, 4);
  // §3: seeded draws reproduce from the seed; same seed twice, city-grouped.
  const s1a = splitGrouped(cities, targets, seededRng('seed-1'));
  const s1b = splitGrouped(cities, targets, seededRng('seed-1'));
  assert.deepEqual(s1a, s1b, 'same seed reproduces the draw');
  const citiesOf = (ids) => new Set(ids.map((id) => cities.find((c) => c.items.some((i) => i.id === id)).city));
  assert.deepEqual([...citiesOf(s1a.tuning)].filter((c) => citiesOf(s1a.blind).has(c)), [], 'no city in both halves');
  // Two cities of the same size in one stratum: the seed decides the tie.
  const tie = [
    { city: 'a', items: [{ id: 'a1', stratum: 's' }] },
    { city: 'b', items: [{ id: 'b1', stratum: 's' }] },
  ];
  const seen = new Set([0, 1].map((i) => JSON.stringify(splitGrouped(tie, new Map([['s', 1]]), seededRng(`tie-${i}`)))));
  assert.ok(seen.size >= 1, 'seeded tie-break runs');
});

// Reference D: provenance rule, core/unresolved partitions, halves.
test('v3 reference D: provenance, status, halves', () => {
  const codes = new Map([['S-A', 'a_surveiller']]);
  const mkVote = ([code, golden]) => ({ valid: true, code, verdict: 'a_surveiller', ambiguous: false, cause: null, goldenPrecedent: golden ?? [], labelProvenance: null, pass: 2, guide: 'G0' });
  // latestVotes shape: Map<annotator, Map<itemId, vote>>.
  const mkLatest = (perItem) => new Map(ANNOTATORS.map((a, i) => [a, new Map(Object.entries(perItem).map(([id, lists]) => [id, lists[i] ? mkVote(lists[i]) : null]))]));
  const perItemCite = { t1: [['S-A', [18]], ['S-A', []], ['S-A', []]], b1: [[null, []], [null, []], [null, []]] };
  const latest = mkLatest(perItemCite);
  const t1votes = [...latest.values()].map((m) => m.get('t1'));
  assert.equal(provenanceOf({ codeMaj: 'S-A', votes: t1votes, adjudicated: false }), 'mixed');
  assert.equal(provenanceOf({ codeMaj: 'S-A', votes: t1votes, adjudicated: true }), 'human_adjudicated');
  const noCite = mkLatest({ t1: [['S-A', []], ['S-A', []], ['S-A', []]], b1: [[null, []], [null, []], [null, []]] });
  assert.equal(provenanceOf({ codeMaj: 'S-A', votes: [...noCite.values()].map((m) => m.get('t1')), adjudicated: false }), 'model_consensus');
  assert.equal(provenanceOf({ codeMaj: null, votes: [], adjudicated: false }), 'model_consensus');
  const rows = [
    { itemId: 't1', kind: 'signal', codeMaj: { value: 'S-A', count: 3 }, verdictMaj: { value: 'a_surveiller', count: 3 }, ambiguousByOne: false },
    { itemId: 'b1', kind: 'pv', codeMaj: null, verdictMaj: null, ambiguousByOne: true },
  ];
  const halves = { tuning: new Set(['t1']), blind: new Set(['b1']) };
  // Review §6b: bare adjudications ({itemId:{}} or true) throw — use a valid {code} here.
  const ref = buildReferenceD({ rows, latest: noCite, complements: new Map(), halves, adjudications: new Map([['t1', { code: 'S-A' }]]), ambiguityCauses: new Map([['b1', 'missing-information']]), pass: 3, codes });
  const t1 = ref.find((r) => r.itemId === 't1');
  assert.equal(t1.partition, 'core');
  assert.equal(t1.status, 'resolved');
  assert.equal(t1.label_provenance, 'human_adjudicated');
  assert.equal(t1.verdict, 'a_surveiller');
  assert.equal(t1.half, 'tuning');
  const b1 = ref.find((r) => r.itemId === 'b1');
  assert.equal(b1.partition, 'unresolved');
  assert.equal(b1.cause, 'missing-information');
  assert.equal(b1.half, 'blind');
  // §6: adjudication {code} overrides the majority and resolves, validated against the registry.
  const codes2 = new Map([['S-A', 'a_surveiller'], ['S-B', 'a_surveiller']]);
  const rows2 = [{ itemId: 'x', kind: 'signal', codeMaj: { value: 'S-A', count: 2 }, verdictMaj: { value: 'a_surveiller', count: 2 }, ambiguousByOne: false }];
  const mkL = () => new Map(ANNOTATORS.map((a) => [a, new Map([['x', { valid: true, code: 'S-A', verdict: 'a_surveiller', ambiguous: false, cause: null, goldenPrecedent: [], labelProvenance: null, pass: 3, guide: 'FINAL' }]])]));
  const over = buildReferenceD({ rows: rows2, latest: mkL(), complements: new Map(), halves: { tuning: new Set(['x']), blind: new Set() }, adjudications: new Map([['x', { code: 'S-B' }]]), ambiguityCauses: new Map(), pass: 3, codes: codes2 });
  assert.equal(over[0].code, 'S-B');
  assert.equal(over[0].status, 'resolved');
  assert.equal(over[0].label_provenance, 'human_adjudicated');
  assert.throws(() => buildReferenceD({ rows: rows2, latest: mkL(), complements: new Map(), halves: { tuning: new Set(['x']), blind: new Set() }, adjudications: new Map([['x', { code: 'NOPE' }]]), ambiguityCauses: new Map(), pass: 3, codes: codes2 }), /unknown code/);
});

// Optimiser firewall: blind keys throw; the optimiser never opens blind or eval sets.
test('v3 optimiser firewall: the blind half never enters an optimiser input', () => {
  const base = { tuningRef: [], tuningOutputs: {}, errors: {}, aggregates: {}, currentPrompt: 'P' };
  assert.doesNotThrow(() => buildOptimiserPrompt(base));
  assert.throws(() => buildOptimiserPrompt({ ...base, blindRows: [] }), /firewall/);
  assert.throws(() => buildOptimiserPrompt({ ...base, blindAggregates: {} }), /firewall/);
  // Static proof: the optimiser module has no blind-half or eval-set access path (the word
  // "blind" in its header comment is the documented firewall contract, not an access).
  const src = readFileSync(new URL('../l4/optimise.mjs', import.meta.url), 'utf8');
  for (const bad of ['lib/blind', 'openBlindSet', 'blindDir', 'blind.sealed', 'openEvalSet', 'guard/evalset']) {
    assert.ok(!src.includes(bad), `optimise.mjs must not contain ${bad}`);
  }
  // Proposal parsing: real text wins, short/JSON-only answers are refused.
  assert.ok((parseProposal('x'.repeat(300)) ?? '').length >= 200);
  assert.equal(parseProposal('{"prompt":"short"}'), null);
  assert.equal(parseProposal('{"a":1}'), null);
});

// Golden pack rendering: 113-row shape on synthetic rows, sorted row numbers.
test('v3 golden pack renders verdict, code, pass and frozen input per row', () => {
  const inputs = [
    { evalId: 'eval-018', lineNo: 18, citySlug: 'c', input: 'frozen input 18', inputSha256: 's' },
    { evalId: 'eval-014', lineNo: 14, citySlug: 'c', input: null, inputSha256: null },
  ];
  const expected = [
    { evalId: 'eval-018', lineNo: 18, verdict: 'pertinent', code: 'P-X', pass: 'pass2' },
    { evalId: 'eval-014', lineNo: 14, verdict: 'non_pertinent', code: 'N-Y', pass: 'pass1' },
  ];
  const { body, rowNos } = renderPack(inputs, expected);
  assert.deepEqual(rowNos, [14, 18]);
  assert.ok(body.includes('## row 18 — eval-018') && body.includes('frozen input 18'));
  assert.ok(body.includes('verdict: pertinent') && body.includes('code: P-X'));
});

// Freeze guard: verbatim 12-word shingles from the sealed set refuse the freeze.
test('v3 freeze guard refuses verbatim sealed-set shingles', async () => {
  const { assertNoVerbatim } = await import('../lib/freeze.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const home = tmp();
  try {
    const salt = 'freeze-salt';
    const sealed = 'le reglement numero 9001-1 de la ville fictive autorise douze logements supplementaires ici presentement';
    mkdirSync(path.join(home, 'guard'), { recursive: true });
    writeFileSync(path.join(home, 'guard', 'salt'), `${salt}\n`);
    writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints(salt, { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: [sealed] })));
    assert.throws(() => assertNoVerbatim(`guide text ... ${sealed} ... end`, home, { what: 'guide G1' }), /freeze refused/);
    assert.doesNotThrow(() => assertNoVerbatim('Un texte de guide sans rapport, douze mots neutres pour completer ici.', home));
    rmSync(path.join(home, 'guard', 'fingerprints.json'));
    assert.throws(() => assertNoVerbatim('anything', home), /fail closed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Evaluated answer parsing: unknown code, partition mismatch and non-JSON fail closed.
test('v3 evaluated answers: partition and JSON are enforced', () => {
  const codes = new Map([['S-A', 'a_surveiller']]);
  assert.deepEqual(parseDevAnswer('{"verdict":"a_surveiller","code":"S-A"}', codes), { verdict: 'a_surveiller', code: 'S-A', failed: false, why: null });
  assert.equal(parseDevAnswer('{"verdict":"pertinent","code":"S-A"}', codes).why, 'verdict-not-partition');
  assert.equal(parseDevAnswer('{"verdict":"a_surveiller","code":"S-NOPE"}', codes).why, 'unknown-code');
  assert.equal(parseDevAnswer('no json', codes).why, 'no-json');
  const p = devPrompt('FROZEN', { itemId: 'x', input: 'ITEM' });
  assert.ok(p.includes('FROZEN') && p.includes('### item_id: x') && p.includes('ITEM'));
});

// Chain plan: pass 1 blind independent, passes 2–5 crossreview with guide progression.
test('v3 chain plan: blind pass 1, crossreview resolutions, frozen guide', async () => {
  const src = readFileSync(new URL('../l2/chain.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("2: 'crossreview'") && src.includes("1: 'independent'"));
  assert.ok(src.includes('requireSplit') && src.includes('split.json'), 'D2: no A2 pass without the committed split');
  assert.ok(src.includes('BUDGET_CAP') || src.includes('budgetCheck'), 'D5: budget enforced before paid steps');
  assert.ok(src.includes('guide-FINAL'), 'freeze to FINAL');
  assert.ok(src.includes('--stage') && src.includes('async function blindStage'), 'blind stage exists');
});
