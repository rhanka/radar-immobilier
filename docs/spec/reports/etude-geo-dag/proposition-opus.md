# Proposition opus : transfert PV et signaux vers un DAG managé dans geo

Auteur : opus, effort maximal, proposition indépendante (la proposition muse n'a pas été lue). Date : 2026-10-31.
Sources lues sur `origin/main` uniquement : radar `d25eb5ac2`, geo `22d74b52`, sentropic (cluster-mesh `0.25.0-dev.1`),
engram `0.23.0`. Les checkouts locaux de geo, h2a, graphify et sentropic sont en retard de 960 à 10 028 commits : rien n'a été lu dans ces arbres.
Légende : `[F]` = vérifié dans le code ou un document daté ; `unverified` = non prouvé ; `[J]` = jugement d'auteur.

## A. État actuel, chiffré

**Ce qui tourne dans radar** `[F]` (`deploy/k8s/34-refresh-cronjob.yaml`, `api/src/scripts/refresh-pv.ts`) :
- **CronJob `radar-refresh-pv`** (`--all`), lancé 4 fois par jour. Prod : 05, 11, 17 et 23 h UTC ; préprod : 00, 06, 12 et 18 h.
  - Bornes : `activeDeadlineSeconds` 19 800 s, arrêt propre à 5 h 15, `backoffLimit: 0`.
  - Un seul pod : 50 à 150 m CPU, 512 Mi à 1,5 Gi.
  - Le pod tient un `flock` sur un PVC keyring RWO (des sièges Codex et Cloud Code, chiffrés).
- **Le balayage traite les villes une par une**, sur environ 528 villes « config-only », et reprend au curseur S3 `refresh/018/sweep/cursor.json`.
  - Pour chaque ville : RECUEIL sur 183 jours, avec un espacement de 1,7 à 2,3 s entre requêtes, puis au plus **1 document extrait par passage**.
  - Les étapes durables sont `corpus → profile → candidate → enriched → published → projected` (`refresh-state.ts`).
  - L'extraction utilise Engram `0.21.2` (`buildProfileChunkPrompt`, `validateProfileExtraction`, `mergeExtractions`) avec le profil `radar/ontology/ontology-profile.yaml` (ontologie 2.2, 9 types de nœuds).
  - Les modèles passent par llm-mesh `0.19.2`, en bibliothèque dans le pod : `gpt-6-astra` medium en principal, `gemini-3.8-flash` low en repli et en vérification (« removal-only »).
  - La publication écrit `graph/<ville>/latest.json` sous garde (If-Match + archive). La projection passe par `upsertGraphAtomic`, seul écrivain de `graph_nodes`/`graph_edges`.
  - La traçabilité tient dans une ligne `refresh_document_outcomes` par document, avec un `cycle_id`.
- **Gardien `radar-refresh-pending-watchdog`**, toutes les 5 min : il supprime un pod resté Pending plus de 15 min.
  - Il existe à cause de l'incident du 2026-10-09 : deux pods prod et préprod ont attaché le même keyring RWO en même temps, et sont restés **Pending 4 h 30**.
- **À côté** : `radar-populate-geo-daily` (04:17 Toronto) et le Job `run-geo-mapper` (Signal → zone/lot dans `geo_resolutions`).
  - Ce sont des minuteries indépendantes, sans dépendance entre elles (`docs/architecture.md` §3).

**Volumétrie** :
- Villes : 528 balayées, dont 93 sources cassées au dernier balayage complet ; run r3 du 2026-09-05 : `new:351 seen:84 errors:93` ; baseline de 19 906 sha de PDF sur 436 villes `[F]`.
- Signaux : « 1 141 nœuds / ~197 villes » selon un commentaire non daté de `graph-signals.ts` (`unverified`) ; vivier B d'environ 914 signaux sur 341 villes (corpus historique) `[F]`.
- Geo : 5 492 PV indexés sur 640 villes (ADR-0023, juillet) ; 1 062 villes sur 1 106 avec un index PV (2026-07-26) ; `registry/role-foncier/<slug>.parquet` pour environ 1 102 municipalités `[F]`.

**Durée des passages** : la fourchette de 2 à 5 h vient de l'owner. Les mesures disponibles sont partielles :
- 2 h 41 pour l'acquisition des 528 villes, mesurée sur le **proxy** `worker-live` ; environ 80 min pour son run r4 `[F]` ; 1 h 30 à 4 h observées selon le coordinateur (`unverified`).
- Coût LLM par document, en p50 : 147,8 s pour Astra low et 15,3 s pour Gemini low `[F]` ; Astra medium n'est pas mesuré (`unverified`).
- `[J]` La durée vient de deux files séquentielles : l'acquisition (index plus téléchargements espacés de 2 s) et les appels LLM (environ 2,5 min par document, l'un après l'autre).

**Points faibles** :
1. **Tout est séquentiel dans un seul pod.** Le keyring RWO plus le `flock` imposent un singleton, donc aucune parallélisation possible.
2. **RECUEIL retélécharge les documents de la fenêtre** : le HEAD-skip n'intervient qu'après le téléchargement (`refresh-run.ts`, commentaire `windowDays`).
3. **Un seul document par ville et par passage**, donc un arriéré se vide en plusieurs jours.
4. **Le quota mémoire du namespace** ne laisse que 768 Mi de marge. Le refresh et un surge HPA de `radar-api` s'excluent mutuellement (`deploy/ci/README.md`).
5. **Le pic RSS du refresh n'a jamais été mesuré.**
6. **Les villes `no-baseline`** (sans graphe canonique) ne sont jamais rafraîchies. Leur nombre n'est pas connu (`unverified`).
7. **Les mêmes sites municipaux sont scrapés deux fois** : par la capture PV de geo (`raw/pv-index/cas/`) et par RECUEIL côté radar.
   - Radar lit pourtant déjà les PDF dans le S3 de geo (`GEO_DOCUMENTS_REPOINT=1`).
8. **Deux ontologies PV coexistent** : geo utilise graphify `^0.17.1` avec un profil Document/CouncilSession, radar utilise Engram 0.21.2 avec le profil 2.2.
9. **L'armement prod** dépend de la variable `REFRESH_CRONJOB_PROD_ENABLED`. Son état actuel n'est pas vérifié (`unverified`).
10. **Côté geo, sur main** `[F]` :
    - seul le DAG `pv-canary` existe ; les routes `/v1/refresh` ne sont pas montées dans geo-api ;
    - aucun refresh d'index PV n'est planifié ;
    - l'étape PV → événements lit des fichiers locaux `work/coverage/` ;
    - le canari s3-dag n'est pas prouvé (`unverified`) ;
    - le contrôleur de capture plafonne à 18 Jobs (10 actifs par défaut).

**Décisions déjà écrites qui encadrent ce transfert** `[F]` :
- **Geo, ADR-0023 (2026-07-30)** : « geo possède l'acquisition, l'indexation et le service des événements de PV ; immo reste consommateur ».
- **Record owner du 2026-09-25 (geo `docs/decisions.md`)** : « à terme on reversera les job de pv d'immo vers geo », avec la même politique de modèle que le refresh immo.
- **En sens contraire**, radar `SPEC_EVOL_REFRESH_018` (« Immo owns acquisition, … grounding, canonical publication ») et `docs/architecture.md` (« not a handoff of PV acquisition to Geo ») : à amender par un ADR (lot L0).

## B. Architecture cible

**Principe** `[J]` : geo exécute toute la chaîne **document → détection** et le **croisement géographique et foncier**. Radar garde ce qui touche son produit :
- la **fusion canonique** et la **projection PostgreSQL**, sous garde ;
- les facets (annotations utilisateur liées aux identifiants de nœuds) ;
- le scoring et l'interface.

Ce partage respecte ADR-0013 et ADR-0023 : geo n'écrit jamais `graph_nodes`.

**Le DAG `pv` dans geo** est défini avec `@sentropic/s3-dag` (`defineDag`, état S3, un Job k8s idempotent par nœud, lease, quota). L'orchestrateur custom a été ratifié contre Argo (D-moteur-1, `MIGRATION_D1_SYNTHESIS.md`). Les nœuds, par ville et par document :

| Nœud | Rôle | Reprend | Idempotence |
|---|---|---|---|
| `detect` | diff de l'index PV : documents nouveaux, ou dus selon le registre de couverture | `registry/qc-pv/<slug>/index.json`, `refresh-coverage.ts` | hash de l'index |
| `capture` | octets CAS + sidecar, téléchargement **conditionnel** (ETag ou URL déjà vue avant GET) | capture geo + `recueil.ts` | sha256 |
| `text` | pdftotext, OCR `/v1/ocr` si nécessaire (ADR-0024) | `refresh-corpus.ts` | `inputHash` |
| `extract` | profil Engram + modèle principal ou repli | `refresh-profile.ts`, `refresh-model-policy.ts` | identité `{doc, profileHash, engramVersion, modelPolicy}` |
| `verify` | passe removal-only (`v101b-removal-only-v3`) | `refresh-verification.ts` | hash de l'extraction |
| `join` | Signal vers lot (NO_LOT et matricule du rôle), zone (`zone_ref`, jointure lot∩zone), contraintes | `run-geo-mapper.ts`, `lotZoneJoin.ts`, `role-foncier` | hash des entrées |
| `promote` | ajout au contrat `pv-signals/v1` et au pointeur CAS `latest.json` | modèle `geo-served-contract` | If-Match |

- **Parallélisme** `[J]` : `concurrencyKey = hôte source` pour `capture`, ce qui garde la politesse d'1 requête par 2 s par hôte tout en traitant plusieurs villes en même temps. `extract` est borné par le nombre de sièges LLM du gateway, `join` par le quota du namespace (environ 6 pods).
- **Rôle de cluster mesh** (vérifié en `0.25.0-dev.1`) : c'est une **bibliothèque de plan de contrôle**, pas un moteur de DAG.
  - Elle ne fournit ni cron, ni DAG, ni file durable. Sa messagerie M01 est locale au processus et perdue au redémarrage `[F]`.
  - Je lui attribue :
    - la **sortie LLM** : les nœuds `extract` et `verify` appellent le `/gw` composé avec `@sentropic/llm-gateway` 0.22.2 (« pooled, metered »), au lieu du keyring sur PVC ;
    - l'**identité NHI** de chaque service account de lane, avec token exchange (déjà prévu dans `s3-dag/src/identity.ts`) ;
    - l'**exposition MCP** du read-model de supervision (immo-mcp enveloppe déjà cluster-mesh 0.22.1).
  - L'orchestration, la file (l'état S3 de s3-dag) et la distribution (Jobs k8s plus quota) restent dans s3-dag.
