import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = 'tools/classif/1passe';
const home = path.join(os.homedir(), '.local/share/radar-classif/1passe-bc');
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const offlineFile = `${home}/correction-offline.json`;
if (process.argv.includes('--snapshot')) {
  assert(!fs.existsSync(offlineFile), 'Offline snapshot already exists');
  fs.copyFileSync(`${home}/reference/agreement.json`, offlineFile);
  process.exit(0);
}
const after = json(`${home}/reference/agreement.json`), offline = json(offlineFile);
const resume = json(`${home}/correction-resume/summary.json`);
const original = json(`${home}/correction-before/agreement.json`);
const targets = json(`${home}/correction-resume/targets-tuning.json`);
const pending = json(`${home}/reference/tuning-d3-remaining.json`);
const tuning = json(`${home}/reference/tuning-prepared.json`);
assert(tuning.every((r) => r.votes.every((v) => v.class !== 'Non classé' && v.status)));
assert.equal(pending.length, after.halves.tuning.d3Remaining);
assert.equal(resume.calls, 16);
assert(resume.outcomes.every((o) => o.valid));
assert.equal(resume.d3Calls, 0);
const quota = resume.quotas.map((q) => q.rateLimits.primary.usedPercent);
const d3Files = fs.readdirSync(`${home}/arbitration`).filter((n) => /\.(json|sealed)$/.test(n)
  && !n.includes('.intent-') && !n.includes('.attempt-') && n !== 'run-summary.json');
const f = (n) => n === null ? 'non défini' : `${(100 * n).toFixed(2)} %`;
const k = (n) => n === null ? 'non défini' : n.toFixed(6);
const lines = ['# Correction du rapprochement et du validateur', '',
  'D3 reste arrêté. Aucun appel Argon lancé. Aucune fusion. Aucun `.env` lu.', '',
  'Le calcul porte sur les 676 actes B. Il ne crée pas une référence C finalisée.', '',
  '| Moitié / état | Non classé, votes | Paires valides | Accord de classe sur paires valides | Kappa | Accords de code / support | Désaccords D3 |',
  '|---|---:|---:|---:|---:|---:|---:|'];
