// bench-v11: build full/SUMMARY.md from scores-v11.json + rescore outputs.
import { readFile, writeFile } from "node:fs/promises";

const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const v11 = JSON.parse(await readFile(`${DIR}/full/scores-v11.json`, "utf8"));
const r676 = JSON.parse(await readFile(`${DIR}/full/rescore-v10/scores-676.json`, "utf8"));
const s674 = JSON.parse(await readFile(`${DIR}/harness/scores-100-674.json`, "utf8"));
const report = JSON.parse(await readFile(`${DIR}/harness/report-data-v101b.json`, "utf8"));
const published = new Map(report.arms.map((a) => [a.arm, a]));
const strict674 = new Map(s674.arms.map((a) => [a.arm, a]));

const f3 = (v) => v === null || v === undefined ? "N-A" : Number(v).toFixed(3);
const f2 = (v) => v === null || v === undefined ? "N-A" : Number(v).toFixed(2);
const f5 = (v) => v === null || v === undefined ? "N-A" : Number(v).toFixed(5);
const usd = (v) => v === null || v === undefined ? "N-A" : Number(v).toFixed(5);

const v11lines = ["| Bras | Modèle | Effort | Acc./100 | P stricte | R stricte | F1 stricte | F1 net 4 doc | E/doc | S/doc | USD équiv. API/doc | USD siège/doc | Sièges/1000 | p50 s | p90 s | Échecs J/V/Pr/T |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
for (const r of v11.arms) {
  const t = r.tokens ?? {};
  const es = r.arm.startsWith("opus55")
    ? `${Math.round(t.inMean + t.cacheMkMean + t.cacheRdMean)} / ${Math.round(t.outMean + t.thinkMean)}`
    : `~${Math.round(t.inBytesMean / 4)} / ~${Math.round(t.outBytesMean / 4)} (est.)`;
  const fc = r.failClasses;
  v11lines.push(`| ${r.arm} | ${r.model} | ${r.effort} | ${r.accepted}/100 | ${f3(r.strict.precision)} | ${f3(r.strict.recall)} | ${f3(r.strict.f1)} | ${f3(r.f1n4)} | ${es} | ${usd(r.usdApiEquivPerDoc)} | ${usd(r.usdSeatPerDoc)} | ${f2(r.seatsPer1000)} | ${f2(r.p50s)} | ${f2(r.p90s)} | ${fc.J}/${fc.V}/${fc.Pr}/${fc.T} |`);
}

const exact676 = new Map(r676.arms.map((a) => [a.arm, a]));
const v10lines = ["| Bras | Acc./100 (v10) | P stricte | R stricte | F1 stricte | Source 676 |",
  "|---|---|---|---|---|---|"];
const order = [...s674.arms.map((a) => a.arm)];
for (const name of order) {
  const s = strict674.get(name);
  const pub = published.get(name);
  const ex = exact676.get(name);
  if (ex) {
    v10lines.push(`| ${name} | ${ex.accepted}/100 | ${f3(ex.strict.precision)} | ${f3(ex.strict.recall)} | ${f3(ex.strict.f1)} | exact (sorties gelées rescorées) |`);
  } else {
    v10lines.push(`| ${name} | ${s.accepted}/100 | ${f3(s.strict.precision)} | ${f3(s.strict.recall)} | ${f3(s.strict.f1)} | report 674 (sorties non archivées, Δ borné §6) |`);
  }
}

const md = `# bench-v11 full — résultats 11 bras sièges + rescore 676

Oracle : 676 unités / 43 non résolus (reconstruction \`full/oracle-676/\`, correctif #725 n°1 ;
réancrage 85 non appliqué, effet borné §6). Scoreur : \`scoreValidV2\` + R4, stricte = non résolus
neutralisés, refus = unités manquées (chaîne v10 exacte).
Corpus : 100 documents v101b, sha256 PDF + textSha256 vérifiés ; prompts gelés byte-exact
100/100 (schemaSha256 + promptSha256 du gel). Aucune clé d'API utilisée (sièges uniquement).

## 1. Bras v11 (sièges)

E/S Opus = jetons mesurés CLI (surcharge système/CLI incluse, documentée §5).
E/S Muse = estimation octets/4 (aucun usage exposé par \`muse exec\`, §5).
USD équiv. API : Opus = coût liste provider ; Muse = estimation × tarif standard.
USD siège Opus = équiv. × f=0,030248 (burn v10, Claude Max 20x) ; Muse = N-A (siège non observable).

${v11lines.join("\n")}

## 2. Bras v10 rescorés sur 676

${v10lines.join("\n")}

Repères #725 mesurés : politique déployée P 0,373 R 0,491 F1 0,424 ; cascade CP P 0,484 R 0,533 F1 0,507
(Δ classement nul). C2/C3 : non rescorables en exact (sorties astra-low non archivées) ;
CP ci-dessus est la cascade de référence.

## 3. Efforts acceptés par les sièges CLI (mesuré)

- \`claude -p --model claude-opus-5-5\` : off (fanion omis), low, medium, high, xhigh acceptés ;
  \`minimal\` refusé (avertissement + repli défaut). max supporté mais exclu par décision owner.
- \`muse exec --provider meta --model muse-spark-1.3\` : minimal, low, medium, high, xhigh, max
  acceptés ; \`none\` refusé (exit 2) ; \`ultra\` rabattu sur xhigh (pas un bras distinct).

## 4. Coûts — sources de tarifs (équivalents calculés, aucun appel payé)

- Opus 5.5 : 4 USD/M entrée, 20 USD/M sortie, cache lecture 0,20, écriture 5m 5,00
  (https://platform.claude.com/docs/en/about-claude/pricing, page officielle).
- Muse 1.3 (standard, PAS contributor) : 1,25 entrée, 4,25 sortie, 0,15 cache (sources
  secondaires convergentes : Meta developer post repris, Cursor pricing, analyses ;
  page officielle dev.meta.ai sans chiffres au 28/09).

## 5. Comptabilité jetons et limites

- CLI Claude : \`usage.input_tokens\` ≈ prompt (≈2) + création/lecture de cache (≈25k/10k
  de surcharge système CLI) ; sortie = output_tokens + thinking. L'USD équiv. retient le
  coût liste provider (cache-aware). Comparaison E inter-transports faussée par la surcharge :
  les colonnes Opus la documentent au lieu de la masquer.
- CLI Muse : aucun usage exposé (événements --json sans jetons) ; E/S estimées, USD siège N-A.

## 6. Limites et bornes

- Réancrage 85 : lot non exécuté, aucune trace dépôt ; scores 676 = minorant (gain
  mécaniquement ≥ 0, 1–2 appariements déplacés/bras, classement inchangé — #725).
- Bras v10 sans sorties archivées (24/26 + C2/C3) : chiffres 674 reportés ; Δ676 borné à
  ~±0,002 de F1 (un seul document affecté, +2 unités), classement inchangé.
- Rapport v10 non modifié.
`;
await writeFile(`${DIR}/full/SUMMARY.md`, md);
console.log(`SUMMARY.md written (${v11.arms.length} v11 rows, ${order.length} v10 rows)`);
