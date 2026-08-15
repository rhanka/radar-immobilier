# Second review indépendant — plan (revue owner) 12-août (GPT-5.6 Sol xhigh)

> Passe §10.3. Lecture seule. Run `.h2a/runs/sol_steve_review`. Contre plan `615007c` + spec `8b85003`.

# Verdict : DIVERGE

Blocages durs :

- S00 ne ferme pas toutes les voies de mise en production : tags `:latest`, CronJobs avec `imagePullPolicy: Always`, déploiement GitHub Pages, workflows manuels non protégés, commandes `kubectl`/Makefile et chemins cross-repo.
- Aucune branche ne porte explicitement l’activation production du refresh quotidien après validation propriétaire.
- La preuve Sutton « production-rendered » exigée au §11 n’est assignée à aucune branche/gate précis.
- Plusieurs exigences sont seulement documentées, sans branche d’implémentation identifiable : collecte réglementaire, classes typées complètes, certaines politiques collaboratives.
- Les preuves proposées ne sont pas suffisamment liées à un digest, un corpus immuable et un environnement attesté pour être non contournables.
- La validation Geo, la résolution des désaccords, le suivi Track, puis la PR du plan convergé restent à faire.
- Le baseline opérationnel du plan est déjà périmé et doit être recalculé avant exécution.

Provenance : le plan correspond bien à `615007c`. La spec courante diffère de `8b85003` par un seul élargissement au §3.1 : `effet_densifiant` a été remplacé par « unrelated field behavior ». J’ai audité les deux versions ; ce delta rend P01 trop étroit aujourd’hui, sans constituer une invention rétroactive de la première passe.

## 1. Couverture exhaustive de la spec §1–§11

Légende : **C** = branche explicitement assignée ; **P** = partiel/sous-spécifié ; **NC** = aucune livraison clairement assignée.

