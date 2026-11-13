import fs from 'node:fs';
import { source, home, dir, json, load, write } from './context.mjs';
import { norm, stage } from '../matching.mjs';
import { graphActs } from './metrics.mjs';
import { sha256 } from '../../lib/refc1.mjs';
const misses = json(`${home}/misses-tuning.json`), manifest = json(`${home}/request-manifest.json`);
const refs = fs.readFileSync(`${source}/tuning.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const counts = {};
for (const m of misses) {
  if (!m.detectionMiss) { m.category = 'classification'; counts.classification = (counts.classification ?? 0) + 1; continue; }
  const ref = refs.find((r) => r.itemId === m.document), u = ref.expected.units.find((r) => r.id === m.id);
  const d = ref.input.document, text = fs.readFileSync(`${source}/texts/${d.sha256}.txt`, 'utf8');
  const accepted = manifest.filter((p) => p.document === m.document).map((p) => load(`${home}/validated/${p.key}`, false));
  const failed = accepted.find((a) => !a.accepted);
  const acts = accepted.filter((a) => a.accepted).flatMap((a) => graphActs(a.result.extraction, d, a.result.annotations)).flatMap((g) => g.variants);
  const bq = norm(u.citation);
  const similar = acts.find((a) => {
    const aq = norm(a.quote);
    return aq.length >= 30 && bq.length >= 30 && (aq.includes(bq) || bq.includes(aq));
  });
  if (failed) { m.category = 'validation_or_transport'; m.cause = `Échec du morceau : ${failed.error ?? failed.v9Error}`; }
  else if (!acts.length) { m.category = 'empty_inventory'; m.cause = 'Aucun acte natif accepté pour ce PV.'; }
  else if (similar) {
    const bs = stage(u.stage), as = stage(similar.stage);
    m.category = bs && bs !== as ? 'stage_mismatch' : 'evidence_mismatch';
    m.cause = m.category === 'stage_mismatch'
      ? `Citation normalisée commune ; étape B « ${u.stage} », candidate « ${similar.stage} ».`
      : `Citation normalisée commune ; B contiguë : ${text.includes(u.citation) ? 'oui' : 'non'} ; candidate contiguë : ${text.includes(similar.quote) ? 'oui' : 'non'}. Numéro, objet ou preuve stricte non appariables.`;
  } else { m.category = 'absent_or_different_anchor'; m.cause = 'Aucune citation normalisée contenue. Omission ou ancre différente ; l’absence sémantique reste indéterminée.'; }
  counts[m.category] = (counts[m.category] ?? 0) + 1;
}
write(`${home}/misses-tuning.json`, misses);
const detailed = '# Manqués de mise au point\n\nCauses diagnostiques. Aucun acte aveugle. Les requêtes restent gelées.\n\n'
  + misses.map((m) => `- **${m.document} — ${m.id}** : ${m.act} (${m.stage}, p. ${m.page}). Manqué (a) : ${m.detectionMiss ? 'oui' : 'non'} ; (b) : ${m.visibleMiss ? 'oui' : 'non'} ; (c) : ${m.psMiss ? 'oui' : 'non'}. ${m.cause}`).join('\n') + '\n';
write(`${home}/MISSES-TUNING.md`, detailed);
write(`${dir}/tuning-audit.json`, JSON.stringify({ counts, totalDetailed: misses.length, detailedSha256: sha256(detailed) }) + '\n');
console.log(JSON.stringify({ counts, totalDetailed: misses.length }));