- **Rôle d'Engram** : c'est le **moteur d'extraction typée** (prompts de profil, validation d'ontologie, fusion d'extractions, candidats de réconciliation, patches d'ontologie relus).
  - Le **profil d'ontologie reste la propriété de radar** (ADR-0013). Radar le publie comme artefact versionné (digest) et geo l'épingle dans l'identité de run.
  - La persistance des annotations n'appartient pas à Engram : elle relève de Sentropic (décision G3) et reste dans les facets radar.

**Contrat de données geo → radar**, sous `s3://sentropic-geo/exports/immo/pv-signals/v1/` (préprod : `sentropic-geo-preprod`) :
- `latest.json`, avancé uniquement par CAS : `{contract_version, generated_at, run_id, profile_digest, engram_version, cities:{slug:{revision, set_hash}}}`.
- `cities/<slug>/<revision>.json` : la liste des documents. Chaque entrée porte :
  - `doc_sha`, `source_url`, `published_at`, `pages` ;
  - `extraction_key` et `extraction_hash` (Extraction Engram vérifiée, ou fragment v2.3) ;
  - `model_receipts` (provider, modèle, effort, statut de repli et de vérification, tentatives, latence) ;
  - `coverage_state` (`covered|pending|abandoned`) ;
  - les jointures `{lot_key, zone_code, role:{matricule, valeur, usage}, method, unresolved_reason}`. Les données du rôle excluent le propriétaire (Loi 25).
