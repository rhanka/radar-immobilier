# Rapport d'étude — Radar Immobilier

Date : 2026-07-01
Statut : étude de faisabilité et de livraison, version consolidée pour relecture client.
Périmètre de mesure : graphes S3 et API geo mesurés les 28–29 juin 2026 ; surface produit et tests lus sur la baseline de branche ; jobs d'exploitation lus dans les manifests Kubernetes au 1er juillet 2026.

> **Note de lecture — effectif vs projeté.** Chaque chiffre est qualifié :
> **[effectif]** = mesuré réellement sur les données ou le code à une date donnée ;
> **[projeté]** = extrapolation crédible mais non encore réalisée ;
> **[à consolider]** = mesure obtenue mais dépendante d'une canonisation ou d'un job non encore rejoué.
> Aucune métrique n'est présentée comme acquise si elle ne l'est pas. Les mesures reposent sur des
> commandes bornées et reproductibles, documentées dans les rapports internes cités en annexe.

---

## Résumé exécutif

Le socle livré démontre la faisabilité d'une chaîne bout-en-bout reliant des sources municipales
hétérogènes à une expérience produit exploitable : collecte documentaire, extraction de signaux
réglementaires, structuration en graphe avec citations, projection en base géospatiale, API de
domaine, vues cartographiques et vue de consolidation des données. La chaîne fonctionne
aujourd'hui de bout en bout sur un large ensemble de municipalités et sert de banc de démonstration.

La lecture doit se faire sur **deux axes indissociables** :

- l'axe **de couverture** : ce qui est **effectif** sur les 30 villes prioritaires (focus 30) et
  sur les 1104 municipalités cibles, versus ce qui est **projeté** ;
- l'axe **de qualité** : la profondeur et la vérifiabilité de chaque couche (citation groundée,
  code de zone exact, lot rattaché), qui conditionne l'usage réel du produit.

Les acquis principaux, **effectifs** :

1. un pipeline d'extraction (graphify) qui produit signaux, événements de désignation, zones,
   citations et références à partir des procès-verbaux et documents municipaux, sous **gate strict
   de citation vérifiable** en version 2.3 ;
2. une couche géographique qui ingère zonage et lots cadastraux depuis une API géospatiale, les
   projette en PostgreSQL/PostGIS, et résout des références signal → zone/lot ;
3. une application exposant **quatre vues** — Signaux, Sources, Évaluation, Opportunités — dont deux
   pleinement fonctionnelles et deux partielles ;
4. une architecture modulaire, à responsabilités séparées, où sources, geo, domaine, API, UI,
   intégrations et jobs d'exploitation sont découplés ;
5. une première industrialisation via jobs Kubernetes one-shot et récurrents.

Les limites principales, **assumées sans survente** :

- disponibilité inégale des sources municipales ; ~97 villes cibles n'ont **aucune** donnée brute
  collectée (scraping préalable bloqué), et certaines villes résistent durablement au scraping ;
- couverture zonage géographique encore très faible sur le focus 30 (**3/30 [à consolider]**) ;
- rappel signal ↔ zone **mesuré à ~59 %** dans son meilleur état actuel, dont ~81 % du déficit
  résiduel n'est pas corrigeable côté application ;
- besoin de modèles/prompts spécialisés et d'un mapping fin rues/zones/lots ;
- exploitation encore partielle : jobs geo one-shot/daily en place mais **cronjobs de refresh
  suspendus** pour des raisons de coût (FinOps), en attente de correction de la cause racine.

### Chiffres clés (au 28–29 juin 2026)

| Indicateur | Effectif | Projeté / cible | Qualification |
|---|---:|---:|---|
| Municipalités cibles | 1104 | 1104 | référentiel |
| Graphes v2.3 publiés | ~976–978 / 1104 (≈ 88 %) | proche de 1104 | **[effectif]** ; reste 128 villes |
| Villes cibles sans aucune donnée brute | 97 | 0 | **[effectif]** ; préalable scraping |
| Collections zonage exposées | ~506 `qc-zonage-*` | 1 collection canonique / ville | **[à consolider]** (fragments ArcGIS) |
| Couverture zonage par match ville | ~234 / 1104 · **3 / 30** focus | extension progressive | **[à consolider]** |
| Collections lots cadastre | ~1103 | quasi provincial | **[effectif]** côté API geo |
| Rappel mapper signal → zone | **47,3 % → 57,3 % → 59,2 %** | plafond immo ~57–59 % atteint | **[effectif]** (3 mesures datées) |
| Vues produit | 2 fonctionnelles / 2 partielles | 4 complètes | **[effectif]** |

