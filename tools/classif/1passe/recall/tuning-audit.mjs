// Diagnostic only: no blind access, no rescoring, no prompt edits.
import fs from 'node:fs';
import { source, home, dir, json, write } from './context.mjs';
import { parseJsonObject } from '../../run-seat.mjs';
import { norm, stage } from '../matching.mjs';
const scores = json(`${dir}/results.json`), misses = json(`${home}/misses-tuning.json`);
const refs = fs.readFileSync(`${source}/tuning.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const counts = {};
for (const m of misses) {
  if (!m.detectionMiss) continue;
  const ref = refs.find((r) => r.itemId === m.document), u = ref.expected.units.find((r) => r.id === m.id);
  const d = ref.input.document, text = fs.readFileSync(`${source}/texts/${d.sha256}.txt`, 'utf8');
  const r = json(`${home}/responses/${m.document}.json`).result;
  const acts = parseJsonObject(r.text)?.acts ?? [];
  const bq = norm(u.citation);
  const similar = acts.find((a) => {
    const aq = norm(a.quote);
    return aq.length >= 30 && bq.length >= 30 && (aq.includes(bq) || bq.includes(aq));
  });
  let category;
  if (!acts.length) { category = 'liste_vide'; m.probableCause = 'Omission d’extraction : le modèle a rendu une liste vide pour ce PV.'; }
  else if (similar) {
    const bs = stage(u.stage), as = stage(similar.stage);
    category = bs && bs !== as ? 'etape_incompatible' : 'preuve_non_contigue';
    m.probableCause = category === 'etape_incompatible'
      ? `Appariement rejeté : étape B « ${u.stage} », étape candidate « ${similar.stage} ». Citation normalisée commune.`
      : `Appariement rejeté malgré une citation normalisée commune. Citation B contiguë dans le texte : ${text.includes(u.citation) ? 'oui' : 'non'} ; candidate contiguë : ${text.includes(similar.quote) ? 'oui' : 'non'}.`;
  } else {
    category = 'absence_ou_ancre_distincte';
    m.probableCause = 'Omission d’extraction ou ancre différente : aucun candidat à citation normalisée contenue. Ce diagnostic ne prouve pas une absence sémantique.';
  }
  m.diagnosticCategory = category; counts[category] = (counts[category] ?? 0) + 1;
}
write(`${home}/misses-tuning.json`, misses);
write(`${home}/MISSES-TUNING.md`, '# Manqués de mise au point\n\n257 manqués stricts de détection ; 322 manqués visibles et P∪S. Causes probables ; aucun acte aveugle.\n\n'
  + misses.map((m) => `- **${m.document} — ${m.id}** : ${m.act} (${m.stage}, p. ${m.page}). Détection manquée : ${m.detectionMiss ? 'oui' : 'non'} ; visible manqué : ${m.visibleMiss ? 'oui' : 'non'} ; P∪S manqué : oui. ${m.probableCause}`).join('\n') + '\n');
write(`${dir}/tuning-audit.json`, JSON.stringify({ missedDetection: scores.halves.tuning.detection.missed, counts, detailedMissesSha256: (await import('../../lib/refc1.mjs')).sha256(fs.readFileSync(`${home}/MISSES-TUNING.md`)) }) + '\n');
console.log(JSON.stringify(counts));
