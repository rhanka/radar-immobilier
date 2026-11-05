#!/usr/bin/env node
// make classif-l2-ambiguity-map PASS=<n> ENV=preprod — ambiguity map of the residual items
// (plan v3 A3, review §A-1c). Clusters every cross-review residual by ONE cause class:
//   code-pair-confusion | definition-gap | missing-information | data-outside-immo | golden-set-conflict
// Writes a JSON file and a markdown table (counts, items, code pairs), plus a question draft:
// one general question per cause cluster with illustrated cases (for the Chaperon, via the PO).
// 0 model call.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RESIDUAL_CAUSES } from './annotation.mjs';
import { residualTodo } from './converge.mjs';
import { readJsonlRecords } from '../lib/jsonl.mjs';
import { CLASSIF_DIR, classifHome } from '../lib/paths.mjs';

// Complement unavailable: the item needs data outside the immo-served text.
const REFUSED = new Set(['refused-fingerprint', 'robots-disallowed', 'fetch-error', 'http-error', 'no-text', 'no-matching-page']);
const refusedStatus = (status, kind) => REFUSED.has(status) || (status === 'no-target' && kind === 'signal');

/** Scrape statuses per item: Map<itemId, status>. Tolerant of a truncated tail. */
export function loadScrapeStatus(home) {
  const m = new Map();
  for (const r of readJsonlRecords(path.join(home, 'l2', 'scrape-manifest.jsonl'))) {
    if (r?.itemId && r?.status) m.set(r.itemId, r.status);
  }
  return m;
}

/**
 * Cause of one residual item. Rule order is binding (first match wins):
 *  1. a vote flags missing-information AND the complement is refused/unavailable → data-outside-immo;
 *  2. a vote flags missing-information (complement available) → missing-information;
 *  3. citing votes support different codes, or a cited golden row decides another code → golden-set-conflict;
 *  4. the item's top-2 codes are a frequent confused pair of this pass → code-pair-confusion;
 *  5. every valid vote is ambiguous, or a vote cause is conflicting-information/scope-unclear → definition-gap.
 */
export function classifyResidual(votes, { kind, scrapeStatus, confusedPairs, goldenCodes }) {
  const valid = votes.filter((v) => v?.code);
  const codes = [...new Set(valid.map((v) => v.code))].sort();
  if (valid.some((v) => v.ambiguous === true && v.cause === 'missing-information')) {
    if (refusedStatus(scrapeStatus, kind)) return { cause: 'data-outside-immo', detail: `missing-information flagged, complement ${scrapeStatus ?? 'absent'}` };
    return { cause: 'missing-information', detail: 'missing-information flagged, complement available or pending' };
  }
  const citing = valid.filter((v) => (v.goldenPrecedent ?? []).length > 0);
  const citingCodes = new Set(citing.map((v) => v.code));
  const citedCodes = new Set();
  for (const v of citing) {
    for (const row of v.goldenPrecedent ?? []) {
      const g = goldenCodes?.get(row);
      if (g?.code) citedCodes.add(g.code);
    }
  }
  if (citing.length > 0 && (citingCodes.size > 1 || (citedCodes.size > 0 && ![...citedCodes].every((c) => citingCodes.has(c))))) {
    return { cause: 'golden-set-conflict', detail: `cited rows support ${[...citedCodes].join('/') || 'nothing cited'} while citing votes say ${[...citingCodes].join('/')}` };
  }
  const pair = codes.slice(0, 2).join(' × ');
  if (codes.length >= 2 && confusedPairs.has(pair)) return { cause: 'code-pair-confusion', detail: `frequent pair of this pass: ${pair}` };
  return { cause: 'definition-gap', detail: codes.length > 1 ? `codes ${codes.join('/')} with no guide rule deciding` : 'ambiguous without a deciding rule' };
}

