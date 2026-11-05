#!/usr/bin/env node
// make classif-l2-chain ENV=preprod — runs the v3 phase-A protocol, resumable at every step,
// meant to be launched under `systemd-run --user --slice=h2a-agents.slice` so it survives
// session restarts (2 concurrent calls per seat):
//   pass 1 independent (G0): wonder + opus votes reused, astra votes filled (same prompt/guide/lots)
//   split: REQUIRED before any pass ≥ 2 (D2) — the committed split halves partition the work
//   passes 2–5 crossreview (G0→G1→G2→G3, tuning half only): vote → revalidate → converge →
//     ambiguity map → converge → amend (tuning disagreements only, shingle-checked)
//   freeze: final guide (FINAL) + shingle check + repo freeze manifest
//   blind stage (separate run, --stage blind): blind-half residuals cross-reviewed once under the
//     frozen FINAL guide, then converged; reference D and the blind seal come next (L3b).
// Stops as soon as the v3 stop rule holds (α never stops alone). Paid calls are never repeated
// (raw answers reused). A deferred annotator keeps its last vote (gap recorded in manifests).
// The pilot budget (22,000 calls, D5) is enforced before every paid step: the chain refuses
// to exceed it. Progress: $CLASSIF_HOME/l2/chain-status.json and one milestone per finished pass.
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { classifHome, CLASSIF_DIR, REPO } from '../lib/paths.mjs';
import { check as budgetCheck, spent as budgetSpent, BUDGET_CAP } from '../lib/budget.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { sealedFile } from '../lib/blind.mjs';
import { sha256 } from '../lib/render.mjs';
import { runPass, loadDevItems, makeLots, ANNOTATORS } from './run.mjs';
import { loadGoldenPack } from './golden-pack.mjs';
import { main as revalidate } from './revalidate.mjs';
import { main as scrape } from './scrape.mjs';
import { main as converge, reconcileContext, loadComplements, latestVotes } from './converge.mjs';
import { main as amend } from './amend.mjs';
import { main as ambiguity } from './ambiguity.mjs';

const GUIDES = { 1: 'G0', 2: 'G0', 3: 'G1', 4: 'G2', 5: 'G3' };
const MODES = { 1: 'independent', 2: 'crossreview', 3: 'crossreview', 4: 'crossreview', 5: 'crossreview' };

/** Committed split halves (D2): refuses any A2 cross-review pass before the split exists.
    Review §3b: existence alone is not enough — the split must be tracked and clean. */