La projection 1104 est **crédible** pour les couches dont la source publique est normalisée
(lots/cadastre notamment) et **conditionnelle** pour les couches municipales non standardisées
(zonage, grilles, règlements, PV scannés). La prochaine étape n'est pas une preuve de concept
supplémentaire, mais une **consolidation priorisée sur le focus 30**.

---

# 1 — Faisabilité data, à consolider avec geo

## 1.A — Synthèse

### 1.A.1 — Focus 30 : toutes les couches et consistance des signaux

Le focus 30 (banlieues prioritaires de la région de Montréal) sert de banc de validation E2E :
`documents → graphes → signaux → projection → API → interface → rapprochement géographique`. La
faisabilité **fonctionnelle** de la chaîne est démontrée ; la **complétude** reste hétérogène selon
la couche.

| Couche | État observé sur le focus 30 | Lecture étude |
|---|---|---|
| Graphes / signaux | chaîne opérationnelle ; reliquat v2.2 traité partiellement | socle exploitable ; certains cas exigent re-grounding depuis le PDF |
| Citations | présentes et affichables quand le graphe est groundé | qualité critique : **aucune citation non vérifiable ne doit être publiée** |
| Zonage geo | **3 / 30 [à consolider]** villes avec collection zonage servie | principal trou de la démo sur le focus |
| Lots cadastre | couche disponible à large échelle, sans donnée propriétaire | base solide pour le scoring et la visualisation lot |
| Résolution signal → zone | rappel réel mesuré, améliorable par lecture de champs et acquisition | faisable, mais dépend du schéma geo et de la précision d'extraction |
| UI | Signaux et Sources fonctionnelles ; Évaluation partielle ; Opportunités en démo | produit **consultable**, pas encore outil complet de prospection multi-couches |

**Consistance des signaux — points mesurés :**

- Sur le run de finition graphify v2.3, le total publié s'établit autour de **976–978 / 1104**
  municipalités cibles **[effectif]** (mesure fraîche S3 du 28 juin : 976 dans la cible ; 978 après
  publication de saint-césaire dans le run réel). Le reliquat de **128 villes** se décompose en
  **~30 graphes v2.2 résiduels** (à re-grounder) et **~97 villes sans aucune donnée brute**
  (scraping préalable requis, hors périmètre 2.3).
- Le run déterministe sur les 30 villes v2.2 résiduelles n'a pu publier que **1 / 30**
  (saint-césaire) **[effectif]** : 29 restent bloquées, dont **22** sans référence de signal
  groundée et **6** sans description de signal, **1** structurellement invalide. Cette rigueur est
  **volontaire** : le gate v2.3 refuse de publier une citation non vérifiable.
- L'audit de grounding a révélé que certaines baselines v2.2 portaient des citations
  **partiellement hallucinées** (ex. une ville avec 12/12 identifiants de document orphelins,
  absents du brut). La vraie voie retenue lit le **PDF réel** (extraction texte + citation verbatim,
  found:false si le passage est absent) et bloque toute fabrication. C'est le bon compromis :
  **moins de volume publié, meilleure confiance**.

### 1.A.2 — Potentiel cible sur les 1104 municipalités

Le potentiel cible est réel, mais ne doit pas être confondu avec l'effectif livré.

| Dimension | Effectif observé / disponible | Potentiel projeté | Condition de passage à l'échelle |
|---|---|---|---|
| Municipalités cibles | 1104 | 1104 | référentiel stable + suivi de couverture |
| Graphes v2.3 | **~976–978 [effectif]** | proche de 1104 | scraping des ~97 villes sans brut + re-grounding des ~30 v2.2 |
| Lots cadastre | **~1103 collections [effectif]** côté geo | quasi provincial | jobs bornés (bbox, pagination, mémoire) |
| Zonage | **~234 / 1104 [à consolider]**, focus 30 faible | extension progressive | canonisation 1 collection/ville + priorisation focus 30 |
| Signaux exploitables | fonction des PV disponibles et du grounding | extensible par ville | modèle spécialisé, citation obligatoire, contrôle qualité |

La projection 1104 est donc **crédible et quasi acquise** pour les lots/cadastre (source publique
normalisée), **atteignable par itérations** pour les graphes/signaux (dépend du scraping et du
grounding), et **conditionnée à une canonisation** pour le zonage.

### 1.A.3 — Limites et préconisations

#### Limites des signaux

Les signaux sont la couche la plus utile au métier, et la plus sensible :

