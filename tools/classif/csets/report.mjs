import {readFileSync,writeFileSync} from 'node:fs';
import {home,json} from './inputs.mjs';
const aggregates=json(`${home}/tuning-aggregates.json`),status=json(`${home}/tuning-status.json`);
const manifest=json('docs/spec/reports/classif-csets/manifest.json');
const log=readFileSync(`${home}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
const completed=log.filter(x=>!x.intent),intents=log.filter(x=>x.intent);
const lost=intents.length-completed.length;
const quota=completed.at(-1).quotaUsedPercent;
const duration=(Date.parse(status.ended)-Date.parse(status.started))/60000;
const pct=x=>x===null?'—':`${(100*x).toFixed(2)} %`;
const rate=(k,n)=>`${k}/${n} (${pct(n?k/n:null)})`;
const interval=x=>`[${pct(x.low)} ; ${pct(x.high)}]`;
const names=['P','S','Écarté','Non classé'];
const table=(label,m)=>`| Mise au point | ${label} | ${label==='A'?rate(m.detectedActs,m.referenceActs):'Sans objet'} | ${m.misses}/${m.refShown} | ${pct(m.recall)} | ${interval(m.recallWilson95)} | ${pct(m.precision)} |`;
const matrix=(label,m)=>`### Mise au point — ${label}\n\nLignes : référence C. Colonnes : prédiction.\n\n| Référence | ${names.join(' | ')} |\n|---|---:|---:|---:|---:|\n${m.matrix.rows.map((row,i)=>`| ${names[i]} | ${row.join(' | ')} |`).join('\n')}\n`;
const summary={tuning:aggregates,blind:{status:'blocked',reason:'CLASSIF_BLIND_KEY not injected; no blind measurement performed'},
 execution:{...status,durationMinutes:duration,weeklyQuotaStart:manifest.quotaStart.rateLimits.primary.used_percent,
 weeklyQuotaEnd:quota,quotaResetUtc:completed.at(-1).quotaResetsAt,measuredResponses:completed.length,
 intentWithoutReceipt:lost,quotaProbeCalls:1,toolEvents:completed.reduce((a,x)=>a+(x.toolEvents??0),0)},
 baseline:manifest.baseline};
writeFileSync('docs/spec/reports/classif-csets/aggregates.json',JSON.stringify(summary)+'\n');
const report=`# Prompt unique × Astra low — jeux C\n\nÉtat : mise au point terminée. Aveugle en attente de la clé injectée par i-cond.\n\n`+
`| Jeu | Mode | Rappel de détection des signaux C | Manqués P ∪ S | Rappel P ∪ S | Wilson 95 % | Précision sur unités C |\n|---|---|---:|---:|---:|---|---:|\n`+
table('A',aggregates.A)+'\n'+table('B',aggregates.B)+'\n'+
`| Aveugle | A | Non mesuré | Non mesuré | — | — | — |\n| Aveugle | B | Sans objet | Non mesuré | — | — | — |\n\n`+
`A : passe complète. B : réannotation. Les 252 unités incluent 191 signaux et 61 PV. Le rappel de détection porte sur les 191 signaux identifiés. Les PV sont des unités documentaires, sans inventaire exhaustif de leurs actes.\n\n`+
`Dix signaux n'ont aucun extrait source figé. Sept sont P ∪ S. Ils comptent comme absents en A. Sur les seules unités avec source, A a ${aggregates.A.withAvailableSource.misses}/${aggregates.A.withAvailableSource.refShown} manqués et un rappel de ${pct(aggregates.A.withAvailableSource.recall)}.\n\n`+
`La précision porte sur les prédictions P ∪ S des unités C. Elle ne mesure pas la précision globale des actes extraits. A retourne ${aggregates.A.extractions} nœuds d'acte ; ${aggregates.A.unpairedExtractions} nœuds des entrées signal restent non appariés. Ces ajouts ne sont pas présumés faux.\n\n`+
`Diagnostic séparé : ${aggregates.A.diagnostics.signalUnitsWithActs} entrées signal contiennent au moins un acte extrait. ${aggregates.A.diagnostics.sameSiteDifferentStage} actes retrouvent le même site cité avec une étape différente ou absente ; ${aggregates.A.diagnostics.shownMissesAtSameSiteDifferentStage} sont P ∪ S. Le critère principal garde l'étape et ne récupère aucun de ces cas.\n\n`+
`Sur les seuls signaux appariés en A : ${aggregates.A.onMatchedSignals.units} unités, ${aggregates.A.onMatchedSignals.misses}/${aggregates.A.onMatchedSignals.refShown} manqué P ∪ S. Les deux références P ne sont pas appariées. En B, les 191 signaux ont zéro manqué sur 87 références P ∪ S ; les trois manqués sont des PV annotés « Non classé ».\n\n`+
`## P0 seul × Astra low, série 7\n\n| Jeu | Manqués | Rappel P ∪ S | Précision | Wilson 95 % du rappel recalculé |\n|---|---:|---:|---:|---|\n`+
['tuning','blind'].map((half,i)=>{const b=manifest.baseline[half];return `| ${i?'Aveugle':'Mise au point'} | 0/${b.refShown} | ${pct(b.recall)} | ${pct(b.precision)} | ${interval(b.recallWilson95)} |`;}).join('\n')+
`\n\nLe baseline ne mesure pas la détection. Ses bornes historiques sont des bornes exactes unilatérales de Clopper–Pearson. Elles ne sont pas présentées comme des bornes de Wilson. La référence de C porte le nom technique D. Sa provenance est consensus de modèles ou mixte.\n\n`+
`## Matrices à quatre classes\n\nLes absences et sorties invalides sont regroupées dans « Non classé ». Les compteurs d'absence et d'invalidité restent séparés dans les agrégats.\n\n`+
matrix('A',aggregates.A)+'\n'+matrix('B',aggregates.B)+'\n'+matrix('A — signaux appariés seulement',aggregates.A.onMatchedSignals)+
`\n## Surface, quotas et durée\n\nGPT-6 Astra, low, siège Codex ChatGPT. Prompt inchangé : \`8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205\`. Composition et schéma importés de la PR #1099. Chaque requête A est revérifiée octet pour octet avec le code de production. Validation native sans reprise ni modèle de secours. Aucun outil ni web accepté.\n\n`+
`Concurrence de reprise : 10. Quota hebdomadaire : ${manifest.quotaStart.rateLimits.primary.used_percent} % → ${quota} %. Arrêt des lancements à 90 %. Réinitialisation : ${completed.at(-1).quotaResetsAt}. Durée des mesures : ${duration.toFixed(2)} min. ${completed.length} réponses mesurées, plus un appel de quota et ${lost} tentatives initiales sans reçu.\n\n`+
`Un fichier de composition créé par Docker appartenait à root. Le refus d'accès a interrompu cinq appels B initiaux avant leur reçu. Ils ne sont pas scorés. La reprise conserve les mêmes entrées. Le pic de concurrence au démarrage interrompu n'est pas attesté. Le précontrôle de toutes les requêtes et l'exécution Docker avec l'UID local corrigent cette cause.\n\n`+
`Le jeu aveugle reste scellé. Aucun résultat par unité n'a été ouvert. Aucun optimiseur n'est alimenté. La clé n'est ni lue dans un fichier d'environnement ni recherchée ailleurs. L'inventaire et les manqués de mise au point sont privés : \`${home}/tuning-inventory.json\` et \`${home}/tuning-misses.md\`.\n\n`+
`## Conséquence pour la production — cinq lignes\n\n`+
`1. La passe complète obtient ${aggregates.A.misses} manqués : D4 ${aggregates.A.D4==='pass'?'réussi':'échoué'} sur la mise au point.\n`+
`2. La réannotation obtient ${aggregates.B.misses} manqués, tous des PV « Non classé » ; les 87 signaux P ∪ S restent affichés.\n`+
`3. P0 seul avait zéro manqué sur les deux jeux ; son avantage en aveugle reste le baseline mesuré.\n`+
`4. Les sources absentes et les extraits limitent la portée du test A ; ce résultat ne démontre pas le rappel sur des PV complets.\n`+
`5. Le prompt unique n'est pas qualifié pour la production : la mesure aveugle demandée reste à exécuter.\n`;
writeFileSync('docs/spec/reports/classif-csets/report.md',report);
const misses=json(`${home}/tuning-misses.json`);
writeFileSync(`${home}/tuning-misses.md`,'# Manqués de mise au point\n\n'+misses.map(r=>
 `- Mode ${r.mode} — ${r.itemId} : ${r.ref} → ${r.pred??'absent/non classé'} (${r.predCode??'aucun code'}). ${r.sourceMissing?'Source absente.':r.sameSiteDifferentStage?'Même site cité ; étape différente ou absente.':r.absent?'Acte non apparié.':'Unité annotée.'}`).join('\n')+'\n',{mode:0o600});
writeFileSync(`${home}/pr-body.md`,`Measures the unchanged PR #1099 prompt on C's tuning units with gpt-6-astra / low.\n\nMode A: ${aggregates.A.misses}/${aggregates.A.refShown} shown misses; mode B: ${aggregates.B.misses}/${aggregates.B.refShown}. Blind modes remain blocked on conductor key injection; no blind per-unit results are published. This draft does not qualify the prompt for production.\n\nValidation: four synthetic metric/pairing tests, module syntax checks, native production validation and byte-for-byte production request checks. See [report](docs/spec/reports/classif-csets/report.md), [protocol](docs/spec/reports/classif-csets/protocol.md) and [review limitation](docs/spec/reports/classif-csets/review.md).\n`,{mode:0o600});
console.log({published:true,durationMinutes:duration,quota,lost,tuning:{A:aggregates.A.misses,B:aggregates.B.misses}});
