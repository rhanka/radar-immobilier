# Consolidation focus-30 — PV (PDF) × signaux — juillet 2026

Le **focus** du produit est l'ensemble des villes qui portent les **signaux
prioritaires** : l'intersection **multifamilial 4+ ∩ zonage ∩ étape précoce**
(z∩m∩p) — l'axe de reporting « **30 villes / 33 signaux précoces** ». L'ensemble
est data-driven : sa taille suit la donnée (~30 villes) et bouge avec les
re-scrapes / re-graphify.

Ce rapport vérifie, **ville par ville**, que ce périmètre dispose à la fois de
ses **procès-verbaux archivés** (preuve PDF) et de ses **signaux projetés**.

**Verdict : 0 trou** — les 31 villes du focus (mesure du 2026-07-03) ont toutes
au moins un signal prioritaire ET au moins un PV PDF archivé.

## 1. Critères des signaux prioritaires

Un signal est PRIORITAIRE ssi il satisfait les trois critères (helpers
canoniques de `api/src/services/graph/graph-store.ts`) :

- **z** (zonage) : `DesignationEvent`, ou `Signal` avec `category` ou `etape`
  ∈ ZONAGE_CATEGORIES (rezonage, dérogation, PIIA, PPCMOI, …) ;
- **m** (multifamilial 4+) : `nb_unites_max ≥ 4` ou `intensite = 'haute'`
  (Signal uniquement) ;
- **p** (précoce) : `etape` ∈ {avis_motion, projet_reglement} (annotée v2.1,
  sinon repli `deriveEtape(label, description)`).

**Le focus = les villes DISTINCTES qui portent ces signaux prioritaires.**

## 2. Mesure (S3 canonique, 2026-07-03)

Mesure sur les graphes projetés `graph/<slug>/latest.json` (bucket S3 SCW),
avec les helpers z/m/p RÉELS importés de `graph-store.ts` (pas une réplique),
clés canoniques du référentiel uniquement :

| Mesure | Valeur |
|---|---:|
| Graphes canoniques `graph/<slug>/latest.json` | 1 007 |
| Villes avec ≥ 1 signal | 723 |
| Total signaux (Signal + DesignationEvent) | 7 202 (z = 5 755, m = 199, p = 1 335) |
| **Signaux PRIORITAIRES z∩m∩p** | **33** |
| **Villes distinctes porteuses (= le focus)** | **31** |

Les deux variantes de classification (`isZonageSignal` 3-args avec repli
`etape`, comme la vue Signaux, vs 2-args comme `report-opportunity-proof.ts`)
donnent le MÊME compte (33/31) : les ensembles `etape` zonage et `etape`
précoce sont disjoints, le repli ne joue pas dans l'intersection.

Réconciliation avec l'application : la vue Signaux en production affichait
**32 signaux / 30 villes** au moment des captures du rapport de livraison — la
projection PG était légèrement en retrait des graphes S3 (33/31) et rattrape.

## 3. Les 31 villes du focus — PV × signaux : 0 trou

Base de la colonne PV : listing S3 récursif complet de l'archive
`raw/proces-verbaux-<slug>/cas/<sha>.pdf` (2026-07-03). Les seules villes à
signaux SANS PV archivé sont les 14 villes du §4 — **aucune n'est dans le
focus** ; chaque ville ci-dessous a donc ≥ 1 PV PDF archivé (compte exact
indiqué quand il a été relevé lors de la mesure).

