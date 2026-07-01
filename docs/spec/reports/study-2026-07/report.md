# Rapport d'étude — Radar Immobilier

Date : 2026-07-01
Statut : version de travail consolidée, à compléter après exécution des jobs géo récurrents et validation des métriques production.

## Résumé exécutif

Le socle livré démontre la faisabilité d'une chaîne bout-en-bout reliant des sources municipales hétérogènes à une expérience produit exploitable : collecte documentaire, extraction de signaux réglementaires, structuration en graphe, projection en API, vues cartographiques et vues de consolidation. La plateforme couvre aujourd'hui les usages prioritaires de consultation : signaux, citations, vue de maturité des sources, lots et zonage lorsque les couches géographiques sont disponibles.

Les résultats doivent toutefois être lus selon deux plans :

- **effectif vérifié** : graphes, signaux, vues applicatives et mesures de rappel réellement observées ;
- **potentiel projeté** : généralisation à l'ensemble des municipalités, dépendante de la disponibilité des documents, des couches géographiques et de jobs récurrents.

Les principaux acquis sont :

1. un pipeline graphify capable de produire des entités de signaux, zones, événements et citations à partir des PV et documents municipaux ;
2. une couche géographique intégrant zonage, lots cadastraux et résolution signal → zone/lot ;
3. une application exposant les signaux, les sources, la carte d'évaluation et une première consolidation des données ;
4. une architecture modulaire, réversible, avec séparation nette entre acquisition, extraction, projection, API et UI ;
5. une industrialisation en cours via jobs Kubernetes one-shot et récurrents.

Les limites principales sont :

- disponibilité inégale des sources municipales ;
- couverture zonage géographique encore très hétérogène sur les 30 villes prioritaires ;
- rappel signal↔zone dépendant autant de la qualité graphify que de la qualité des couches géographiques ;
- besoin de modèles / prompts spécialisés pour les signaux à fort enjeu ;
- nécessité de stabiliser les jobs récurrents, les métriques de couverture et les mappings rues / zones / lots.

---

# 1 — Faisabilité data, à consolider avec geo

## 1.A — Synthèse

### Focus 30 : toutes les couches et E2E

Le focus 30 sert de banc de validation E2E : documents → graphes → signaux → projection → API → interface → rapprochement géographique. La faisabilité fonctionnelle est démontrée, mais la complétude reste hétérogène selon les couches.

| Couche | État observé | Lecture étude |
|---|---:|---|
| Graphes / signaux | chaîne opérationnelle sur un grand nombre de villes ; reliquat v2.2 traité partiellement | socle exploitable, mais certains cas exigent re-grounding ou re-scraping |
| Citations | présentes et affichables quand le graphe est correctement groundé | qualité critique : ne pas publier de citation non vérifiable |
| Zonage geo | couverture provinciale partielle ; focus 30 encore faible selon les mesures disponibles | principal trou du focus démo |
| Lots cadastre | couche techniquement disponible à large échelle, sans PII propriétaire | base solide pour scoring et visualisation lot |
| Résolution signal→zone | rappel réel mesuré, améliorable par lecture de champs supplémentaires | faisable, mais dépend du schéma geo et de la précision graphify |
| UI | vues Signaux et Sources fonctionnelles ; Évaluation partielle ; Opportunités encore démo | produit consultable, pas encore outil complet de prospection multi-couches |

Points mesurés disponibles :

- Sur un run de finition graphify v2.3, le total publié atteint **978 / 1104** municipalités ciblées, avec un reliquat explicable par manque de raw, problème de grounding ou besoin de re-scraping.
- Sur l'investigation zonage geo, l'API exposait environ **506 collections `qc-zonage-*`** et **1103 collections lots cadastre** ; la couverture zonage par match de ville est estimée autour de **234 / 1104**, mais seulement **3 / 30** sur le focus prioritaire selon la mesure de juin. Cette métrique doit être consolidée après canonisation des collections.
- Sur la mesure du mapper signal↔zone, le rappel live était de **52 / 110 codes = 47,3 %** sur le périmètre strict des villes ayant à la fois signaux et collection zonage exacte. Un fix de lecture de champs non candidats monte la mesure à **63 / 110 = 57,3 %**.