- Les identifiants de nœuds restent les **clés naturelles `::` actuelles**. C'est la condition pour que les facets survivent à la bascule.
- La supervision passe par `/v1/refresh/{overview,runs,freshness}` de s3-dag (`http.ts`). Ces routes existent mais ne sont pas encore montées dans geo-api : à faire en L3. La fraîcheur y est mesurée au dernier artefact promu, pas au dernier Job vert.
- L'identité s'appuie sur la carte C1 `s3dag-c1-identity-workspace-map.json` (1 tenant `geo`, workspace `geo-pv`, « FORMAT/CONTRAT = mesh »). Le gateway peut ainsi rattacher un pod de lane à son budget.

**Ce que radar consomme** : un CronJob léger `radar-pv-consume`, sans scraping et sans LLM.
- Il lit le delta de `latest.json`, puis rejoue les étapes existantes `enriched → published → projected`.
- Le reste ne change pas : écrivain canonique sous garde, `upsertGraphAtomic`, `refresh_document_outcomes` (alimenté depuis `model_receipts`), et les PDF lus depuis `raw/pv-index/cas/` de geo.
- `geo_resolutions` est alimenté à partir de `join`, ce qui retire le Job `run-geo-mapper`.

## C. Fonctions complémentaires demandées

**À cluster mesh (sentropic)** :

