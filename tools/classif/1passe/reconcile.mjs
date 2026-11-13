import fs from 'node:fs';
import assert from 'node:assert/strict';
import { home, split, context, referenceRows, save, load, writePrivate } from './context.mjs';
import { codesFrom, validate, matchActs, agreement } from './matching.mjs';
const ctx = context(), codes = codesFrom(ctx.pack);
assert.equal(codes.size, 28);
const arms = ['astra-medium', 'opus-5.5-medium'];
const rows = [], inventory = [], issues = {};
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
      unmatched: acts.filter((a) => ![...matched.values()].includes(a)) });
    return matched;
  });
  for (const unit of units) {
    const votes = matches.map((m) => m.get(unit.id) ?? { valid: false, class: 'Non classé', issues: ['missing_annotation'] });
    rows.push({ id: unit.id, document: id, blind, unit, votes,
      disputed: votes.some((v) => !v.valid) || votes[0].code !== votes[1].code,
      finalClass: votes.every((v) => v.valid) && votes[0].code === votes[1].code ? votes[0].class : 'Non classé' });
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
save(`${home}/reference/tuning-prepared`, rows.filter((r) => !r.blind), false);
save(`${home}/reference/blind-prepared`, rows.filter((r) => r.blind), true);
save(`${home}/reference/tuning-inventory`, inventory.filter((r) => !r.blind), false);
save(`${home}/reference/blind-inventory`, inventory.filter((r) => r.blind), true);
writePrivate(`${home}/reference/agreement.json`, summary);
console.log(JSON.stringify(summary));
