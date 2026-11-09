// bench-v11: build oracle 676 from the frozen 674 oracle + #725 correction 1.
// Correction: merge dual representations of two unanimously recognized
// Saint-Barthelemy acts (a02+a05 -> adoption 738-26, a03+a06 -> premier
// projet 739-26). Explicit regulatory object retained; both locations kept
// as anchor sites (scorer rule R3, alternate_sites). 674+2=676 units,
// 47-4=43 unresolved. Correction 2 (85 reanchors) is NOT applied: the new
// anchor spans were never published and the lot has no repository trace;
// effect bounded (see README).
import { readFile, writeFile, mkdir } from "node:fs/promises";

const DIR = "/home/antoinefa/src/radar-immobilier-bench/tmp/bench-wonder";
const H = `${DIR}/harness`;
const OUT = `${DIR}/full/oracle-676`;

const consensus = JSON.parse(await readFile(`${H}/consensus-674.json`, "utf8"));
const unresolved = JSON.parse(await readFile(`${H}/unresolved-674.json`, "utf8"));
const disputed = JSON.parse(await readFile(`${H}/barth-unresolved.json`, "utf8"));
const byItem = Object.fromEntries(disputed.map((e) => [e.item, e]));
const rep = (item) => byItem[item].options.find((o) => o.unit).unit;

const DOC = "saint-barthelemy-2026-09-08";
const docUnits = consensus.units.filter((u) => u.documentId === DOC);
const ref = docUnits[0];

const merged = [
  { item: "a02+a05", unitId: "u01", label: rep("a05").label, stage: "adoption",
    objet: "738-26", citation: rep("a05").citation, anchor: rep("a05").anchor,
    page: rep("a05").page,
    alternate: { page: rep("a02").page, anchor: rep("a02").anchor, citation: rep("a02").citation } },
  { item: "a03+a06", unitId: "u03", label: rep("a06").label, stage: "projet_reglement",
    objet: "739-26", citation: rep("a06").citation, anchor: rep("a06").anchor,
    page: rep("a06").page,
    alternate: { page: rep("a03").page, anchor: rep("a03").anchor, citation: rep("a03").citation } },
];

for (const m of merged) {
  consensus.units.push({
    city: "saint-barthelemy",
    documentId: DOC,
    id: `${DOC}#${m.unitId}`,
    label: m.label,
    stage: m.stage,
    objet: m.objet,
    citation: m.citation,
    anchor: m.anchor,
    page: m.page,
    alternate_sites: [{ page: m.alternate.page, anchor: m.alternate.anchor, citation: m.alternate.citation }],
    doc_sha: ref.doc_sha,
    sourceUrl: ref.sourceUrl,
    provenance: { via: "corrected-725", addedBy: "bench-v11",
      events: [`merge:${m.item}`, "objet:explicit-retained", "sites:both-kept-R3"] },
  });
}
consensus.unitCount = consensus.units.length;
consensus.counts = { ...consensus.counts, unresolved: 43 };
consensus.correction725 = {
  merged: merged.map((m) => ({ id: `${DOC}#${m.unitId}`, from: m.item, objet: m.objet })),
  unitsBefore: 674, unitsAfter: consensus.units.length,
  reanchor85: "NOT-APPLIED (new spans unpublished, lot untraced; bounded effect, see README.md)",
};
const st = consensus.documentsStatus.find((d) => d.documentId === DOC);
st.units = consensus.units.filter((u) => u.documentId === DOC).length;

const drop = new Set(["a02", "a03", "a05", "a06"]);
unresolved.entries = unresolved.entries.filter(
  (e) => !(e.documentId === DOC && drop.has(e.item)));
unresolved.count = unresolved.entries.length;

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/consensus.json`, `${JSON.stringify(consensus, null, 1)}\n`);
await writeFile(`${OUT}/unresolved.json`, `${JSON.stringify(unresolved, null, 1)}\n`);

const readme = `# Oracle 676 — reconstruction bench-v11 (depuis 674 + correctif #725)

Source gelée : \`origin/feat/t1-model-benchmark-real\` dd0561f6,
\`docs/reviews/refresh-benchmark/v101b/oracle-v3/consensus.json\` (674 unités)
+ \`unresolved.json\` (47 non résolus).

## Correctif 1 appliqué (+2 unités, −4 non résolus)

Fusion des doubles représentations de deux actes de Saint-Barthélemy
unanimement reconnus (commentaire #725) :

- \`saint-barthelemy-2026-09-08#u01\` ← a02 (humaine S738, ancrée sommaire p.4)
  + a05 (v3, ancrée titre p.3) : adoption règlement 738-26, objet \`738-26\`.
- \`saint-barthelemy-2026-09-08#u03\` ← a03 (humaine S739P, p.5)
  + a06 (v3, p.4) : premier projet 739-26, objet \`739-26\`.

Objet réglementaire explicite retenu ; les deux emplacements conservés
(site primaire + \`alternate_sites\`, règle R3 du scoreur). Les identifiants
u01/u03 reprennent ceux de l'arbitrage pour ces représentations.
a01 (aqueduc, désaccord réel) reste non résolu.

Résultat : 676 unités, 43 non résolus. \`unitCount\`, \`counts.unresolved\`
et le statut documentaire de Saint-Barthélemy (6→8) mis à jour ; le reste
du gel est inchangé (aucune réécriture).

## Correctif 2 NON appliqué (85 citations à réancrer)

Le lot de convergence à trois modèles (nouvelles ancres contenant formule
+ identifiant) n'a aucune trace dans le dépôt (branche bench figée au
19/09, aucune autre branche ne le porte) et les nouvelles ancres ne sont
publiées nulle part. Reconstruction exacte impossible.
Effet borné par #725 : 1 à 2 appariements déplacés par bras, gain
mécaniquement positif ou nul (l'emplacement actuel serait conservé en site
alternatif), classement inchangé. Les scores 676 ci-dessous sont donc un
minorant de l'oracle 676+réancré.
`;
await writeFile(`${OUT}/README.md`, readme);
console.log(`units=${consensus.units.length} unresolved=${unresolved.count}`);
if (consensus.units.length !== 676 || unresolved.count !== 43) process.exitCode = 1;