| Exigence brute | Plan candidat | Verdict |
|---|---|---|
| §1 — préproduction | D01, D05, S01, S05 | **C**, sous réserve de définir comment l’isolation est attestée. |
| §1 — migrations CI sur fixtures production-shaped nettoyées | S02 | **P** : les tests sont prévus, mais leur intégration obligatoire à la CI n’est pas explicitement assignée. |
| §1 — rollback migration | S02, S05, G-P4, A01 | **C** en intention. |
| §1 — rollback applicatif répété | D01, S05, G-P4 | **P** : « documenté » et « joué » figurent dans les gates, mais aucune branche ne porte clairement le mécanisme et le test de rollback applicatif. |
| §1 — backups production planifiés, testés, restore drill | S03 | **P** : la source réellement « production-data », la cohérence applicative, RPO/RTO et le caractère isolé de la restauration ne sont pas explicités. |
| §1 — séparation acceptation préprod / autorisation prod | D01, G-P7/G-P8 | **C** conceptuellement. |
| §1 — confirmation humaine de tout déploiement prod | S00 | **P critique** : S00 ne couvre qu’un workflow CD. Voir §3 ci-dessous. |
| §2 — modèle et vues annotations/panier/archive/utilisateurs/collaboration | D02, C01–C04 | **P** : pas de vue utilisateurs/groupes explicitement assignée ; C01 paraît surtout backend. |
| §2 — réutiliser commentaires et annotations Sentropic | D02, C04, SNT1 | **P** : commentaires/chat sont nommés ; le module Sentropic d’annotation ne l’est pas. SNT1 ne concerne que le « comments host contract ». |
| §2.1 — cinq types de cible, pour annotation/sélection/archive | D02, C02, preuves sécurité | **P** : la matrice de preuve les couvre implicitement, mais aucun critère C02/C03/C04 n’énumère les 5 × 3 capacités. |
| §2.1 — références stables, typées, scoped, version-aware | C02 | **C**. |
| §2.2 — sélection + Markdown TipTap + privé/partagé groupes nommés | C01, C03 | **C**. |
| §2.3 — archive distincte, hide/deselect, raison obligatoire | C02, C03 | **P** : distinction et raison couvertes ; le comportement concret hide/deselect ne l’est pas. |
| §2.3 — archive personnelle et shared/all-users | décisions A2, C03 | **C**, sous décision propriétaire. |
| §2.3 — Signal comme premier cas | — | **NC** explicitement. |
| §2.3 — acteur/scope/raison/date/réversion visibles | C03 | **C**. |
| §2.4 — note autonome typée, ancre UI, threads/replies/follow | C04 | **C** au niveau de sortie. |
| §2.4 — six types initiaux à valider | D02/C04 génériques | **P** : aucun critère ne les énumère. |
| §2.4 — taxonomie, rétention, visibilité, notifications, historique, suppression, audit avant implémentation | D02, décisions A3, C02/C04 | **P** : notification et politique de follow sont peu spécifiées ; l’ordre « avant implémentation » dépend d’un gate narratif. |
| §2.5 — latest `chat-ui` | C04 | **P** : branche trop large et aucune stratégie de version/migration/compatibilité. |
| §2.5 — feedback MCP proactif, confirmation explicite, zéro écriture autonome | M01, M02 | **C**. |
| §2.5 — auth, validation, audit, état de confirmation, prompt contract | D02, M01/M02 | **P** : le contrat de prompt n’est pas un livrable explicite. |
| §3.1 — restaurer l’association signal/PDF et sa provenance | P01 | **C**. |
| §3.1 — empêcher toute substitution par un champ sans rapport | P01 limité à `effet_densifiant` | **P** contre la spec courante ; couvert contre `8b85003` seulement. |
| §3.2 — recherche lots et zones avec ranking/clavier/états | P04 | **C**. Sa dépendance à P01 n’a toutefois pas de justification fonctionnelle. |
| §4 — Saint-Stanislas, pipeline complet et test sur état réel | P02, D08 | **C**. |
| §5 — placement, icône, basemap/satellite, déplacement mesure | P05 | **C**. |
| §5 — conservation sélection et retrait des fills | P05 | **C**. |
| §5 — labels accessibles, clavier, persistance d’état | P05 | **P/NC** : absents de son acceptation principale. |
| §5 — attribution, licence, tuiles indisponibles | P05, décision B3 | **C**. |
| §6 — refresh Kubernetes quotidien, automatique, 1 000+ municipalités | F01, F02 | **P critique** : F02 s’arrête à la préproduction ; aucune branche d’activation production autorisée. |
| §6 — scheduling, idempotence, limits, retries, shards, locks, watermark, failures, observabilité, alertes, replay | F01/F02 | **P** : pagination explicite absente ; la plupart des autres points sont présents. |
| §6 — coûts/capacité | B1/B4, D05 indirectement | **P** : pas de critère F01/F02 mesurable. |
| §6 — safe deployment et production authorization | S00–S05, gates | **P** : la politique existe, l’exécution production manque. |
| §6 — prouver la fraîcheur, dont Saint-Rémi | preuves fraîcheur, A01 | **C** en intention, preuve encore circulaire ; voir §4. |
| §7 — section limitée aux règlements/normes, sans minutes | R01 | **C**. |
| §7 — correctif relation signal→zone→règlement | G01, R01 | **C**. |
| §7 — classes typées règlement/PDF/grille/preuve | D03 | **P critique** : D03 les spécifie, mais G01/R01 ne promettent pas clairement leur implémentation complète. |
| §7 — collecte réglementaire | D03 seulement | **NC** comme livraison d’implémentation identifiable. |
| §7 — provenance, qualité, relations, serving, présentation, MCP, erreurs | D03, D06, G01, R01 | **P** : bon découpage contractuel, mais absence de tests d’évolution fournisseur/consommateur et de branche de collecte. |
| §7 — distinguer toutes les absences et interdire l’inférence municipale | G01, R01, preuves | **C**. |
| §8 — corriger les quatre KPI nommés et ajouter le KPI moyen | D04, P03, P06 | **P** : les branches parlent de « chaque KPI » sans nommer les cinq livraisons ; Geo consistency peut exiger un producteur Geo non assigné. |
| §8 — source/définition/dénominateur/date/qualité/exclusions | P03/P06 | **C**. |
| §8 — ne pas présenter incomplet/estimé comme vérifié | P03, preuves KPI | **C**. |
| §9 — deep research Sol xhigh sur toutes les catégories candidates | D07 | **P critique** : D07 réduit d’avance l’étude à BDZI/GRHQ/CPTAQ. Aires protégées, terrains contaminés et autres options ne sont pas évalués explicitement. |
| §9 — autorité, licence, fréquence, CRS, résolution, couverture, limites, attribution, privacy, valeur produit | D07 | **P** : résolution, attribution, privacy et valeur produit manquent à sa sortie bornée. |
| §9 — pilote Warden avec Geo | G02, L01 | **C**. Warden est bien une municipalité connue du checkout. |
| §9 — custom layer par MCP pour une ville | G03, L02, L03 | **C**. |
| §9 — owner/share, provenance, auth, quota/rétention, review, rendu, suppression | G03, L02/L03 | **P** : le périmètre est présent, mais les dépendances à l’identité C01/C02 manquent. |
| §9 — jamais de promotion canonique implicite | G03, L02, preuves | **C** en intention. |
| §10.1 — vagues parallélisables | plan lui-même | **C**, mais parallélisme mal sécurisé ; voir §2. |
| §10.2 — passe Immo Sol + validation Geo distincte | provenance, D06/D07 | **P** : Immo revendiquée terminée ; Geo toujours non obtenue. |
| §10.3 — second review et résolution explicite des désaccords | présente revue ; §9 du plan | **P** : revue maintenant produite, mais aucune étape/branche de résolution et ratification n’est assignée. |
| §10.4 — Track chaque branche/dépendance/acceptation/owner/gate | tables du plan | **P/NC** : IDs non Track, owners génériques, dépendances et acceptations incomplètes. |
| §10.5 — plan convergé, PR, merge commit | — | **NC** comme étape planifiée explicite. |
| §10.6 — boucle H2A avec owners/dépendances/cadence/stop | §8 | **P** : owners non affectés ref par ref ; le stop criteria oublie la réussite normale. |
| §10.7 — aucun implicite prod | gates | **P** : intention correcte, enforcement incomplet. |
| §11 — préprod + autorisation humaine | S01, G-P7–G-P9 | **P**, faute d’attestation non contournable. |
| §11 — restore + rollback | S02/S03/A01 | **C** en intention. |
| §11 — collaboration scoped/auditable | C01–C04, preuves | **P** : couverture des canaux MCP/cache/search/object store insuffisante. |
| §11 — preuves rendues right/left panes | D08, P01/P02, S04 | **P** : screenshots seuls contournables. |
| §11 — carte et accessibilité | P05 | **P** : clavier/persistance absents. |
| §11 — fraîcheur Saint-Rémi et refresh global | F01/F02/A01 | **P** : oracle et population de mesure non définis. |
| §11 — audit règlement all-city | G01 | **P** : univers et dénominateur non définis. |
| §11 — Sutton rendu en production | R01/A01/G-P9 générique | **NC** explicitement. |
| §11 — KPI reproductibles | preuves KPI | **P** : « recalcul indépendant » n’est pas défini. |
| §11 — Warden provenance/source | G02 | **P** : manque un manifeste source immuable complet. |
| §11 — custom layer reste user-layer | G03/L02, test négatif | **P** : absence d’écriture dans le canon non attestée sur tous les stores. |