| # | Fonction | Justification |
|---|---|---|
| CM1 | Profil **batch** du `/gw` déployable en k8s : un pool de sièges Codex et Cloud Code, appelable par un service account de lane via token exchange | supprime le keyring RWO singleton (incident du 2026-10-09) et permet N Jobs `extract` en parallèle. Le support des runtimes Codex et Cloud Code par llm-gateway n'est pas vérifié (`unverified`) |
| CM2 | **Budget, quota et coupe-circuit par appelant** (lane), avec un circuit 429 partagé entre les workers | aujourd'hui une seule instance de politique en mémoire épargne le principal voué au 429 ; avec N pods il faut un état commun |
| CM3 | **Reçus d'usage** par appel (tokens, coût, modèle, latence) exportables | il n'existe aucun registre de coûts ni dans Engram ni dans cluster-mesh `[F]`, alors que les rapports de coûts mensuels en ont besoin |
| CM4 | **Namespace MCP de supervision** branché sur le read-model s3-dag | donne aux agents et à immo-mcp l'état de fraîcheur sans droits k8s |
| CM5 | **Attest et offboard NHI** des service accounts de lane, avec audit | l'identité dédiée exigée par s3-dag devient réelle |
| CM6 | (optionnel) **Messagerie durable** de type « contrat promu », qui survit à un redémarrage | réveil de `radar-pv-consume`. En repli, le polling du pointeur suffit |

**À Engram** :

| # | Fonction | Justification |
|---|---|---|
| EN1 | Champ **excerpt verbatim** dans `OntologyCitation` (`{docSha, page, excerpt}`) | radar l'ajoute lui-même aujourd'hui (`SPEC_CITATIONS` : « no quote field ») ; le grounding doit devenir portable vers geo |
| EN2 | Rendu des `properties` et `extraction_hints` du profil dans `buildProfileChunkPrompt` | écart connu ; sans lui, geo devrait recopier l'enveloppe de prompt de radar |
| EN3 | `mergeExtractions` qui **préserve les citations** (union des références sur une entité dupliquée) | aujourd'hui la dernière écriture gagne, donc des citations sont perdues |
| EN4 | **Registre de couverture documentaire** en port de bibliothèque, clé `docSha × profileHash`, stockage S3 injecté | la même sémantique `covered/pending/abandoned` côté geo et côté radar |
| EN5 | **Vérification removal-only** comme fonction de bibliothèque | sort `refresh-verification.ts` de radar, et le même contrat sert aux deux dépôts |
| EN6 | **Bundle de profil** avec digest (profil + registres), via `./registry/manifest` | permet d'épingler `profile_digest` dans l'identité de run et dans le contrat |
| EN7 | Aide à la convergence du profil PV de geo (graphify 0.17.1) vers le profil 2.2 de radar | évite deux ontologies PV divergentes |