for (const half of ['tuning', 'blind']) {
  const b = after.before[half], a = after.halves[half], o = offline.halves[half];
  if (half === 'blind') lines.push('| Moitié / état | Non classé, votes | Paires valides | Accord de classe sur paires valides | Kappa | Accords de code / support | Désaccords D3 |',
    '|---|---:|---:|---:|---:|---:|---:|');
  for (const [label, nc, m, disputes] of [
    ['avant, métrique comparable', b.nonClasseVotes, b.comparableAgreement, b.disputes],
    ['correction seule', 0, o.agreement, o.disputes], ['après reprise', 0, a.agreement, a.disputes]])
    lines.push(`| ${half} / ${label} | ${nc} | ${m.n}/${m.total} | ${f(m.rawAgreement)} | ${k(m.kappa)} | ${f(m.validatedAgreement)} | ${disputes} |`);
  lines.push('');
  lines.push(`Ancien calcul ${half}, incluant les doubles Non classé : accord ${f(b.rawAgreement)}, kappa ${k(b.kappa)}.`);
  lines.push('');
}
lines.push('Le changement de dénominateur interdit de comparer directement les anciens kappas aux nouveaux. Les lignes comparables excluent les votes invalides ou absents. Les désaccords D3 portent sur les codes. L’accord et le kappa portent sur P/S/N.', '',
  `Total avant : ${Object.values(after.before).reduce((s, h) => s + h.nonClasseVotes, 0)} votes Non classé ; accord ancien ${f(original.agreement.rawAgreement)}, kappa ancien ${k(original.agreement.kappa)}, ${original.disputes} désaccords. Total après : zéro classe technique ; ${after.agreement.n}/676 paires valides, accord ${f(after.agreement.rawAgreement)}, kappa ${k(after.agreement.kappa)}, ${after.disputes} désaccords.`, '',
  'Zéro Non classé ne signifie pas zéro cas à traiter. Les statuts techniques restent séparés. Un code connu est conservé même si sa preuve est invalide.', '',
  '| Moitié | Valide | Invalide | Absent | Interrompu | Erreur | Collision | Ambiguïté, attribut |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [half, h] of Object.entries(after.halves)) lines.push(`| ${half} | ${Object.values(h.voteStatuses).join(' | ')} | ${h.ambiguousVotes} |`);
lines.push('', '## Reprises', '',
  `Seize appels document. Onze en mise au point : six Astra et cinq Opus. Cinq en aveugle : deux Astra et trois Opus. Seize réponses JSON valides. Concurrence totale : 10. Quota Codex : ${quota[0]} % au départ, ${quota.at(-1)} % à la fin, maximum ${Math.max(...quota)} %. Arrêt fixé à 90 %.`, '',
  ...targets.map((t) => `- ${t.arm} : ${t.document}`), '', '## D3 restant', '',
  `${after.disputes} désaccords de code ou techniques après rapprochement. ${after.d3Remaining} demandent encore un arbitrage : ${after.halves.tuning.d3Remaining} en mise au point et ${after.halves.blind.d3Remaining} en aveugle. ${after.halves.tuning.reusableD3 + after.halves.blind.reusableD3} arbitrages sauvegardés restent réutilisables : même prompt et preuve valide. Les autres résultats D3 sont conservés, sans transfert à un prompt modifié.`, '',
  `${fs.readdirSync(`${home}/arbitration`).length} fichiers D3 existants sont présents, dont ${d3Files.length} réponses finales. Ils n’ont pas été réécrits par le recalcul.`, '',
  `Estimation Argon high : ${after.argonEstimate.firstAttempts} premiers appels. Maximum ${after.argonEstimate.upperWithinRemainingBudget} avec le budget de reprises restant (${after.argonEstimate.retriesRemaining}). Les ${after.argonEstimate.priorD3Calls} départs historiques restent comptés. i-cond décide de la suite. Aucun départ D3 dans cette correction.`, '',
  `Liste détaillée mise au point : ${home}/reference/tuning-d3-remaining.json et TUNING-D3-REMAINING.md dans le même dossier. Liste aveugle scellée : ${home}/reference/blind-d3-remaining.sealed.`, '',
  '## Module partagé', '', `Module : ${dir}/matching.mjs. SHA-256 : ${after.matcherSha256}.`, '',
  'NFD, accents, casse et séparateurs normalisés. Recouvrement contigu de 30 caractères au minimum. Étape et numéro compatibles. Page physique à ±1. Une page est dérivée de la citation si son ancrage est unique. Le folio déclaré reste conservé. Seules les arêtes présentes dans toutes les affectations maximales sont retenues. Les collisions restent explicites.', '',
  '## Recalcul des lanes de rappel', '',
  'Commandes depuis ce worktree. Elles ne lancent aucun modèle. Les scores lisent les sorties sauvegardées. Le module et la contrainte globale d’unicité sont injectés en mémoire. Les sources des lanes restent inchangées. Les métriques produites restent dans chaque lane. Les anciens rapports de rappel doivent être remplacés après ce recalcul.', '',
  '```sh',
  'rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=recall ENV=test-classif-recall',
  'rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=recall1099 ENV=test-classif-recall1099',
  'rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=csets HALF=tuning ENV=test-classif-csets',
  'rtk make -f tools/classif/1passe/ops.mk shared-recalc LANE=csets HALF=blind ENV=test-classif-csets', '```', '',
  'Les deux premières commandes traitent les deux moitiés. Pour csets aveugle, le dépositaire doit injecter son rôle test-executor et sa clé existante dans le processus. Aucun fichier de configuration d’environnement ne doit être chargé. Csets conserve son protocole PV documentaire ; le module partagé remplace le rapprochement de ses signaux.', '',
  'Les trois adaptateurs ont été vérifiés en lecture seule. Leur recalcul effectif appartient aux lanes. Aucun scellé de ces lanes n’a été ouvert ici.', '');
fs.writeFileSync(`${dir}/CORRECTION.md`, lines.join('\n'));
fs.writeFileSync(`${dir}/correction-results.json`, JSON.stringify({ after, offline, resume: { calls: resume.calls,
  outcomes: resume.outcomes, quotaStart: quota[0], quotaEnd: quota.at(-1), quotaMax: Math.max(...quota) } }) + '\n');
fs.writeFileSync(`${home}/reference/TUNING-D3-REMAINING.md`, '# D3 restant — mise au point\n\n' + pending.map((r) =>
  `## ${r.id}\n\n${r.unit.label} — ${r.unit.stage}, p. ${r.unit.page}.\n\n${r.unit.sourceUrl}\n\nCitation B : ${r.unit.citation}\n\n` +
  r.votes.map((v, i) => `Avis ${i + 1} : ${v.status}, ${v.code ?? 'aucun code'}, ambiguïté ${v.ambiguous ?? 'sans vote'}. ${v.reason ?? ''}\n\n${v.quote ?? ''}`).join('\n\n') +
  `\n\nD3 précédent : ${r.previousD3 ?? 'absent'}. Même prompt : ${r.samePrompt}.`).join('\n\n'), { mode: 0o600 });
console.log(JSON.stringify({ report: `${dir}/CORRECTION.md`, d3Remaining: after.d3Remaining, matcherSha256: after.matcherSha256 }));
