#!/usr/bin/env node
// make classif-l2-converge PASS=<n> ENV=preprod — majority per field after pass n (plan §A, §B-L2):
// 3/3 or 2/3, else `non convergé`; an execution failure is a missing vote, never a negative.
// Computes Krippendorff α (verdict, code), verdict unanimity, share of labels changed by the pass,
// applies the stop rule, and prepares pass n+1 (todo = items without 3/3 on the code; reconciliation
// context = own previous annotation + the two others anonymised + traced complements).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { ANNOTATORS, loadDevItems, readPass } from './run.mjs';
import { readJsonlRecords } from '../lib/jsonl.mjs';
import { krippendorffAlpha, majority, stopDecision } from './agreement.mjs';

/**
 * Latest annotation per annotator and item over passes 1..n. A deferred annotator (Argon quota,
 * plan v3) casts no new vote: its last vote stays current until it rejoins. When pass p carries
 * no vote for an annotator that voted in p-1, the p-1 vote is carried forward and the gap is
 * recorded (never silently: gaps land in the converge report and the manifest).
 */
export function latestVotes(home, n, { deferred = [] } = {}) {
  const latest = new Map(ANNOTATORS.map((a) => [a, new Map()]));
  const gaps = [];
  const perPass = [];
  for (let p = 1; p <= n; p++) {
    const pass = readPass(home, p);
    perPass.push(pass);
    for (const a of ANNOTATORS) {
      const votes = pass.get(a);
      if (votes.size === 0 && p > 1 && latest.get(a).size > 0) {
        for (const [id, an] of latest.get(a)) votes.set(id, { ...an, carriedFrom: p - 1 });
        gaps.push({ annotator: a, pass: p, carriedFrom: p - 1, votes: votes.size });
      }
      for (const [id, an] of votes) latest.get(a).set(id, an);
    }
  }
  return { latest, perPass, gaps, deferred };
}

/**
 * Cross-review todo of a pass (plan v3 A2): items NOT 3/3 on code, OR NOT 3/3 on verdict,
 * OR flagged ambiguous by at least one annotator. Verdict follows the code partition, so a
 * verdict split without a code split only happens with missing/invalid votes — still re-done.
 */
export function residualTodo(rows) {
  return rows.filter((r) => !r.codeUnanimous || !r.verdictUnanimous || r.ambiguousByOne).map((r) => r.itemId);
}

export function summarise(items, latest) {
  const rows = items.map((it) => {
    const votes = ANNOTATORS.map((a) => latest.get(a).get(it.itemId) ?? null);
    const code = votes.map((v) => (v?.valid ? v.code : null));
    const verdict = votes.map((v) => (v?.valid ? v.verdict : null));
    const amb = votes.map((v) => (v?.valid ? String(v.ambiguous) : null));
    const cm = majority(code);
    const vm = majority(verdict);
    const am = majority(amb);
    const validVotes = votes.filter((v) => v?.valid);
    return { itemId: it.itemId, kind: it.kind, votes: code.filter(Boolean).length, code, verdict, codeMaj: cm, verdictMaj: vm, ambiguousMaj: am,
      codeUnanimous: Boolean(cm && cm.count === 3), verdictUnanimous: Boolean(vm && vm.count === 3), ambiguous33: Boolean(am && am.value === 'true' && am.count === 3),
      ambiguousByOne: validVotes.some((v) => v.ambiguous === true),
      ambiguousVotes: validVotes.map((v) => ({ code: v.code, verdict: v.verdict, ambiguous: v.ambiguous, cause: v.cause ?? null, goldenPrecedent: v.goldenPrecedent ?? [], labelProvenance: v.labelProvenance ?? null })),
      missingInfo: votes.some((v) => v?.valid && v.ambiguous && v.cause === 'missing-information') };
  });
  const n = rows.length;
  const share = (f) => rows.filter(f).length / n;
  return {
    rows,
    metrics: {
      items: n,
      alphaVerdict: krippendorffAlpha(rows.map((r) => r.verdict)),
      alphaCode: krippendorffAlpha(rows.map((r) => r.code)),
      verdictUnanimity: share((r) => r.verdictUnanimous),
      verdictConverged: share((r) => r.verdictMaj),
      codeUnanimity: share((r) => r.codeUnanimous),
      codeConverged: share((r) => r.codeMaj),
      nonConvergedCode: rows.filter((r) => !r.codeMaj).length,
      nonConvergedVerdict: rows.filter((r) => !r.verdictMaj).length,
      executionFailures: rows.reduce((s, r) => s + (3 - r.votes), 0),
      ambiguous33: rows.filter((r) => r.ambiguous33).length,
      missingInfoFlagged: rows.filter((r) => r.missingInfo).length,
    },
  };
}

