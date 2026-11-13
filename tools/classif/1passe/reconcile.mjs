import fs from 'node:fs';
import assert from 'node:assert/strict';
import { home, split, context, referenceRows, save, load, writePrivate } from './context.mjs';
import { codesFrom, validate, matchActs, agreement } from './matching.mjs';
import { sha256 } from '../lib/refc1.mjs';
const ctx = context(), codes = codesFrom(ctx.pack);
assert.equal(codes.size, 28);
const arms = ['astra-medium', 'opus-5.5-medium'];
const rows = [], inventory = [], issues = {};
const snapshot = `${home}/correction-before`;
if (!fs.existsSync(snapshot)) {
  fs.mkdirSync(snapshot, { mode: 0o700 });
  for (const name of ['agreement.json', 'tuning-prepared.json', 'blind-prepared.sealed'])
    fs.copyFileSync(`${home}/reference/${name}`, `${snapshot}/${name}`);
}
const legacy = (part) => {
  const classes = ['P', 'S', 'N', 'Non classé'], matrix = classes.map(() => classes.map(() => 0));
  for (const r of part) matrix[classes.indexOf(r.votes[0].class)][classes.indexOf(r.votes[1].class)]++;
  const n = part.length, po = matrix.reduce((s, r, i) => s + r[i], 0) / n;
  const pe = matrix.reduce((s, r, i) => s + r.reduce((a, b) => a + b, 0) * matrix.reduce((a, b) => a + b[i], 0), 0) / n ** 2;
  return { acts: n, nonClasseVotes: part.flatMap((r) => r.votes).filter((v) => v.class === 'Non classé').length,
    rawAgreement: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe),
    disputes: part.filter((r) => r.disputed).length, comparableAgreement: agreement(part) };
};
const before = Object.fromEntries(['tuning', 'blind'].map((half) => [half,
  legacy(load(`${snapshot}/${half}-prepared`, half === 'blind'))]));
for (const doc of referenceRows()) {
  const id = doc.itemId;
  assert(ctx.texts.has(id), 'identifiant du PV');
  const text = ctx.texts.get(id), blind = split.blind.includes(id), units = doc.expected.units;
  const matches = arms.map((arm) => {
    const file = `${home}/annotation/${arm}/${id}`;
    const response = fs.existsSync(`${file}.${blind ? 'sealed' : 'json'}`) ? load(file, blind) : { acts: [], valid: false, error: 'missing_annotation' };
    const acts = (response.valid ? response.acts : []).map((a) => validate(a, text, codes));
    for (const a of acts) for (const issue of a.issues) issues[issue] = (issues[issue] ?? 0) + 1;
    const matched = matchActs(units, acts, text);
    inventory.push({ document: id, arm, blind, extracted: acts.length, matched: matched.size,
      collisions: matched.collisions, unmatched: acts.filter((a) => ![...matched.values()].includes(a)) });
    matched.absence = response.error === 'execution_interrupted' ? 'interrompu' : response.error && response.error !== 'missing_annotation' ? 'erreur' : 'absent';
    return matched;
  });
  for (const unit of units) {
    const votes = matches.map((m) => {
      const status = m.collisions.some((c) => c.id === unit.id) ? 'collision' : m.absence;
      return m.get(unit.id) ?? { valid: false, class: null, status,
        issues: [status === 'collision' ? 'matching_collision' : status === 'interrompu' ? 'execution_interrupted' : 'missing_annotation'] };
    });
    rows.push({ id: unit.id, document: id, blind, unit, votes,
      disputed: votes.some((v) => !v.valid) || votes[0].code !== votes[1].code,
      finalClass: votes.every((v) => v.valid) && votes[0].code === votes[1].code ? votes[0].class : null });
  }
}
assert.equal(rows.length, 676);
assert.equal(new Set(rows.map((r) => r.id)).size, 676);
const summary = { at: new Date().toISOString(), population: 676, neutral: 43,
  agreement: agreement(rows), disputes: rows.filter((r) => r.disputed).length, validationIssues: issues,
  newInventory: { count: inventory.reduce((n, r) => n + r.unmatched.length, 0),
    status: 'Inventaires hors B conservés, sans ajout automatique au support D1.' },
  halves: Object.fromEntries(['tuning', 'blind'].map((half) => [half, {
    acts: rows.filter((r) => r.blind === (half === 'blind')).length,
    disputes: rows.filter((r) => r.blind === (half === 'blind') && r.disputed).length }])) };
const base = fs.readFileSync('tools/classif/1passe/arbitration-prompt.md', 'utf8');
for (const half of ['tuning', 'blind']) {
  const part = rows.filter((r) => r.blind === (half === 'blind'));
  const pending = [];
  for (const row of part.filter((r) => r.disputed)) {
    const file = `${home}/arbitration/${row.id.replaceAll('#', '_')}`, ext = row.blind ? 'sealed' : 'json';
    const act = { object: row.unit.label, stage: row.unit.stage, quote: row.unit.citation, page: row.unit.page };
    const opinions = row.votes.map((v) => ({ code: v.valid ? v.code : null, quote: v.quote ?? '', reason: v.reason ?? '', issues: v.issues }));
    const prompt = `${base}\n\n${ctx.pack}\n\nACTE À ARBITRER\n${JSON.stringify(act)}\nAVIS A ET B\n${JSON.stringify(opinions)}\nDOCUMENT INTÉGRAL\n${ctx.texts.get(row.document)}`;
    const outcome = fs.existsSync(`${file}.${ext}`) ? load(file, row.blind) : null;
    const samePrompt = [0, 1, 2].some((i) => fs.existsSync(`${file}.intent-${i}.${ext}`)
      && load(`${file}.intent-${i}`, row.blind).promptSha256 === sha256(prompt));
    if (!(samePrompt && outcome?.status === 'resolved' && validate({ ...outcome.answer, ambiguous: false, page: row.unit.page }, ctx.texts.get(row.document), codes).valid))
      pending.push({ ...row, previousD3: outcome?.status ?? null, samePrompt });
  }
  save(`${home}/reference/${half}-d3-remaining`, pending, half === 'blind');
  summary.halves[half] = { ...summary.halves[half], agreement: agreement(part), nonClasseVotes: 0,
    voteStatuses: Object.fromEntries(['valide', 'invalide', 'absent', 'interrompu', 'erreur', 'collision'].map((s) => [s, part.flatMap((r) => r.votes).filter((v) => v.status === s).length])),
    ambiguousVotes: part.flatMap((r) => r.votes).filter((v) => v.ambiguous === true).length,
    d3Remaining: pending.length, reusableD3: part.filter((r) => r.disputed).length - pending.length };
}
summary.before = before;
summary.matcherSha256 = sha256(fs.readFileSync('tools/classif/1passe/matching.mjs'));
summary.d3Remaining = Object.values(summary.halves).reduce((s, h) => s + h.d3Remaining, 0);
summary.argonEstimate = { firstAttempts: summary.d3Remaining, upperWithTwoRetries: 3 * summary.d3Remaining, launched: 0 };
save(`${home}/reference/tuning-prepared`, rows.filter((r) => !r.blind), false);
save(`${home}/reference/blind-prepared`, rows.filter((r) => r.blind), true);
save(`${home}/reference/tuning-inventory`, inventory.filter((r) => !r.blind), false);
save(`${home}/reference/blind-inventory`, inventory.filter((r) => r.blind), true);
writePrivate(`${home}/reference/agreement.json`, summary);
console.log(JSON.stringify(summary));
