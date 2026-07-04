# Consolidation focus-30 : PV (PDF) + signaux — juillet 2026

Bug signalé par Steve (utilisateur client) : la définition du « Focus 30 » de la
vue Sources classait les villes par **distance à Montréal** (`priorityRank`,
haversine depuis le centre de MTL dans
`packages/radar-sources/src/geo/municipalities.qc.json`) au lieu de la
**présence de signaux**. Conséquence : des villes proches SANS aucun signal
(Kirkland, Brossard, L'Île-Dorval — ni PV ni signal) étaient dans le focus-30,
et des villes À signaux mais éloignées (ex. Mont-Tremblant, ville pilote
grounding) en étaient exclues.

> **AMENDEMENT 2026-07-03 (2e correction de définition).** Le premier fix
> (PR #343) avait remplacé la proximité par un **top 30 par NOMBRE de
> signaux** (`signals.count`), ce qui était ENCORE faux : le focus n'est pas
> un top-N par volume. La définition invariante de l'axe de reporting
> « **30 villes / 33 signaux précoces** » (aussi « 33 vs 5000+ ») est : **le
> focus = l'ensemble des villes DISTINCTES qui portent les signaux
> PRIORITAIRES z∩m∩p** — zonage ∩ multifamilial 4+ ∩ précoce, la cohorte
> « 33 » WPB-E2E. Voir la section « Correction de définition » ci-dessous ;
> les sections « top-30 par volume » d'origine sont conservées pour trace et
> marquées DÉPASSÉES.

## Correction de définition (2026-07-03) : le focus = les villes des 33 signaux prioritaires

### La définition établie (retrouvée, avec sources)

L'axe de reporting du principal est « **30 villes / 33 signaux précoces** ».
Le « 33 » y est DÉFINI — ce n'est ni un top-N ni un volume :

- `docs/spec/SPEC_CONSOLIDATED_2026-07.md` §1.2 : « **Axe PROFONDEUR DE
  PREUVE — 33 E2E vs 5000+.** *33* = cohorte « opportunités témoins » suivies
  bout-en-bout (signal → document → zone → grille → lot), périmètre WPB-E2E
  des **33 opportunités prioritaires `z∩m∩p`** ».
- `docs/spec/reports/wp6-focus-rollup.md` : « focus:33 — opportunités preuve
  E2E **z∩m∩p** (cible WPB-E2E) ».
- Filtre opérationnel : `api/src/scripts/report-opportunity-proof.ts`
  (`--limit 33`) — sélectionne les nœuds Signal/DesignationEvent satisfaisant
  `isZonageSignal ∧ isMulti4Plus ∧ isPrecoceSignal`.
- La vue Signaux avec ses 3 filtres actifs (zonage ∩ multifamilial 4+ ∩
  précoce = subset `z|m|p` de `listCitiesWithSignalNodes`) affiche ce même
  périmètre — c'est le « **32 signaux qualifiés sur 30 villes** » du rapport
  de livraison (mesure PG prod, début juillet).

Concrètement, un signal est PRIORITAIRE ssi (helpers canoniques de
`api/src/services/graph/graph-store.ts`) :

- **z** (zonage) : `DesignationEvent`, ou `Signal` avec `category` OU `etape`
  ∈ ZONAGE_CATEGORIES (rezonage, dérogation, PIIA, PPCMOI, …) ;
- **m** (multifamilial 4+) : `nb_unites_max ≥ 4` ou `intensite = 'haute'`
  (Signal uniquement) ;
- **p** (précoce) : `etape` ∈ {avis_motion, projet_reglement} (annotée v2.1,
  sinon repli `deriveEtape(label, description)`).

**Le focus-30 = les villes DISTINCTES qui portent ces signaux prioritaires.**
Ce n'est PAS un classement : ni `priorityRank ≤ 30` (1er bug, proximité), ni
« top 30 par nombre de signaux » (2e bug, introduit par le premier fix #343).
L'ensemble est data-driven ; sa taille suit la donnée (~30) et n'est jamais
forcée à 30.

### Mesure réelle (S3 canonique, 2026-07-03)

Même méthode que la mesure d'origine ci-dessous (graphes
`graph/<slug>/latest.json`, helpers z/m/p RÉELS importés de `graph-store.ts`,
pas une réplique), clés canoniques uniquement :

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

Les 31 villes du focus (rang = nb de signaux prioritaires, puis volume) :

| # | Ville | z∩m∩p | Signaux |
|---|-------|------:|--------:|
| 1 | Mont-Tremblant (`mont-tremblant`) | 2 | 13 |
| 2 | Saint-Frédéric (`saint-frederic`) | 2 | 4 |
| 3 | Saint-Mathieu-de-Beloeil (`saint-mathieu-de-beloeil`) | 1 | 22 |
| 4 | Sainte-Catherine (`sainte-catherine`) | 1 | 16 |
| 5 | Saint-Amable (`saint-amable`) | 1 | 15 |
| 6 | Rimouski (`rimouski`) | 1 | 12 |
| 7 | Rosemère (`rosemere`) | 1 | 11 |
| 8 | Saint-Raymond (`saint-raymond`) | 1 | 11 |
| 9 | Champlain (`champlain`) | 1 | 10 |
| 10 | Saint-Côme-Linière (`saint-come-liniere`) | 1 | 9 |
| 11 | Coaticook (`coaticook`) | 1 | 8 |
| 12 | Mont-Saint-Hilaire (`mont-saint-hilaire`) | 1 | 8 |
| 13 | Saint-Stanislas-de-Kostka (`saint-stanislas-de-kostka`) | 1 | 8 |
| 14 | Cowansville (`cowansville`) | 1 | 7 |
| 15 | Lévis (`levis`) | 1 | 7 |
| 16 | Petite-Rivière-Saint-François (`petite-riviere-saint-francois`) | 1 | 7 |
| 17 | Plaisance (`plaisance`) | 1 | 7 |
| 18 | Saint-Raphaël (`saint-raphael`) | 1 | 7 |
| 19 | Alma (`alma`) | 1 | 6 |
| 20 | Chelsea (`chelsea`) | 1 | 6 |
| 21 | Hemmingford (`hemmingford--les-jardins-de-napierville--2`) | 1 | 6 |
| 22 | Saint-Boniface (`saint-boniface`) | 1 | 6 |
| 23 | Saint-Charles-Borromée (`saint-charles-borromee`) | 1 | 6 |
| 24 | Sainte-Cécile-de-Milton (`sainte-cecile-de-milton`) | 1 | 6 |
| 25 | La Sarre (`la-sarre`) | 1 | 5 |
| 26 | Notre-Dame-de-Lourdes (`notre-dame-de-lourdes--lerable`) | 1 | 5 |
| 27 | Preissac (`preissac`) | 1 | 5 |
| 28 | Saint-Gilbert (`saint-gilbert`) | 1 | 5 |
| 29 | Sutton (`sutton`) | 1 | 5 |
| 30 | Neuville (`neuville`) | 1 | 4 |
| 31 | Stratford (`stratford`) | 1 | 4 |

Aucune ville du top-30 « par volume » du premier fix (Lyster 400 signaux,
Grand-Remous 331, …) ne porte le moindre signal prioritaire : le classement
par volume mettait en avant 30 villes qui ne recoupent PAS la cohorte « 33 »
(0 ville commune entre les deux ensembles).

### L'écart des comptes (documenté, pas forcé)

Trois chiffres coexistent, aucun n'est « faux » :

- **33 signaux / 31 villes** : mesure S3 canonique du 2026-07-03 (ce rapport).
  Le « 33 » de l'axe tombe exactement ; le compte de villes mesuré est **31**,
  pas 30 — l'ensemble est data-driven et bouge avec les re-scrapes/re-graphify.
- **32 signaux / 30 villes** : compte live de la vue Signaux (PG de prod)
  capturé dans le rapport de livraison du 19 juin – 3 juillet — la projection
  PG était légèrement en retrait du S3 au moment de la capture.
- **27 signaux / 10 villes** : l'audit `wp3-33-anomalies` porte sur un
  échantillon (10 villes prioritaires), pas sur la cohorte entière —
  l'avertissement du SPEC_CONSOLIDATED (§1.2) le dit explicitement.

### Réponse explicite : Brossard, Kirkland, L'Île-Dorval

Les 3 villes « trous » de l'ancien focus proximité n'ont **ni PV, ni signal,
ni a fortiori signal prioritaire**. Elles étaient dans le focus UNIQUEMENT par
l'artefact du bug proximité (`priorityRank` 8, 30, 16). Avec la définition
corrigée, elles sont **hors focus PAR CONSTRUCTION** — il n'y a RIEN à
récupérer pour le focus : le périmètre est défini par les 33 signaux
prioritaires et leurs 31 villes porteuses, il ne dépend d'aucune de ces 3
villes. (Leur scrape reste un fond de tâche de COUVERTURE province — cf. R3 —
sans lien avec le focus.)

### Le fix de définition v2 (code, 2026-07-03)

- **API** `api/src/routes/source-coverage.ts` : la cellule `signals` de
  `GET /api/source/coverage` expose désormais `priority` = nb de signaux
  z∩m∩p de la ville (`listCitiesWithSignalNodes(db)`, subset `z|m|p` — la
  MÊME classification que la vue Signaux, une seule source de vérité).
- **Client** `ui/src/lib/sources/source-coverage-client.ts` :
  `computeFocusScope(cities)` = TOUTES les villes `signals.priority > 0`
  (aucune troncature, plus de `FOCUS_CITY_COUNT`) ; rang = nb de signaux
  prioritaires décroissant (tie-break volume, priorityRank, nom).
- **Libellés** : radio « 30 villes à signaux » → « **Villes à signaux
  précoces** » (helper « signaux prioritaires : zonage · 4+ · précoce ») ;
  segment Console « Focus 30 » → « Villes à signaux précoces » ; badge
  scorecard « Focus 30 » → « Signaux précoces » ; la scorecard affiche
  « n prioritaires (zonage · 4+ · précoce) » dans la ligne Signaux.
- « **Focus QA : 4 villes** » (REFERENCE_CITIES) : INCHANGÉ.
- Tests mis au vrai critère (villes porteuses de signaux prioritaires, PAS
  top-N) : `source-coverage-client.test.ts`, `coverage-scope.test.ts`,
  `SourceConsole.test.ts`, `SourcesRail.test.ts`, `SourceCoverageMap.test.ts`,
  `source-coverage.test.ts` (API), harnais Playwright
  `focus-scope.harness.spec.ts` + `sources-coverage.spec.ts` — chacun épingle
  aussi le cas « gros volume sans prioritaire → JAMAIS focus » (Lyster).

### Parasites S3 constatés pendant la mesure (à purger — conducteur)

Depuis la mesure du matin, **~110 graphes parasites** sont apparus sous le
double préfixe `graph/graph/<slug>/latest.json` (en plus des parasites R2
déjà connus). Danger : `project-graph-from-s3.ts` (mode complet) prend
`parts[1]` comme citySlug → ces objets se projetteraient TOUS sous le slug
`graph`, en s'écrasant l'un l'autre. Action : purge du préfixe
`graph/graph/` (ou fix du writer qui a doublé le préfixe).

## Méthode de mesure (chiffres réels, mesurés le 2026-07-03)

- **Source de vérité signaux** : graphes projetés S3 SCW
  (`s3://radar-immobilier-docs-pocs/graph/<slug>/latest.json`, 1 009 graphes
  villes), nœuds `Signal` + `DesignationEvent` — la même matière que
  `graph_nodes` en PG (ce que comptent `/api/graph-signals/by-city` et la
  cellule `signals` de `/api/source/coverage`).
- **Classification z/m/p** : réplique exacte de
  `api/src/services/graph/graph-store.ts` — `isZonageSignal`
  (DesignationEvent toujours zonage ; Signal si `category` OU `etape` ∈
  ZONAGE_CATEGORIES), `isMulti4Plus` (`nb_unites_max ≥ 4` ou
  `intensite = 'haute'`), `isPrecoceSignal` (`etape` annotée ∈
  {avis_motion, projet_reglement}, sinon heuristique `deriveEtape`).
- **Source de vérité PV (PDF)** : archive S3
  `raw/proces-verbaux-<slug>/cas/<sha>.pdf` (le chemin servi par
  `/api/documents/raw` via `rawRef`), listing récursif complet.
- **Référentiel** : 1 106 municipalités (`municipalities.qc.json`).
- Limite : la **PG de prod n'a pas pu être comparée** d'ici
  (`/api/graph-signals/by-city` et `/api/source/coverage` répondent 401,
  auth-gated ; kubectl local KO). Voir « Liste de récupération », item V1.

## Chiffres clés

| Mesure | Valeur |
|---|---:|
| Graphes villes sur S3 | 1 009 |
| **Villes avec ≥ 1 signal** (Signal + DesignationEvent) | **725** |
| Villes avec ≥ 1 signal des 3 filtres (z ∪ m ∪ p) | 708 |
| Villes avec ≥ 1 PV PDF archivé | 818 |
| Villes avec PV **et** signaux | 711 |
| Total signaux | 7 210 (z = 5 761, m = 199, p = 1 338) |
| Total PV PDF archivés | 7 806 |
| Villes du référentiel **ni PV ni signal** | 276 |
| Villes avec signaux mais **0 PV archivé** (preuve manquante) | 14 |
| Villes avec PV mais 0 signal projeté (graphe présent, rien détecté) | 107 |
| Seuil d'entrée du top-30 par signaux | 24 signaux |

## [DÉPASSÉ — premier fix #343] Top-30 « villes à signaux » (rang = nombre de signaux)

> **DÉPASSÉ (amendement 2026-07-03)** : ce classement par VOLUME de signaux
> était le premier fix, lui-même erroné — le focus n'est pas un top-N. La
> définition corrigée (villes des 33 signaux prioritaires z∩m∩p) est en tête
> de rapport. Table conservée pour trace : AUCUNE de ces 30 villes « à
> volume » ne porte de signal prioritaire.

Critère du premier fix : villes avec `signals.count > 0`, classées par nombre
de signaux décroissant (tie-break : priorityRank croissant, puis nom), top 30.
**Verdict consolidation : les 30 villes ont TOUTES ≥ 1 PV PDF archivé ET des
signaux** — aucun trou dans le nouveau focus-30.

| # | Ville | Signaux | z | m | p | PV PDF | Ancien rang (proximité) | Verdict |
|---|-------|--------:|--:|--:|--:|-------:|------------------------:|---------|
| 1 | Lyster (`lyster`) | 400 | 135 | 0 | 2 | 251 | 550 | OK |
| 2 | Grand-Remous (`grand-remous`) | 331 | 118 | 0 | 198 | 323 | 645 | OK |
| 3 | Chibougamau (`chibougamau`) | 304 | 253 | 0 | 39 | 270 | 946 | OK |
| 4 | Baie-des-Sables (`baie-des-sables`) | 271 | 114 | 0 | 100 | 215 | 1004 | OK |
| 5 | Laurierville (`laurierville`) | 251 | 121 | 0 | 1 | 227 | 524 | OK |
| 6 | Dunham (`dunham`) | 223 | 170 | 0 | 25 | 132 | 237 | OK |
| 7 | Saint-Eustache (`saint-eustache`) | 221 | 221 | 0 | 98 | 6 | 55 | OK |
| 8 | Beaupré (`beaupre`) | 123 | 107 | 0 | 13 | 114 | 737 | OK |
| 9 | Lac-Frontière (`lac-frontiere`) | 117 | 43 | 0 | 54 | 85 | 766 | OK |
| 10 | Boileau (`boileau`) | 105 | 33 | 0 | 63 | 164 | 339 | OK |
| 11 | Lac-Saint-Paul (`lac-saint-paul`) | 77 | 42 | 0 | 27 | 82 | 573 | OK |
| 12 | Saint-Pie (`saint-pie`) | 62 | 39 | 0 | 22 | 5 | 138 | OK |
| 13 | Saint-Hippolyte (`saint-hippolyte`) | 59 | 52 | 0 | 14 | 6 | 162 | OK |
| 14 | Vaudreuil-Dorion (`vaudreuil-dorion`) | 54 | 43 | 0 | 6 | 11 | 95 | OK |
| 15 | Sainte-Martine (`sainte-martine`) | 46 | 46 | 0 | 16 | 10 | 69 | OK |
| 16 | Clarendon (`clarendon`) | 42 | 26 | 0 | 0 | 56 | 669 | OK |
| 17 | Saint-Jean-sur-Richelieu (`saint-jean-sur-richelieu`) | 39 | 34 | 0 | 7 | 11 | 53 | OK |
| 18 | Shefford (`shefford`) | 38 | 38 | 0 | 0 | 11 | 259 | OK |
| 19 | Batiscan (`batiscan`) | 37 | 23 | 0 | 9 | 20 | 466 | OK |
| 20 | Grenville (`grenville`) | 35 | 18 | 0 | 24 | 12 | 264 | OK |
| 21 | Sainte-Anne-de-Sorel (`sainte-anne-de-sorel`) | 33 | 33 | 0 | 2 | 4 | 232 | OK |
| 22 | Sainte-Marthe-sur-le-Lac (`sainte-marthe-sur-le-lac`) | 32 | 27 | 0 | 7 | 10 | 52 | OK |
| 23 | Saint-Paul (`saint-paul`) | 32 | 24 | 0 | 6 | 5 | 137 | OK |
| 24 | Pointe-Claire (`pointe-claire`) | 29 | 27 | 0 | 2 | 3 | 21 | OK |
| 25 | Saint-Hyacinthe (`saint-hyacinthe`) | 29 | 26 | 0 | 6 | 5 | 134 | OK |
| 26 | Léry (`lery`) | 28 | 27 | 1 | 1 | 8 | 35 | OK |
| 27 | Saint-Alexandre (`saint-alexandre`) | 27 | 17 | 0 | 6 | 9 | 115 | OK |
| 28 | Saint-Félix-de-Valois (`saint-felix-de-valois`) | 27 | 27 | 0 | 8 | 10 | 245 | OK |
| 29 | Saint-Esprit (`saint-esprit`) | 26 | 26 | 0 | 3 | 5 | 111 | OK |
| 30 | Saint-Michel (`saint-michel`) | 24 | 24 | 0 | 8 | 7 | 60 | OK |

## L'ancien focus-30 « proximité » vs le top-30 par volume — le delta [trace du premier fix]

**29 des 30 villes sortent** ; seule Pointe-Claire (29 signaux) reste. Trois
villes de l'ancien focus n'ont **NI PV NI SIGNAL** (le trou de consolidation
que voyait Steve) : **Brossard, L'Île-Dorval, Kirkland**. Saint-Lambert n'a
aucun signal (3 PV).

| Rang prox. | Ville | Signaux | PV PDF | Statut nouveau focus |
|-----------:|-------|--------:|-------:|----------------------|
| 1 | Westmount (`westmount`) | 4 | 4 | SORT — rang signaux insuffisant |
| 2 | Saint-Lambert (`saint-lambert`) | 0 | 3 | SORT — aucun signal |
| 3 | Hampstead (`hampstead`) | 4 | 1 | SORT — rang signaux insuffisant |
| 4 | Mont-Royal (`mont-royal`) | 6 | 3 | SORT — rang signaux insuffisant |
| 5 | Montréal-Ouest (`montreal-ouest`) | 1 | 6 | SORT — rang signaux insuffisant |
| 6 | Côte-Saint-Luc (`cote-saint-luc`) | 1 | 5 | SORT — rang signaux insuffisant |
| 7 | Longueuil (`longueuil`) | 4 | 6 | SORT — rang signaux insuffisant |
| 8 | Brossard (`brossard`) | 0 | 0 | **SORT — NI PV NI SIGNAL** |
| 9 | Sainte-Catherine (`sainte-catherine`) | 16 | 85 | SORT — rang signaux insuffisant |
| 10 | La Prairie (`la-prairie`) | 14 | 5 | SORT — rang signaux insuffisant |
| 11 | Delson (`delson`) | 17 | 16 | SORT — rang signaux insuffisant |
| 12 | Candiac (`candiac`) | 8 | 26 | SORT — rang signaux insuffisant |
| 13 | Montréal-Est (`montreal-est`) | 5 | 4 | SORT — rang signaux insuffisant |
| 14 | Boucherville (`boucherville`) | 9 | 7 | SORT — rang signaux insuffisant |
| 15 | Dorval (`dorval`) | 13 | 5 | SORT — rang signaux insuffisant |
| 16 | L'Île-Dorval (`lile-dorval`) | 0 | 0 | **SORT — NI PV NI SIGNAL** |
| 17 | Saint-Constant (`saint-constant`) | 19 | 219 | SORT — rang signaux insuffisant |
| 18 | Saint-Bruno-de-Montarville (`saint-bruno-de-montarville`) | 13 | 4 | SORT — rang signaux insuffisant |
| 19 | Carignan (`carignan`) | 17 | 4 | SORT — rang signaux insuffisant |
| 20 | Dollard-Des Ormeaux (`dollard-des-ormeaux`) | 3 | 5 | SORT — rang signaux insuffisant |
| 21 | Pointe-Claire (`pointe-claire`) | 29 | 3 | **RESTE** (24e du vrai focus) |
| 22 | Saint-Philippe (`saint-philippe`) | 9 | 7 | SORT — rang signaux insuffisant |
| 23 | Saint-Mathieu (`saint-mathieu`) | 12 | 11 | SORT — rang signaux insuffisant |
| 24 | Châteauguay (`chateauguay`) | 9 | 4 | SORT — rang signaux insuffisant |
| 25 | Sainte-Julie (`sainte-julie`) | 10 | 11 | SORT — rang signaux insuffisant |
| 26 | Saint-Basile-le-Grand (`saint-basile-le-grand`) | 6 | 5 | SORT — rang signaux insuffisant |
| 27 | Chambly (`chambly`) | 2 | 5 | SORT — rang signaux insuffisant |
| 28 | Rosemère (`rosemere`) | 11 | 10 | SORT — rang signaux insuffisant |
| 29 | Varennes (`varennes`) | 8 | 11 | SORT — rang signaux insuffisant |
| 30 | Kirkland (`kirkland`) | 0 | 0 | **SORT — NI PV NI SIGNAL** |

NB : les villes qui « sortent » du focus restent visibles en mode Province.
(Depuis l'amendement : le focus n'est NI ce top-30 par volume NI la proximité —
c'est l'ensemble des villes portant les signaux prioritaires z∩m∩p.)

### Cas Mont-Tremblant (ville pilote grounding)

Mesuré : **13 signaux** (z = 13, m = 2, p = 7), dont **2 signaux prioritaires
z∩m∩p**, **5 PV PDF** archivés. Ancien rang proximité : **351** (exclue du
focus alors que des villes à 0 signal y étaient) ; le top-30 par volume du
premier fix l'excluait AUSSI (rang 80/723 par volume, seuil 24 signaux) — et
proposait un « épinglage de curation » pour l'y remettre. **Avec la définition
corrigée, la question ne se pose plus : Mont-Tremblant porte 2 signaux
prioritaires → rang 1 du focus, par définition, sans curation.**

## [DÉPASSÉ — premier fix #343] Le fix de définition v1 (code)

> **DÉPASSÉ (amendement 2026-07-03)** : remplacé par le fix v2 (villes des
> signaux prioritaires z∩m∩p, champ `signals.priority` de l'API) décrit en
> tête de rapport. Conservé pour trace.

`ui/src/lib/sources/source-coverage-client.ts` :

- **Nouveau** `computeFocusScope(cities, limit = FOCUS_CITY_COUNT)` : périmètre
  focus calculé sur les DONNÉES de la réponse `/api/source/coverage` — villes
  `signals.count > 0`, triées par `signals.count` décroissant (tie-break
  priorityRank croissant puis nom), tronquées à 30. Une ville sans signal
  n'est JAMAIS focus. Données vides → focus vide (honnête).
- `isFocusCity(city, scope)` : appartenance au scope — **plus jamais
  `priorityRank ≤ 30`**.
- `buildFocusOpacityExpression` (carte Couverture) : surbrillance des 30
  villes à signaux.
- Consommateurs alignés : `SourceConsole.svelte` (toggle « Focus 30 » = filtre
  de lignes ; badge = rang par signaux), `SourceCoverageMap.svelte`,
  `SourceScorecard.svelte` (badge « Focus 30 » via prop `focusScope`).
- Le critère étant **data-driven** (recalculé à chaque réponse de couverture),
  il s'auto-corrige quand la projection PG rattrape les graphes S3.
- La portée « Focus QA : 4 villes » (Delson/Sainte-Catherine/Saint-Constant/
  Candiac = `REFERENCE_CITIES`, carte Steve/Évaluation) est un périmètre
  distinct, **inchangé**.

### Réconciliation avec le radio 3 portées (PR #339)

La branche a été rebasée sur `origin/main` après le merge de #339 (vue Sources
« mode Signaux » : rail gauche à radio EXCLUSIF **Focus QA : 4 villes /
30 villes à signaux / Toutes**, `ui/src/lib/sources/coverage-scope.ts`). La
portée `focus30` du radio branchait l'ANCIEN `isFocusCity(city)` (priorityRank
≤ 30). Réconcilié (fusion, pas duplication) :

- `coverage-scope.ts` : `cityInScope(city, scope, focusScope)` — la portée
  `focus30` délègue à `isFocusCity(city, focusScope)` ; les fonctions au niveau
  liste (`filterCitiesByScope`, `countCitiesInScope`, `buildScopeOpacityExpression`)
  calculent `computeFocusScope(cities)` une fois et le passent (jamais de
  recalcul par ville). La parité carte `focus30 ≡ buildFocusOpacityExpression`
  reste épinglée par test.
- `SourcesRail.svelte` : calcule `computeFocusScope(cities)` et le thread dans le
  prédicat de filtrage de la liste.
- `SourceCoverageMap.svelte` : câble `focusScope` sur le drawer `SourceScorecard`
  (badge « Focus 30 » sur le critère signaux). Le libellé du radio devient
  « top 30 par nombre de signaux » (plus « priorité ≤ 30 »).
- Tests #339 mis à jour au critère signaux (`coverage-scope.test.ts`,
  `SourcesRail.test.ts`, `SourceCoverageMap.test.ts`, `sources-coverage.spec.ts`) :
  fixtures dotées de comptes de signaux ; une ville à signaux ÉLOIGNÉE
  (Sainte-Sophie rang 44) entre dans focus30, une ville proche SANS signal
  (La Prairie, Candiac) en sort.

