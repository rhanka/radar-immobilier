# Consolidation focus-30 : PV (PDF) + signaux — juillet 2026

Bug signalé par Steve (utilisateur client) : la définition du « Focus 30 » de la
vue Sources classait les villes par **distance à Montréal** (`priorityRank`,
haversine depuis le centre de MTL dans
`packages/radar-sources/src/geo/municipalities.qc.json`) au lieu de la
**présence de signaux**. Conséquence : des villes proches SANS aucun signal
(Kirkland, Brossard, L'Île-Dorval — ni PV ni signal) étaient dans le focus-30,
et des villes À signaux mais éloignées (ex. Mont-Tremblant, ville pilote
grounding) en étaient exclues.

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

## Le vrai focus-30 « villes à signaux » (rang = nombre de signaux)

Critère corrigé : villes avec `signals.count > 0`, classées par nombre de
signaux décroissant (tie-break : priorityRank croissant, puis nom), top 30.
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

## L'ancien focus-30 « proximité » vs le réel — le delta

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

NB : les villes qui « sortent » du focus-30 restent visibles en mode Province
et restent dans le périmètre « villes à signaux » (725 villes) — le focus-30
n'est qu'une loupe sur les 30 mieux fournies.

### Cas Mont-Tremblant (ville pilote grounding)

Mesuré : **13 signaux** (z = 13, m = 2, p = 7), **5 PV PDF** archivés. Ancien
rang proximité : **351** (exclue du focus alors que des villes à 0 signal y
étaient). Avec le critère corrigé, Mont-Tremblant est dans le périmètre
« villes à signaux » au **rang 80/725 par nombre de signaux** — mieux classée
que 19 des 30 villes de l'ancien focus, mais pas dans le top-30 en volume
brut (seuil : 24 signaux). Le bug d'EXCLUSION (0 signal devant elle) est
corrigé ; si le principal veut Mont-Tremblant dans les 30 affichées, c'est un
choix de curation (épinglage pilote), pas de définition — à trancher côté
produit.

## Le fix de définition (code)

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

- `svelte-check` : 1 erreur préexistante sur origin/main
  (`SignalPdfOverlay.svelte`, typage pdfjs, fichier non touché) — **0 nouvelle
  erreur**.
- `vitest` suites touchées : `source-coverage-client.test.ts` (21) +
  `SourceConsole.test.ts` (4) + suites voisines `sources/` — 38/38 verts.
