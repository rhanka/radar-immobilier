#!/usr/bin/env node
// make classif-l2-amend FROM=<guide> TO=<guide> PASS=<n> ENV=preprod — guide amendment (plan §B-L2,
// pass 3): from the residual DEV disagreements after pass n, each of the 3 annotators proposes up to
// 8 amendments to the guide; the union, anonymised, is put to a vote of the 3; amendments with ≥ 2
// votes are adopted into the next guide. Dev items only; the sealed evaluation set is never read.
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { callSeat, parseJsonObject } from '../run-seat.mjs';
import { sha256 } from '../lib/render.mjs';
import { appendJsonlRecord } from '../lib/jsonl.mjs';
import { classifDir, repoRoot, testOnlyEnv, classifHome, privateDir } from '../lib/paths.mjs';
import { check as checkBudget } from '../lib/budget.mjs';
import { quotaFields } from '../lib/codex-quota.mjs';
import { assertNoVerbatim } from '../lib/freeze.mjs';
import { atomicWrite, ANNOTATORS, loadDevItems } from './run.mjs';
import { latestVotes } from './converge.mjs';

/** Tuning-half item ids from the committed split (plan v3 D2: amendments from tuning only).
    Review §3b: the split must be committed clean — an edited uncommitted split is refused.
    Review D1/D2: hermetic tests override via CLASSIF_SPLIT_FILE / CLASSIF_REPO in test
    mode only (temp committed split); production refuses both hooks. */
export function tuningHalf(splitFile = null, repo = null) {
  const env = process.env;
  const file = splitFile ?? testOnlyEnv(env, 'CLASSIF_SPLIT_FILE') ?? path.join(classifDir(env), 'l3', 'manifests', 'split.json');
  const root = repo ?? repoRoot(env);
  if (!existsSync(file)) throw new Error(`split refused: ${file} absent (run make classif-l3b-split first)`);
  const rel = path.relative(root, file);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`split refused: ${rel} is not committed (commit the draw before amending)`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`split refused: ${rel} differs from the committed version (commit before amending)`);
  const m = JSON.parse(readFileSync(file, 'utf8'));
  return new Set(m.halves.tuning);
}

const MAX_PER_ANNOTATOR = 8;

/**
 * Fail-closed seat policy for amendment: a non-zero seat exit OR any tool event
 * contributes nothing — neither a proposal nor a vote — so a failed ballot can never
 * adopt a rule (review N5: Astra in read-only still counts as a tool user).
 */
export function parseProposalList(r) {
  if (!r || r.code !== 0 || (r.toolEvents ?? 0) > 0) return [];
  const j = parseJsonObject(r.text);
  return (Array.isArray(j?.amendments) ? j.amendments : []).slice(0, MAX_PER_ANNOTATOR).filter((x) => typeof x?.rule === 'string' && x.rule.trim());
}

export function parseBallot(r) {
  if (!r || r.code !== 0 || (r.toolEvents ?? 0) > 0) return {};
  return parseJsonObject(r.text)?.votes ?? {};
}

export function tallyAmendments(union, ballotResults) {
  const ballots = ballotResults.map(parseBallot);
  const tally = union.map((x) => ({ ...x, yes: ballots.filter((b) => b[x.id] === true).length }));
  return { ballots, tally, adopted: tally.filter((x) => x.yes >= 2) };
}

// Resume state: each answer is saved as soon as it returns and reused (keyed by prompt sha256).
async function cachedCall(home, annotator, step, prompt, seatTmp, intent = null) {
  const file = path.join(home, 'l2', 'amend-raw', `${step}.${annotator}.${sha256(prompt).slice(0, 16)}.json`);
  if (existsSync(file)) return { ...JSON.parse(readFileSync(file, 'utf8')), reused: true };
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Review §5: intent counted BEFORE the paid call.
  if (intent) appendJsonlRecord(intent.log, { at: new Date().toISOString(), intent: true, ...intent.rec });
  const r = await callSeat(annotator, prompt, { base: seatTmp, timeoutMs: 3600000 });
  atomicWrite(file, JSON.stringify(r), { mode: 0o600 });
  return r;
}

