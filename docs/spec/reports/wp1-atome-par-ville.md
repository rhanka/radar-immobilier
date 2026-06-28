# WP1 — Atome DATA par ville (concaténation agrégeable)

Tableau ville × dimensions de ce que la couche DATA livre réellement, à l'image
de l'atome geo. Données brutes : `wp1-atome-par-ville-full.tsv`
(slug, name, priorityRank, graph_version, v23, zones_geo, lots_geo, signaux,
citations_pct, focus30) — 1104 villes.

Mesuré le 2026-06-28. Aucune valeur inventée : chaque cellule provient d'une
mesure réelle (API geo OGC `api.geo.sent-tech.ca`, graphes S3
`radar-immobilier-docs-pocs/graph/<slug>/latest.json`).

## Méthode & statut de mesure (exhaustif vs échantillon — anti-survente)

| Dimension | Source | Statut |
|---|---|---|
| `graph_version` / `v23` | TSV amont | exhaustif 1104 |
| `zones_geo` **présence** (existe / 0) | `/collections` (1 appel, 2695 collections) — règle code `id===qc-zonage-<slug>` OU `startsWith("qc-zonage-<slug>-")` | **exhaustif 1104** |
| `lots_geo` **présence** (existe / 0) | `/collections` — `qc-lots-<slug>` | **exhaustif 1104** |
| `zones_geo` / `lots_geo` **comptes de features** (n) | `/collections/<id>/items?limit=1` → `numberMatched` | **exhaustif focus30** + échantillon ~264/1299 collections pour le reste (biais vers petites collections : `numberMatched` force un COUNT serveur lent, les grosses villes timeoutent) |
| `signaux` (nb nœuds Signal + DesignationEvent) | graphes S3 téléchargés (1118 fichiers, 35 Mo) puis comptés en local | **exhaustif** sur les 1007 villes disposant d'un graphe S3 ; `nd` = pas de graphe |
| `citations_pct` (part Signal+DE avec `properties.citation` non vide — proxy grounding) | graphes S3, local | **exhaustif** sur les villes à ≥1 signal |

Convention cellules : `n` = compté ; `0` = absent (ou collection présente mais
0 feature) ; `nd` = présent/attendu mais non mesuré (count non récupéré, ou pas
de graphe S3) ; `>=n` = somme partielle (zones multi-collections, certaines non
comptées).

Note slugs : les graphes S3 désambiguïsent les homonymes MRC par `--`
(ex. `clermont--charlevoix-est`) ; matché contre le slug TSV `-` par
normalisation `--`→`-` (récupère 58 villes).

## Couverture par dimension

### focus:30 (top priorityRank — EXHAUSTIF sur toutes les dimensions)

| Dimension | Couverture | Détail |
|---|---|---|
| v2.3 | 25/30 (83 %) | 3 villes `none` (brossard, lile-dorval, kirkland), 2 villes `2.2` (saint-constant, saint-philippe) |
| lots_geo présent | 30/30 (100 %) | tous comptés (n) — min 1444 (saint-mathieu), max 67010 (longueuil) |
| zones_geo présent | 3/30 (10 %) | seulement westmount (159), longueuil (6305), rosemère (117) ont une collection `qc-zonage-<slug>` |
| graphe S3 (signaux mesurables) | 27/30 (90 %) | 3 sans graphe : brossard, lile-dorval, kirkland |
| ≥1 signal extrait | 26/30 | saint-lambert a un graphe mais 0 nœud Signal/DE |
| total Signal+DE | 250 | — |
| grounding pondéré (citation) | 188/250 = **75 %** | 0 % sur les 2 villes v2.2 (citation non peuplée en 2.2) |

### focus:1104 (toutes — présence exhaustive, comptes partiels)

| Dimension | Couverture | Note |
|---|---|---|
| v2.3 | 976/1104 (88 %) | 128 villes hors 2.3 (none ou 2.2) |
| lots_geo présent | 1038/1104 (94 %) | 1043 collections `qc-lots-*` ; 5 vides 0 feature (territoires nord : la-tuque, eeyou-istchee-james-bay, havre-saint-pierre, aguanish, cote-nord-du-golfe-du-saint-laurent) |
| zones_geo présent | 218/1104 (20 %) | gros trou structurel : 80 % des villes n'ont aucune collection zonage normalisée au slug |
| graphe S3 présent | 1007/1104 (91 %) | 97 villes sans graphe (signaux = nd) |
| ≥1 signal extrait | 723/1104 (65 %) | 284 villes ont un graphe mais 0 Signal/DE (PV ingérés, rien d'extrait) |
| total Signal+DE | 7202 | exhaustif sur les 1007 graphes |
| grounding pondéré (citation) | 3862/7021 ≈ **55 %** | exhaustif |

## Trous saillants par ville

- **Grounding nul malgré du volume** : les 31 villes en ontologie v2.2 ont
  toutes 0 % de citation (champ non peuplé avant v2.3) — `saint-constant` (19
  signaux), `saint-philippe` (9). En plus, 67 villes v2.3 restent à 0 %.
  Pire encore en volume brut : `lyster` (400 signaux, 0 % grounding),
  `grand-remous` (331, 0 %), `lac-saint-paul` (77, 0 %) — fort volume, zéro preuve.
- **Zonage quasi absent** : seules 218/1104 villes (20 %) exposent une
  collection `qc-zonage-<slug>`. C'est la dimension la moins couverte ;
  les comptes de features ne sont disponibles que pour 3 villes (zones très
  partiellement comptées au global).
- **97 villes sans graphe S3** du tout (signaux = nd), dont 3 focus
  (brossard, lile-dorval, kirkland) et des chefs-lieux (quebec, lac-megantic,
  marieville).
- **284 villes "graphe vide"** : graphe présent mais 0 Signal/DE — pipeline
  d'ingestion PV passé, extraction designation/signal à zéro.

## Top 5 villes focus les plus incomplètes

| rank | ville | graph_version | v2.3 | zones_geo | lots_geo | signaux | citations_pct | manque |
|---|---|---|---|---|---|---|---|---|
| 8 | brossard | none | 0 | 0 | 24823 | nd | nd | pas de graphe S3, pas v2.3, pas de zonage — seul le cadastre lots est livré |
| 16 | lile-dorval | none | 0 | 0 | 27261 | nd | nd | idem brossard |
| 30 | kirkland | none | 0 | 0 | 6878 | nd | nd | idem brossard |
| 17 | saint-constant | 2.2 | 0 | 0 | 11622 | 19 | 0 | v2.2 (pas v2.3), grounding nul, pas de zonage |
| 22 | saint-philippe | 2.2 | 0 | 0 | 5202 | 9 | 0 | v2.2, grounding nul, pas de zonage |

(Suivantes : saint-lambert rank 2 — graphe présent mais 0 signal extrait ;
montreal-ouest / cote-saint-luc — 1 signal, 0 % grounding.)