## 2. Contestation du découpage en vagues

### Dépendances mauvaises ou manquantes

Position Sol : le séquencement D0 → S0 → S1…P6 suffit à rendre les branches indépendantes.

Ma position : plusieurs dépendances structurantes sont absentes ou artificielles.

- P04 ne dépend pas fonctionnellement de P01. Cette dépendance retarde inutilement la recherche lot/zone et semble servir à sérialiser une collision UI non nommée.
- G03 dépend de l’identité et du partage, donc au minimum de C01/C02 et du contrat D03/D06. Le plan ne lui donne que des « décisions A/B2/B3 ».
- M01 dépend de l’identité acteur/tenant et de l’audit collaboratif ; C01/C02 devraient être des dépendances explicites.
- L02/L03 dépendent aussi de C01/C02 pour les ACL owner/share, pas seulement de G03/M01.
- G02 « acquisition cluster→S3 » devrait dépendre de la topologie et de la promotion préprod S01/S05, ou expliquer pourquoi il s’exécute ailleurs.
- C01 introduit une migration sans dépendance explicite à S02, alors que S02 est précisément le harnais de migrations.
- F01 ne dépend pas explicitement des contrats source/scheduling ni d’un critère capacité/coût accepté.
- Le KPI « Geo consistency » n’a aucune branche producteur Geo dédiée.
- A01 dépend de « toutes les verticales retenues », formule non calculable : la liste doit être figée.
- Les branches Geo et poc-k8s n’ont aucun gate CD propre. S00 ne protège que Radar.

### Branches trop larges

