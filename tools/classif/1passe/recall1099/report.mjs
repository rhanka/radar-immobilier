import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dir, home, json, write } from './context.mjs';
import { sha256 } from '../../lib/refc1.mjs';
const r = json(`${dir}/results.json`), h = json(`${dir}/historical.json`);
const audit = json(`${dir}/tuning-audit.json`), verification = json(`${dir}/verification.json`);
const production = '/home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass';
const ref = execFileSync('git', ['-C', production, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
for (const [p, expected] of Object.entries(r.freeze.sourceHashes)) {
  assert.equal(sha256(execFileSync('git', ['-C', production, 'show', `${ref}:${p}`])), expected);
}
write(`${dir}/source-proof.json`, { ref, sourceHashesVerifiedAgainstCommit: true, hashes: r.freeze.sourceHashes });
const pct = (x) => x === null ? 'inconnu' : `${(100 * x).toFixed(2).replace('.', ',')} %`;
const names = { tuning: 'Mise au point', blind: 'Aveugle', total: 'Total' };
const measures = { detection: '(a) Détection', visible: '(b) Visible', ps: '(c) P∪S' };
const lines = ['# Rappel du prompt exact de la PR #1099', '',
  `${r.run.calls} PV exécutés, concurrence 10. ${r.halves.total.accepted} réponses acceptées. ${r.halves.total.failures} échecs. ${r.halves.total.toolEvents} événement d’outil. Aucun rejeu.`, '',
  'Les dénominateurs sont les 676 actes B corrigés. Les 43 cas neutres sont exclus.',
  'Visible signifie détecté et non Écarté. P∪S/B ne mesure pas le rappel sur les références C.',
  'Appariement strict gelé, un à un. Les manqués incluent les échecs de rapprochement.', '',
  '| Moitié | Mesure | Retrouvés/support | Manqués | Rappel | Wilson bas 95 % |',
  '|---|---|---:|---:|---:|---:|'];
for (const half of Object.keys(names)) for (const m of Object.keys(measures)) {
  const v = r.halves[half][m];
  lines.push(`| ${names[half]} | ${measures[m]} | ${v.found}/${v.support} | ${v.missed} | ${pct(v.recall)} | ${pct(v.wilsonLower95)} |`);
}
lines.push('', '## Comparaison avec B et la variante voisine', '',
  'B = détection Astra medium sans P0, sorties natives validées du bras astra-medium-rejeu, benchmark v12. Même corpus et même apparieur strict.',
  'Les classes C de ce témoin ne sont pas disponibles. Ses rappels (b) et (c) restent inconnus.', '',
  '| Moitié | PR #1099 : détection | B : détection | Variante : détection | PR #1099 : visible / P∪S | Variante : visible / P∪S |',
  '|---|---:|---:|---:|---:|---:|');
for (const half of Object.keys(names)) {
  const own = r.halves[half], other = r.adjacent?.halves[half];
  lines.push(`| ${names[half]} | ${pct(own.detection.recall)} | ${pct(own.baselineDetection?.recall ?? null)} | ${pct(other?.detection.recall ?? null)} | ${pct(own.visible.recall)} / ${pct(own.ps.recall)} | ${pct(other?.visible.recall ?? null)} / ${pct(other?.ps.recall ?? null)} |`);
}
lines.push('', 'La variante lit le PV entier et rend des actes plats. Elle ne contient pas le prompt de détection B.',
  'Les deux lanes utilisent Astra low. Cette comparaison est descriptive ; aucun test de supériorité n’est revendiqué.', '',
  '## Diagnostic secondaire avec le scoreur historique B', '',
  'Scoreur importé sans changement. Il normalise les espaces et peut créditer plusieurs actes par groupe.',
  'Il ne remplace pas l’appariement strict. Les étapes natives restent inchangées.', '',
  '| Moitié | PR #1099 : retrouvés ; rappel ; Wilson bas | B : retrouvés ; rappel ; Wilson bas |', '|---|---:|---:|');
for (const half of Object.keys(names)) {
  const a = h.halves[half].detection, b = h.halves[half].baseline;
  lines.push(`| ${names[half]} | ${a.found}/${a.support} ; ${pct(a.recall)} ; ${pct(a.wilsonLower95)} | ${b.found}/${b.support} ; ${pct(b.recall)} ; ${pct(b.wilsonLower95)} |`);
}
lines.push('', 'Le témoin historique reproduit 336/676. Les critères des deux apparieurs ne sont pas interchangeables.', '',
  '## Identité du prompt et surface', '',
  `Code importé depuis le worktree de la PR #1099. Contenu vérifié contre le commit ${ref}.`,
  '`extractRefreshProfile` compose P0, le prompt de détection B et `singlePassSchema(schemaFor(...))`.',
  'Le prompt n’est ni copié dans cette lane ni modifié. Le découpeur de production est exposé par un ajout d’export privé.',
  'Les textes PDF sont vérifiés contre v101b. La date utilise l’extracteur natif d’en-tête ; aucun sidecar distant n’est fourni.',
  `Prompt P0/PR #1099 : ${r.freeze.productionPromptSha256}.`,
  `Morceau témoin : ${r.freeze.example.chunkId} (${r.freeze.example.document}).`,
  `Prompt composé : ${r.freeze.example.promptSha256}.`,
  `Schéma annoté : ${r.freeze.example.schemaSha256}.`,
  `Entrée CLI complète : ${r.freeze.example.inputSha256}.`,
  `Manifeste des 100 requêtes : ${r.freeze.requestManifestSha256}.`,
  'Les requêtes sont capturées au port `generateJson`. Le siège reçoit le prompt puis `Schema: ...`.',
  'Modèle choisi par `singlePassPrimary` : `REFRESH_SINGLE_PASS_MODEL=gpt-6-astra`, effort `low`.',
  'Surface : `codex exec`, siège ChatGPT isolé, cwd vide, stdin, lecture seule. Web, MCP, skills et fonctions désactivés.',
  'Le CLI peut encore exposer unified_exec. Toute invocation invalide la réponse. Aucun repli Gemini.',
  'Le transport CLI remplace le mesh au port injecté. Le plafond de 32768 est celui demandé au port ; son application au fil CLI n’est pas attestée.',
  `Validation native : ${r.halves.total.nativeAccepted}/100 ; validation v9 supplémentaire : ${r.halves.total.v9Accepted}/100.`,
  'La PR annonce v10. Son validateur et `validateSinglePassCoverage` tournent sans modification.',
  'Le contrôle v9 utilise le validateur gelé du benchmark et Graphify 0.18.0 sur le graphe natif accepté, sans annotations.', '',
  '## Coût, durée et quotas', '',
  '| Moitié | PR #1099 : entrée / sortie / cache inclus | Détection B : entrée / sortie |', '|---|---:|---:|');
for (const half of Object.keys(names)) {
  const a = r.halves[half].tokens, b = r.halves[half].baselineTokens;
  lines.push(`| ${names[half]} | ${a.input} / ${a.output} / ${a.cached} | ${b.input} / ${b.output} |`);
}
const q = r.run.quotas.map((s) => s.rateLimits?.primary?.usedPercent);
if (r.adjacent) {
  const t = r.adjacent.halves.total.tokens;
  lines.push('', `Variante voisine : ${t.input} jetons d’entrée, ${t.output} de sortie, ${t.cached} en cache inclus ; durée ${r.adjacent.run.durationSeconds} s.`);
}
lines.push('', `Durée : ${r.run.durationSeconds.toFixed(3)} s, soit ${(r.run.durationSeconds / 60).toFixed(2)} min.`,
  `Début : ${r.run.started}. Fin : ${r.run.finished}.`,
  `Quota hebdomadaire partagé : ${q[0]} % avant ; ${q.at(-1)} % après ; seuil 90 %. Arrêt : ${r.run.stopped ?? 'aucun'}.`,
  'Le quota est vérifié au départ, toutes les dix minutes, à réception des appels et à la fin.',
  'Le cache est inclus dans l’entrée. La télémétrie CLI est conservée. Aucun tarif API n’est attribué au siège Pro.',
  'Le coût de classification séparée du témoin B manque. Son coût complet ne peut donc pas être comparé.',
  'Le delta du quota partagé inclut les autres usages du compte.', '',
  '## Manqués de mise au point', '',
  `${audit.totalDetailed} actes détaillés un par un dans ${home}/MISSES-TUNING.md.`,
  `Détection manquée : ${r.halves.tuning.detection.missed}. Visible manqué : ${r.halves.tuning.visible.missed}. P∪S manqué : ${r.halves.tuning.ps.missed}.`,
  `Diagnostic agrégé : ${JSON.stringify(audit.counts)}.`,
  `Empreinte de la liste privée : ${audit.detailedSha256}.`,
  'Les causes sont diagnostiques. Un échec de preuve stricte ne démontre pas toujours une omission sémantique.',
  'Aucun acte aveugle n’est publié. Aucun résultat n’est renvoyé à un optimiseur.', '',
  '## Vérifications et livraison', '',
  `100 requêtes vérifiées par empreinte ; 50 réponses aveugles REFC1 ; ${verification.sealedResidues} résidus du siège archivés sous sceau puis retirés en clair.`,
  'Contrôles : syntaxe, sources importées, supports, arithmétique des métriques, ordre P∪S ≤ visible ≤ détection et absence de labels aveugles dans Git.',
  'Aucun .env lu. Aucune écriture dans les données B+C ou la lane voisine. Aucun appel Python.',
  'Livraison en PR draft. Aucune fusion.', '');
write(`${dir}/REPORT.md`, lines.join('\n'));
console.log(JSON.stringify({ report: `${dir}/REPORT.md`, lines: lines.length, productionRef: ref }));