function requireSplit() {
  const f = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
  if (!existsSync(f)) {
    process.stderr.write(`classif-l2-chain: refusing pass ≥ 2 without the committed 50/50 split (D2: run make classif-l3b-split ENV=preprod first)\n`);
    process.exit(2);
  }
  const rel = path.relative(REPO, f);
  const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' });
  if (git('ls-files', '--error-unmatch', rel).status !== 0) {
    process.stderr.write(`classif-l2-chain: refusing pass ≥ 2, split ${rel} is not committed\n`);
    process.exit(2);
  }
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) {
    process.stderr.write(`classif-l2-chain: refusing pass ≥ 2, split ${rel} differs from the committed version\n`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

function splitTodo(split, todo, half) {
  const keep = new Set(split.halves[half]);
  return new Set([...todo].filter((id) => keep.has(id)));
}

export async function main(argv = process.argv.slice(2)) {
  const home = classifHome();
  const concurrency = Number(argv.includes('--concurrency') ? argv[argv.indexOf('--concurrency') + 1] : 2);
  const waitUnit = argv.includes('--wait-unit') ? argv[argv.indexOf('--wait-unit') + 1] : null;
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  const stage = argv.includes('--stage') ? argv[argv.indexOf('--stage') + 1] : 'main';
  const active = ANNOTATORS.filter((a) => !deferred.includes(a));
  const statusFile = path.join(home, 'l2', 'chain-status.json');
  const t0 = Date.now();
  const status = (step, extra = {}) => writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(), step, stage, deferred, minutes: Math.round((Date.now() - t0) / 60000), budget: { spent: budgetSpent(home), cap: BUDGET_CAP }, ...extra }, null, 1), { mode: 0o600 });
  if (waitUnit) {
    status(`waiting for ${waitUnit}`);
    while (spawnSync('systemctl', ['--user', 'is-active', '--quiet', waitUnit]).status === 0) await sleep(30000);
  }

  if (stage === 'blind') return blindStage({ home, active, deferred, concurrency, status, argv });

  for (let pass = 1; pass <= 5; pass++) {
    const mode = MODES[pass];
    const guide = GUIDES[pass];
    let split = null;
    if (pass >= 2) split = requireSplit();
    // Review §2 reserve: crossreview needs the shared golden pack — load it BEFORE amend
    // at passes ≥ 3, so a deleted pack fails before any paid amendment call.
    const goldenEarly = mode === 'crossreview' ? loadGoldenPack(home) : { goldenPack: null, goldenRows: null };
    if (pass >= 3 && !existsSync(path.join(home, 'l1', 'pack', `guide-${guide}.md`))) {
      status(`amend → ${guide} (tuning half, after pass ${pass - 1})`);
      const rep = await amend(['--from', GUIDES[pass - 1], '--to', guide, '--pass', String(pass - 1), '--half', 'tuning', ...(deferred.length ? ['--deferred', deferred.join(',')] : [])]);
      status(`amended → ${guide}`, { adopted: rep.adopted?.length ?? rep.adopted });
    }
    // Paid-step budget (D5): todo lots × active annotators, plus the amend rounds already checked.
    let todo = null;
    let context = new Map();
    if (pass > 1) {
      todo = splitTodo(split, new Set(JSON.parse(readFileSync(path.join(home, 'l2', `pass${pass}`, 'todo.json'), 'utf8')).items), 'tuning');
      if (mode === 'crossreview') {
        const ctx = JSON.parse(readFileSync(path.join(home, 'l2', `pass${pass}`, 'context.json'), 'utf8'));
        context = new Map(Object.entries(ctx).map(([a, m]) => [a, new Map(Object.entries(m))]));
      }
    }
    // Review §5: planned counts only non-cached lots (finished (pass,annotator,lot) outputs deducted).
    const passLots = makeLots((todo ? loadDevItems(home).filter((i) => todo.has(i.itemId)) : loadDevItems(home)));
    let remaining = 0;
    for (const a of active) {
      for (const lot of passLots) {
        if (!existsSync(path.join(home, 'l2', `pass${pass}`, a, `${lot.lotId}.json`))) remaining++;
      }
    }
    const planned = remaining * 3;
    budgetCheck(home, planned);
    status(`pass ${pass} (${mode}, ${guide})`, { todo: todo ? todo.size : 'all', planned });
    // Review §2: pack already loaded before amend (goldenEarly); reuse it here.
    const golden = goldenEarly;
    const r = await runPass({ pass, mode, guide, annotators: active, todo, context, concurrency, home, phase: `pass${pass}`,
      goldenPack: golden.goldenPack, goldenRows: golden.goldenRows });
    status(`revalidate pass ${pass}`, { calls: r.calls });
    await revalidate(['--pass', String(pass)]);
    if (pass === 1) { status('complements (scrape)'); await scrape(); }
    status(`converge pass ${pass} (descriptive)`);
    await converge(['--pass', String(pass), ...(deferred.length ? ['--deferred', deferred.join(',')] : [])]);
    status(`ambiguity map pass ${pass}`);
    await ambiguity(['--pass', String(pass)]);
    status(`converge pass ${pass} (final, with causes)`);
    const report = await converge(['--pass', String(pass), ...(deferred.length ? ['--deferred', deferred.join(',')] : [])]);
    writeFileSync(path.join(home, 'l2', `pass${pass}.done`), JSON.stringify({ at: new Date().toISOString(), minutes: Math.round((Date.now() - t0) / 60000), stop: report.stop, metrics: report.metrics }), { mode: 0o600 });
    if (report.stop.stop) { status('stopped', { pass, why: report.stop.why }); return freeze(home, guide, status); }
  }
  status('cap reached');
  return freeze(home, GUIDES[5], status);
}

