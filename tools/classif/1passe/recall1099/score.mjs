import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/refc1.mjs';
import { dir, home, freeze, references, documents, load, write, save, json } from './context.mjs';
import { baseline } from './baseline.mjs';
import { metric, pair, graphActs } from './metrics.mjs';
const docs = new Map(documents().map((d) => [d.id, d]));
const manifest = json(`${home}/request-manifest.json`);
const rows = [], receipts = [], misses = [], inventories = [];
for (const ref of references()) {
  const d = docs.get(ref.itemId), units = ref.expected.units;
  const acts = [], parts = manifest.filter((r) => r.document === d.id);
  for (const part of parts) {
    const suffix = d.blind ? 'sealed' : 'json';
    const received = fs.existsSync(`${home}/responses/${part.key}.${suffix}`);
    const response = received ? load(`${home}/responses/${part.key}`, d.blind) : null;
    const checked = fs.existsSync(`${home}/validated/${part.key}.${suffix}`);
    const validation = checked ? load(`${home}/validated/${part.key}`, d.blind) : null;
    if (validation?.accepted) acts.push(...graphActs(validation.result.extraction, d, validation.result.annotations));
    receipts.push({ document: d.id, blind: d.blind, received, accepted: validation?.accepted ?? false,
      nativeAccepted: validation?.nativeAccepted ?? false, v9Accepted: validation?.v9Accepted ?? false,
      error: validation?.error ?? validation?.v9Error ?? null, usage: response?.result?.usage ?? null,
      toolEvents: response?.result?.toolEvents ?? 0, latencyMs: response?.result?.latencyMs ?? null,
      answerSha256: received ? sha256(fs.readFileSync(`${home}/responses/${part.key}.${suffix}`)) : null });
  }
  const matches = pair(units, acts, d.text), b = baseline(d), bm = pair(units, b.acts, d.text);
  const neutral = pair(ref.expected.neutral ?? [], acts.filter((a) => ![...matches.values()].some((v) => v.id === a.id)), d.text);
  inventories.push({ blind: d.blind, predictions: acts.length, neutralMatched: neutral.size,
    baselineMissing: b.missing ?? false, baselineUsage: b.usage ?? null, baselineSha256: b.sha256 ?? null });
  for (const u of units) {
    const a = matches.get(u.id), detected = Boolean(a), visible = detected && a.classe !== 'ecarte';
    const ps = detected && ['pertinent', 'a_surveiller'].includes(a.classe);
    rows.push({ id: u.id, document: d.id, blind: d.blind, detected, visible, ps, bDetected: bm.has(u.id) });
    if (!d.blind && (!detected || !visible || !ps)) {
      const invalid = receipts.filter((r) => r.document === d.id).some((r) => !r.accepted);
      const cause = !detected ? invalid ? 'Échec technique ou validation native/v9 refusée ; aucun acte accepté pour ce morceau.'
        : 'Aucun candidat appariable selon la preuve, le numéro, l’objet et l’étape gelés.'
        : a.classe === 'ecarte' ? `Détecté puis Écarté : ${a.code}. ${a.reason}` : `Détecté et visible, Non classé : ${a.reason}`;
      misses.push({ document: d.id, id: u.id, act: u.label, stage: u.stage, page: u.page,
        detectionMiss: !detected, visibleMiss: !visible, psMiss: !ps, cause });
    }
  }
}
assert.equal(rows.length, 676); assert.equal(new Set(rows.map((r) => r.id)).size, 676);
const cost = (rs, field) => ({ measured: rs.filter((r) => r[field]).length,
  input: rs.reduce((n, r) => n + (r[field]?.input_tokens ?? r[field]?.inputTokens ?? 0), 0),
  output: rs.reduce((n, r) => n + (r[field]?.output_tokens ?? r[field]?.outputTokens ?? 0), 0),
  cached: rs.reduce((n, r) => n + (r[field]?.cached_input_tokens ?? r[field]?.cachedTokens ?? 0), 0) });
const halves = Object.fromEntries(['tuning', 'blind', 'total'].map((half) => {
  const choose = (r) => half === 'total' || r.blind === (half === 'blind');
  const sub = rows.filter(choose), rec = receipts.filter(choose), inv = inventories.filter(choose);
  return [half, { pv: inv.length, support: sub.length,
    detection: metric(sub.filter((r) => r.detected).length, sub.length),
    visible: metric(sub.filter((r) => r.visible).length, sub.length),
    ps: metric(sub.filter((r) => r.ps).length, sub.length),
    baselineDetection: inv.some((r) => r.baselineMissing) ? null : metric(sub.filter((r) => r.bDetected).length, sub.length),
    baselineVisible: null, baselinePS: null,
    pairedDetection: { both: sub.filter((r) => r.detected && r.bDetected).length,
      only1099: sub.filter((r) => r.detected && !r.bDetected).length, onlyB: sub.filter((r) => !r.detected && r.bDetected).length },
    received: rec.filter((r) => r.received).length, accepted: rec.filter((r) => r.accepted).length,
    nativeAccepted: rec.filter((r) => r.nativeAccepted).length, v9Accepted: rec.filter((r) => r.v9Accepted).length,
    failures: rec.filter((r) => !r.accepted).length, toolEvents: rec.reduce((n, r) => n + r.toolEvents, 0),
    predictions: inv.reduce((n, r) => n + r.predictions, 0), neutralMatched: inv.reduce((n, r) => n + r.neutralMatched, 0),
    tokens: cost(rec, 'usage'), baselineTokens: cost(inv, 'baselineUsage') }];
}));
save(`${home}/score-tuning-${Date.now()}`, rows.filter((r) => !r.blind), false);
save(`${home}/score-blind-${Date.now()}`, rows.filter((r) => r.blind), true);
save(`${home}/receipts-blind-${Date.now()}`, receipts.filter((r) => r.blind), true);
write(`${home}/receipts-tuning.json`, receipts.filter((r) => !r.blind));
write(`${home}/misses-tuning.json`, misses);
const adjacentPath = '/home/antoinefa/src/radar-immobilier/tmp/classif-1passe-recall/tools/classif/1passe/recall/results.json';
const adjacent = fs.existsSync(adjacentPath) ? json(adjacentPath) : null;
const summary = { at: new Date().toISOString(), freeze, halves, run: json(`${home}/run-summary.json`),
  matcherSha256: sha256(fs.readFileSync('tools/classif/1passe/matching.mjs')),
  groupMatcherSha256: sha256(fs.readFileSync(`${dir}/metrics.mjs`)), scorerSha256: sha256(fs.readFileSync(import.meta.filename)),
  baselineArtifactsSha256: sha256(JSON.stringify(inventories.map((r) => r.baselineSha256))),
  adjacent: adjacent ? { artifactSha256: sha256(fs.readFileSync(adjacentPath)), at: adjacent.at,
    halves: adjacent.halves, run: adjacent.run } : null,
  note: 'All denominators B; P_union_S/B is not recall against C. Failures remain in supports.' };
write(`${dir}/results.json`, JSON.stringify(summary) + '\n');
console.log(JSON.stringify({ halves, adjacentAvailable: Boolean(adjacent), tuningMisses: misses.length }));