### Potentiel cible sur les 1104 municipalités

Le potentiel cible est réel, mais ne doit pas être confondu avec l'effectif déjà livré.

| Dimension | Effectif observé / disponible | Potentiel projeté | Condition de passage à l'échelle |
|---|---:|---:|---|
| Municipalités cibles | 1104 | 1104 | référentiel stable et suivi de couverture |
| Graphes v2.3 | 978 mesurés dans le rapport de finition | proche de 1104 | scraping des villes sans raw + re-grounding des reliquats |
| Lots cadastre | ~1103 collections côté geo | quasi provincial | jobs de pull + limites mémoire / pagination maîtrisées |
| Zonage | ~234 / 1104 par match disponible, focus 30 faible | extension progressive | canonisation 1 collection/ville + priorisation focus 30 |
| Signaux exploitables | dépend des PV disponibles et du grounding | extensible par ville | modèle spécialisé, citations obligatoires, contrôle qualité |

La projection 1104 est donc crédible pour les couches où la source publique est normalisée, notamment lots/cadastre. Elle est moins immédiate pour les couches municipales non standardisées : zonage, grilles, règlements, PV et documents scannés.

### Limites et préconisations

#### Limites signaux

Les signaux sont la couche la plus utile métier, mais aussi la plus sensible :

- les PV et règlements sont hétérogènes ;
- certaines municipalités ont des PDF scannés, des tables mal extraites ou des formats instables ;
- des graphes anciens peuvent contenir des citations faibles ou non groundées ;
- les signaux « famille de zone » ne suffisent pas toujours à retrouver une sous-zone exacte ;
- les signaux de type zone proposée ou règlement en cours peuvent légitimement ne pas exister dans la couche zonage courante.

Préconisations :

1. conserver une règle stricte : **pas de signal publié sans citation vérifiable** ;
2. spécialiser le modèle de détection des signaux réglementaires plutôt que compter uniquement sur un modèle généraliste ;
3. introduire un score de confiance par signal : citation, date, type, zone, lot, source, état du règlement ;
4. séparer clairement les signaux constatés, les signaux inférés et les opportunités projetées.

#### Jobs récurrents

Les jobs one-shot et daily ont été ajoutés pour industrialiser la chaîne geo :

- `radar-populate-geo` : pull zones/lots puis résolution ;
- `radar-populate-geo-daily` : refresh quotidien ;
- `radar-run-geo-mapper` : relance du mapper seul.

Préconisations :

- journaliser les résultats par ville et par couche ;
- publier un tableau de bord de freshness ;
- conserver les échecs par cause : source absente, schéma inconnu, timeout, OOM, mismatch ;
- borner les lots par ville et par bbox pour éviter les extractions provinciales accidentelles.

#### Optimisations

Optimisations prioritaires :

1. **modèle signaux** : affiner les prompts / schémas pour PPCMOI, dérogations, zonage, PIIA, TOD, usages, densité ;
2. **mapping rues / zones** : relier adresse, toponyme, rue, lot et zone ;
3. **canonisation zonage** : réduire les fragments ArcGIS / Geo* à une collection canonique par ville ;
4. **normalisation grilles** : détecter les champs porteurs du code de zone et les liens de grilles ;
5. **contrôle qualité** : métriques automatiques de rappel, précision, citations et couverture.

---

## 1.B — Détail par layer

### 1.B.a — Zonage : méthode, proportions projetées et limites

#### Méthode

La couche zonage combine plusieurs familles de sources :