Tests : `source-coverage-client.test.ts` (ville proche sans signal jamais
focus ; ville à signaux loin focus ; troncature top-30 par signalCount ;
tie-break stable ; opacité carte) et `SourceConsole.test.ts` (fixture
Kirkland/Brossard 0 signal vs Mont-Tremblant 13 signaux).

## Liste de récupération (actions conducteur — rien lancé d'ici)

Aucun PDF ni signal n'a été fabriqué. Les items R* demandent un re-scrape /
re-graphify que le conducteur opère lui-même.

### R1 — Signaux sans preuve PV archivée (14 villes, bris de chaîne de preuve)

Villes avec signaux projetés mais **0 PDF** sous
`raw/proces-verbaux-<slug>/cas/` :

| Ville | Signaux | Constat | Action requise |
|---|--:|---|---|
| `brigham` | 6 | 5 PV existent sous le préfixe NON canonique `brigham-pdfs/` (noms datés, pas de sha) | Réarchiver sous `raw/proces-verbaux-brigham/cas/<sha>.pdf` + meta, relier les rawRefs |
| `maricourt` | 4 | Les signaux référencent `raw/proces-verbaux-maricourt/cas/…` mais les PDFs sont ABSENTS du bucket | Re-scrape PV (restaurer l'archive référencée) |
| `saint-patrice-de-sherrington` | 8 | Idem : rawRefs pointent vers des PDFs absents | Re-scrape PV |
| `lassomption` | 7 | Signaux SANS rawRef (aucune preuve) | Re-scrape PV + re-graphify pour rattacher les citations |
| `saint-donat--la-mitis` | 4 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-lazare-de-bellechasse` | 2 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-paulin` | 5 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-philibert` | 2 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-rene` | 1 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-robert-bellarmin` | 2 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-simon-de-rimouski` | 6 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `sainte-helene-de-kamouraska` | 2 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `sainte-jeanne-darc--maria-chapdelaine` | 2 | Signaux sans rawRef | Re-scrape PV + re-graphify |
| `saint-damase` | 3 | Graphe PARASITE : slug hors référentiel (doublon de `saint-damase--les-maskoutains`, qui a son propre graphe + 5 PV) | Purger `graph/saint-damase/` (ou re-slugger) |

### R2 — Graphes parasites sous slug hors référentiel

`graph/saint-damase/` et `graph/hemmingford/` n'existent pas dans
`municipalities.qc.json` (canoniques : `saint-damase--les-maskoutains`,
`hemmingford--les-jardins-de-napierville[--2]`, qui ont leurs propres graphes
et PV). Un objet parasite `saint-patrice-de-sherrington/latest.json` traîne
aussi à la racine du bucket. Action : purge (ou fusion) pour éviter une
double projection PG sous un mauvais slug.

### R3 — Couverture restante (fond de tâche, pas le bug Steve)

- **276 villes** du référentiel n'ont ni PV ni signal (jamais scrapées ou
  scrape en échec — cf. mémoire « tail dur scraper ») ;
