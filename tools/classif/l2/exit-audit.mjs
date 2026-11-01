#!/usr/bin/env node
// make classif-l2-exit-audit PASS=<n> [OUT=<dir>] ENV=preprod — exit-code audit (0 LLM call).
// Mandatory measurement: did any ACCEPTED L2 vote of pass <n> come from a seat run with a
// non-zero exit? Lists such votes, then recomputes L2 convergence (Krippendorff α, unanimity)
// and the L3 reference rows WITHOUT any new LLM call, excluding those votes. Reads the home
// read-only; writes only to OUT (default $CLASSIF_HOME/recompute-972).
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';
import { ANNOTATORS, loadCodes, loadDevItems, readPass } from './run.mjs';
import { latestVotes, loadComplements, summarise } from './converge.mjs';
import { buildReferenceRows } from '../l3/reference.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);

export function auditPass(home, pass) {
  const accepted = [];
  const finals = [];
  for (const a of ANNOTATORS) {
    const dir = path.join(home, 'l2', `pass${pass}`, a);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const lot = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      finals.push({ annotator: a, lotId: lot.lotId, exitCode: lot.exitCode, attempts: lot.attempts });
      const valid = lot.annotations.filter((an) => an.valid).map((an) => an.itemId);
      if (lot.exitCode !== 0 && valid.length) accepted.push({ annotator: a, lotId: lot.lotId, exitCode: lot.exitCode, itemIds: valid });
    }
  }
  // Superseded attempts (retried later): informational, must never leak into accepted votes.
  const superseded = [];
  const rawDir = path.join(home, 'l2', `pass${pass}`, 'raw');
  if (existsSync(rawDir)) for (const a of readdirSync(rawDir)) for (const f of readdirSync(path.join(rawDir, a)).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(path.join(rawDir, a, f), 'utf8'));
    if (r.code !== 0) superseded.push({ annotator: a, file: f, code: r.code });
  }
  const calls = path.join(home, 'l2', 'calls.jsonl');
  const callsByExit = {};
  const nonZeroAnsweredAttempts = [];
  if (existsSync(calls)) for (const l of readFileSync(calls, 'utf8').split('\n').filter(Boolean)) {
    const c = JSON.parse(l);
    if (c.pass !== pass) continue;
    callsByExit[String(c.exitCode)] = (callsByExit[String(c.exitCode)] ?? 0) + 1;
    if (c.exitCode !== 0 && (c.answered ?? 0) > 0) nonZeroAnsweredAttempts.push({ annotator: c.annotator, lotId: c.lotId, attempt: c.attempt, exitCode: c.exitCode, answered: c.answered });
  }
  return { accepted, finals, superseded, callsByExit, nonZeroAnsweredAttempts };
}

export function recomputeWithout(home, pass, excluded) {
  const items = loadDevItems(home);
  const { latest } = latestVotes(home, pass);
  const before = summarise(items, latest);
  const filtered = new Map();
  for (const a of ANNOTATORS) {
    const m = new Map(latest.get(a));
    for (const e of excluded.filter((x) => x.annotator === a)) for (const id of e.itemIds) {
      const an = m.get(id);
      if (an) m.set(id, { ...an, valid: false, issues: [...(an.issues ?? []), 'non-zero-exit-excluded'] });
    }
    filtered.set(a, m);
  }
  const after = summarise(items, filtered);
  return { items, before, after, filtered };
}

export function recomputeL3Rows({ items, before, after, filtered }, home, pass) {
  const codes = loadCodes();
  const complements = loadComplements(home);
  const signalStrata = new Map(JSON.parse(readFileSync(path.join(CLASSIF_DIR, 'l0', 'manifests', 'signal-draw-manifest.json'), 'utf8')).items.map((i) => [i.itemId, i]));
  const { latest } = latestVotes(home, pass);
  const refBefore = buildReferenceRows({ items, codes, rows: before.rows, latest, complements, signalStrata, pass });
  const refAfter = buildReferenceRows({ items, codes, rows: after.rows, latest: filtered, complements, signalStrata, pass });
  const changed = refAfter.filter((r, i) => r.code !== refBefore[i].code || r.verdict !== refBefore[i].verdict || r.partition !== refBefore[i].partition);
  return { refBefore, refAfter, changed, complements: complements.size };
}

export async function main() {
  const pass = Number(arg('--pass', '1'));
  const home = classifHome();
  const out = path.resolve(arg('--out', path.join(home, 'recompute-972')));
  const { accepted, finals, superseded, callsByExit, nonZeroAnsweredAttempts } = auditPass(home, pass);
  const convFile = path.join(home, 'l2', `converge-pass${pass}.json`);
  const committed = JSON.parse(readFileSync(convFile, 'utf8'));
  const { items, before, after, filtered } = recomputeWithout(home, pass, accepted);
  const l3 = recomputeL3Rows({ items, before, after, filtered }, home, pass);
  mkdirSync(out, { recursive: true });
  const report = {
    pass, createdAt: new Date().toISOString(), llmCalls: 0,
    lots: finals.length, callsByExit, nonZeroAnsweredAttempts, supersededAttempts: superseded.length, superseded,
    acceptedFromNonZeroExit: accepted,
    metricsCommitted: committed.metrics,
    metricsBefore: before.metrics,
    metricsAfter: after.metrics,
    l3RowsChanged: l3.changed.map((r) => r.itemId), complementsTraced: l3.complements,
  };
  writeFileSync(path.join(out, 'audit.json'), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(path.join(out, `converge-pass${pass}.recomputed.json`), `${JSON.stringify({ pass, metrics: after.metrics, rows: after.rows }, null, 1)}\n`);
  writeFileSync(path.join(out, 'dev-reference.recomputed.jsonl'), `${l3.refAfter.map((r) => JSON.stringify(r)).join('\n')}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, superseded: `[${superseded.length} entries, see audit.json]` }, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'exit-audit.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-exit-audit: ${err.stack}\n`); process.exit(1); });
}
