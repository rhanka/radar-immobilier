# Rapport - Structure de tracking cible stable

Date: 2026-06-28  
Auteur: Codex, revue indépendante en lecture seule  
Portée: structure Track cible, sans mutation Track ni branche ni commit  

Convention de lecture:

- **[OBSERVÉ]** fait tiré d'une commande exécutée ou d'un fichier lu.
- **[PROPOSITION]** recommandation de structure.
- **[HYPOTHÈSE]** point à valider par le propriétaire.

## 1. Résumé exécutif

**[OBSERVÉ]** Track est actuellement plat: `track query --role workpackage --format json` retourne `[]`, donc aucun item n'est exposé comme `role:"workpackage"` dans la requête lue.  
**[OBSERVÉ]** Le backlog live contient 111 items: 68 `DONE`, 35 `TO-DO`, 6 `AWAITED`, 2 `DROPPED`; 14 workspaces distincts servent aujourd'hui de "thèmes" implicites.  
**[PROPOSITION]** La structure cible doit figer le sommet en 6 WP immuables: Signaux, Socle géospatial, Réconciliation/preuve, Produit radar, Plateforme, Gouvernance Track.  
**[PROPOSITION]** Je diverge du draft owner en séparant strictement `geo` et `immo`: à terme, `geo` porte le foncier/géospatial, `immo` garde l'extraction sémantique des signaux municipaux et la décision produit.  
**[PROPOSITION]** Track doit rester la source de vérité des WPs, todos, statuts, signoff et décisions; PostgreSQL ne doit porter qu'une projection lecture pour un kanban UI.  
**[PROPOSITION]** Les horizons `now/week/month/project` ne doivent pas modifier les WPs: ils filtrent les todos internes par cadence, focus `30/33/1105` et signoff.  
**[OBSERVÉ]** La migration proposée couvre tous les 14 workspaces Track observés, sans workspace orphelin.

## 2. État réel du Track

### Commandes lancées

**[OBSERVÉ]** Toutes les commandes ci-dessous ont été lancées depuis `/home/antoinefa/src/radar-immobilier`. Aucune commande Track mutante n'a été exécutée.

| Commande | Résultat utile |
|---|---|
| `track report --format json` | Succès. Buckets: `AWAITED=6`, `DONE=68`, `DROPPED=2`, `TO-DO=35`. |
| `track query --format json` | Succès. 111 items listés avec `id`, `title`, `kind`, `workspace`, `bucket`, `realization`, `acceptance`, parfois `priority` et `accountable`. |
| `track query --role workpackage --format json` | Succès, sortie `[]`. Aucun workpackage structuré visible par ce filtre. |
| `track report --format text` | Succès. Synthèse: `fait=68`, `à-faire=35`, `attendus=6`, `dropped=2`, `décisions pending=0`. |
| `track query --format json | jq ... group_by(.workspace) ...` | Succès. 14 workspaces distincts inventoriés. |

Extrait exact de `track report --format text`:

```text
SYNTHÈSE
fait   à-faire   attendus   dropped   décisions pending
────   ───────   ────────   ───────   ─────────────────
68     35        6          2         0
```

### Inventaire des thèmes/workspaces observés

**[OBSERVÉ]** Track n'expose pas de champ `theme` dans les sorties lues; j'utilise donc `workspace` comme thème opérationnel existant.

| Workspace Track observé | Items | Buckets observés | Réalisations observées | Lecture |
|---|---:|---|---|---|
| `frontA-data` | 12 | DONE 6, DROPPED 1, TO-DO 5 | cancelled 1, done 6, in-progress 2, to-do 3 | Mélange PV/avis/YouTube, geo data, rôle, zonage, data quality. |
| `frontA-viz` | 15 | DONE 13, TO-DO 2 | done 13, in-progress 2 | Vues radar, AppShell/DS, filtres, sélection, routing. |
| `frontA-infra` | 8 | DONE 6, TO-DO 2 | done 6, in-progress 1, to-do 1 | Infra agents, graph DB, admin/auth, orchestration. |
| `frontB-geo` | 8 | AWAITED 1, DONE 4, TO-DO 3 | done 5, in-progress 2, to-do 1 | Vertical géo zone-lot, preuve PDF géo, E2E 33, propriétaires. |
| `reorientation` | 25 | AWAITED 5, DONE 6, TO-DO 14 | done 7, in-progress 4, to-do 14 | Pivot grand filet, S3-first, CS-L/CS-P Steve, parsing massif. |
| `wp4-sources` | 8 | DONE 8 | done 8 | Sources historiques: multi-villes, raw/S3, MAMH, AQ, règlements. |
| `wp4-pipeline` | 3 | DONE 3 | done 3 | Ciblage, recueil/exploitation, bug accumulation multi-sources. |
| `wp5-ontology` | 18 | DONE 11, DROPPED 1, TO-DO 6 | cancelled 1, done 11, in-progress 3, to-do 3 | Graphify, ontologie, citations, evidence/PDF, reliquats grounding. |
| `wp6-platform` | 2 | DONE 2 | done 2 | Backlog UI branché Track et auto-refresh sidecar. |
| `evdoc-branch-feat-evidence-doc-cards` | 8 | DONE 8 | done 8 | Cartes documentaires de preuve, API document, overlay PDF. |
| `infra` | 1 | DONE 1 | done 1 | Déploiement k8s/sentropic. |
| `WP B` | 1 | TO-DO 1 | in-progress 1 | Sélection géo zones/lots pour détections prioritaires. |
| `WP A.3` | 1 | TO-DO 1 | in-progress 1 | Vue data quality/admin. |
| `meta-track` | 1 | TO-DO 1 | in-progress 1 | Recalage Track post-drift. |