- **107 villes** ont des PV + graphe mais 0 signal détecté (a priori légitime
  — rien dans les PV — mais un échantillonnage de contrôle est raisonnable) ;
- **288 villes** du référentiel n'ont pas de PV archivé (1 106 − 818).

### V1 — Vérification prod (bloquée d'ici, auth)

Comparer la PG de prod aux 725 villes à signaux S3 :
`GET /api/graph-signals/by-city` (session authentifiée) doit retourner ~725
villes / 7 210 signaux. Répond 401 depuis cette box — à vérifier par le
conducteur. Si la projection est en retard, `populate`/refresh (jobs k8s) puis
recontrôler ; le focus-30 UI s'auto-corrigera (critère data-driven).

## Gate

Premier fix (#343) :

- `svelte-check` : 1 erreur préexistante sur origin/main
  (`SignalPdfOverlay.svelte`, typage pdfjs, fichier non touché) — **0 nouvelle
  erreur**.
- `vitest` suites touchées : `source-coverage-client.test.ts` (21) +
  `SourceConsole.test.ts` (4) + suites voisines `sources/` — 38/38 verts.

Fix v2 (amendement 2026-07-03, définition « signaux prioritaires ») :

- `svelte-check` : **0 nouvelle erreur** (la même préexistante
  `SignalPdfOverlay.svelte`).
- `vitest` UI : `source-coverage-client.test.ts` (22) + `coverage-scope.test.ts`
  (13) + `SourceConsole/SourcesRail/SourceCoverageMap.test.ts` (25) —
  **60/60 verts**.
- `vitest` API : `source-coverage.test.ts` — **30/30 verts** (dont 2 tests du
  compte `priority` z∩m∩p sur nœuds bruts).
- Playwright HEADLESS jetable (ports 4317/4318, jamais le Chrome utilisateur) :
  `sources-coverage.spec.ts` **3/3** + `focus-scope.harness.spec.ts` **3/3** —
  rendu réel : Mont-Tremblant (2 prioritaires) listée, Kirkland/Brossard
  (0 signal) ET Lyster (400 signaux, 0 prioritaire) exclues.