export function disagreementDigest(items, latest, residual) {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return residual.map((id) => {
    const it = byId.get(id);
    const votes = ANNOTATORS.map((a, k) => {
      const v = latest.get(a).get(id);
      return v?.valid ? `  - annotator ${k + 1}: ${v.code} (${v.verdict})${v.ambiguous ? `, ambiguous: ${v.cause}` : ''} — ${String(v.reason ?? '').slice(0, 200)}` : `  - annotator ${k + 1}: no valid annotation`;
    }).join('\n');
    return `### ${id} (${it.kind})\n${it.input.slice(0, 1200)}${it.input.length > 1200 ? ' […]' : ''}\n- votes:\n${votes}`;
  }).join('\n\n');
}

export async function main(argv = process.argv.slice(2)) {
  const arg = (k) => argv[argv.indexOf(k) + 1];
  const from = arg('--from');
  const to = arg('--to');
  const n = Number(arg('--pass'));
  const half = argv.includes('--half') ? argv[argv.indexOf('--half') + 1] : 'tuning';
  // Review §4: amendments come from the tuning half ONLY — any other half fails closed
  // (HALF=blind would smuggle blind items into the guide digest).
  if (half !== 'tuning') throw new Error(`amend refused: half must be 'tuning' (got '${half}')`);
  const deferred = argv.includes('--deferred') ? argv[argv.indexOf('--deferred') + 1].split(',').filter(Boolean) : [];
  const active = ANNOTATORS.filter((a) => !deferred.includes(a));
  const home = classifHome();
  const packDir = path.join(home, 'l1', 'pack');
  const out = path.join(packDir, `guide-${to}.md`);
  if (existsSync(out)) throw new Error(`${out} exists`);
  const guide = readFileSync(path.join(packDir, `guide-${from}.md`), 'utf8');
  const criteria = readFileSync(path.join(packDir, 'criteria.md'), 'utf8');
  const definitions = readFileSync(path.join(packDir, 'codes-definitions.md'), 'utf8');
  const items = loadDevItems(home);
  const { latest, gaps } = latestVotes(home, n, { deferred });
  let residual = JSON.parse(readFileSync(path.join(home, 'l2', `pass${n + 1}`, 'todo.json'), 'utf8')).items;
  // D2: guide amendments are drawn from tuning-half disagreements only (committed split).
  if (half === 'tuning') {
    const tuning = tuningHalf();
    residual = residual.filter((id) => tuning.has(id));
  }
  // Review §7: an empty tuning todo is a GEL (nothing left to amend), not an error.
  if (!residual.length) {
    writeFileSync(out, guide, { mode: 0o600 });
    const gel = { kind: 'guide-amendment', from, to, afterPass: n, createdAt: new Date().toISOString(), half, deferred, gaps,
      residualItems: 0, proposed: 0, adopted: 0, votes: [], calls: [], gel: true, guideSha256: sha256(guide),
      why: `gel: no ${half}-half residual disagreements after pass ${n} (guide ${from} stands, copied to ${to})` };
    writeFileSync(path.join(home, 'l2', `amend-${to}.json`), JSON.stringify({ gel: true, why: gel.why }, null, 1), { mode: 0o600 });
    mkdirSync(path.join(classifDir(process.env), 'l2', 'manifests'), { recursive: true });
    writeFileSync(path.join(classifDir(process.env), 'l2', 'manifests', `amend-${to}.json`), `${JSON.stringify(gel, null, 1)}\n`);
    process.stdout.write(`${JSON.stringify(gel, null, 2)}\n`);
    return gel;
  }
  const digest = disagreementDigest(items, latest, residual);
  const seatTmp = privateDir(path.join(home, 'l2', 'seat-tmp'));
  const common = `You maintain the annotation guide used by three annotators to classify municipal regulatory items for
Steve's residential densification radar. Steve's criteria:\n${criteria}\n\nReason codes:\n${definitions}\n\nCurrent guide ${from}:\n${guide}\n`;
  const proposePrompt = `${common}
After ${n} passes, the annotators still disagree on the development items below (anonymised votes). Propose at most
${MAX_PER_ANNOTATOR} amendments to guide ${from} that would resolve recurring disagreements consistently with Steve's
criteria and the code definitions (general rules, not item-specific decisions). Return ONLY JSON:
{"amendments":[{"rule":"<the rule to add, imperative, ≤ 60 words>","rationale":"<≤ 40 words>"}]}

## Residual disagreements (development items)
${digest}
`;
  const calls = [];
  const callsLog = path.join(home, 'l2', 'calls.jsonl');
  // Review §5 (D5): pre-call control (propose + vote per active annotator, cache deducted
  // inside cachedCall — intents counted before each paid call).
  checkBudget(home, active.length * 2);
  // A deferred annotator neither proposes nor votes; its last votes stand (recorded in the manifest).
  const proposals = (await Promise.all(active.map(async (a) => {
    const r = await cachedCall(home, a, 'propose', proposePrompt, seatTmp,
      { log: callsLog, rec: { phase: `amend-${to}`, pass: n, step: 'propose', annotator: a } });
    appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `amend-${to}`, pass: n, step: 'propose', annotator: a,
      exitCode: r.code, latencyMs: r.latencyMs, reused: Boolean(r.reused), toolEvents: r.toolEvents ?? null, usage: r.usage ?? null, ...(r.reused ? {} : quotaFields(r)) });
    calls.push({ annotator: a, step: 'propose', exitCode: r.code, latencyMs: r.latencyMs, reused: Boolean(r.reused), toolEvents: r.toolEvents ?? null });
    if (r.code !== 0) process.stderr.write(`[amend] ${a} propose seat exit code ${r.code}: proposals inadmissible (fail-closed exit policy)\n`);
    if ((r.toolEvents ?? 0) > 0) process.stderr.write(`[amend] ${a} propose tool events ${r.toolEvents}: proposals inadmissible (fail-closed tool policy)\n`);
    return parseProposalList(r);
  }))).flat();
  const union = proposals.flat().map((x) => ({ rule: x.rule.trim(), rationale: String(x.rationale ?? '').trim() }))
    .sort((x, y) => (sha256(x.rule) < sha256(y.rule) ? -1 : 1)).map((x, i) => ({ id: `X${i + 1}`, ...x }));
  const votePrompt = `${common}
Candidate amendments to guide ${from} (anonymised, from the three annotators). For each, vote true if it should
be added to the guide (consistent with Steve's criteria and the code definitions, general, not redundant), else
false. Return ONLY JSON: {"votes":{"X1":true,"X2":false, ...}}

${union.map((x) => `- ${x.id}: ${x.rule} (rationale: ${x.rationale})`).join('\n')}
`;
  const ballotResults = await Promise.all(active.map(async (a) => {
    const r = await cachedCall(home, a, 'vote', votePrompt, seatTmp,
      { log: callsLog, rec: { phase: `amend-${to}`, pass: n, step: 'vote', annotator: a } });
    appendJsonlRecord(callsLog, { at: new Date().toISOString(), intent: false, phase: `amend-${to}`, pass: n, step: 'vote', annotator: a,
      exitCode: r.code, latencyMs: r.latencyMs, reused: Boolean(r.reused), toolEvents: r.toolEvents ?? null, usage: r.usage ?? null, ...(r.reused ? {} : quotaFields(r)) });
    calls.push({ annotator: a, step: 'vote', exitCode: r.code, latencyMs: r.latencyMs, reused: Boolean(r.reused), toolEvents: r.toolEvents ?? null });
    if (r.code !== 0) process.stderr.write(`[amend] ${a} vote seat exit code ${r.code}: ballot inadmissible (fail-closed exit policy)\n`);
    if ((r.toolEvents ?? 0) > 0) process.stderr.write(`[amend] ${a} vote tool events ${r.toolEvents}: ballot inadmissible (fail-closed tool policy)\n`);
    return r;
  }));
  const { tally, adopted } = tallyAmendments(union, ballotResults);
  const next = `${guide.trim()}\n\n## Amendments adopted in ${to} (majority of the three annotators, after pass ${n})\n\n${adopted.map((x, i) => `${i + 1}. ${x.rule}`).join('\n')}\n`;
  // Review §C: no verbatim golden excerpt in any guide — shingle check before the freeze.
  assertNoVerbatim(next, home, { what: `guide ${to}` });
  writeFileSync(out, next, { mode: 0o600 });
  writeFileSync(path.join(home, 'l2', `amend-${to}.json`), JSON.stringify({ tally, calls }, null, 1), { mode: 0o600 });
  const manifest = { kind: 'guide-amendment', from, to, afterPass: n, createdAt: new Date().toISOString(), half, deferred, gaps,
    residualItems: residual.length, proposed: union.length, adopted: adopted.length, votes: tally.map((x) => x.yes), calls, guideSha256: sha256(next) };
  const repoDir = path.join(classifDir(process.env), 'l2', 'manifests');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, `amend-${to}.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'amend.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-amend: ${err.stack}\n`); process.exit(1); });
}