### Items actifs et attendus

**[OBSERVÉ]** Les items non `DONE`/`DROPPED` sont ceux qui structurent le travail immédiat. Les plus déterminants sont:

| Bucket | Réalisation | Workspace | Item | Titre |
|---|---|---|---|---|
| AWAITED | done | `frontB-geo` | `01KTQP5FEAD2BQ860ZQK2WF5BQ` | WP B - Vertical profond geo zone-lot. |
| AWAITED | done | `reorientation` | `01KTW1NC9NRQQ5G05YB5E2MH8M` | CS-L1 - scoring visuel lots 4+ et TOD. |
| AWAITED | in-progress | `reorientation` | `01KTW1NZ55V6FTN3ACJSKQQNQ7` | CS-L2 - fiche lot complète. |
| AWAITED | to-do | `reorientation` | `01KTW1NZ8FEWYQ1T4CCNR479FK` | CS-L3 - marquage équipe et notes. |
| AWAITED | to-do | `reorientation` | `01KTW1NZBY7F1SC7A6A4NQAEAS` | CS-L4 - export CSV lettres et sélection. |
| AWAITED | to-do | `reorientation` | `01KTW1NZJ06D73BQZP14GX8PE7` | CS-L5 - filtres potentiel, usage, superficie. |
| TO-DO | in-progress | `frontA-data` | `01KTQP5EWW8Q7JNXYFZ9HWSS6Q` | WP A.2 - Data easy first et agents remote. |
| TO-DO | to-do | `frontA-data` | `01KTQP5F3TBJW90Y4A2SX7Z2Z5` | A.2.4 todo permanente, agents background, Obscura, Track. |
| TO-DO | to-do | `frontA-infra` | `01KTQP5FAW14WSGS18TB4R5B2B` | A.3.2 remote, orchestration agents, suivi backlog Track. |
| TO-DO | to-do | `frontA-data` | `01KTQQB24Q0X5HMTFWW5JQDPQB` | Source zonage PDF/GeoJSON. |
| TO-DO | to-do | `frontA-data` | `01KTQQB270VKEM8BGYM06B8S4N` | Source rôle-évaluation Données Québec. |
| TO-DO | to-do | `reorientation` | `01KTT2X4QG1VSWNPGX61S8024P` | WP Persistance S3-first. |
| TO-DO | to-do | `reorientation` | `01KTT2XP110R7EAD9EP9X1MGMG` | L4 - rebuild Postgres depuis S3. |
| TO-DO | to-do | `reorientation` | `01KTT2XP45WKMVY2P3FR5850RM` | L5 - fixtures git réduites et promote. |
| TO-DO | to-do | `reorientation` | `01KTT2XP663WGCX3YNF4WVMXQN` | L6 - worker vers Serverless Jobs et Cron. |
| TO-DO | to-do | `reorientation` | `01KTW1PP40D39CQ3VSFNNNKMM1` | CS-L6 - maquette substrat Steve 4 villes. |
| TO-DO | to-do | `reorientation` | `01KTW1PP80NN8AYY9NDYRJ7NTN` | CS-P1 - pastilles, couches env, recherche, batch, labels, sync. |
| TO-DO | to-do | `reorientation` | `01KTW1PPBEW81X8HTZZ4NS7VKZ` | CS-P2 - annonces, code postal, éditeur zonage, mobile, dashboard. |
| TO-DO | to-do | `reorientation` | `01KTW674GHVBQ2J843QP0BERGP` | CS-P3 - sync temps réel multi-utilisateurs, auth, export/import JSON. |
| TO-DO | to-do | `reorientation` | `01KTW67FQGE1AZ9J841Z0FH2FB` | CS-P2-S13 - lookup code postal. |
| TO-DO | in-progress | `reorientation` | `01KTWQEH2ATBCD75BDZY48GWHC` | Parsing graphify PV. |
| TO-DO | to-do | `reorientation` | `01KTWQEVH0KHS4C472BZR51ZED` | Script one-shot bootstrap simulation Steve + graphify. |
| TO-DO | to-do | `wp5-ontology` | `01KTWQF2T7V8A7K9RQCPEAGGZC` | Entités additionnelles graphify. |
| TO-DO | to-do | `reorientation` | `01KTWQF6YVGJKWNRC99FNQ7XGR` | Orchestration remote parsing graphify 3272 docs. |
| TO-DO | to-do | `wp5-ontology` | `01KVB2FB14WB399NQ1VHHV3NMC` | Mesure de performance extraction ontologie. |
| TO-DO | in-progress | `reorientation` | `01KVB2KAE3C3WKCP98QJ1JQAHN` | DS redesign - buckets sélection et cartes détail. |
| TO-DO | to-do | `wp5-ontology` | `01KVB3PV4X8AXSZR5DF249X21X` | Parité version Graphify. |
| TO-DO | in-progress | `wp5-ontology` | `01KVB478A9NVXDWQPZPK8T8PZ9` | Graphify v2.3 descriptions et citations exhaustives. |
| TO-DO | in-progress | `WP B` | `01KVB67H8PDQZDHN952DY0SB82` | Geo selection zones/lots pour priority detections. |
| TO-DO | in-progress | `WP A.3` | `01KVB67M7CV95DXB5DTX4PX59G` | Data quality and admin validation views. |
| TO-DO | in-progress | `frontA-viz` | `01KVB9MZ76TV5PNENQZPG7C9YS` | P1 DS alignment. |
| TO-DO | in-progress | `frontA-data` | `01KVB9MZ7Y96B2B18BNBC2SVC2` | P4 Data quality view par ville. |
| TO-DO | in-progress | `frontA-viz` | `01KVB9MZ8CQ4X5TW9NKMYE52QJ` | P2 Selection bucket UX. |
| TO-DO | in-progress | `meta-track` | `01KW2KS5K2D1Y7KGYF41ZAZGSW` | Recalage Track drift post-2026-06-23. |
| TO-DO | in-progress | `wp5-ontology` | `01KW2KS5S8FC5150AEWQPP7X37` | Consolidation couche preuve citation/PDF/rawRef. |
| TO-DO | in-progress | `frontB-geo` | `01KW2KS5ZDNY72Y2G3B6DRYZQ5` | Ownership geo de la preuve PDF liée aux signaux/zones/lots. |
| TO-DO | in-progress | `frontA-infra` | `01KW2KS65RKCSBNBEWQVSN7PH7` | Auth durable Sentropic, session 15j. |
| TO-DO | in-progress | `wp5-ontology` | `01KW2KS6CAK6A761D81YMX8DY0` | Reliquats grounding citations. |
| TO-DO | in-progress | `frontB-geo` | `01KW5N0Z3X2RFBG6NAJJZKXTWY` | WPB-E2E cohérence 33 opportunités. |
| TO-DO | in-progress | `reorientation` | `01KW5N4WEBT27JDFZ9VZ0MDD3Y` | CS-L1b scoring visuel lots aligné WPB-E2E 33. |
| TO-DO | to-do | `frontB-geo` | `01KW5RXJF7YWYHM86XY411SWJ0` | Geo propriétaires de lots, Loi 25, auth, avertissement scraping. |