/** Copies the last guide to guide-FINAL.md (shingle-checked) and records the freeze manifest. */
function freeze(home, guide, status) {
  const src = path.join(home, 'l1', 'pack', `guide-${guide}.md`);
  const text = readFileSync(src, 'utf8');
  assertNoVerbatim(text, home, { what: 'guide FINAL' });
  const dst = path.join(home, 'l1', 'pack', 'guide-FINAL.md');
  // Review §11: never overwrite a frozen artefact.
  if (existsSync(dst)) throw new Error(`freeze refused: ${dst} already frozen`);
  copyFileSync(src, dst);
  const manifest = { kind: 'guide-freeze', frozen: 'FINAL', from: guide, createdAt: new Date().toISOString(), llmCalls: 0, guideSha256: sha256(text), shingleCheck: 'pass (0 verbatim shingles from the sealed set)' };
  writeFileSync(path.join(CLASSIF_DIR, 'l2', 'manifests', 'guide-freeze.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  status('frozen', { guide: 'FINAL', from: guide });
  return { frozen: 'FINAL', from: guide };
}

/**
 * Blind stage: blind-half residuals cross-reviewed ONCE under the frozen FINAL guide, then
 * converged (no stop rule, no amendment: the blind half never feeds the guide). Requires the
 * committed split and the frozen guide; refuses when the blind half is already sealed.
 */
async function blindStage({ home, active, deferred, concurrency, status, argv }) {
  const split = requireSplit();
  // Review §4 + §11a: shared fail-closed FINAL guard (sha-checked, manifest required).
  const { assertFinalGuide } = await import('../lib/freeze.mjs');
  try {
    assertFinalGuide(home);
  } catch (e) {
    process.stderr.write(`classif-l2-chain --stage blind: ${e.message}\n`);
    process.exit(2);
  }
  if (existsSync(sealedFile(home))) { process.stderr.write('classif-l2-chain --stage blind: refusing, the blind half is already sealed\n'); process.exit(2); }
  const last = Math.max(...[1, 2, 3, 4, 5].filter((p) => existsSync(path.join(home, 'l2', `converge-pass${p}.json`))));
  const conv = JSON.parse(readFileSync(path.join(home, 'l2', `converge-pass${last}.json`), 'utf8'));
  const blindIds = new Set(split.halves.blind);
  const todo = new Set((conv.rows ?? []).filter((r) => blindIds.has(r.itemId) && (!r.codeUnanimous || !r.verdictUnanimous || r.ambiguousByOne)).map((r) => r.itemId));
  const pass = last + 1;
  status(`blind cross-review pass ${pass} (FINAL, blind half only)`, { todo: todo.size });
  // Review §5: planned counts only non-cached lots.
  const blindLots = makeLots(loadDevItems(home).filter((i) => todo.has(i.itemId)));
  let blindRemaining = 0;
  for (const a of active) {
    for (const lot of blindLots) {
      if (!existsSync(path.join(home, 'l2', `pass${pass}`, a, `${lot.lotId}.json`))) blindRemaining++;
    }
  }
  budgetCheck(home, blindRemaining * 3);
  const dir = path.join(home, 'l2', `pass${pass}`);
  const { mkdirSync, writeFileSync: writeSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { atomicWrite } = await import('./run.mjs');
  atomicWrite(path.join(dir, 'todo.json'), JSON.stringify({ fromPass: last, half: 'blind', items: [...todo] }), { mode: 0o600 });
  // Cross-review context for the blind residuals: own previous vote + two others anonymised +
  // traced complements, from the last converged state (same builder as the main passes).
  const { latest } = latestVotes(home, last);
  const blindRows = (conv.rows ?? []).filter((r) => todo.has(r.itemId));
  const ctx = reconcileContext(blindRows, latest, loadComplements(home));
  writeSync(path.join(dir, 'context.json'), JSON.stringify(ctx), { mode: 0o600 });
  const context = new Map(Object.entries(ctx).map(([a, m]) => [a, new Map(Object.entries(m))]));
  const golden = loadGoldenPack(home);
  await runPass({ pass, mode: 'crossreview', guide: 'FINAL', annotators: active, todo, context, concurrency, home, phase: 'blind-crossreview',
    goldenPack: golden.goldenPack, goldenRows: golden.goldenRows });
  await revalidate(['--pass', String(pass)]);
  await ambiguity(['--pass', String(pass)]);
  const report = await converge(['--pass', String(pass), ...(deferred.length ? ['--deferred', deferred.join(',')] : [])]);
  writeFileSync(path.join(home, 'l2', `pass${pass}.done`), JSON.stringify({ at: new Date().toISOString(), stop: { stop: true, why: 'blind half cross-reviewed once under the frozen guide; reference D next' }, metrics: report.metrics }), { mode: 0o600 });
  status('blind done', { pass, residuals: report.residuals });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'chain.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-chain: ${err.stack}\n`); process.exit(1); });
}