- les PV et règlements sont hétérogènes (PDF scannés, tables mal extraites, formats instables) ;
- des graphes anciens peuvent porter des citations faibles ou non groundées ;
- un signal « famille de zone » (`H1`) ne suffit pas toujours à retrouver la sous-zone exacte
  (`H1-30`) ;
- un signal de **zone proposée** ou de **règlement en cours** peut légitimement ne pas exister dans
  la couche zonage courante (non-match **attendu**, pas une erreur).

**Préconisations :**

1. conserver la règle stricte **« pas de signal publié sans citation vérifiable »** ;
2. **spécialiser le modèle de détection** des signaux réglementaires plutôt que de compter sur un
   modèle généraliste ;
3. introduire un **score de confiance par signal** : citation, date, type, zone, lot, source, état
   du règlement ;
4. séparer explicitement signaux **constatés**, signaux **inférés** et **opportunités projetées**.

#### Jobs récurrents

Trois jobs Kubernetes industrialisent la chaîne geo **[effectif]** :

- `radar-populate-geo` (one-shot) : pull zones/lots puis résolution des références ;
- `radar-populate-geo` en CronJob : rafraîchissement récurrent ;
- `radar-run-geo-mapper` : relance du mapper seul.

**Honnêteté d'exploitation :** deux CronJobs de refresh applicatif (`radar-refresh-scrape` et
`radar-refresh-projection`) sont **actuellement suspendus** (`suspend: true`) **[effectif]** : ils
échouaient chaque nuit et réveillaient un pool de calcul burst à la demande, avec un coût
injustifié tant que la cause racine (secret/schéma) n'est pas corrigée. Un nettoyage automatique
(`ttlSecondsAfterFinished`) a été ajouté. C'est une **décision FinOps assumée**, pas une capacité
manquante : la réactivation est un simple `suspend: false` après correction.

**Préconisations :** journaliser les résultats par ville et par couche ; publier un tableau de bord
de fraîcheur ; conserver les échecs par cause (source absente, schéma inconnu, timeout, OOM,
mismatch) ; **borner les lots par ville et par bbox** pour éviter les extractions provinciales
accidentelles.

#### Optimisations prioritaires

1. **modèle signaux** : prompts/schémas dédiés par famille (PPCMOI, dérogations, rezonage, PIIA,
   TOD, usages, densité) ;
2. **mapping rues / zones** : relier adresse, toponyme, rue, lot et zone — **couche encore faible**,
   c'est le principal levier de précision restant ;
3. **canonisation zonage** : réduire les fragments ArcGIS/Geo* à **une** collection canonique/ville ;
4. **normalisation des grilles** : détecter le champ porteur du code de zone et le lien de grille ;
5. **contrôle qualité** : métriques automatiques de rappel, précision, taux de citation et couverture.

---

## 1.B — Détail par layer

### 1.B.a — Zonage : méthode, proportions projetées et limites

#### Méthode

La couche zonage combine plusieurs familles de sources :

- couches ArcGIS et services géographiques municipaux ;
- collections ouvertes (catalogue provincial, portails municipaux) ;
- documents PDF lorsque la géométrie n'est pas directement exposée ;
- mapping standard côté geo, puis ingestion dans la table `zone_versions` ;
- normalisation des codes de zones pour permettre le rapprochement avec les signaux.

L'ingestion (`ogc-pull`) interroge l'API géospatiale, pagine les collections `qc-zonage-<ville>` et
`qc-lots-<ville>`, et **upsert** zones et lots dans PostgreSQL/PostGIS. Le service `populate-geo`
enchaîne acquisition des polygones, normalisation des codes, upsert dans `zone_versions`, puis
résolution des références géographiques depuis les signaux.