- couches ArcGIS / services géographiques municipaux ;
- collections Geo* et CKAN / Données Québec ;
- documents PDF lorsque la géométrie n'est pas directement exposée ;
- mapping OGC côté geo, puis ingestion dans `zone_versions` ;
- normalisation des codes de zones pour permettre le rapprochement avec les signaux.

Le service `populate-geo` effectue :

1. acquisition des polygones de zones ;
2. normalisation des codes ;
3. upsert dans `zone_versions` ;
4. résolution des références géographiques depuis les signaux.

#### Proportions projetées

Mesures disponibles à consolider :

- environ **506 collections `qc-zonage-*`** exposées ;
- couverture par match de ville autour de **234 / 1104** ;
- focus 30 prioritaire : seulement **3 / 30** selon la mesure d'investigation ;
- les chiffres peuvent varier selon la stratégie de matching, car plusieurs collections représentent des fragments, affectations, PIIA ou variantes ArcGIS.

Lecture : le zonage est faisable, mais le focus commercial doit être priorisé explicitement. Une couverture provinciale brute ne garantit pas que les 30 villes démonstratrices soient couvertes.

#### Limites potentielles

- nommage non canonique des collections ;
- plusieurs couches par ville : zonage, affectation, grille, PIIA, SAD ;
- champs de code de zone hétérogènes : `zone_code`, `code`, `NumZone`, `NO_ZONAGE`, `ETIQUETTE`, etc. ;
- granularité différente entre signal et couche : famille `H1` vs sous-zone `H1-30` ;
- zones proposées non encore présentes dans la géométrie en vigueur ;
- nécessité de conserver l'historique temporel des règlements.

### 1.B.b — Grilles d'évaluation

Les grilles d'évaluation sont utiles pour passer d'un signal à une opportunité : usages permis, densité, hauteur, marges, contraintes et potentiel.

Constat :

- les grilles sont souvent dans des PDF ou des champs liens hétérogènes ;
- les liens de grilles varient (`LienGrille`, `URL_GRILLE`, `GRILLE_URL`, `Grille`) ;
- la complétion textuelle peut introduire des erreurs lorsqu'elle résume ou reconstruit des tableaux réglementaires.

Recommandation IA :

- **conserver Mistral OCR 4** pour l'OCR lorsqu'il donne de bons résultats sur les documents complexes ;
- être prudent avec la **complétion Mistral** sur la reconstruction réglementaire : l'écart d'erreur doit être mesuré et borné ;
- préférer une extraction structurée avec preuves : cellule, page, citation, table, champ ;
- produire des grilles en mode « preuve d'abord » plutôt qu'en mode résumé.

### 1.B.c — Lots, cadastre et données PII

La couche lots s'appuie sur le cadastre public, avec bornage strict par commune / bbox. Elle est essentielle pour :

- afficher les parcelles ;
- scorer un potentiel ;
- lier un signal de zone à des lots concernés ;
- préparer des workflows de prospection.

Point de conformité : la donnée utilisée est géométrique et cadastrale : numéro de lot et géométrie. Elle ne contient pas de propriétaire. Le pipeline doit maintenir cette séparation :

- pas d'enrichissement propriétaire sans base légale et gouvernance spécifique ;
- pas d'affichage de PII ;
- tests anti-PII côté UI/API ;
- limitation des properties exposées au client.

La couverture lots semble nettement plus industrialisable que le zonage, car la source est plus normalisée. Les contraintes sont davantage techniques : pagination, mémoire, bbox, coûts et fréquence de rafraîchissement.

### 1.B.d — Détection des signaux : méthode graphify / entités

La méthode graphify transforme des documents municipaux en entités :

- sources et documents ;
- signaux réglementaires ;
- événements de désignation ;
- zones ;
- citations et références ;
- relations documentaires.

La version v2.3 renforce la contrainte de qualité : citation obligatoire et grounding vérifiable. C'est le bon compromis : moins de volume publié, mais meilleure confiance.

Risques identifiés :