- F01 regroupe orchestration, sharding, locking, retry, classification, métriques, alertes et replay sur 1 000+ villes : ce n’est pas une branche indépendante raisonnable.
- C03 combine panier privé/partagé, TipTap, archives personnelles/globales, permissions, transitions et UI d’audit.
- C04 combine notes typées, ancrage UI, threads, follow, historique et upgrade `chat-ui`.
- G03 combine data plane, ACL, quotas, rétention, review, suppression et API cross-repo.
- R01 traverse API, UI et MCP, en plus de la migration de contrat Geo.
- S04 remplace plusieurs harnais globaux et risque de devenir une branche transversale touchant Makefile, CI, E2E et fixtures.

Le plan affirme qu’une branche dépassant 10–15 fichiers doit être rescindée. C’est une mauvaise lecture des règles : la limite 10–15 fichiers concerne les commits, pas les branches.

### Branches trop étroites

- S00 est artificiellement limité au « workflow CD uniquement », alors que le contrôle production exige credentials, tags d’images, environnements GitHub, RBAC, workflows manuels et chemins hors CI.
- D01 et D05 séparent contrat de sécurité et topologie sans définir le propriétaire de la décision finale ; elles risquent de produire deux architectures incompatibles.
- P01 ne devrait pas porter seulement un test anti-`effet_densifiant`, mais une règle générale sur la nature et la provenance des documents affichés.

### Collisions de fichiers sous-estimées

Le plan anticipe quelques collisions, mais pas les suivantes :

- S00/S05 et potentiellement S04 sur `.github/workflows/**`.
- C01/C02/C03/C04, F01, M01/M02 sur les migrations Drizzle, schémas, journaux de migration et middleware auth.
- C03/C04/M02/L02 sur les routes, enregistrements MCP, exports de packages et OpenAPI.
- P01/P04 sur le right pane et ses stores de sélection.
- P05/L01/L03 sur la carte, le store de couches, la légende, les contrôles et les tests visuels.
- C04/SNT1/M01 sur les manifests et lockfiles de dépendances Sentropic.
- Toutes les branches sur `PLAN.md`, leurs branch plans et éventuellement les index de documentation.
- Les contrats Geo/Radar n’ont pas de stratégie provider-first/consumer-compatible permettant de fusionner les deux repos dans n’importe quel ordre.

### Ownership cross-repo

Position Sol : Radar possède identité/authz/persistence, Geo sert les couches utilisateur, Sentropic ne porte que les modules génériques.

Ma position : cette répartition est une proposition non ratifiée, pas un fait acquis.

- Le plan met l’ACL et le partage des user layers dans G03/Geo, tout en disant que Radar possède l’identité et l’authz. Il manque un vrai control-plane/data-plane contract.
- Dissent #3 reconnaît cette ambiguïté, mais §7 et G03 la tranchent déjà en faveur de Geo : contradiction interne.
- « Acquisition cluster→S3 uniquement » est une décision d’architecture non demandée par la spec et insuffisante à elle seule pour le rendu.
- La propriété canonique des types règlement/preuve/zone entre Geo et Radar reste indécise.
- Les backups poc-k8s nécessitent des invariants applicatifs Radar ; une preuve purement infrastructure ne suffit pas.
- L’intégration au modèle de collaboration Sentropic doit être validée avant d’affirmer que Radar porte seul identité, persistence et rétention.

## 3. S00 et gates de production

Position Sol : chaque fusion est NO-GO jusqu’à S00 ; S00 avec `environment: production`, dispatch humain et approbateur obligatoire suffit à rétablir le contrôle.

Ma position : le diagnostic initial est juste, le remède est insuffisant.

Le workflow actuel déploie effectivement le cluster sur `push main`, sans `environment:`. Mais il existe d’autres chemins :

1. `build-push-images.yml` pousse `:latest` à chaque push. Plusieurs Deployments et CronJobs utilisent `:latest` avec `imagePullPolicy: Always`. Après F02, un nouveau pod de CronJob pourrait donc exécuter le code non autorisé sans aucun `kubectl` provenant du push.

2. Un `workflow_dispatch` de `build-push-images.yml` sur `main` déclenche aussi le job `deploy`, car sa condition vérifie seulement `github.ref == refs/heads/main`.

3. `k8s-apply-mcp.yaml` déploie et redémarre le MCP en production sans `environment: production`. Son redémarrage récupère `:latest`.

4. `run-job.yaml` applique et exécute des Jobs sur le cluster de production sans environnement protégé. Un dispatch humain n’équivaut pas à une validation explicite de l’owner.