### Diagnostic de structure

**[OBSERVÉ]** La sortie Track ne montre aucun arbre WP existant. Les anciens noms `WP A.1`, `WP A.2`, `WP A.3`, `WP B`, `wp4-*`, `wp5-*`, `CS-*`, `P*`, `L*` coexistent comme titres ou workspaces, pas comme structure immuable.  
**[OBSERVÉ]** Les workspaces mélangent des dimensions différentes: propriétaire (`frontB-geo`), période (`reorientation`), ancien plan (`wp4-sources`), branche (`evdoc-branch-feat-evidence-doc-cards`), et méta-tracking (`meta-track`).  
**[PROPOSITION]** La migration doit donc créer des WPs de préoccupation durable, puis reclasser les items existants en sous-lots internes, sans garder les préfixes historiques comme sommet.

## 3. Couverture cible Steve

### Ce que les specs disent

**[OBSERVÉ]** `/home/antoinefa/src/radar-immobilier/docs/spec/input/PROCESS.md` décrit le pipeline cible: les signaux réglementaires créent des hypothèses, l'ancrage foncier les relie aux lots, les contraintes filtrent, puis marché/contexte/scoring priorisent (`PROCESS.md`, lignes 13-18). Les phases détaillées sont Signal, Ancrage foncier, Contraintes, Enrichissement marché, Contexte stratégique, Scoring (`PROCESS.md`, lignes 43-99).  
**[OBSERVÉ]** Le même fichier impose que chaque score pointe vers une preuve, une date et une source (`PROCESS.md`, lignes 168-172), et que les PDF municipaux soient lus par OCR/LLM tout en conservant l'extrait source et la page (`PROCESS.md`, lignes 230-252).  
**[OBSERVÉ]** `/home/antoinefa/src/radar-immobilier/docs/spec/SPEC_REORIENTATION_GRAND_FILET.md` pivote vers un radar multi-villes, centré PV et carte-first: changement de zonage depuis procès-verbaux, avis de motion, grand filet, carte ville-zone-lot (`SPEC_REORIENTATION_GRAND_FILET.md`, lignes 8-34).  
**[OBSERVÉ]** `/home/antoinefa/src/radar-immobilier/docs/spec/input/carte-steve/README.md` décrit l'outil Steve comme une plateforme de prospection foncière: lots cadastraux, rôle 2022, zonage 4+, TOD, marques d'équipe, notes, pastilles réglementaires et exports CSV (`README.md`, lignes 8-17).  
**[OBSERVÉ]** Le corpus Steve couvre 4 villes et 27 279 lots: Delson, Sainte-Catherine, Saint-Constant, Candiac (`README.md`, lignes 20-30; `SPEC_CONTROLE_PARITE_VILLES_STEVE.md`, lignes 36-51).  
**[OBSERVÉ]** `/home/antoinefa/src/radar-immobilier/docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` dit que tout Steve doit s'intégrer aux quatre vues radar existantes: Signaux, Opportunités, Évaluation, Sources (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, lignes 1-6 et 25-33).  
**[OBSERVÉ]** Cette spec liste 17 features Steve couvertes par les vues radar, dont carte lots/zonage/TOD, fiche lot, marques, export CSV, filtres, pastilles depuis PV, couches environnementales, recherche, batch, auth/sync, code postal, éditeur zonage, mobile et dashboard multi-villes (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, lignes 328-350).  
**[OBSERVÉ]** La table de contrôle Steve est un dataset de référence isolé, jamais le store opérationnel, pour mesurer la parité entre Steve et le pipeline radar (`SPEC_CONTROLE_PARITE_VILLES_STEVE.md`, lignes 6-13 et 28-35).  
**[OBSERVÉ]** La frontière immo/geo est déjà cadrée: `geo` doit porter les données géo génériques, cadastre, zonage, contraintes, registre municipalités, rôle/adresses en acquisition, OCR/géoréférencement de plans PDF; `immo` garde PV, détection sémantique, mapper, ontologie, scoring, signaux/opportunités et scraping dur Obscura (`data-division-immo-geo.md`, lignes 15-40 et 79-109).

