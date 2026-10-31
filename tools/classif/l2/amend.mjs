#!/usr/bin/env node
// make classif-l2-amend FROM=<guide> TO=<guide> PASS=<n> ENV=preprod — guide amendment (plan §B-L2,
// pass 3): from the residual DEV disagreements after pass n, each of the 3 annotators proposes up to
// 8 amendments to the guide; the union, anonymised, is put to a vote of the 3; amendments with ≥ 2
// votes are adopted into the next guide. Dev items only; the sealed evaluation set is never read.
import path from 'node:path';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { callSeat, parseJsonObject } from '../run-seat.mjs';
import { sha256 } from '../lib/render.mjs';
import { CLASSIF_DIR, classifHome, privateDir } from '../lib/paths.mjs';
import { ANNOTATORS, loadDevItems } from './run.mjs';
import { latestVotes } from './converge.mjs';

const MAX_PER_ANNOTATOR = 8;

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
  const home = classifHome();
  const packDir = path.join(home, 'l1', 'pack');
  const out = path.join(packDir, `guide-${to}.md`);
  if (existsSync(out)) throw new Error(`${out} exists`);
  const guide = readFileSync(path.join(packDir, `guide-${from}.md`), 'utf8');
  const criteria = readFileSync(path.join(packDir, 'criteria.md'), 'utf8');
  const definitions = readFileSync(path.join(packDir, 'codes-definitions.md'), 'utf8');
  const items = loadDevItems(home);
  const { latest } = latestVotes(home, n);
  const residual = JSON.parse(readFileSync(path.join(home, 'l2', `pass${n + 1}`, 'todo.json'), 'utf8')).items;
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
  const proposals = await Promise.all(ANNOTATORS.map(async (a) => {
    const r = await callSeat(a, proposePrompt, { base: seatTmp, timeoutMs: 1800000 });
    calls.push({ annotator: a, step: 'propose', exitCode: r.code, latencyMs: r.latencyMs });
    const j = parseJsonObject(r.text);
    return (Array.isArray(j?.amendments) ? j.amendments : []).slice(0, MAX_PER_ANNOTATOR).filter((x) => typeof x?.rule === 'string' && x.rule.trim());
  }));
  const union = proposals.flat().map((x) => ({ rule: x.rule.trim(), rationale: String(x.rationale ?? '').trim() }))
    .sort((x, y) => (sha256(x.rule) < sha256(y.rule) ? -1 : 1)).map((x, i) => ({ id: `X${i + 1}`, ...x }));
  const votePrompt = `${common}
Candidate amendments to guide ${from} (anonymised, from the three annotators). For each, vote true if it should
be added to the guide (consistent with Steve's criteria and the code definitions, general, not redundant), else
false. Return ONLY JSON: {"votes":{"X1":true,"X2":false, ...}}

${union.map((x) => `- ${x.id}: ${x.rule} (rationale: ${x.rationale})`).join('\n')}
`;
  const ballots = await Promise.all(ANNOTATORS.map(async (a) => {
    const r = await callSeat(a, votePrompt, { base: seatTmp, timeoutMs: 1800000 });
    calls.push({ annotator: a, step: 'vote', exitCode: r.code, latencyMs: r.latencyMs });
    return parseJsonObject(r.text)?.votes ?? {};
  }));
  const tally = union.map((x) => ({ ...x, yes: ballots.filter((b) => b[x.id] === true).length }));
  const adopted = tally.filter((x) => x.yes >= 2);
  const next = `${guide.trim()}\n\n## Amendments adopted in ${to} (majority of the three annotators, after pass ${n})\n\n${adopted.map((x, i) => `${i + 1}. ${x.rule}`).join('\n')}\n`;
  writeFileSync(out, next, { mode: 0o600 });
  writeFileSync(path.join(home, 'l2', `amend-${to}.json`), JSON.stringify({ tally, calls }, null, 1), { mode: 0o600 });
  const manifest = { kind: 'guide-amendment', from, to, afterPass: n, createdAt: new Date().toISOString(), residualItems: residual.length,
    proposed: union.length, adopted: adopted.length, votes: tally.map((x) => x.yes), calls, guideSha256: sha256(next) };
  const repoDir = path.join(CLASSIF_DIR, 'l2', 'manifests');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, `amend-${to}.json`), `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'amend.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-amend: ${err.stack}\n`); process.exit(1); });
}
