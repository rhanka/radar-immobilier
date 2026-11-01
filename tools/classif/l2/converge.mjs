#!/usr/bin/env node
// make classif-l2-converge PASS=<n> ENV=preprod — majority per field after pass n (plan §A, §B-L2):
// 3/3 or 2/3, else `non convergé`; an execution failure is a missing vote, never a negative.
// Computes Krippendorff α (verdict, code), verdict unanimity, share of labels changed by the pass,
// applies the stop rule, and prepares pass n+1 (todo = items without 3/3 on the code; reconciliation
// context = own previous annotation + the two others anonymised + traced complements).
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { ANNOTATORS, loadDevItems, readPass } from './run.mjs';
import { readJsonlRecords } from '../lib/jsonl.mjs';
import { krippendorffAlpha, majority, stopDecision } from './agreement.mjs';

/** Latest annotation per annotator and item over passes 1..n. */
export function latestVotes(home, n) {
  const latest = new Map(ANNOTATORS.map((a) => [a, new Map()]));
  const perPass = [];
  for (let p = 1; p <= n; p++) {
    const pass = readPass(home, p);
    perPass.push(pass);
    for (const a of ANNOTATORS) for (const [id, an] of pass.get(a)) latest.get(a).set(id, an);
  }
  return { latest, perPass };
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
    return { itemId: it.itemId, kind: it.kind, votes: code.filter(Boolean).length, code, verdict, codeMaj: cm, verdictMaj: vm, ambiguousMaj: am,
      codeUnanimous: Boolean(cm && cm.count === 3), verdictUnanimous: Boolean(vm && vm.count === 3), ambiguous33: Boolean(am && am.value === 'true' && am.count === 3),
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

function reconcileContext(rows, latest, complements) {
  const ctx = Object.fromEntries(ANNOTATORS.map((a) => [a, {}]));
  for (const r of rows) {
    for (const a of ANNOTATORS) {
      const own = latest.get(a).get(r.itemId);
      const others = ANNOTATORS.filter((b) => b !== a).map((b, i) => ({ who: String.fromCharCode(65 + i), v: latest.get(b).get(r.itemId) }));
      const fmt = (v) => (v?.valid ? `code ${v.code} (${v.verdict}), ambiguous=${v.ambiguous}${v.cause ? ` (${v.cause})` : ''}; quote: « ${String(v.quote ?? '').slice(0, 300)} »; reason: ${String(v.reason ?? '').slice(0, 300)}` : 'no valid annotation');
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

export async function main(argv = process.argv.slice(2)) {
  const n = Number(argv[argv.indexOf('--pass') + 1]);
  const home = classifHome();
  const items = loadDevItems(home);
  const { latest, perPass } = latestVotes(home, n);
  const { rows, metrics } = summarise(items, latest);
  let changedShare = null;
  if (n > 1) {
    const prev = latestVotes(home, n - 1).latest;
    let changed = 0;
    for (const a of ANNOTATORS) for (const [id, an] of perPass[n - 1].get(a)) if (prev.get(a).get(id)?.code !== an.code) changed++;
    changedShare = changed / (items.length * ANNOTATORS.length);
  }
  const stop = stopDecision({ ...metrics, changedShare, pass: n });
  const report = { pass: n, createdAt: new Date().toISOString(), metrics: { ...metrics, changedShare }, stop,
    reannotatedThisPass: Object.fromEntries(ANNOTATORS.map((a) => [a, perPass[n - 1].get(a).size])) };
  const repoDir = path.join(CLASSIF_DIR, 'l2', 'manifests');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, `converge-pass${n}.json`), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(path.join(home, 'l2', `converge-pass${n}.json`), JSON.stringify({ ...report, rows }, null, 1), { mode: 0o600 });
  if (!stop.stop) {
    const todo = rows.filter((r) => !r.codeUnanimous).map((r) => r.itemId);
    const nextDir = path.join(home, 'l2', `pass${n + 1}`);
    mkdirSync(nextDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(nextDir, 'todo.json'), JSON.stringify({ fromPass: n, items: todo }), { mode: 0o600 });
    const ctx = reconcileContext(rows.filter((r) => !r.codeUnanimous), latest, loadComplements(home));
    writeFileSync(path.join(nextDir, 'context.json'), JSON.stringify(ctx), { mode: 0o600 });
    report.next = { pass: n + 1, todo: todo.length };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'converge.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-converge: ${err.stack}\n`); process.exit(1); });
}