### Ce que la structure doit porter

**[PROPOSITION]** La structure Track doit permettre de répondre, à tout moment:

| Question propriétaire/client | Réponse par la structure |
|---|---|
| Que travaille-t-on maintenant ? | Filtre `timeScale=now`, items `in_progress` ou `blocked`, groupés par WP et axe `30/33/1105`. |
| Qu'a-t-on fait et que reste-t-il cette semaine ? | Vue `timeScale=week`, avec done/to-do/blocked/needs_review par WP, critères et signoff. |
| Qu'a-t-on fait et que reste-t-il ce mois-ci ? | Vue `timeScale=month`, rollup des lots internes par WP et jalons de focus. |
| Depuis le départ, qu'est-ce qui est fait et restant ? | Vue `timeScale=project`, rollup de tous les items Track, y compris DONE/DROPPED, sans changer les WPs. |
| Le produit Steve est-il couvert ? | Matrice WP-REC/WP-PROD: features S-1 à S-17, focus `33` et table de contrôle 4 villes. |
| La preuve PDF est-elle vraie ? | WP-REC: chaîne signal -> citation -> rawRef/PDF -> page/bbox -> zone -> lot -> grille. |
| Qui porte quoi entre geo et immo ? | RACI au niveau WP et sous-lot: `geo` par défaut sur géospatial/foncier, `immo` sur extraction signal/scoring/décision produit. |

## 4. Critique du draft owner

### WP1 DATA

**Draft owner:** `cities | pv | signals | zones | lots`, double focus `30 cities + 1105`, RACI geo/immo, sous-lots optionnels.

**[JUGEMENT]** Le risque principal est le mot `DATA`: il absorbe à la fois des sources géo, des sources texte, de l'extraction sémantique, des owners, du foncier et des signaux. C'est exactement la confusion que la RACI immo/geo tente d'éliminer.  
**[OBSERVÉ]** La frontière locale dit que `geo` absorbe la donnée géo générique, tandis que `immo` garde PV, détection sémantique, scoring et signaux (`data-division-immo-geo.md`, lignes 103-109).  
**[PROPOSITION]** Remplacer WP1 par deux WPs stables: `WP-SIG` pour l'extraction des signaux municipaux et `WP-GEO` pour le socle géospatial/foncier. Les sous-lots `cities`, `zones`, `lots`, `cadastre`, `rôle`, `contraintes`, `owners` vivent dans `WP-GEO`; `pv`, `avis`, `youtube`, `graphify`, `signals` vivent dans `WP-SIG`.

### WP2 E2E RECONCILIATION

**Draft owner:** niveaux 1/2/3: signaux x PDF; signaux x PDF x zones x geo; signaux x zones x grid x lots.