| # | Ville | z∩m∩p | Signaux | PV (PDF) | Verdict |
|---|-------|------:|--------:|:---|:---|
| 1 | Mont-Tremblant (`mont-tremblant`) | 2 | 13 | oui (5) | OK |
| 2 | Saint-Frédéric (`saint-frederic`) | 2 | 4 | oui | OK |
| 3 | Saint-Mathieu-de-Beloeil (`saint-mathieu-de-beloeil`) | 1 | 22 | oui | OK |
| 4 | Sainte-Catherine (`sainte-catherine`) | 1 | 16 | oui (85) | OK |
| 5 | Saint-Amable (`saint-amable`) | 1 | 15 | oui | OK |
| 6 | Rimouski (`rimouski`) | 1 | 12 | oui | OK |
| 7 | Rosemère (`rosemere`) | 1 | 11 | oui (10) | OK |
| 8 | Saint-Raymond (`saint-raymond`) | 1 | 11 | oui | OK |
| 9 | Champlain (`champlain`) | 1 | 10 | oui | OK |
| 10 | Saint-Côme-Linière (`saint-come-liniere`) | 1 | 9 | oui | OK |
| 11 | Coaticook (`coaticook`) | 1 | 8 | oui | OK |
| 12 | Mont-Saint-Hilaire (`mont-saint-hilaire`) | 1 | 8 | oui | OK |
| 13 | Saint-Stanislas-de-Kostka (`saint-stanislas-de-kostka`) | 1 | 8 | oui | OK |
| 14 | Cowansville (`cowansville`) | 1 | 7 | oui | OK |
| 15 | Lévis (`levis`) | 1 | 7 | oui | OK |
| 16 | Petite-Rivière-Saint-François (`petite-riviere-saint-francois`) | 1 | 7 | oui | OK |
| 17 | Plaisance (`plaisance`) | 1 | 7 | oui | OK |
| 18 | Saint-Raphaël (`saint-raphael`) | 1 | 7 | oui | OK |
| 19 | Alma (`alma`) | 1 | 6 | oui | OK |
| 20 | Chelsea (`chelsea`) | 1 | 6 | oui | OK |
| 21 | Hemmingford (`hemmingford--les-jardins-de-napierville--2`) | 1 | 6 | oui | OK |
| 22 | Saint-Boniface (`saint-boniface`) | 1 | 6 | oui | OK |
| 23 | Saint-Charles-Borromée (`saint-charles-borromee`) | 1 | 6 | oui | OK |
| 24 | Sainte-Cécile-de-Milton (`sainte-cecile-de-milton`) | 1 | 6 | oui | OK |
| 25 | La Sarre (`la-sarre`) | 1 | 5 | oui | OK |
| 26 | Notre-Dame-de-Lourdes (`notre-dame-de-lourdes--lerable`) | 1 | 5 | oui | OK |
| 27 | Preissac (`preissac`) | 1 | 5 | oui | OK |
| 28 | Saint-Gilbert (`saint-gilbert`) | 1 | 5 | oui | OK |
| 29 | Sutton (`sutton`) | 1 | 5 | oui | OK |
| 30 | Neuville (`neuville`) | 1 | 4 | oui | OK |
| 31 | Stratford (`stratford`) | 1 | 4 | oui | OK |

(Rang = nombre de signaux prioritaires, puis volume de signaux.)

**Verdict : 31/31 OK — 0 trou.** Chaque ville du focus a sa chaîne complète :
signaux projetés + procès-verbaux PDF archivés sous le préfixe canonique.

## 4. Hors focus — bris de chaîne de preuve : 14 villes à signaux sans PV archivé

Mesure du 2026-07-03 : 14 villes ont des signaux projetés mais **0 PDF** sous
`raw/proces-verbaux-<slug>/cas/`. Aucune ne porte de signal prioritaire (elles
sont hors focus) ; la résorption est un fond de tâche de qualité de preuve.

