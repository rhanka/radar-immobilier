# SPEC_EVOL — Vue « Source » (qualité de données e2e, carto)

Rung : **EVOL** (design engagé, décisions numérotées, prêt pour `harness plan`).
Issu de `SPEC_STUDY_SOURCE_VIEW.md` + 2 revues pairs adversariales (faisabilité/valeur,
risque/honnêteté) + décisions principal (2026-06-29).

## 0. Intention
Rendre **visuel et géographique** l'état du pipeline de données par ville (le focus
30/1104 rendu carto), orienté **qualité de données + consistance e2e**, dans le
respect strict de l'**anti-survente** (jamais de vert fabriqué).

## 1. Décisions (capturées)

- **D1 — Socle 80 % commun avec SIGNAUX.** On EXTRAIT un socle géo partagé
  `GeoCityMapBase` depuis `SignauxMapView` (init MapLibre + source `municipalities.geojson`
  + couche `cities-fill` choropleth dont l'**expression couleur est une prop** + drill
  segmenté Province/Ville/Zone + `flyTo` + légende + couches zone/lot). **Signaux** et
  **Source** consomment ce même socle (80 % commun). La vue Sources **liste** actuelle
  (`SourcesMapView` cartes/`MapPin`) est **remplacée** par la version géo. PAS une 5ᵉ vue
  parallèle, PAS un fork de 1460 lignes.
- **D2 — Coloration = pire statut d'étape honnête + « absent » distinct.** La couleur
  d'une ville = l'étape la plus en retard de sa chaîne (raw→graphe→zonage→lots). **Vert
  uniquement si vérifié live.** Couleur distincte pour `absent` et pour `déclaré non
  substantié`. **PAS de score 0-100 en couleur** (anti-survente : #74=59,2 %, 98 sans-graphe
  → un vert global mentirait). `cityMaturity` existant peut servir au tri/scorecard, jamais
  à la couleur.
- **D3 — Périmètre V1 = province 1104 + highlight focus-30.** Les agrégateurs sont déjà
  province-wide → 1104 quasi gratuit ; le focus-30 démo = surbrillance (pas un recompute).
  PRÉREQUIS : vérifier que `municipalities.geojson` porte les **1104 géométries** (sinon
  villes en `no-data` honnête, pas en erreur).
- **D4 — Couches V1 = L1 raw + L2 v2.3 + L4 zonage servi + L5 lots servis.** Grounding (L3),
  rappel #74 (L6), consistance e2e (L7) → **V2** (jointures coûteuses ; #74 ne tourne que
  sur 9 villes pilotes aujourd'hui).
- **D5 — Réutiliser les agrégateurs existants, PAS de batch/table.** Source de vérité :
  `api/src/routes/scrape-status.ts` (`/coverage` byStatus/byMrc, `/maturity`,
  `derive.ts`) + `api/src/routes/data-quality.ts` (`buildDataQualityCitySummary` :
  L1 councilMinutes, L2/L3 ontologie+fraîcheur, L4 zones, L5 lots, tri-état
  `fresh|partial|stale|unknown`). **Nouveau** = un endpoint **lecture BULK set-based**
  `/api/source/coverage` (un `GROUP BY citySlug` sur `zone_versions`/`lot_versions`/
  `graph_nodes` + merge scrape-status), PAS 1104 appels per-city, PAS de job batch.
  **Bannir le scan S3 raw live** à 1104 (lire le statut dérivé scrape-status pour L1).
- **D6 — Honnêteté par cellule (tri-état).** Chaque cellule = `vérifié live` /
  `déclaré non substantié` / `absent`, avec **preuve + fraîcheur**. Distinguer
  « scrapé sans graphe » de « graphifié+groundé » (ne pas les fondre dans une couleur).
- **D7 — Insight actionnable (valeur).** Surfacer le **prochain gain marginal** : villes
  scrapées+graphifiées MAIS sans zonage/lots servis (complétions cheap). Headline province
  en haut (`X/1104 graphés, Y/1104 zonage servi`) = le chiffre que veut le principal.

## 2. Architecture cible

```
ui/src/lib/components/maps/GeoCityMapBase.svelte   (NOUVEAU — socle extrait de SignauxMapView)
  props: { fillColorExpression, fillOpacityExpression?, onCityClick, segments, legend, ... }
ui/.../SignauxMapView.svelte    → consomme GeoCityMapBase (couleur = signal count)   [refactor]
ui/.../sources-map/SourceMapView.svelte (NOUVEAU/EVOL) → GeoCityMapBase (couleur = pire statut)
  + SourceScorecardPanel (réutilise data-quality-client + CityDetailPanel)
api/src/routes/source-coverage.ts (NOUVEAU) → GET /api/source/coverage  (bulk set-based)
ui/src/lib/sources/source-coverage-client.ts (NOUVEAU)
```

## 3. Lots d'implémentation (pour `harness plan`)
1. **L-base** : extraire `GeoCityMapBase` de `SignauxMapView` + faire passer Signaux dessus (refactor iso-comportement, gate vert).
2. **L-api** : endpoint bulk `/api/source/coverage` (set-based, tri-état honnête L1/L2/L4/L5) + tests.
3. **L-view** : `SourceMapView` (socle + rampe pire-statut + absent distinct) + scorecard + headline province + highlight focus-30 + remplacement de la nav Sources.
4. **L-honnêteté** : tests anti-survente (jamais vert si non substantié ; 98 sans-graphe = absent ; couleurs L2≠L3).
5. **V2 (hors lot)** : L3 grounding / L6 #74 / L7 consistance + drill zone/lot.

## 4. Risques / prérequis
- `municipalities.geojson` doit couvrir 1104 géométries (sinon no-data honnête).
- Refactor `GeoCityMapBase` doit être iso-comportement pour Signaux (gate + screenshot avant/après).
- Pas de recompute par périmètre ; le focus-30 est un filtre visuel.
