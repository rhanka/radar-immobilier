# SPEC_STUDY — Vue « Source » (qualité de données e2e, carto)

Rung : **STUDY** (problème ouvert — options + trade-offs, pas d'engagement).
Auteur : conducteur radar-immobilier. Date : 2026-06-29.

## 0. Problème & intention

Le principal veut une **5ᵉ vue « Source »**, sur le **même socle géo que Signaux**,
mais orientée **qualité de données** : recueil de la donnée brute + **consistance
end-to-end** du pipeline. Objectif : rendre **visuel et géographique** ce qui est
aujourd'hui un tableau (le focus **30 vs 1104** et **33 vs 5000+**) — on voit d'un
coup les trous (98 sans-graphe, 22 grounding, zonage 7/30, rappel #74 59,2 %).

Ce n'est PAS une vue métier (opportunités) — c'est une vue **ops/data-quality**
(« où en est notre matière première, par ville »).

## 1. Le pipeline e2e à visualiser (les couches candidates)

Par ville, l'état de chaque étape :

| # | Couche | Métrique | Source |
|---|---|---|---|
| L1 | **Recueil brut** | a-t-on du raw scrapé (PV/PDF) ? nb docs | S3 `raw/<city>/` |
| L2 | **Graphifié** | graphe présent ? `ontology_version` (v2.3 ?) | S3 `graph/<city>/latest.json` |
| L3 | **Grounding** | % signaux avec citation page/bbox | graphe |
| L4 | **Zonage servi** | collection `qc-zonage-<slug>` dispo ? | API geo `/collections` |
| L5 | **Lots cadastraux** | `qc-lots-<slug>` servi ? | API geo |
| L6 | **Mapping #74** | rappel zone-citée↔servie | mesure (jointure) |
| L7 | **Consistance e2e** | signal→citation→PDF→zone→lot cohérents (chaîne complète) | jointures |

## 2. Axes de décision (ouverts) + options + préco

### D-A. Maille primaire
- **A1 ville** (choropleth/point par ville) — colle au 30/1104, simple, c'est l'histoire du principal.
- A2 zone/lot — plus profond mais lourd, peu lisible à l'échelle province.
- **Préco : A1 ville en V1** ; drill-down ville→(zone/lot) en V2.

### D-B. Périmètre & axes de focus
- Doit afficher **30 / 1104 / 33 / 5000+** comme filtres-cadrage (déjà des tags focus).
- **Préco** : sélecteur de focus (30 démo / 1104 province / 33 E2E / tout), métriques recalculées par périmètre.

### D-C. Couches V1 (lesquelles des 7)
- **Préco V1** : L1 (raw), L2 (v2.3), L4 (zonage servi), L5 (lots) + **un score de complétude agrégé** par ville.
- **V2** : L3 (grounding), L6 (#74), L7 (consistance e2e) — plus coûteux (jointures).
- Trade-off : 4 couches + score = lisible ; les 7 d'un coup = illisible.

### D-D. Source des métriques (où vit le calcul)
- D1 **live client** (compose les endpoints existants : geo `/collections`, signaux, S3) — frais mais lent/lourd à l'échelle 1104.
- D2 **endpoint API agrégateur** (`/api/source/coverage`) qui pré-calcule la matrice — rapide, cache.
- D3 **réutiliser la coverage-matrix geo** (geo maintient déjà une matrice zones=done par ville) + compléter côté immo.
- **Préco** : **D2** (endpoint agrégateur immo) en V1, alimenté par un job batch léger ; D3 comme source d'entrée zonage. Éviter D1 pur (1104 appels live = lent).

### D-E. Réutilisation du socle geo Signaux
- E1 **réutiliser** SignauxMapView (carte, légende, projection SVG, filtres) en paramétrant la couche de coloration.
- E2 nouvelle vue from scratch.
- **Préco : E1** — factoriser le socle carto (déjà éprouvé : projection, bbox, légende) ; la vue Source = même carte + couche « qualité » + panneau scorecard.

### D-F. Encodage visuel
- **Préco** : choropleth ville colorée par **score de complétude** (rouge→vert), **toggle de couche** (voir L1 seul, ou L4 seul…), **scorecard au clic** (les 7 lignes pour la ville, dont les manquantes en rouge honnête).

### D-G. Honnêteté (anti-survente, principe maison)
- La vue DOIT afficher les trous tels quels (98 sans-graphe, 22 DUR zonage…) — pas de vert fabriqué. Le « done non substantié » (cf. geo coverage-matrix) doit être distingué du « servi vérifié ».
- **Préco** : 2 états distincts par cellule — `vérifié live` vs `déclaré non substantié` vs `absent`.

## 3. Ce qui est déjà réutilisable (matériau de cette session)
- Socle carto : `SignauxMapView` + `EvaluationMapView` (projection SVG, bbox, légende).
- Mesures e2e : `zones-client` + passthrough geo, `prospect`/lots clients, mesure rappel #74 (`docs/spec/reports/wp3-mapper-recall-2026-06-28.md`), complétude v2.3 (`2.3-completude-1105-FRESH.md`), focus rollup.
- Source zonage/lots : API geo `/collections` (passthrough déjà câblé).

## 4. Questions ouvertes pour le principal (à batcher après revue pairs)
1. **Maille V1** : ville-only (préco) ou drill-down ville→zone→lot dès V1 ?
2. **Couches V1** : les 4 (raw/v2.3/zonage/lots + score) (préco) ou inclure grounding/#74/consistance dès V1 ?
3. **Calcul** : endpoint agrégateur batch (préco D2) ou live-client (D1) ?
4. **Périmètre** : V1 = les 30 focus (démo) d'abord, puis 1104 ? ou 1104 d'emblée ?

## 4bis. Réconciliation des 2 revues pairs (2026-06-29)

**Pair A (faisabilité/valeur) — angle mort majeur levé : ~70 % EXISTE déjà.**
- Vue « Sources » câblée : `ui/src/lib/components/sources-map/SourcesMapView.svelte` (+ `CityDetailPanel`) — en **liste/cartes**, pas choropleth.
- Agrégateurs en prod : `api/src/routes/scrape-status.ts` (`/coverage` 1106 villes byStatus/byMrc + `/maturity` 0-100/ville, dérivation honnête `derive.ts`) ET `api/src/routes/data-quality.ts` → `buildDataQualityCitySummary` (L1 councilMinutes, L2/L3 ontologie+compte Zone/Lot+fraîcheur, L4 zones servies, L5 lots servis, tri-état `fresh|partial|stale|unknown` + evidence readiness).
- → **Recadrer en EVOL de la vue Sources** (liste→**choropleth**), réutiliser ces agrégateurs. PAS de 5ᵉ vue, PAS de nouvel agrégateur, PAS de job batch/table.

**Pair B (risque/honnêteté) :** tuer le **score 0-100 en couleur** (anti-survente : #74=59,2 %, 98 sans-graphe → un vert global ment). Colorer par **pire statut d'étape honnête** + **« absent » distinct**. Tri-état strict par cellule.

**Points DURS communs** : maille ville ; honnêteté-first (jamais de vert fabriqué ; `vérifié live` / `non substantié` / `absent`) ; L3/#74(L6)/consistance(L7) → **V2** (mesure #74 ne tourne que sur 9 villes pilotes, pas par-ville à 1104) ; **bannir le scan S3 raw live** à 1104 (lire le statut dérivé scrape-status) ; extraire un **`ChoroplethMapBase`** depuis `SignauxMapView` (lignes ~332-374) au lieu de forker 1460 lignes.

**Divergence réconciliée** :
- *Score* : Pair A note que `cityMaturity` 0-100 existe ; Pair B refuse qu'il colore la carte. → **couleur = pire statut d'étape honnête + absent distinct** ; la maturité existante sert au tri/scorecard, PAS à la couleur.
- *Périmètre* : Pair B = 30-only ; Pair A = 1104 + highlight 30 (les agrégateurs SONT déjà province-wide → 1104 quasi gratuit). → **décision principal** (sous réserve que `municipalities.geojson` porte les 1104 géométries, sinon trous no-data).

**Valeur-ajout repérée par Pair A (à intégrer)** : surfacer le **prochain gain marginal** = villes scrapées+graphifiées MAIS sans zonage/lots servis (complétions cheap) — l'insight actionnable, pas juste contemplatif.

## 5. Prochaines étapes
- Revue ≥2 pairs adversariaux (faisabilité/altitude vs risque/scope) sur ce STUDY.
- Réconcilier → présenter décisions en lots ≤4.
- Si convergence : monter en EVOL (`SPEC_EVOL_SOURCE_VIEW.md`) + `harness plan` (lots BRANCH.md).