| Ville | Signaux | Constat (2026-07-03) | Statut |
|---|--:|---|---|
| `brigham` | 6 | 5 PV sous le préfixe non canonique `brigham-pdfs/` | **FAIT** — PV ré-archivés sous `raw/proces-verbaux-brigham/cas/` et ville re-graphifiée v2.3 : **7 signaux + 2 événements de désignation** (PR #347) |
| `maricourt` | 4 | rawRefs vers des PDFs absents du bucket | à re-scraper (restaurer l'archive référencée) |
| `saint-patrice-de-sherrington` | 8 | rawRefs vers des PDFs absents | à re-scraper |
| `lassomption` | 7 | signaux sans rawRef (aucune preuve) | à re-scraper + re-graphifier |
| `saint-donat--la-mitis` | 4 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-lazare-de-bellechasse` | 2 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-paulin` | 5 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-philibert` | 2 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-rene` | 1 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-robert-bellarmin` | 2 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-simon-de-rimouski` | 6 | signaux sans rawRef | à re-scraper + re-graphifier |
| `sainte-helene-de-kamouraska` | 2 | signaux sans rawRef | à re-scraper + re-graphifier |
| `sainte-jeanne-darc--maria-chapdelaine` | 2 | signaux sans rawRef | à re-scraper + re-graphifier |
| `saint-damase` | 3 | graphe parasite : slug hors référentiel (doublon de `saint-damase--les-maskoutains`, qui a son propre graphe + 5 PV) | **sans objet** — parasite purgé (§5) |

## 5. Parasites S3 — purgés

Constatés lors de la mesure du 2026-07-03, purgés depuis (opération
conducteur) :

- **`graph/graph/<slug>/latest.json`** (~110 objets à double préfixe) :
  purgés. Risque évité : la projection complète (`project-graph-from-s3.ts`)
  prend `parts[1]` comme citySlug — ces objets se seraient tous projetés sous
  le slug `graph` en s'écrasant l'un l'autre.
- **`graph/saint-damase/`** et **`graph/hemmingford/`** (slugs hors
  référentiel — les canoniques `saint-damase--les-maskoutains` et
  `hemmingford--les-jardins-de-napierville[--2]` ont leurs propres graphes et
  PV) : purgés. Risque évité : double projection PG sous un mauvais slug.
- Objet orphelin `saint-patrice-de-sherrington/latest.json` à la racine du
  bucket : purgé.

## 6. Chiffres d'ensemble (contexte province)

Listing complet du 2026-07-03 (toutes clés, avant purge des parasites — d'où
le léger écart avec la mesure canonique du §2) :

| Mesure | Valeur |
|---|---:|
| Graphes villes sur S3 | 1 009 |
| Villes avec ≥ 1 signal (Signal + DesignationEvent) | 725 |
| Villes avec ≥ 1 signal d'un des 3 critères (z ∪ m ∪ p) | 708 |
| Villes avec ≥ 1 PV PDF archivé | 818 |
| Villes avec PV **et** signaux | 711 |
| Total signaux | 7 210 (z = 5 761, m = 199, p = 1 338) |
| Total PV PDF archivés | 7 806 |
| Villes du référentiel ni PV ni signal | 276 |
| Villes avec signaux mais 0 PV archivé | 14 (§4) |
| Villes avec PV mais 0 signal projeté | 107 |

## 7. Méthode

- **Source de vérité signaux** : graphes projetés S3 SCW
  (`s3://radar-immobilier-docs-pocs/graph/<slug>/latest.json`), nœuds
  `Signal` + `DesignationEvent` — la même matière que `graph_nodes` en PG (ce
  que comptent `/api/graph-signals/by-city` et la cellule `signals` de
  `/api/source/coverage`).
- **Classification z/m/p** : helpers de
  `api/src/services/graph/graph-store.ts` (`isZonageSignal`, `isMulti4Plus`,
  `isPrecoceSignal`) — la même classification que la vue Signaux et que le
  champ `signals.priority` de `/api/source/coverage` (une seule source de
  vérité).
- **Source de vérité PV (PDF)** : archive S3
  `raw/proces-verbaux-<slug>/cas/<sha>.pdf` (le chemin servi par
  `/api/documents/raw` via `rawRef`), listing récursif complet.
- **Référentiel** : 1 106 municipalités (`municipalities.qc.json`).
- Dates : mesures S3 du **2026-07-03** ; statut brigham et purges au
  **2026-07-04**.