5. `deploy-gh-pages.yml` déploie automatiquement une UI publique sur push `main`. Le plan doit décider si cette surface est production, préprod ou démo ; son environnement `github-pages` ne prouve pas qu’un reviewer obligatoire est configuré.

6. `make deploy-k8s`, `make deploy-db-migrate-k8s` et les procédures directes `kubectl` reposent sur un booléen et la possession du kubeconfig. Elles ne matérialisent pas une autorisation owner distincte.

7. Les secrets cluster sont des secrets repository dans les workflows observés. Les ajouter à un job avec `environment:` ne suffit pas s’ils restent accessibles par d’autres workflows.

8. Aucun audit équivalent n’est fourni pour les pipelines Geo et poc-k8s.

9. L’absence d’Argo/Flux est affirmée dans un commentaire de workflow, pas attestée contre l’état du cluster. Registry webhooks, image updaters ou autres controllers restent inconnus.

Le gate nécessaire doit donc couvrir l’inventaire complet des mutations production, le déplacement/rotation des credentials vers un environnement protégé, des images uniquement identifiées par digest immuable, la protection des workflows eux-mêmes et une validation cross-repo.

Je diverge aussi sur l’affirmation selon laquelle fusionner S00 exécuterait forcément l’ancien workflow. Pour un événement `push`, GitHub évalue normalement le workflow présent dans le commit poussé. Une S00 correctement auto-neutralisante peut donc empêcher son propre déploiement. Il faut néanmoins faire drainer/annuler les runs déjà lancés et obtenir l’autorisation owner pour cette transition.

## 4. Reproductibilité et non-contournabilité des preuves §11

Les preuves proposées sont utiles, mais restent majoritairement narratives.

- Les screenshots ne sont pas liés obligatoirement au full SHA, digest OCI, URL, navigateur, dataset, migration et workflow run. Ils peuvent être sélectionnés manuellement.
- `PREPROD_ACCEPTANCE` et `PRODUCTION_AUTHORIZATION` sont dits « signés », sans format, identité cryptographique, durée de validité, nonce, stockage immuable ni règle anti-rejeu.
- La préproduction est prouvée par un endpoint et un SHA servi, pas par l’absence de credentials/réseau/DB/bucket production.
- Le restore drill ne définit pas les invariants : âge du backup, chiffrement, PITR, row counts, références objet/DB, RPO/RTO et validation applicative.
- Les tests collaboratifs ne couvrent pas explicitement recherche, caches, websocket, MCP, exports, accès direct par ID et object storage.
- La fraîcheur peut être « prouvée » en avançant un watermark sans avoir ingéré les minutes attendues. Il faut un oracle indépendant : documents publics attendus, URLs, dates de séance/publication, population figée et états partiels.
- « Audit all-city » ne définit ni univers, ni dénominateur, ni cas négatifs, ni faux positifs/faux négatifs.
- Le recalcul KPI « indépendant » peut réutiliser la même librairie et reproduire la même erreur. Il faut une formule versionnée, un extract canonique hashé, règles de rounding/timezone et un second calcul réellement indépendant.
- La preuve Warden doit lier URL/version de source, licence, timestamp d’acquisition, hash raw, CRS/transform et résultat géométrique.
- Le test « non-promotion canonique » doit inspecter tous les stores et index canoniques, pas seulement la réponse de l’endpoint.
- Surtout, aucun scénario n’exécute explicitement le cas Sutton sur l’URL production après G-P9. A01 interdit même le déploiement production.

## 5. Revue des 10 dissents candidates

1. **Hard delete vs tombstone** — dissent valide, mais trop binaire. Il faut aussi considérer journal append-only, pseudonymisation et obligations de suppression.

2. **Archive globale ouverte vs modérateur** — valide. Il manque le désaccord préalable : l’archive globale est-elle un filtre partagé réversible ou un acte de modération sur l’objet ?

3. **Stockage couche utilisateur Geo vs Radar/Geo partagé** — valide et bloquant. Le plan ne le préserve pas réellement puisqu’il assigne déjà le service owner/share à Geo.

4. **CronJob monolithique vs sharding** — mal posé. La spec exige déjà pagination/sharding et une portée 1 000+. Le vrai dissent est CronJobs multiples par source vs orchestrateur/queue, ainsi que cadence quotidienne uniforme vs SLO propre à chaque source.

5. **Satellite externe vs fournisseur contractuel/self-hosted** — valide.