> **Point d'architecture honnête — geo « live » vs projection PG.** Le rapprochement signal → zone
> **ne requête pas** l'API géospatiale en direct : il lit la **projection PostgreSQL/PostGIS locale**
> (`zone_versions` / `lot_versions`, via `ST_AsGeoJSON`). L'API géospatiale live n'est sollicitée que
> par l'étape d'**ingestion** qui **peuple** ces tables. En conséquence, la fraîcheur du zonage servi
> dépend du **dernier job de pull réussi**, pas d'un accès temps réel. C'est un choix de robustesse
> (indépendance vis-à-vis d'un tiers, requêtes géospatiales performantes), mais il **impose des jobs
> de rafraîchissement fiables** — cf. la suspension FinOps ci-dessus.

#### Proportions projetées

Mesures directes sur l'API geo (28–29 juin), **à consolider** :

- **~506 collections `qc-zonage-*`** exposées **[effectif]** — mais dont ~200 sont des fragments
  ArcGIS ré-attribués (`-arcgis`, `-affectation`, `-piia`, schémas de plan) que le mapper ne
  requête jamais (il construit `qc-zonage-<slug>` en dur) ;
- couverture par match de ville autour de **~234 / 1104 [à consolider]** ;
- focus 30 : seulement **3 / 30 [à consolider]** ;
- ces chiffres varient selon la stratégie de matching, car plusieurs collections représentent des
  fragments, affectations, PIIA ou variantes ArcGIS d'une même ville.

> **Fiabilité de la mesure :** une mesure antérieure issue d'un balayage S3 (« atome sweep »)
> sous-comptait grossièrement (3/1104 zonage, 320/1104 lots) : elle est **écartée** comme buggée.
> La source fiable est la **mesure directe de l'API** (211–234/1104). Le comptage zonage ne sera
> stable qu'après réduction à **une collection canonique par ville**.

#### Limites potentielles

- nommage non canonique des collections ;
- plusieurs couches par ville (zonage, affectation, grille, PIIA, plan d'urbanisme) ;
- champs de code de zone hétérogènes : `zone_code`, `code`, `NumZone`, `NO_ZONAGE`, `ETIQUETTE`,
  `Zone`, `zone_`… certains **non lus** par sensibilité à la casse (corrigé, cf. mapper) ;
- granularité différente entre signal et couche (famille `H1` vs sous-zone `H1-30`) ;
- collections « fausses grilles » (couche d'affectation vide, numéros de lot au lieu de codes de
  zone) exposées à tort sous le préfixe `qc-zonage-` ;
- nécessité de conserver l'historique temporel des règlements (zones proposées, entrées en vigueur).

### 1.B.b — Grilles d'évaluation

Les grilles d'évaluation permettent de passer d'un signal à une opportunité : usages permis,
densité, hauteur, marges, contraintes et potentiel constructible.

**Constat :** les grilles sont souvent dans des PDF ou des champs-liens hétérogènes ; le lien de
grille varie d'une ville à l'autre (`LienGrille`, `URL_GRILLE`, `GRILLE_URL`, `Grille`) et n'est pas
lu aujourd'hui ; la reconstruction textuelle peut introduire des erreurs quand elle résume ou
recompose des tableaux réglementaires.

**Recommandation IA — prudente et explicite :**

- **conserver le moteur OCR spécialisé (Mistral OCR 4)** pour l'OCR, où il donne de bons résultats
  sur les documents complexes ;
- **rester prudent avec la complétion (completion Mistral)** sur la reconstruction réglementaire :
  **mesurer et borner l'écart d'erreur avant tout usage à portée réglementaire**. Une grille
  reconstruite par complétion peut paraître plausible tout en étant fausse sur une valeur critique
  (hauteur, densité, usage) — inacceptable pour une décision d'investissement ;
- préférer une **extraction structurée avec preuve** : cellule, page, citation, table, champ ;
- produire les grilles en mode **« preuve d'abord »** plutôt qu'en mode résumé.

### 1.B.c — Lots, cadastre et données PII

La couche lots s'appuie sur le cadastre public, avec bornage strict par commune / bbox. Elle est
essentielle pour afficher les parcelles, scorer un potentiel, lier un signal de zone aux lots
concernés et préparer des workflows de prospection.

**Conformité — point central :** la donnée utilisée est **géométrique et cadastrale** (numéro de lot
et géométrie), **sans propriétaire**. Le pipeline maintient cette séparation :

- pas d'enrichissement propriétaire sans base légale et gouvernance spécifiques ;
- pas d'affichage de donnée personnelle ;
- **tests anti-PII côté UI/API** : un test vérifie que les propriétés exposées d'un lot se limitent
  à `noLot` et `citySlug`. Ce test est actuellement **à recaler** car un champ dérivé public
  (`potentialScore`, un score, pas une donnée personnelle) a été ajouté aux propriétés — c'est un
  test périmé à élargir, **pas une fuite** ;
- limitation stricte des propriétés exposées au client.

La couverture lots (**~1103 collections [effectif]**) est **nettement plus industrialisable** que le
zonage, car la source est normalisée. Les contraintes sont surtout techniques : pagination, mémoire,
bbox, coûts et fréquence de rafraîchissement.

### 1.B.d — Détection des signaux : méthode graphify / entités

Le pipeline graphify transforme des documents municipaux en entités : sources et documents, signaux
réglementaires, événements de désignation, zones, citations et références, et relations
documentaires.

La version **v2.3** renforce la contrainte de qualité : **citation obligatoire et grounding
vérifiable**. Le grounding lit le PDF réel (extraction texte + citation verbatim), et marque
`found:false` quand le passage est absent plutôt que de fabriquer une citation.

**Risques identifiés [effectif] :**

- citations anciennes potentiellement faibles ou hallucinées sur certaines baselines v2.2 ;
- identifiants de document orphelins dans certains graphes ;
- signaux sans description ou sans référence groundée (cause de blocage majoritaire du reliquat) ;
- extraction trop grossière des codes de zone (famille au lieu de sous-zone) ;
- PV disponibles mais pipeline de re-grounding/re-scraping encore à compléter pour une partie du
  reliquat.

**Préconisations :** maintenir un gate de publication strict ; enrichir chaque signal (type, phase,
date, effet réglementaire, cible géographique) ; utiliser un modèle/prompt expert par famille de
signal ; mesurer régulièrement précision, rappel et taux de citation vérifiable.

#### Rappel signal ↔ zone — mesure réelle et honnête

Le rapprochement signal → zone a été mesuré **trois fois**, sans extrapolation, sur le périmètre
strict des villes ayant à la fois des signaux désignant une zone et une collection zonage servie :

| Mesure | Rappel | Périmètre | Date |
|---|---:|---|---|
| Live (mapper tel quel) | **52 / 110 = 47,3 %** | 55 villes d'intersection | 28 juin |
| Après fix applicatif (lecture des champs de zone non-candidats) | **63 / 110 = 57,3 %** (+9,1 pts) | idem | 28 juin |
| Re-mesure finale (corrections applicatives + geo) | **71 / 120 = 59,2 %** | 55 villes, logique de champ finale | 29 juin |

Détails utiles à la décision :

- répartition des causes de non-match : **gap-data 63,8 %**, champ-non-lu 19,0 %, écart-schéma
  17,2 %, format-zéro-tête **0,0 %** (l'hypothèse d'un décalage de zéros de tête est **réfutée** sur
  la donnée réelle) ;
- **~81 % du déficit résiduel n'est pas corrigeable côté application** : il relève d'une extraction
  d'entités trop grossière (famille `H1` au lieu de `H1-30`) ou de couches geo divergentes (couche
  d'affectation servie au lieu de la grille) ;
- le **plafond de rappel atteignable côté application seule est ~57–59 %** ; aller au-delà exige
  l'acquisition des vraies grilles réglementaires (geo) et l'affinage de la granularité d'extraction
  (graphify). Le fix applicatif a débloqué des villes entières (par exemple rimouski 0→5/5,
  saint-hyacinthe 0→4/4).

Lecture étude : la normalisation et la jointure côté application sont **saines** ; le levier de
progression restant est **hors application** (données geo + granularité d'extraction), ce qui doit
guider la priorisation.

---

# 2 — Réalisations fonctionnelles

Quatre vues officielles sont câblées dans la navigation : **Signaux**, **Opportunités**,
**Évaluation**, **Sources**. Un socle cartographique partagé (`GeoCityMapBase`) a été extrait et
alimente les vues MapLibre.

## 2.A — Vue géographique : ville, zones, lots

### Signaux — **fonctionnel**

- carte **MapLibre GL** sur socle `GeoCityMapBase` ;
- aplats choroplèthes par ville, coloriés par nombre d'opportunités récentes ;
- clic ville → vol cartographique, rail et panneau listant les signaux (rezonage, PPCMOI,
  dérogation…) ;
- **3 filtres de type de signal** (`z | m | p`), **persistés dans l'URL et le stockage local** ;
- recherche de villes dans le rail ; légende épinglée ; affichage des citations et du contexte.

Limite : la précision lot/zone dépend du mapper signal → zone et de la couverture geo (cf. §1.B.d).

### Évaluation — **partiel, fonctionnel mais non migré**

- drilldown ville → **lots cadastraux rendus en SVG**, coloriés par **score de potentiel** ;
- **plafond de rendu à 200 lots** (`limit: 200` ; zones chargées à `limit: 500`) ;
- buckets de score, fiche lot, liens cartes externes (Google Maps / Street View) ;
- marques/prospects **en lecture seule** (aucune écriture depuis l'UI aujourd'hui).

Limites : pas encore de carte MapLibre lots + zonage cible ; couche TOD non ingérée ; écriture des
marques/notes et « mini-formulaire en vente » à finaliser ; filtres combinés usage × potentiel ×
superficie à compléter.

### Sources — **fonctionnel**

Vue de consolidation (« grand filet ») :

- villes coloriées par **maturité de recueil** (choroplèthe sur `GeoCityMapBase`) ;
- distinction `hasZonage`, statut par source (graphifié / scrappé / identifié / erreur) ;
- panneau qualité des données et détail par ville ;
- **dégradation honnête** : état vide explicite si la donnée est absente.

Elle s'appuie sur `/api/scrape-status`, la couverture qualité par ville et `/api/signals/by-city`.

## 2.B — Signaux : filtrage, citations, affichage

Les signaux disposent déjà d'une expérience consultable : catégorisation par type, filtre dans la
vue, citation affichable, chemin vers le document source quand disponible, contextualisation par
ville. Le point clef est la **traçabilité** ; un signal doit répondre à : quelle ville ? quel
document ? quelle page / citation ? quel type ? quelle zone / lot / rue ? quelle confiance ? Le
produit couvre les premiers éléments ; la **confiance** et la **liaison fine zone/lot** restent à
renforcer.

La preuve documentaire est disponible : un viewer PDF (pdf.js) affiche le document source à partir
d'une archive objet. La route de service **sonde d'abord l'archive de scraping** (PDF PV stockés en
adressage par contenu) puis **retombe** sur un store de métadonnées — mécanisme de repli utile quand
la source d'origine est complexe ou indisponible.

## 2.C — Vue données : consolidation

La vue Sources / Données consolide l'état de collecte et de qualité. C'est une réalisation
importante car elle **évite de vendre une couverture théorique non vérifiée**. Elle a vocation à
devenir le **tableau de bord de pilotage** : couverture raw, graph, zonage, lots ; fraîcheur des
jobs ; erreurs par source ; villes bloquées ; qualité des citations.

### Couverture des 17 fonctionnalités cibles (référentiel Steve)

Sur les 17 fonctionnalités du cahier des charges produit **[effectif, lecture code + tests]** :

- **Livré : 2** — pastilles réglementaires (signaux automatiques) et dashboard multi-villes (vue
  Sources) ;
- **Partiel : 5** — scoring lots (sans TOD ni carte Opportunités MapLibre), fiche lot (sans
  formulaire « en vente »), marques équipe (**lecture seule**, pas d'écriture), authentification
  (livrée ; synchronisation temps réel et export/import JSON absents), fiche mobile (tiroir latéral,
  pas encore bottom-sheet) ;
- **Absent / planifié : 10** — export CSV, filtres combinés, couches environnementales, recherche
  adresse/lot, sélection multiple batch, labels par zoom, flux annonces, lookup code postal, éditeur
  de zonage manuel, marquage batch de zone.

> **Point d'honnêteté produit :** la vue **Opportunités** de la navigation est aujourd'hui un
> **entonnoir de dossiers de démonstration** (fixture statique), **pas** la carte lots/zonage/scoring
> branchée sur l'API réelle. La carte lots scorée existe côté **Évaluation**. La carte Opportunités
> réelle reste à faire.

**Tests :** la suite UI compte **680 tests** (**669 passent**, 1 échoue, 10 à écrire, 10 ignorés)
**[effectif]**. Le sous-ensemble logique lots/fiche/prospect/scoring est **au vert (86/86)**. Le seul
test rouge est le test anti-PII périmé décrit au §1.B.c, à recaler avant fusion.

---

# 3 — Code et intégration

## 3.A — Architecture générale et réversibilité

L'architecture est **modulaire, à responsabilités séparées** :

```text
Sources municipales / géographiques
        ↓
Acquisition et scraping
        ↓
OCR / extraction / graphify
        ↓
Graphe normalisé + citations
        ↓
Projection PostgreSQL / PostGIS
        ↓
API domaine
        ↓
Application UI
        ↓
Intégrations assistées (MCP)
```

Le dépôt est un **monorepo** à espaces de travail : API, UI et bibliothèques de domaine
(`radar-domain`, `radar-scoring`, `radar-sources`), plus des jobs d'exploitation. Chaque
bibliothèque a une convention homogène (modules ES, TypeScript, build et typage via `tsc`, tests
`vitest`).

Les sources sont **pilotées par configuration** plutôt que codées ville par ville : un registre
central décrit chaque municipalité (procès-verbaux, avis publics, règlements d'urbanisme, rôle
d'évaluation, adresses, séances vidéo) et un scraper générique la consomme. Cette approche est un
atout de scalabilité — mais elle **ne rend pas toutes les villes accessibles** : un manifeste des
villes « dures » classe explicitement les cas irréductibles (par exemple portails protégés par
anti-bot, sites sans PDF exploitable, périmètres minuscules au domaine non résolu). Ces cas sont
**documentés**, pas masqués.

Cette séparation permet :

- de remplacer une source sans réécrire l'UI ;
- de changer de fournisseur OCR / LLM ;
- de rejouer une projection à volonté ;
- de **brancher ou retirer une couche d'authentification** sans toucher au domaine.

**Réversibilité des couches d'identité (OAuth) :** l'authentification repose sur un flux OIDC
standard (`authorization_code` + PKCE) et une session applicative auto-portée ; l'interface de
domaine reste stable pendant que la couche d'identité évolue. Cette couche transverse n'est pas le
cœur de l'étude ; l'important est qu'elle soit **réversible** : le produit fonctionne avec ou sans
elle, et son durcissement (session durable, refresh silencieux, persistance du consentement) est un
chantier identifié et cadré, indépendant du domaine métier.

## 3.B — Utilisation de l'IA : mixture of experts

La production s'est appuyée sur une **combinaison d'experts** (mixture of experts) : plusieurs
moteurs et agents spécialisés sont mobilisés selon la nature du problème, plutôt qu'un modèle unique.

| Rôle | Moteur / capacité | Usage |
|---|---|---|
| Raisonnement complexe, arbitrages d'architecture | profils de raisonnement premium **Claude 4.8 (xhigh)**, en **double compte** | conception, décisions, revue de cohérence |
| Exécution, patchs, revue, consolidation | profils premium **Codex 5.5 (xhigh)**, en **double compte** | implémentation, correctifs, consolidation |
| OCR de documents complexes | moteur OCR spécialisé (**Mistral OCR 4**) | extraction de texte sur PDF difficiles |
| Grounding verbatim des citations | modèle de raisonnement rapide | retrouver la citation exacte, anti-hallucination |
| Agents parallèles | flotte d'agents isolés | mesures, UI, infra, data, rédaction |

L'usage de **doubles comptes** des profils premium (Claude 4.8 xhigh et Codex 5.5 xhigh) a servi à
**paralléliser** les chantiers difficiles et à croiser les points de vue (un moteur exécute, un
autre arbitre/relit). Ce mode est adapté au problème : la difficulté n'est pas seulement de générer
du code, mais de **coordonner des couches hétérogènes, de valider les faits et d'éviter la survente
des métriques**.

**Principe à conserver :** l'IA accélère extraction, mapping, tests et rédaction ; des **gates
déterministes** décident de ce qui est publié ; les **métriques et citations** arbitrent ; les
**humains** valident les hypothèses métier et les priorités.

## 3.C — Infrastructure et coûts

### Infrastructure

- API Node / TypeScript ;
- PostgreSQL / PostGIS (projection géospatiale) ;
- jobs Kubernetes (backfill, refresh, mapper) ;
- stockage objet S3 (documents, PV en adressage par contenu, graphes) ;
- CDN / distribution du front ; application web.

Les jobs geo permettent de passer d'une exécution manuelle à une exploitation : one-shot pour
backfill ou relance, CronJob pour rafraîchissement, mapper autonome pour recalculer les résolutions.
Comme indiqué au §1.A.3, deux CronJobs de refresh applicatif sont **suspendus pour raison de coût**
en attendant la correction de leur cause racine — l'exploitation est donc **amorcée mais pas encore
pleinement stabilisée**.

### Projection des coûts et des tokens — coût au siège vs coût complet

Il faut distinguer **deux coûts** et ne jamais présenter le premier comme le second :

1. **Coût au siège / marginal de démonstration** : runs ciblés, focus 30, extraction ponctuelle,
   modèles premium réservés aux cas difficiles. C'est le coût d'une **preuve**, faible et maîtrisé.
2. **Coût complet industrialisé** : 1104 municipalités, refresh régulier, OCR, stockage, LLM, jobs,
   supervision et reprise d'erreurs. C'est le coût d'un **service**, dominé par les volumes récurrents
   (OCR + LLM sur les documents, et refresh geo/scrape) plutôt que par le développement.

**Stratégie recommandée pour maîtriser le coût complet :**

- réserver les **modèles premium aux cas complexes ou à forte valeur** ; garder les transformations
  **déterministes** partout où c'est possible (le reshape et le gate ne consomment pas de LLM) ;
- réserver l'**OCR spécialisé** aux documents où il apporte un gain mesurable ;
- **batcher** les villes et **borner** les extractions (bbox, pagination) ;
- exploiter **hashes, fraîcheur et jobs incrémentaux** pour éviter les relances complètes inutiles ;
- **mesurer le coût par ville, par document et par signal validé** — la bonne unité économique n'est
  pas le token brut mais le **signal vérifiable produit**.

La suspension FinOps des CronJobs de refresh est une **illustration concrète** de cette discipline :
un job récurrent défaillant a un coût réel (réveil d'un pool de calcul), et il est légitime de le
suspendre tant qu'il ne produit pas de valeur.

---

# Conclusion et feuille de route

La faisabilité est **démontrée** : les briques data, geo, graphe, API et UI existent et
communiquent. Le produit permet déjà de **consulter des signaux avec citations**, d'**inspecter la
maturité des sources** et de **visualiser des lots scorés** sur les villes couvertes.

La prochaine étape n'est pas une preuve de concept supplémentaire, mais une **consolidation
priorisée**, dans cet ordre :

1. **prioriser le focus 30** avec toutes les couches nécessaires (zonage en tête, aujourd'hui 3/30) ;
2. **stabiliser les jobs récurrents** (corriger puis réactiver les CronJobs de refresh) ;
3. **canoniser les collections zonage** (une collection par ville) pour un comptage et un mapping
   stables ;
4. **améliorer le modèle de signaux et le grounding**, et **construire la couche mapping rues/zones** ;
5. **finaliser les vues lots / opportunités** (carte réelle, écriture des marques, filtres métier) ;
6. **publier un tableau de bord de couverture honnête** distinguant effectif et projeté.

Le potentiel 1104 est **atteignable par itérations**, en séparant clairement ce qui est **effectif**
de ce qui est **projeté**. La valeur du socle actuel tient autant à ce qu'il produit qu'à sa
**discipline de vérité** : gates déterministes, citations obligatoires, mesures reproductibles et
limites documentées.

---

# Annexes — métriques citées, provenance et dates

| Sujet | Mesure | Qualification | Source interne | Date |
|---|---|---|---|---|
| Graphes v2.3 | ~976 (dans cible) à 978 (après publication) / 1104 | effectif | `2.3-completude-1105-FRESH.md`, `2.3-finition-progress.md` | 28 juin |
| Reliquat v2.3 | 128 villes (~30 v2.2 + ~97 sans brut) | effectif | idem | 28 juin |
| Focus 30 v2.2 résiduel | 1 publié (saint-césaire), 29 bloquées | effectif | `2.3-finition-progress.md` | 28 juin |
| Grounding hallucination | ex. 12/12 identifiants orphelins sur une ville | effectif | `2.3-finition-progress.md` | 28 juin |
| Collections zonage | ~506 `qc-zonage-*` (dont ~200 fragments ArcGIS) | à consolider | `zones-geo-30-investigation.md`, `wp3-mapper-recall-2026-06-28.md` | 28–29 juin |
| Couverture zonage | ~234 / 1104 par match | à consolider | `zones-geo-30-investigation.md` | 28 juin |
| Focus 30 zonage | 3 / 30 | à consolider | idem | 28 juin |
| Collections lots | ~1103 | effectif (API geo) | idem | 28 juin |
| Rappel mapper (live) | 52 / 110 = 47,3 % | effectif | `wp3-mapper-recall-2026-06-28.md` | 28 juin |
| Rappel mapper (fix applicatif) | 63 / 110 = 57,3 % | effectif | idem | 28 juin |
| Rappel mapper (final immo+geo) | 71 / 120 = 59,2 % | effectif | idem, §6 | 29 juin |
| Causes de non-match | gap-data 63,8 % · champ-non-lu 19 % · écart-schéma 17,2 % · zéro-tête 0 % | effectif | idem | 28 juin |
| Vues produit | 2 fonctionnelles / 2 partielles ; 2 livré · 5 partiel · 10 absent (17 features) | effectif | `wp4-produit-coverage.md` | 28 juin |
| Tests UI | 680 (669 pass, 1 fail, 10 todo, 10 skip) | effectif | idem | 28 juin |
| Jobs geo | populate-geo one-shot + CronJob, run-geo-mapper | effectif | `deploy/k8s/35a/35b/35` | 1er juillet |
| CronJobs refresh | suspendus (`suspend: true`, FinOps) | effectif | `deploy/k8s/34-refresh-cronjob.yaml` | 1er juillet |

> Les captures d'écran des vues (Signaux, Sources, Évaluation) peuvent être jointes sous
> `docs/spec/reports/study-2026-07/assets/` pour la version présentée ; elles ne modifient aucun
> chiffre du présent rapport.