- anciennes citations potentiellement faibles ;
- docSha orphelins dans certains graphes ;
- signaux sans description ou sans référence groundée ;
- extraction trop grossière de codes de zones ;
- PV disponibles mais pipeline de re-grounding ou de re-scraping à compléter.

Préconisations :

1. maintenir un gate de publication strict ;
2. enrichir les signaux avec type, phase, date, effet réglementaire et cible géographique ;
3. utiliser un modèle / prompt expert pour chaque famille de signal ;
4. mesurer régulièrement précision, rappel et taux de citation vérifiable.

---

# 2 — Réalisations fonctionnelles

## 2.A — Vue géographique : ville, zones, lots

La plateforme expose plusieurs vues géographiques ou semi-géographiques.

### Signaux

La vue Signaux est fonctionnelle :

- carte MapLibre ;
- choroplèthe par ville ;
- clic ville → liste et détail ;
- filtres par familles de signaux ;
- affichage des citations et contexte.

Limite actuelle : la précision lot / zone dépend du mapper signal→zone et de la couverture geo.

### Évaluation

La vue Évaluation affiche les lots et le scoring visuel :

- lots cadastraux rendus en SVG ;
- plafond courant de rendu autour de 200 lots selon la vue ;
- score potentiel et buckets ;
- fiche lot ;
- liens cartes externes ;
- marques/prospects principalement en lecture.

Limites :

- pas encore la carte MapLibre lots + zonage cible complète ;
- couche TOD non livrée ;
- écriture des marques / notes à finaliser ;
- filtres combinés usage × potentiel × superficie à compléter.

### Sources

La vue Sources est fonctionnelle et sert de console de consolidation :

- maturité par ville ;
- statut des sources ;
- indication de présence zonage ;
- panneau détail ville ;
- dégradation honnête si les données sont absentes.

## 2.B — Signaux : filtrage, citations, affichage

Les signaux disposent déjà d'une expérience consultable :

- catégorisation par type ;
- filtre dans la vue ;
- citation affichable ;
- chemin vers le document source quand disponible ;
- contextualisation par ville.

Le point clef est la traçabilité. Un signal doit répondre à :

1. quelle ville ?
2. quel document ?
3. quelle page / citation ?
4. quel type de signal ?
5. quelle zone / lot / rue ?
6. quelle confiance ?

Le produit couvre les premiers éléments, mais la confiance et la liaison fine zone/lot doivent être renforcées.

## 2.C — Vue données : consolidation

La vue Sources / Données consolide l'état de collecte et de qualité. C'est une réalisation importante car elle évite de vendre une couverture théorique non vérifiée.

Elle doit devenir le tableau de bord de pilotage :

- couverture raw ;
- couverture graph ;
- couverture zonage ;
- couverture lots ;
- fraîcheur des jobs ;
- erreurs par source ;
- villes bloquées ;
- qualité des citations.

---

# 3 — Code et intégration

## 3.A — Code généré et architecture générale

