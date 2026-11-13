import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseJsonObject } from '../../run-seat.mjs';
import { sha256 } from '../../lib/refc1.mjs';
import { codesFrom } from '../matching.mjs';
import { dir, home, freeze, split, references, documents, load, write, save, json } from './context.mjs';
import { baseline } from './baseline.mjs';
import { metric, pair, predictionClass } from './metrics.mjs';
const codes = codesFrom(fs.readFileSync(`${dir}/prompt.md`, 'utf8'));
assert.equal(codes.size, 28);
const docs = new Map(documents().map((d) => [d.id, d]));
const rows = [], receipts = [], missLines = [], inventories = [];
for (const ref of references()) {
  const d = docs.get(ref.itemId), units = ref.expected.units;
  const file = `${home}/responses/${d.id}`, exists = fs.existsSync(`${file}.${d.blind ? 'sealed' : 'json'}`);
  const response = exists ? load(file, d.blind) : null, r = response?.result;
  const parsed = r?.code === 0 && !r.toolEvents && !r.errorEnvelope ? parseJsonObject(r.text) : null;
  const valid = Array.isArray(parsed?.acts);
  const acts = valid ? parsed.acts.filter((a) => a && typeof a === 'object').map((a) => ({ ...a, class: predictionClass(a, codes) })) : [];
  const matches = pair(units, acts, d.text), b = baseline(d), bm = pair(units, b.acts, d.text);
  const neutral = pair(ref.expected.neutral ?? [], acts.filter((a) => ![...matches.values()].includes(a)), d.text);
  receipts.push({ document: d.id, blind: d.blind, valid, usage: r?.usage ?? null, latencyMs: r?.latencyMs ?? null,
    toolEvents: r?.toolEvents ?? 0, baselineMissing: b.missing ?? false, baselineUsage: b.usage ?? null,
    baselineSha256: b.sha256 ?? null, answerSha256: exists ? sha256(fs.readFileSync(`${file}.${d.blind ? 'sealed' : 'json'}`)) : null });
  inventories.push({ blind: d.blind, predictions: acts.length, neutralMatched: neutral.size,
    classes: Object.fromEntries(['P', 'S', 'N', 'Non classé'].map((c) => [c, acts.filter((a) => a.class === c).length])) });
  for (const u of units) {
    const a = matches.get(u.id), detected = Boolean(a), visible = detected && a.class !== 'N', ps = detected && ['P', 'S'].includes(a.class);
    rows.push({ id: u.id, document: d.id, blind: d.blind, detected, visible, ps, class: a?.class ?? null, bDetected: bm.has(u.id) });
    if (!d.blind && (!detected || !visible || !ps)) {
      const sameNumber = acts.find((x) => x.target_number && `${u.label} ${u.objet}`.includes(x.target_number));
      const cause = !valid ? 'Échec technique ou réponse invalide.' : !detected
        ? sameNumber ? 'Candidat de même numéro présent ; preuve, étape ou objet insuffisant pour l’appariement figé.'
          : 'Acte absent de la liste appariable ; omission d’extraction ou citation non rapprochable.'
        : a.class === 'N' ? `Acte détecté puis masqué : ${a.code}. ${a.reason}`
          : `Acte détecté et visible en Non classé : ${a.code}. ${a.reason}`;
      missLines.push({ document: d.id, id: u.id, act: u.label, stage: u.stage, page: u.page,
        detectionMiss: !detected, visibleMiss: !visible, psMiss: !ps, probableCause: cause,
        sourceUrl: u.sourceUrl });
    }
  }
}
assert.equal(rows.length, 676);
assert.equal(new Set(rows.map((r) => r.id)).size, 676);
const cost = (rs, field) => ({ measured: rs.filter((r) => r[field]).length,
  input: rs.reduce((n, r) => n + (r[field]?.input_tokens ?? r[field]?.inputTokens ?? 0), 0),
  output: rs.reduce((n, r) => n + (r[field]?.output_tokens ?? r[field]?.outputTokens ?? 0), 0),
  cached: rs.reduce((n, r) => n + (r[field]?.cached_input_tokens ?? r[field]?.cachedTokens ?? 0), 0) });
const halves = Object.fromEntries(['tuning', 'blind', 'total'].map((half) => {
  const sub = rows.filter((r) => half === 'total' || r.blind === (half === 'blind'));
  const rec = receipts.filter((r) => half === 'total' || r.blind === (half === 'blind'));
  const inv = inventories.filter((r) => half === 'total' || r.blind === (half === 'blind'));
  return [half, { pv: rec.length, support: sub.length,
    detection: metric(sub.filter((r) => r.detected).length, sub.length),
    visible: metric(sub.filter((r) => r.visible).length, sub.length),
    ps: metric(sub.filter((r) => r.ps).length, sub.length),
    maskedByN: sub.filter((r) => r.detected && !r.visible).length,
    baselineDetection: rec.some((r) => r.baselineMissing) ? 'missing source' : metric(sub.filter((r) => r.bDetected).length, sub.length),
    baselineVisible: 'missing source', baselinePS: 'missing source',
    invalidResponses: rec.filter((r) => !r.valid).length, toolEvents: rec.reduce((n, r) => n + r.toolEvents, 0),
    predictions: inv.reduce((n, r) => n + r.predictions, 0), neutralMatched: inv.reduce((n, r) => n + r.neutralMatched, 0),
    predictionClasses: Object.fromEntries(['P', 'S', 'N', 'Non classé'].map((c) => [c, inv.reduce((n, r) => n + r.classes[c], 0)])),
    tokens: cost(rec, 'usage'), baselineDetectionTokens: cost(rec, 'baselineUsage'), baselineClassificationTokens: 'missing source' }];
}));
const stamp = Date.now(), privateScores = { tuning: `score-tuning-${stamp}`, blind: `score-blind-${stamp}` };
save(`${home}/${privateScores.tuning}`, rows.filter((r) => !r.blind), false);
save(`${home}/${privateScores.blind}`, rows.filter((r) => r.blind), true);
write(`${home}/misses-tuning.json`, missLines);
write(`${home}/MISSES-TUNING.md`, '# Manqués de mise au point\n\nCauses probables automatiques. Aucun cas aveugle.\n\n'
  + missLines.map((m) => `- **${m.document} — ${m.id}** : ${m.act} (${m.stage}, p. ${m.page}). Détection manquée : ${m.detectionMiss ? 'oui' : 'non'} ; visible manqué : ${m.visibleMiss ? 'oui' : 'non'} ; P∪S manqué : oui. ${m.probableCause}`).join('\n') + '\n');
const summary = { at: new Date().toISOString(), promptSha256: freeze.promptSha256, halves, privateScores,
  matcherSha256: sha256(fs.readFileSync('tools/classif/1passe/matching.mjs')),
  scorerSha256: sha256(fs.readFileSync(import.meta.filename)),
  run: fs.existsSync(`${home}/run-summary.json`) ? json(`${home}/run-summary.json`) : null,
  baselineArtifactsSha256: sha256(JSON.stringify(receipts.map((r) => [r.document, r.baselineSha256]))),
  note: 'All three denominators are B. P∪S/B is not recall against C. No D3 reference used.' };
write(`${dir}/results.json`, summary);
console.log(JSON.stringify(summary));