**À s3-dag (geo, interne)** :
- `concurrencyKey` par hôte (à vérifier dans `dag.ts`) ;
- un fan-out dynamique par document (l'Indexed Job du canari ne gère que des shards fixes) ;
- la fin de la phase 1b (les 4 preuves owner) et le montage de `/v1/refresh` ;
- l'étape PV → événements doit lire S3, plus aucun fichier `work/` local.

## D. Migration par lots, sans interruption pour radar

| Lot | Contenu | Coexistence | Bascule | Retour arrière |
|---|---|---|---|---|
| L0 | ADR croisé geo et radar : amender `SPEC_EVOL_REFRESH_018` et l'architecture radar, fixer la propriété du profil, clarifier le terme « cluster mesh », figer le contrat `pv-signals/v1` | rien ne change | GO owner | sans objet |
| L1 | Radar passe à Engram 0.23 ; non-régression sur `refresh-018` et sur le benchmark v101b (100 documents, 674 unités) | le refresh reste en place | merge | repin 0.21.2 |
| L2 | CM1 à CM3 qualifiés en préprod avec un Job unique ; le refresh radar reste sur le keyring | double chemin LLM | flag `REFRESH_LLM_TRANSPORT=gateway` | flag `keyring` |
| L3 | DAG geo `detect → capture → text` en **ombre** sur les 528 villes ; KPI de parité des ensembles de sha comparé à RECUEIL | radar inchangé | aucune | arrêt du DAG |
| L4 | `extract → verify → promote` en ombre, en préprod ; `radar-pv-consume` en **dry-run** compare les graphes produits aux canoniques radar | double coût LLM, limité à un échantillon de villes et au benchmark | aucune | arrêt |
| L5 | Bascule en préprod **par cohortes de villes** : allowlist `PV_SOURCE=geo-contract`. `radar-refresh-pv` exclut ces villes et continue sur les autres | les deux producteurs, avec un ensemble de villes disjoint | la cohorte s'élargit | retrait de la ville de l'allowlist ; archive de pré-image du canonique |
| L6 | Prod, mêmes cohortes, GO owner à chaque palier | idem | idem | idem |
| L7 | Nœud `join` (rôle, lot, zone) ; `geo_resolutions` alimenté par le contrat ; `run-geo-mapper` en ombre puis retiré | double calcul | flag | réactivation du Job |
| L8 | Retrait de `radar-refresh-pv`, du gardien, du PVC keyring et du code RECUEIL côté radar ; les adaptateurs PV migrent vers `qc-sources` de geo | aucune | après une période sans retour arrière (durée fixée par l'owner) | redéploiement du tag précédent |

- **Ordre ferme** :
  - pas de L5 avant le seuil de parité de L4, fixé par l'owner ;
  - pas de L8 tant qu'une ville reste hors allowlist ;
  - les facets doivent rester attachées : test obligatoire en L4 que les identifiants `::` produits par geo sont égaux à ceux de radar.
- **Make uniquement, avec ENV en dernier argument** :
  - côté radar : `make pv-consume-render ENV=preprod`, `make pv-consume-apply ENV=preprod`, `make pv-consume-diff ENV=preprod` (cibles à créer, à l'image de `refresh-018.mk`) ;
  - côté geo, le Makefile actuel n'expose que `k8s-*` ; il faut ajouter `make pv-dag-render|apply|status ENV=…` (voir F).

## E. Risques, coût et effort par lot

Effort `[J]` en jours-agent ; S ≤ 3, M ≤ 10, L ≤ 20. Aucune mesure ne fonde ces estimations.

| Lot | Effort | Coût de run | Risque principal |
|---|---|---|---|
| L0 | S | 0 | arbitrage de propriété (ontologie, détection) contesté entre radar et geo |
| L1 | S–M | benchmark LLM ponctuel | régression d'extraction entre Engram 0.21 et 0.23 |
| L2 | M (sentropic) | 0 de plus | ToS des sièges (passthrough personnel, pas de pooling entre utilisateurs) ; texte des PV qui traverse le gateway (`unverified`) |
| L3 | M | CPU geo, 0 LLM | phase 1b de s3-dag non prouvée ; politesse envers les sites pendant le double scraping |
| L4 | L | **double LLM** sur l'échantillon | écart de qualité ; identifiants `::` instables, donc des facets orphelines |
| L5–L6 | M | baisse progressive du coût radar | quota partagé (3 nœuds b3-8, environ 6 pods geo) ; dérive de la cohorte |
| L7 | M | faible | taux de résolution lot/zone ; l'estimation de 70 à 85 % (cadrage D2/G6) n'est pas vérifiée (`unverified`) |
| L8 | S | gain : 1 pod, 1 PVC et 1 gardien en moins | suppression prématurée de code |

- **Risques transverses** :
  - **Repli si s3-dag échoue aux 4 preuves** : CronJob auto-pilote du type `pv-capture-backlog`, ou Argo (repli documenté).
  - **Fichier Python** : `build-municipal-directory.py` est versionné dans geo, hors des jobs, mais il contredit la règle « 0 Python ».
  - **Engram s'oriente vers la mémoire d'agent** : les demandes EN1 à EN7 risquent d'être reléguées.
- **Gain attendu en durée** `[J]` : passer de 2 à 5 h séquentielles à un temps borné par les sièges et les hôtes en parallèle ; non mesuré, à mesurer en L3 et L4 (`unverified`).

## F. Questions ouvertes

**Pour l'owner** :
1. Que recouvre « cluster mesh » : la bibliothèque `@sentropic/cluster-mesh`, le gateway LLM, ou une fédération inter-clusters (CNI ClusterMesh) ? Les documents geo jugent déjà le terme ambigu.
2. La **détection** (Extraction validée) passe-t-elle chez geo, alors que l'ontologie reste chez radar ? Ou bien le profil devient-il un artefact partagé ?
3. Quel seuil de parité autorise la bascule (sha capturés, F1 sur l'oracle v101b, nombre de signaux par ville) ?
4. Quel budget LLM est accepté pour la double exécution en ombre (L4), et sur quel échantillon ?
5. Quel est l'état réel de l'armement du refresh en prod (`REFRESH_CRONJOB_PROD_ENABLED`) ?
6. Le gateway peut-il porter des sièges personnels Codex et Cloud Code dans un pool batch (ToS, D-moteur-2 encore ouvert) ?

**Pour geo** :
7. Quel est l'état réel de la phase 1b de s3-dag (le canari `s3dag-pv-reconciler` a-t-il prouvé les 4 preuves) ?
8. `concurrencyKey` et le fan-out dynamique par document existent-ils dans `dag.ts` ?
9. Geo accepte-t-il d'abandonner son profil PV graphify 0.17.1 au profil 2.2 de radar, et de monter de version vers Engram 0.23 ?
10. Geo adopte-t-il Make avec ENV en dernier argument pour les cibles du DAG PV ?
11. Les 93 sources radar cassées et les villes `no-baseline` sont-elles couvertes par la capture geo (1 062 index) ?
12. Que contient la base PostGIS de geo (`unverified`) ? Le rôle d'évaluation reste-t-il en parquet S3 ?