L'architecture est modulaire :

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
MCP / intégrations assistées
```

Les librairies sont séparées par responsabilité :

- acquisition et sources ;
- géographie ;
- domaine immobilier ;
- API ;
- UI ;
- intégrations MCP ;
- jobs d'exploitation.

Cette séparation permet :

- de remplacer une source sans réécrire l'UI ;
- de changer de fournisseur OCR / LLM ;
- de rejouer une projection ;
- de brancher ou retirer une couche d'authentification ;
- de rendre les couches OAuth réversibles : l'interface domaine reste stable pendant que la couche d'identité évolue.

Les couches transverses ne sont pas le sujet principal de l'étude, mais l'architecture est prête pour une intégration plus stricte : tenant, scopes, audit, OAuth / resource server.

## 3.B — Utilisation IA : mixture of experts

L'utilisation IA s'est faite en mode mixture of experts : plusieurs agents / modèles spécialisés sont mobilisés selon la nature du problème.

Exemples :

- raisonnement complexe et arbitrage d'architecture avec profils Claude 4.8 xhigh ;
- exécution, revue, patchs et consolidation avec Codex 5.5 xhigh ;
- OCR et extraction documentaires avec moteur OCR spécialisé ;
- prompts de grounding pour retrouver des citations verbatim ;
- agents parallèles pour mesures, UI, infra, data et rapports.

Ce mode est adapté au problème : la difficulté n'est pas seulement de générer du code, mais de coordonner des couches hétérogènes, de valider les faits et d'éviter la survente des métriques.

Principe à conserver :

- IA pour accélérer extraction, mapping, tests et rédaction ;
- gates déterministes pour publier ;
- métriques et citations pour arbitrer ;
- humains pour valider les hypothèses métier et les priorités.

## 3.C — Infrastructure et coûts

### Infrastructure

La plateforme repose sur une infrastructure applicative moderne :

- API Node / TypeScript ;
- PostgreSQL / PostGIS ;
- jobs Kubernetes ;
- objets S3 / stockage documentaire ;
- CDN / distribution front ;
- application web ;
- jobs de projection et refresh.

Les jobs ajoutés pour geo permettent de passer d'une exécution manuelle à une exploitation :

- one-shot pour backfill ou relance ;
- CronJob daily pour rafraîchissement ;
- mapper standalone pour recalculer les résolutions.

### Coûts et tokens

Il faut distinguer deux coûts :

1. **coût au siège / coût marginal de démonstration** : runs ciblés, focus 30, extraction ponctuelle, modèles premium sur cas difficiles ;
2. **coût complet industrialisé** : 1104 municipalités, refresh régulier, OCR, stockage, LLM, jobs, supervision, reprise d'erreurs.

La stratégie recommandée :

- utiliser des modèles premium seulement sur les cas complexes ou à forte valeur ;
- garder les transformations déterministes quand possible ;
- réserver l'OCR spécialisé aux documents où il apporte un gain ;
- batcher les villes ;
- mesurer coût par ville, coût par document et coût par signal validé ;
- éviter les relances complètes non nécessaires grâce aux hashes, freshness et jobs incrémentaux.

---

# Conclusion

La faisabilité est démontrée : les briques data, geo, graph, API et UI existent et communiquent. Le produit permet déjà de consulter des signaux, d'inspecter les sources et de visualiser des lots / scores sur les villes couvertes.

La prochaine étape n'est pas une preuve de concept supplémentaire, mais une consolidation :

1. prioriser le focus 30 avec toutes les couches nécessaires ;
2. stabiliser les jobs récurrents ;
3. canoniser les collections zonage ;
4. améliorer le modèle de signaux et le grounding ;
5. finaliser les vues lots / opportunités ;
6. publier un tableau de bord de couverture honnête.

Le potentiel 1104 est atteignable par itérations, en séparant clairement ce qui est déjà effectif de ce qui est projeté.

---

# Annexes — métriques citées

| Sujet | Mesure | Source interne |
|---|---:|---|
| Graphes v2.3 | 978 / 1104 | `docs/spec/reports/2.3-finition-progress.md` |
| Focus 30 v2.2 résidu | 1 publié, 29 bloqués dans le run déterministe | idem |
| Collections zonage | ~506 `qc-zonage-*` | `docs/spec/reports/zones-geo-30-investigation.md` |
| Couverture zonage projetée | ~234 / 1104 par match | idem, à consolider |
| Focus 30 zonage | ~3 / 30 | idem, à consolider après canonisation |
| Collections lots | ~1103 | idem |
| Rappel mapper live | 52 / 110 = 47,3 % | `docs/spec/reports/wp3-mapper-recall-2026-06-28.md` |
| Rappel après fix champ | 63 / 110 = 57,3 % | idem |
| Vues produit | Signaux/Sources fonctionnelles ; Évaluation partielle ; Opportunités démo | `docs/spec/reports/wp4-produit-coverage.md` |