/** Pairs (top-2 codes) seen on ≥ 2 residuals of the pass: the confused pairs. */
export function confusedPairsOf(residuals) {
  const counts = new Map();
  for (const r of residuals) {
    const codes = [...new Set((r.votes ?? []).filter((v) => v?.code).map((v) => v.code))].sort();
    if (codes.length >= 2) {
      const pair = codes.slice(0, 2).join(' × ');
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
  }
  return { pairs: new Set([...counts].filter(([, c]) => c >= 2).map(([p]) => p)), counts: Object.fromEntries(counts) };
}

export function renderTable(map) {
  const lines = [`| Cause | Items | Codes | Item ids |`, `|---|---|---|---|`];
  for (const cause of RESIDUAL_CAUSES) {
    const rs = map.residuals.filter((r) => r.cause === cause);
    if (!rs.length) continue;
    const codes = [...new Set(rs.flatMap((r) => r.codes))].sort().join(', ');
    lines.push(`| ${cause} | ${rs.length} | ${codes} | ${rs.map((r) => r.itemId).join(', ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** One general question per cause cluster, with illustrated cases (Chaperon, via the PO). */
export function renderQuestions(map) {
  const out = [`# Resolution questions — pass ${map.pass} (${map.residuals.length} residual items)`, ``];
  for (const cause of RESIDUAL_CAUSES) {
    const rs = map.residuals.filter((r) => r.cause === cause);
    if (!rs.length) continue;
    const general = {
      'code-pair-confusion': `When two codes of the registry both seem to apply, which observable fact in the item text decides between them?`,
      'definition-gap': `Which rule is missing from the guide to decide these items consistently with Steve's criteria?`,
      'missing-information': `Which external source would decide these items, and is it in scope for the radar?`,
      'data-outside-immo': `These items need data outside the immo-served text. Should the radar fetch it, or are they out of scope?`,
      'golden-set-conflict': `Steve's triage rows cited as precedent point to different codes than the item text suggests. Which reading wins, and why?`,
    }[cause];
    out.push(`## ${cause} (${rs.length})`, ``, general, ``);
    for (const r of rs.slice(0, 8)) out.push(`- ${r.itemId} (${r.kind}): codes ${r.codes.join('/')} — ${r.detail}`);
    if (rs.length > 8) out.push(`- … and ${rs.length - 8} more (see the JSON map)`);
    out.push(``);
  }
  return `${out.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const n = Number(argv[argv.indexOf('--pass') + 1]);
  const home = classifHome();
  const conv = JSON.parse(readFileSync(path.join(home, 'l2', `converge-pass${n}.json`), 'utf8'));
  const rows = conv.rows;
  const todo = new Set(residualTodo(rows));
  const residuals = rows.filter((r) => todo.has(r.itemId));
  const scrape = loadScrapeStatus(home);
  const codesFile = path.join(home, 'pack-golden', 'codes.json');
  const goldenCodes = new Map(existsSync(codesFile) ? Object.entries(JSON.parse(readFileSync(codesFile, 'utf8'))).map(([k, v]) => [Number(k), v]) : []);
  const { pairs } = confusedPairsOf(residuals.map((r) => ({ votes: r.ambiguousVotes ?? [] })));
  const mapped = residuals.map((r) => {
    const votes = (r.ambiguousVotes ?? []).map((v) => ({ code: v.code, ambiguous: v.ambiguous, cause: v.cause, goldenPrecedent: v.goldenPrecedent ?? [] }));
    const { cause, detail } = classifyResidual(votes, { kind: r.kind, scrapeStatus: scrape.get(r.itemId), confusedPairs: pairs, goldenCodes });
    return { itemId: r.itemId, kind: r.kind, cause, detail, codes: [...new Set(votes.map((v) => v.code))].sort(), codeMaj: r.codeMaj?.value ?? null };
  });
  const counts = Object.fromEntries(RESIDUAL_CAUSES.map((c) => [c, mapped.filter((r) => r.cause === c).length]));
  const map = { kind: 'ambiguity-map', pass: n, createdAt: new Date().toISOString(), llmCalls: 0,
    residuals: mapped, counts, codePairs: confusedPairsOf(residuals.map((r) => ({ votes: r.ambiguousVotes ?? [] }))).counts };
  const table = renderTable(map);
  const questions = renderQuestions(map);
  writeFileSync(path.join(home, 'l2', `ambiguity-pass${n}.json`), `${JSON.stringify(map, null, 1)}\n`, { mode: 0o600 });
  writeFileSync(path.join(home, 'l2', `ambiguity-pass${n}.md`), table, { mode: 0o600 });
  writeFileSync(path.join(home, 'l2', `questions-pass${n}.md`), questions, { mode: 0o600 });
  const repoManifest = { kind: 'ambiguity-map', pass: n, createdAt: map.createdAt, counts: map.counts, residuals: mapped.length, codePairs: map.codePairs };
  mkdirSync(path.join(CLASSIF_DIR, 'l2', 'manifests'), { recursive: true });
  writeFileSync(path.join(CLASSIF_DIR, 'l2', 'manifests', `ambiguity-pass${n}.json`), `${JSON.stringify(repoManifest, null, 1)}\n`);
  process.stdout.write(table);
  return map;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'ambiguity.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-ambiguity-map: ${err.stack}\n`); process.exit(1); });
}