**[JUGEMENT]** L'intention est correcte, mais les niveaux sont des critères de maturité, pas des WPs. Si le sommet est `level1/level2/level3`, il bougera dès que la preuve avance.  
**[OBSERVÉ]** Les specs imposent bien une chaîne signal/PV -> zone -> lot -> opportunité avec preuve et PDF (`PROCESS.md`, lignes 43-99 et 230-252; `SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, lignes 201-219 et 354-371).  
**[PROPOSITION]** Garder un seul WP durable `WP-REC - Réconciliation E2E et preuve`, avec des critères internes L1/L2/L3. L1/L2/L3 deviennent des checklist de complétude et des focus reports, pas des parents permanents.

### WP3 IMMO FUNCTIONAL

**Draft owner:** niveaux Québec, ville, zone, lot, transverse PDF; filtering views, bucket functions, CS-L tests.

**[JUGEMENT]** Ce WP confond la hiérarchie de navigation, les vues produit, le scoring et la preuve PDF. La navigation Québec/ville/zone/lot est stable comme expérience, mais PDF/preuve doit rester dans la chaîne de vérité E2E, sinon le produit peut paraître fini sans être prouvé.  
**[OBSERVÉ]** Les quatre vues officielles sont Signaux, Opportunités, Évaluation, Sources (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, lignes 35-47), et Steve doit y être couvert sans nouvel écran (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, lignes 328-350).  
**[PROPOSITION]** Renommer et recentrer en `WP-PROD - Expérience radar client`: vues, filtres, buckets, marques, exports, URL state, DS/app shell. La preuve PDF transverse sort vers `WP-REC`; les données géo sortent vers `WP-GEO`.

### WP4 INFRA

**Draft owner:** auth, DS, MCP, chat-ui, etc.

**[JUGEMENT]** `INFRA` est nécessaire mais trop large: il mélange plateforme, sécurité, DS/app shell, agents, Track, MCP, déploiement. Sans frontière, il deviendra le nouveau "misc".  
**[OBSERVÉ]** Track contient déjà des items distincts pour auth durable (`01KW2KS65RKCSBNBEWQVSN7PH7`), backlog Track UI (`01KTNXDJ6EN4WXBFKVYCZJF6E2`, `01KTQ1DRFWRK2DNCGPEFFETF3A`), déploiement (`01KTNXDJ7ZK5GAEAFZJQZNJMVE`), DS/AppHeader (`frontA-viz` DONE/TO-DO), et orchestration agents (`01KTQP5FAW14WSGS18TB4R5B2B`).  
**[PROPOSITION]** Scinder en `WP-PLAT - Plateforme, sécurité et exploitation` pour S3/Postgres/auth/deploy/agents/MCP, et `WP-GOV - Pilotage Track et décisions` pour la structure de tracking, décision dossiers, focus HTML et reporting client.

### Gaps et items orphelins si le draft est accepté tel quel

**[OBSERVÉ]** Le workspace `meta-track` existe et contient `Recalage Track - drift post-2026-06-23...`; le draft owner ne lui donne pas de WP stable.  
**[OBSERVÉ]** Le workspace `evdoc-branch-feat-evidence-doc-cards` regroupe 8 DONE autour des cartes documentaires et de l'overlay PDF; le draft ne dit pas si cela relève d'E2E preuve, UI produit ou infra.  
**[OBSERVÉ]** Les items `wp6-platform` concernent explicitement Backlog <-> Track; le draft WP4 les absorberait sans distinguer source de vérité Track et projection UI.  
**[OBSERVÉ]** Les items `frontA-data` mélangent PV à garder immo et zonage/rôle à déléguer geo; le draft WP1 ne force pas cette séparation.  
**[OBSERVÉ]** Les items `CS-L*` et `CS-P*` sont des lots d'intégration Steve (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, lignes 706-780), pas des WPs de long terme.  
**[PROPOSITION]** La migration doit donc être par préoccupation durable et non par préfixe historique.

## 5. Structure cible: tableau des WP

**[PROPOSITION]** Les WPs ci-dessous sont immuables au sommet. On peut ajouter, fermer ou déplacer des sous-lots, mais pas renommer/recycler les codes sans décision dossier.

| Code | Titre | Définition | RACI geo/immo | Critère de complétude |
|---|---|---|---|---|
| `WP-SIG` | Signaux municipaux et extraction prouvée | Tout ce qui transforme PV, avis publics et séances en `Signal`/`DesignationEvent`: collecte texte, OCR PV, YouTube, graphify, entités, citations textuelles, classification, confiance. N'inclut pas la géométrie des zones/lots. | **A/R immo** pour PV, sémantique, graphify, signaux, scoring initial. **C geo** pour OCR mutualisé si fourni. **I geo** sur besoins de jointure. | Pour les axes actifs, les signaux ont source, date, extrait, confidence, type, statut et lien preuve; les reliquats grounding sont explicitement `blocked` ou `dropped`. |
| `WP-GEO` | Socle géospatial et foncier | Données géo/foncières génériques: villes, lots, cadastre, zonage, grilles/plan PDF géoréférencé, rôle MAMH acquisition, adresses, TOD, contraintes CPTAQ/BDZI/MELCC, propriétaires sous garde Loi 25. | **A/R geo** par défaut sur acquisition et primitives géo. **R immo** seulement sur overlay stratégique, interprétation métier valeur/usage, et consommation produit. **C immo** sur schémas nécessaires aux signaux. | Les couches ciblées ont provenance, fraîcheur, clé de jointure (`citySlug`, `NO_LOT`, `codeAffiche`), couverture par axe `30/1105`, et statut honnête `fait/hypothese/non-disponible/simulé`. |
| `WP-REC` | Réconciliation E2E, preuve et parité | Chaîne de vérité qui relie signal -> PDF/rawRef -> citation/page/bbox -> zone -> grille -> lot -> dossier d'opportunité. Inclut les gates 33 opportunités, la parité Steve, les rapports de qualité, et la preuve client. | **A immo** pour vérité produit/opportunité. **R immo** sur signal/PDF/citation métier. **R geo** sur projection zone/lot/géométrie/grille. **C plateforme** sur routes document et stockage. | 33 opportunités démontrables ont preuves PDF, zones/lots, grille et scoring; chaque rupture est visible avec cause. Les 4 villes Steve sont diffables contre `ControlLot`/`ControlMark` sans polluer le store réel. |
| `WP-PROD` | Expérience radar client | Vues Signaux, Opportunités, Évaluation, Sources; carte-first; filtres, buckets, marques, notes, exports, recherche, sélection, labels, mobile, DS/app shell. N'inclut pas l'autorité des données ni la preuve brute. | **A immo/product** pour workflows client, wording, priorisation, scoring visible. **R geo** sur composants/couches carto quand délégués. **C plateforme** pour auth/session/sync. | Les 17 features Steve sont soit livrées, soit explicitement planifiées/droppées; la démo répond à quoi faire maintenant par ville/zone/lot sans cacher l'état de preuve. |
| `WP-PLAT` | Plateforme, sécurité et exploitation | S3-first, Postgres projections, rebuild, worker/serverless, auth/session 15j, MCP/chat-ui, remote agents, déploiement, CI/test infra, routes document, performance et sécurité. N'inclut pas la gouvernance Track. | **A/R immo-platform** tant que le repo porte l'app. **C geo** pour contrats OGC/S3 et couches géo. **C product** pour UX auth/admin. | Les services sont reproductibles, sécurisés, observables; Postgres est reconstructible depuis S3 quand spécifié; auth durable fonctionne; les agents/remote ne cassent pas le writer Track. |
| `WP-GOV` | Pilotage Track, décisions et reporting | Structure Track, décision dossiers, focus HTML, règles de statuts/signoff, reporting now/week/month/project, migration/reparenting, vues client et audit de drift. | **A propriétaire/conducteur**. **R immo-conductor** pour Track. **C geo/platform/product** selon décisions. Aucun write Track sans writer désigné. | Track répond aux quatre questions temporelles, chaque item appartient à un seul WP, les décisions ouvertes ont owner/critère, et le rendu `track focus --format html` est client-présentable. |

## 6. Modèle de todo interne

### Statuts fermés

**[PROPOSITION]** Les feuilles de travail doivent utiliser exactement ces statuts métier, projetés depuis/vers Track:

| Statut cible | Sens | Mapping Track actuel proposé |
|---|---|---|
| `planned` | Travail accepté mais non commencé. | `realization=to-do`, `bucket=TO-DO` ou `AWAITED` sans dépendance active. |
| `in_progress` | Travail activement piloté cette semaine ou maintenant. | `realization=in-progress`. |
| `blocked` | Travail impossible sans fait externe, décision, dépendance ou accès. | Item avec blocker explicite ou `AWAITED` dont la dépendance n'est pas satisfaite. |
| `needs_review` | Travail livré localement ou en PR mais pas signé. | `realization=done` avec `acceptance=unknown/stale` et `signoff=pending`; ou bucket `AWAITED` quand le code est done mais non validé. |
| `done` | Critère de complétude atteint et signoff requis satisfait. | `realization=done` + `acceptance` non stale + `signoff=signed` ou `not_required`. |
| `dropped` | Abandonné explicitement; ne compte plus dans le restant. | `realization=cancelled`, `bucket=DROPPED`, avec raison et éventuel remplacement. |

**[PROPOSITION]** Les buckets Track actuels (`TO-DO`, `AWAITED`, `DONE`, `DROPPED`) restent l'état brut Track, mais la vue client ne doit pas afficher `AWAITED done` comme "fait": elle doit l'afficher `needs_review` tant que le signoff n'est pas clair.

### Signoff fermé

| Signoff | Sens |
|---|---|
| `not_required` | Item technique interne sans validation humaine nécessaire. |
| `pending` | En attente de revue propriétaire, client, pair ou autre WP. |
| `signed` | Accepté explicitement; peut compter comme livré. |
| `rejected` | Revoyé et refusé; retourne en `planned/in_progress/blocked` selon cause. |

### Axes de focus

**[PROPOSITION]** Les axes ne sont pas des WPs. Ils filtrent les mêmes items selon la démonstration recherchée.

| Axe | Définition proposée | Usage |
|---|---|---|
| `30` | Villes prioritaires/démo opérationnelle. | Répond "que montre-t-on vite et avec couverture assez large". |
| `33` | Opportunités E2E à prouver. | Répond "quels dossiers ont signal, PDF, zone, lot, grille et score cohérents". |
| `1105` | Couverture provinciale complète des municipalités. | Répond "est-ce industrialisable depuis le départ vers tout le Québec". |

**[HYPOTHÈSE]** L'utilisateur nomme `1105`, tandis que `/home/antoinefa/src/radar-immobilier/docs/spec/data-division-immo-geo.md` mentionne `municipalities.qc.json` avec 1106 entrées (ligne 55). Le nom de l'axe doit rester `1105` si c'est la convention owner, mais le nombre exact doit être tranché.

### Échelle temporelle

| Échelle | Règle |
|---|---|
| `now` | 3 à 7 items maximum, activement travaillés, avec owner et prochain pas. |
| `week` | Tout ce qui doit passer `done`, `needs_review` ou `blocked` avant fin de semaine. |
| `month` | Lots internes qui changent la capacité produit ou la démo client du mois. |
| `project` | Tout l'historique depuis le départ, incluant `DONE` et `DROPPED`, rollup par WP. |

### Forme recommandée d'un todo Track

**[PROPOSITION]** Chaque item feuille doit porter, dans son corps ou ses critères Track, un bloc structuré lisible par humain et par projection:

```yaml
wp: WP-REC
sub_lot: evidence-chain
status: in_progress
signoff: pending
focus_axes: [33, 30]
time_scale: week
raci:
  accountable: immo
  responsible: [immo, geo]
criteria:
  - "Signal has source PDF rawRef and citation page/bbox"
  - "Zone and lot projection reconciled or marked non-disponible"
  - "Client-visible fallback is honest"
```

## 7. Portage Track et relation Track <-> PostgreSQL

### Portage Track

**[PROPOSITION]** La migration doit être préparée comme décision dossier, pas comme réécriture silencieuse.

1. Créer un dossier de décision `tracking-structure-v1` dans Track après approbation du propriétaire.
2. Y attacher ce rapport comme artefact de cadrage.
3. Créer 6 items parents `role:"workpackage"` correspondant à `WP-SIG`, `WP-GEO`, `WP-REC`, `WP-PROD`, `WP-PLAT`, `WP-GOV`.
4. Reparent chaque item existant vers exactement un WP ou un sous-lot; les items qui touchent deux WPs doivent être splités, pas multi-homés.
5. Ajouter les critères de complétude comme `criteria`/body structuré; le pourcentage est toujours calculé par Track à partir des feuilles, jamais maintenu à la main.
6. Utiliser `track focus <decision-id> --workspace <w> --format html` pour produire la vue client: top WPs, rollups, décisions ouvertes, focus `now/week/month/project`.

**[OBSERVÉ]** Aucune étape ci-dessus n'a été exécutée; ce rapport est volontairement lecture seule vis-à-vis de Track.

### Rendu `track focus --format html`

**[PROPOSITION]** Le rendu client doit exposer quatre panneaux stables:

| Panneau | Contenu |
|---|---|
| Maintenant | Items `timeScale=now`, groupés par WP, avec owner, statut, blocage, prochain pas. |
| Semaine | Done/to-do/blocked/needs_review de la semaine, plus signoff attendu. |
| Mois | Progression par WP et par axe `30/33/1105`, sans nouveaux WPs mensuels. |
| Depuis le départ | Rollup `done/remaining/dropped` par WP, décisions closes/ouvertes, critères de complétude. |

### Source de vérité Track vs PostgreSQL

| Donnée | Source de vérité | PostgreSQL | Track |
|---|---|---|---|
| WPs, todos, statuts, signoff, décisions | Track | Projection lecture pour kanban, filtres, rollups rapides. | Autorité append-only. |
| Données produit: villes, lots, zones, signaux, opportunités, prospects | PostgreSQL/S3 selon domaine | Autorité applicative ou projection reconstructible depuis S3. | Références d'avancement seulement, jamais source métier. |
| Raw documents/PDF/transcripts | S3/Object storage | Index, métadonnées, refs. | Critères et preuves de travail, pas stockage document. |
| Kanban UI | Projection PostgreSQL dérivée de Track | Tables `track_items_projection`, `track_wp_rollup`, `track_focus_cache` régénérables. | Source canonique des événements. |
| Actions utilisateur dans le kanban | Track via writer désigné | Queue d'intention si l'UI ne peut pas écrire Track directement. | L'écriture réelle doit passer par le mécanisme Track autorisé. |

**[PROPOSITION]** PostgreSQL ne doit jamais permettre de changer silencieusement le statut canonique d'un todo. Une action UI peut créer une intention (`track_write_requests`) ou appeler un service writer autorisé, mais l'état affiché doit revenir de la projection Track.

## 8. Table de migration: chaque thème Track existant -> nouveau WP/sous-lot

**[OBSERVÉ]** Les thèmes ci-dessous sont exactement les 14 workspaces observés dans `track query --format json`.  
**[PROPOSITION]** La colonne cible indique la destination de migration. Quand un workspace est mixte, la ligne donne la règle de split à appliquer item par item.

| Workspace existant | Items | Nouveau WP/sous-lot | Règle de migration | Notes / exemples observés |
|---|---:|---|---|---|
| `frontA-data` | 12 | Split `WP-SIG.acquisition-textuelle`, `WP-GEO.sources-foncieres`, `WP-PROD.data-quality` | PV, avis, YouTube, Obscura hard scrape -> `WP-SIG`; zonage, rôle, city registry -> `WP-GEO`; data quality view -> `WP-PROD` avec dépendances `WP-GEO/WP-SIG`. | `01KTQP5F0D6...` PV -> `WP-SIG`; `01KTQQB24...` zonage -> `WP-GEO`; `01KVB9MZ7...` data quality -> `WP-PROD`. |
| `frontA-viz` | 15 | `WP-PROD.navigation-carte-ds` | Vues, filtres, selection bucket, AppShell/header, URL state -> `WP-PROD`. Les bugs purement DS restent sous ce sous-lot produit car ils affectent la présentation client. | A.1 vues Signaux/Opportunités/Évaluation/Sources, P1 DS alignment, P2 selection bucket UX. |
| `frontA-infra` | 8 | Split `WP-PLAT.runtime-auth-agents`, `WP-GOV.track-ui` | Auth, remote, graph DB, admin, deploy support -> `WP-PLAT`; suivi backlog Track quand source de vérité -> `WP-GOV` avec support plateforme. | `01KW2KS65...` auth -> `WP-PLAT`; `01KTQP5FA...` orchestration agents + suivi Track -> split `WP-PLAT/WP-GOV`. |
| `frontB-geo` | 8 | Split `WP-REC.projection-geo-preuve`, `WP-GEO.owners-loi25`, `WP-PROD.geo-bugs` | E2E zone-lot/PDF/33 opportunités -> `WP-REC`; propriétaires lots Loi 25 -> `WP-GEO`; bugs affichage carte zones/lots -> `WP-PROD` si pure UI. | `01KW5N0Z...` -> `WP-REC`; `01KW5RXJ...` -> `WP-GEO`; bugs filtres/accordéon/highlight -> `WP-PROD`. |
| `reorientation` | 25 | Split par contenu: `WP-GOV`, `WP-PLAT`, `WP-PROD`, `WP-SIG`, `WP-REC` | Le pivot grand filet documente la direction -> `WP-GOV`; L1-L6 S3/rebuild/worker -> `WP-PLAT`; CS-L/CS-P UI Steve -> `WP-PROD`; parsing graphify -> `WP-SIG`; CS-L6/parité/bootstrap Steve -> `WP-REC` ou `WP-PROD` selon critère. | `01KTQP5EH...` pivot -> `WP-GOV`; `01KTT2X4...` S3-first -> `WP-PLAT`; CS-L1..L5 -> `WP-PROD`; `01KTWQEH...` -> `WP-SIG`. |
| `wp4-sources` | 8 | Split `WP-SIG.sources-municipales`, `WP-GEO.sources-geo` | Sources PV/avis et exploitation mentions -> `WP-SIG`; rôle MAMH, Adresses Québec, règlements/zonage acquisition -> `WP-GEO`; raw/S3 substrate peut référencer `WP-PLAT`. | Source #3 rôle MAMH -> `WP-GEO`; source #4 Adresses -> `WP-GEO`; source #5 règlements/Zone mentions -> split `WP-GEO/WP-SIG`. |
| `wp4-pipeline` | 3 | `WP-SIG.pipeline-recueil-exploitation` | Ciblage, déclenchement recueil/exploitation, bug accumulation sources -> `WP-SIG`; dépendances runtime -> `WP-PLAT`. | `01KTNXDJ31...` pipelines exécutables; `01KTP0JX...` bug executor multi-sources. |
| `wp5-ontology` | 18 | Split `WP-SIG.graphify-ontology`, `WP-REC.evidence-chain` | Graphify extraction/ontology/version/performance -> `WP-SIG`; citations, PDF, rawRef, viewer, proof consolidation -> `WP-REC`; legacy redo dropped reste `dropped` sous `WP-SIG`. | `01KVB478...` Graphify v2.3 -> `WP-SIG`; `01KW2KS5S...` preuve -> `WP-REC`; `01KVB2FB12...` dropped legacy -> `WP-SIG.dropped`. |
| `wp6-platform` | 2 | `WP-GOV.track-projection` | Backlog <-> Track et auto-refresh sidecar sont gouvernance/projection Track; l'implémentation technique dépend de `WP-PLAT`. | `01KTNXDJ6...`, `01KTQ1DR...`. |
| `evdoc-branch-feat-evidence-doc-cards` | 8 | `WP-REC.document-evidence-ui` | Les cartes documentaires, API document, PDF overlay et notes de gate servent la chaîne preuve; si l'UI est pure présentation, elle reste sous `WP-REC` comme surface de preuve. | Evidence-backed signal document cards, API evidence DTO, UI card/PDF overlay. |
| `infra` | 1 | `WP-PLAT.deployment` | Déploiement k8s/sentropic -> plateforme. | `01KTNXDJ7...` déploiement. |
| `WP B` | 1 | `WP-REC.zone-lot-priority-detections` | Ancien workspace propriétaire; l'item porte la sélection zones/lots pour détections prioritaires. | `01KVB67H...` Geo selection zones/lots. |
| `WP A.3` | 1 | `WP-PROD.data-quality-admin` | Vue data quality/admin est une surface produit/admin; ses données viennent de `WP-GEO/WP-SIG`. | `01KVB67M...` Data quality and admin validation views. |
| `meta-track` | 1 | `WP-GOV.track-recalage` | Recalage Track, drift et consolidation -> gouvernance Track. | `01KW2KS5K...` Recalage Track drift post-2026-06-23. |

**[PROPOSITION]** Aucun workspace observé ne reste sans cible. Les splits item par item doivent être ratifiés avant écriture Track, puis appliqués via `track item reparent` et éventuels items splités.

## 9. Décisions ouvertes à trancher

1. **Sommet à 6 WPs ou 5 WPs ?**  
   Recommandation: garder `WP-GOV` séparé de `WP-PLAT`, parce que Track/reporting client est une gouvernance de portefeuille, pas une infra runtime. Ce qui l'invaliderait: si le propriétaire ne veut jamais exposer Track au client et veut réduire le sommet à 5 lignes.

2. **Convention exacte de l'axe `1105`.**  
   L'utilisateur demande `1105`; la doc RACI mentionne `municipalities.qc.json` avec 1106. Décider si `1105` est une convention de pilotage, une exclusion connue, ou un nombre à corriger.

3. **Owner final de `WP-REC`.**  
   Recommandation: `immo` accountable pour la vérité d'opportunité, `geo` responsible pour projection spatiale. Ce qui peut changer: si `geo` accepte de porter toute la preuve PDF liée zones/lots en owner principal, avec immo seulement consulted sur sémantique signal.

4. **Écriture Track depuis UI kanban.**  
   Recommandation: Track reste source de vérité; Postgres ne porte qu'une projection et une queue d'intentions. À trancher: faut-il un writer service autorisé, ou garder toutes les mutations Track manuelles via CLI/conducteur.

5. **Statut des items `AWAITED` dont `realization=done`.**  
   Recommandation: les afficher `needs_review` tant qu'il manque le signoff, au lieu de les compter comme "done" dans les vues client. À trancher: qui signe ces items et avec quel critère.

6. **Traitement des propriétaires de lots.**  
   Recommandation: `WP-GEO.owners-loi25`, gated auth/Loi 25, jamais dans la carte publique par défaut. À trancher: niveau d'ambition commercial et acceptable légalement.