export function reconcileContext(rows, latest, complements) {
  const ctx = Object.fromEntries(ANNOTATORS.map((a) => [a, {}]));
  for (const r of rows) {
    for (const a of ANNOTATORS) {
      const own = latest.get(a).get(r.itemId);
      const others = ANNOTATORS.filter((b) => b !== a).map((b, i) => ({ who: String.fromCharCode(65 + i), v: latest.get(b).get(r.itemId) }));
      const fmt = (v) => (v?.valid ? `code ${v.code} (${v.verdict}), ambiguous=${v.ambiguous}${v.cause ? ` (${v.cause})` : ''}${(v.goldenPrecedent ?? []).length ? `, golden_precedent: [${v.goldenPrecedent.join(',')}]` : ''}${v.labelProvenance ? `, provenance: ${v.labelProvenance}` : ''}; quote: « ${String(v.quote ?? '').slice(0, 300)} »; reason: ${String(v.reason ?? '').slice(0, 300)}` : 'no valid annotation');
      const comp = (complements.get(r.itemId) ?? []).map((c) => `\n[External complement, traced: ${c.url} — fetched ${c.fetchedAt}, sha256 ${c.sha256.slice(0, 16)}…]\n${c.excerpt}`).join('\n');
      ctx[a][r.itemId] = `\n**Your previous annotation:** ${fmt(own)}\n**Annotator ${others[0].who}:** ${fmt(others[0].v)}\n**Annotator ${others[1].who}:** ${fmt(others[1].v)}${comp ? `\n${comp}` : ''}\n`;
    }
  }
  return ctx;
}

export function loadComplements(home) {
  const f = path.join(home, 'l2', 'scrape-manifest.jsonl');
  const m = new Map();
  // Tolerant: a truncated last line from a killed scrape never throws here.
  for (const r of readJsonlRecords(f)) {
    if (r?.status !== 'ok' || !r.excerptPath) continue;
    const excerpt = readFileSync(r.excerptPath, 'utf8');
    m.set(r.itemId, [...(m.get(r.itemId) ?? []), { url: r.url, fetchedAt: r.fetchedAt, sha256: r.sha256, excerpt }]);
  }
  return m;
}

/**
 * Cause classes of the residual items after pass n, from the ambiguity map
 * (make classif-l2-ambiguity-map PASS=n). Missing map = not classified.
 */
export function residualsClassified(home, n, todo) {
  const f = path.join(home, 'l2', `ambiguity-pass${n}.json`);
  if (!existsSync(f)) return { classified: false, causes: {}, missing: todo };
  const map = JSON.parse(readFileSync(f, 'utf8'));
  const byId = new Map((map.residuals ?? []).map((r) => [r.itemId, r.cause]));
  const missing = todo.filter((id) => !byId.has(id));
  const causes = {};
  for (const id of todo) if (byId.has(id)) causes[byId.get(id)] = (causes[byId.get(id)] ?? 0) + 1;
  return { classified: missing.length === 0, causes, missing };
}

export async function main(argv = process.argv.slice(2)) {
  const n = Number(argv[argv.indexOf('--pass') + 1]);
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  const home = classifHome();
  const items = loadDevItems(home);
  const { latest, perPass, gaps } = latestVotes(home, n, { deferred });
  const { rows, metrics } = summarise(items, latest);
  const todo = residualTodo(rows);
  // Changed share over the votes re-annotated this pass (valid or not, carried votes excluded:
  // a deferred annotator repeats its last vote, which must not count as resolved work).
  let changedShare = null;
  let reannotated = 0;
  if (n > 1) {
    const prev = latestVotes(home, n - 1, { deferred }).latest;
    let changed = 0;
    for (const a of ANNOTATORS) {
      for (const [id, an] of perPass[n - 1].get(a)) {
        if (an.carriedFrom) continue;
        reannotated++;
        if (prev.get(a).get(id)?.code !== an.code) changed++;
      }
    }
    changedShare = reannotated ? changed / reannotated : null;
  }
  const { classified: allClassified, causes, missing } = residualsClassified(home, n, todo);
  const residuals = { count: todo.length, causes, unclassified: missing, unclassifiedCount: missing.length };
  const stop = n === 1
    ? { stop: false, why: 'pass 1 is blind: convergence is descriptive, the split must be committed before any A2 cross-review pass' }
    : stopDecision({ changedShare, pass: n, residualsClassified: allClassified });
  const { spent, BUDGET_CAP } = await import('../lib/budget.mjs').then((m) => ({ spent: m.spent(home), BUDGET_CAP: m.BUDGET_CAP }));
  const report = { pass: n, createdAt: new Date().toISOString(), deferred, gaps,
    metrics: { ...metrics, changedShare, reannotatedVotes: reannotated }, residuals, stop, budget: { spent, cap: BUDGET_CAP },
    reannotatedThisPass: Object.fromEntries(ANNOTATORS.map((a) => [a, perPass[n - 1].get(a).size])) };
  const repoDir = path.join(CLASSIF_DIR, 'l2', 'manifests');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, `converge-pass${n}.json`), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(path.join(home, 'l2', `converge-pass${n}.json`), JSON.stringify({ ...report, rows }, null, 1), { mode: 0o600 });
  if (!stop.stop) {
    const nextDir = path.join(home, 'l2', `pass${n + 1}`);
    mkdirSync(nextDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(nextDir, 'todo.json'), JSON.stringify({ fromPass: n, items: todo }), { mode: 0o600 });
    const ctx = reconcileContext(rows.filter((r) => todo.includes(r.itemId)), latest, loadComplements(home));
    writeFileSync(path.join(nextDir, 'context.json'), JSON.stringify(ctx), { mode: 0o600 });
    report.next = { pass: n + 1, todo: todo.length };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'converge.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-converge: ${err.stack}\n`); process.exit(1); });
}