6. **`mcp-platform` vs adaptateur Radar** — valide mais incomplet. La même décision concerne comments, annotations et `chat-ui`, avec versions réellement publiées.

7. **Règlement représentatif par signal vs relation prouvée signal→zone→règlement** — faux dissent. La preuve municipale indirecte est explicitement interdite par la spec. Une option non conforme ne doit pas être conservée comme choix équilibré.

8. **Namespace partagé vs isolation plus forte** — valide. Les dimensions DB, bucket, credentials et blast radius doivent être séparées de la seule question du cluster.

9. **KPI moyen global vs pondéré/par ville** — valide. Il manque aussi la fenêtre temporelle et l’unité statistique.

10. **Promotion par copie vs changement de statut en place** — valide, mais le plan préjuge que le statut en place compromet forcément la séparation. Il peut être conforme si provenance, type d’origine, revue, version et audit restent immuables.

Nouveaux dissents à préserver :

11. GitHub Environment comme autorité de production vs approbation externe/change-management attestée.

12. Source d’identité et de groupes : IdP/Sentropic vs Radar, et modèle multi-tenant réel vs workspace unique.

13. Confirmation MCP inline en deux phases vs approbation hors bande, avec expiration, TOCTOU et reprise.

14. Ancre d’annotation par ID sémantique de composant vs coordonnées/DOM/snapshot, notamment après évolution de l’objet.

15. Freshness globale quotidienne vs SLO par source, et traitement d’une exécution partiellement réussie.

16. Propriété des types règlement/preuve et des relations canoniques : Geo vs Radar.

17. Stratégie des données préprod : copie production nettoyée vs corpus synthétique/versionné, avec compromis fidélité–confidentialité.

18. Étendue du pilote environnemental : réutiliser immédiatement BDZI/GRHQ/CPTAQ vs comparer d’abord toutes les catégories demandées.

19. Preuve Sutton en production : probe read-only post-promotion vs interdiction absolue de toute recette production.

20. Artefact de promotion : tag SHA mutable/abrégé vs digest OCI immuable.

## 6. Faits inventés, périmés ou non étayés

### Périmés, mais pas nécessairement inventés lors de la passe Sol

- `origin/main = 1710301` n’est plus vrai : la référence locale observée est maintenant `a132d4a`.
- `8b85003` est maintenant dans l’ascendance de `origin/main`, avec merge-base `8b85003`.
- Le checkout n’est plus à `9ea4949` : il est à `615007c`, deux commits devant et 162 derrière `origin/main`.
- Les états des PR #509/#498/etc. et des boucles H2A sont temporels et doivent être ré-audités avant planification.

### Non étayés par les artefacts fournis

- `zone_ref_canon_v1` et `ca-qc-constraints` n’apparaissent dans le checkout Radar que dans le plan lui-même. Ils peuvent exister dans Geo, mais aucun repo/ref/commit n’est cité.
- La version Sentropic `0.33.0` et les comportements précis de hard delete/cascade ne sont liés à aucun commit ou package publié vérifiable dans le plan.
- « Aucun controller Argo/Flux » n’est pas prouvé par l’absence de fichiers locaux ni par un commentaire.
- Les longueurs exactes du stream Track, liveness H2A et conclusion « aucun nouveau WP racine » n’ont pas de preuve incluse ; je ne les ai pas ré-auditées conformément à l’interdiction de toucher Track.
- La règle « branche > 10–15 fichiers ⇒ rescinder » est inventée/mal transposée depuis la limite par commit.
- Le maximum de quatre branches actives est une hypothèse de capacité, pas une règle du dépôt.
- « Aucun nouveau WP racine n’est justifié » est un jugement, présenté trop catégoriquement.

### Assertions partiellement justes mais trop larges

- La DB Radar expose bien `account_users` sans tables persistées tenant/groupes visibles. En revanche, le MCP possède déjà des concepts `tenantId`/`workspaces`; « Radar ne possède que account_users » est donc trop large hors contexte DB.
- Il existe bien deux CronJobs de refresh suspendus dans `34-refresh-cronjob.yaml`, mais un troisième CronJob de consistency est également suspendu.
- Warden comme municipalité pilote n’est pas inventé : Warden figure dans les données municipales du checkout.
- P01 et `effet_densifiant` correspondent exactement à la spec `8b85003`; leur étroitesse face au texte courant est un problème de mise à jour, pas une fabrication.

Aucun fichier, événement Track, commit, PR ou état externe n’a été modifié pendant cette revue.
