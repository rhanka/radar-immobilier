# Cohorte « Nouveau B » (6 derniers mois) — reproduction versionnée

Artefact **rejouable sur checkout propre** qui produit la liste de slugs de la cohorte affichée par
l'onglet **Nouveau B**, période **« 6 derniers mois »**, les **5 toggles cochés**
(Zonage ✓ Résidentiel ✓ Précoce ✓ « Exclure PIIA sans projet résidentiel » ✓ « Exclure dérogations mineures » ✓).

## Définition EXACTE (vrai code, pas une ré-implémentation)

Le rail « Nouveau B » filtre au **niveau SIGNAL** (pas l'agrégat `countForVivierCity`, qui n'applique aucune
exclusion et dont la fenêtre serveur DROP les dates nulles). `reproduce-cohort.ts` importe les VRAIES fonctions
de production et rejoue le pipeline :

1. `classifyVivierSignal` (`api/src/services/graph/vivier-v2.ts`) par nœud → classification serveur.
2. `projectComposedVivierB(nodes, DEFAULT_B_AXES={z,r,p:true})` (`ui/src/lib/signals/vivier-view-mode.ts`)
   = **INTERSECTION** : `exclusion_reason===null ∧ zonage.valeur==='oui' ∧ isResidentialEligible(c)
   ∧ etape∈{avis_motion, projet_reglement}`.
3. `filterNodesByEtapeDate(nodes, dateRangeFromSignalTimeRange(defaultSignalTimeRange(now)))`
   (`ui/src/lib/signals/signal-date-filter.ts`) = **6 mois calendaires**,
   `[startOfDay(today−6mois), endOfDay(today)]` inclusif ; **dates nulles GARDÉES** (le client n'invente
   pas de récence — le miroir serveur `isSignalInDateRange`, lui, les DROP : c'est LA divergence qui faisait
   sous-compter l'agrégat).
4. `applyVivierBExclusions(nodes, DEFAULT_VIVIER_B_EXCLUSIONS={piiaSansProjetResidentiel,derogationsMineures:true})`
   (`ui/src/lib/signals/vivier-b-display-filter.ts`) = AND-NOT : retire `instrument==='piia'` sans preuve
   résidentielle (`nb_unites_max` | `residentiel='oui'` | logements cités) et `instrument==='derogation'`
   (couvre `derogation_mineure`).

Puis `signaux = filtered.length`, `villes = distinct(citySlug)` triées.

- **SCOPE = TOUTES les villes servies** (PAS set-167 : `mont-tremblant`, une ancre, est HORS 167).
- **INTERSECTION, pas UNION** : confirmé par le match bit-à-bit des 5 ancres owner.

## Fidélité vérifiée (ancres owner)

Le script **échoue en code 2** si les 5 ancres ne matchent pas — la fidélité est vérifiée, pas supposée :
`Sainte-Martine=6 · Saint-Michel=4 · Saint-Jean-Baptiste=4 · Mont-Tremblant=4 · Brossard=3`.

## Source (pointeur versionné)

- Dump prod-PG `graph_nodes` (projection exacte de `listCitiesWithSignalNodes`, export OVH read-only job 39).
- S3 : `s3://radar-immobilier-docs-pocs/scratch/postbrossard-7263-20260803/graph_nodes.ndjson`
- Export OVH **2026-08-06** · **7298 nœuds** · sha256 `d9cb3cc6b9700caa1ba711d7fa204597e2db8be6b4002a764a7f386a43e57699`

## Invocation

```
DUMP=<path/graph_nodes.ndjson> [NOW=<ms epoch>] \
  TSX_TSCONFIG_PATH=scripts/cohorte-vivier-b/tsconfig.json \
  tsx scripts/cohorte-vivier-b/reproduce-cohort.ts > cohorte-vivier-b-6mo.slugs.tsv
```

## Résultat sur le dump 2026-08-06 + caveat FRAÎCHEUR

À `now=2026-08-10` : **191 signaux · 127 villes**, **5/5 ancres OK** (logique fidèle). Les totaux owner
`185 · 124` ne tombent sur **aucun `now` exact** de ce dump (balayage : 200·130 @08-06 → 191·127 @08-10 →
180·125 @08-12). L'écart +6 signaux / +3 villes = **vintage du dump (4 j) + le `now` exact du screenshot**
(frontière de fenêtre), PAS la logique. Pour le **185·124 EXACT** que voit l'owner : rejouer CE MÊME script
sur un **dump frais** (job 39-export OVH) ou lire l'UI live. La définition est verrouillée ; seul le pointeur
source change.

Sortie versionnée jointe : `cohorte-vivier-b-6mo.slugs.tsv` (127 slugs, dump 2026-08-06, now=2026-08-10).
