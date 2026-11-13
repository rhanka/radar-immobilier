import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {home,json,hash} from './inputs.mjs';
import {shown} from './metrics.mjs';
const publicDir='docs/spec/reports/classif-csets';
const summary=json(`${publicDir}/aggregates.json`);
const versions={v1:'8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205',
 v2:'34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50'};
const records=[];
for(const version of ['v1','v2']) for(const half of ['tuning','blind']){
 const dir=home+(version==='v2'?'/v2':'');
 const m=version==='v1'&&half==='tuning'?summary.tuning.B:json(`${dir}/${half}-aggregates.json`).B;
 const status=version==='v1'&&half==='tuning'?summary.execution:json(`${dir}/${half}-status.json`);
 const calls=readFileSync(`${dir}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse)
  .filter(x=>x.half===half&&x.mode==='B'&&!x.intent&&x.at>=status.started&&x.at<=status.ended);
 const last=calls.at(-1);
 assert.equal(m.units,252);assert.equal(m.matrix.rows.flat().reduce((a,b)=>a+b,0),252);
 assert.equal(m.refShown-m.trueShown,m.misses);
 if(!(version==='v1'&&half==='tuning')){
  assert.equal(status.completed+status.cached,252);assert.equal(status.total,252);
  assert.equal(status.stopped,null);assert.equal(calls.length,status.completed);
 }
 records.push({half,version,mode:'B',promptSha256:versions[version],metrics:m,
  execution:{...status,durationMinutes:(Date.parse(status.ended)-Date.parse(status.started))/60000,
   weeklyQuotaEnd:last?.quotaUsedPercent??status.weeklyQuotaEnd,
   quotaResetUtc:last?.quotaResetsAt??status.quotaResetUtc,
   measuredResponses:calls.length,toolEvents:calls.reduce((n,c)=>n+(c.toolEvents??0),0)}});
}
assert.ok(records.every(r=>r.execution.toolEvents===0));
summary.blind={B:records.find(r=>r.version==='v1'&&r.half==='blind').metrics};
summary.classificationOnly={versions,records};
const oldTuning=json(`${home}/tuning/scored-B.json`),newTuning=new Map(json(`${home}/v2/tuning/scored-B.json`).map(r=>[r.itemId,r]));
const oldMisses=oldTuning.filter(r=>shown(r.ref)&&!shown(r.pred));
const transition={originalMisses:oldMisses.length,recovered:oldMisses.filter(r=>shown(newTuning.get(r.itemId)?.pred)).length,
 retained:oldMisses.filter(r=>!shown(newTuning.get(r.itemId)?.pred)).length,
 introduced:oldTuning.filter(r=>shown(r.ref)&&shown(r.pred)&&!shown(newTuning.get(r.itemId)?.pred)).length};
summary.classificationOnly.tuningMissesTransition=transition;
const pct=x=>x===null?'—':`${(100*x).toFixed(2)} %`;
const interval=x=>`[${pct(x.low)} ; ${pct(x.high)}]`;
const label=h=>h==='tuning'?'Mise au point':'Aveugle';
const names=['P','S','Écarté','Non classé'];
const verdict=version=>records.filter(r=>r.version===version).every(r=>r.metrics.D4==='pass')?'réussi':'échoué';
const report=`# Classification seule × Astra low — jeux C

Décision du 13 novembre : détection B conservée, puis classification de chaque acte. La passe complète est abandonnée.
Le mode B de cette étude désigne la réannotation. Il conserve les entrées figées de C.

| Jeu | Prompt | Mode | Manqués P ∪ S | Rappel | Wilson 95 % du rappel | Précision | D4 |
|---|---|---|---:|---:|---|---:|---|
${records.map(r=>{const m=r.metrics;return `| ${label(r.half)} | ${r.version} | B | ${m.misses}/${m.refShown} | ${pct(m.recall)} | ${interval(m.recallWilson95)} | ${pct(m.precision)} | ${m.D4==='pass'?'réussi':'échoué'} |`;}).join('\n')}

D4 exige zéro manqué P ∪ S. Verdict v1 : **${verdict('v1')}**. Verdict v2 : **${verdict('v2')}**.
La comparaison v2 porte sur les agrégats. Aucun rapprochement par unité aveugle ne sort de l’exécuteur.
Sur les ${transition.originalMisses} manqués v1 de mise au point, la v2 en récupère ${transition.recovered} et en conserve ${transition.retained}.
Elle introduit ${transition.introduced} nouveau manqué sur les références P ∪ S auparavant affichées.

## Comparaison avec P0 seul

| Jeu | Manqués P ∪ S | Rappel | Wilson 95 % du rappel | Précision |
|---|---:|---:|---|---:|
${['tuning','blind'].map(h=>{const b=summary.baseline[h];return `| ${label(h)} | 0/${b.refShown} | ${pct(b.recall)} | ${interval(b.recallWilson95)} | ${pct(b.precision)} |`;}).join('\n')}

P0 seul est le baseline Astra low de la série 7. Il a zéro manqué sur les deux jeux.
Les bornes ci-dessus sont recalculées selon Wilson. Les bornes historiques de C étaient exactes et unilatérales.

## Matrices 4×4

Lignes : référence C. Colonnes : prédiction. Les sorties absentes ou invalides comptent comme « Non classé ».
${records.map(r=>`\n### ${label(r.half)} — ${r.version} — B\n\n| Référence | ${names.join(' | ')} |\n|---|---:|---:|---:|---:|\n${r.metrics.matrix.rows.map((row,i)=>`| ${names[i]} | ${row.join(' | ')} |`).join('\n')}\n`).join('')}
## Quotas et durée

GPT-6 Astra, low, siège Codex ChatGPT. Concurrence : 10. Arrêt des nouveaux appels à 90 %.
Aucun outil ni web accepté. Aucun modèle de secours. Aucune reprise selon la prédiction.

| Jeu | Prompt | Quota hebdomadaire | Durée | Réponses B | Sorties invalides |
|---|---|---|---:|---:|---:|
${records.map(r=>`| ${label(r.half)} | ${r.version} | ${r.execution.weeklyQuotaStart} % → ${r.execution.weeklyQuotaEnd} % | ${r.execution.durationMinutes.toFixed(2)} min | ${r.execution.measuredResponses} | ${r.metrics.invalid} |`).join('\n')}

La durée v1 de mise au point inclut les anciens modes A et B. Les nouvelles durées portent sur B seul.
Le run historique avait cinq tentatives initiales sans reçu, hors mesure. Il avait 494 réponses A et B mesurées.
Chaque nouvelle mesure ajoute une sonde de quota. Réinitialisation : ${records.at(-1).execution.quotaResetUtc}.

## Traçabilité et portée

Prompt v1 : \`${versions.v1}\` (#1099). Prompt v2 : \`${versions.v2}\` (commit 6c7cc36c0165253c11e89f41edfe67108dbbd0f9).
Les octets des prompts sont vérifiés avant les appels. Les caches sont séparés par version.
La cible make charge le fichier d’environnement. La clé n’est jamais affichée ni transmise au modèle.
Les références et sorties par unité aveugle restent scellées. Seuls les agrégats sont publiés.

Chaque jeu compte 252 unités. Les PV restent des unités documentaires. La précision et le rappel portent sur ces unités C.
Cette mesure de classification ne mesure pas le rappel de la détection B conservée. La référence technique D provient du consensus de modèles ou d’une provenance mixte.
Les anciennes mesures A restent dans les agrégats historiques. Elles ne sont pas relancées.
`;
const bytes=JSON.stringify(summary)+'\n';
assert.ok(!/dev-(?:sig|pv)-[a-f0-9]{12}/.test(report+bytes));
writeFileSync(`${publicDir}/aggregates.json`,bytes);
writeFileSync(`${publicDir}/report.md`,report);
writeFileSync(`${home}/pr-body.md`,`${report}\nValidation : quatre tests de métriques et d’appariement, contrôle de syntaxe et invariants des agrégats. PR maintenue en brouillon. Aucune fusion.\n`,{mode:0o600});
console.log({published:true,records:records.length,reportSha256:hash(report)});
