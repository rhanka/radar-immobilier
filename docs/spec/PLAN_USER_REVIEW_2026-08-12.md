# Plan de vagues — revue owner (spécification du 12 août 2026)

> **Statut : BROUILLON CANDIDAT — non convergé.** Ce plan est la sortie de la passe
> archi indépendante GPT-5.6 Sol xhigh (Immo), lue à `SPEC_RAW_USER_REVIEW_2026-08-12.md`
> commit `8b85003`. Il reste à valider par **(a)** une validation archi Geo séparée
> (§10.2, items D06/D07) et **(b)** un second review indépendant Fable/Sol préservant les
> désaccords (§10.3). La boucle objective H2A (§10.6) et la négociation cross-repo geo-cond
> (§7) ne s'ouvrent qu'**après convergence**. Aucun fichier/PR/déploiement/événement Track
> n'a été créé par la passe Sol.

## Provenance & traçabilité

- Source d'entrée : `docs/spec/SPEC_RAW_USER_REVIEW_2026-08-12.md` @ `8b85003`.
- Passe 1 (Immo, §10.2) : GPT-5.6 Sol, effort xhigh, run `.h2a/runs/sol_steve_waves`
  (terminé, exit 0). Consultatif strict : lecture seule, aucune mutation.
- Passe 2 (Geo, §10.2) : **à lancer** — délégation geo-cond (D06/D07).
- Passe 3 (second review, §10.3) : **à lancer** — modèle distinct (Terra xhigh),
  désaccords préservés, pas de lissage par consensus.

## Blocage structurel NO-GO à traiter EN PREMIER (résumé conducteur)

Sur `origin/main` observé (`1710301`), **chaque push `main` déclenche le déploiement
production** : le job `deploy` n'a pas de gate GitHub `environment:` avec approbateur
obligatoire — il enregistre un Deployment après pré-vol. Cela contredit directement §1
et §10 (« la production doit être une porte confirmée par un humain, pas un effet
automatique du CI »). Conséquence : **toute fusion est en NO-GO** tant que le gate S00
(`fix/production-deploy-human-gate`) n'est pas en place, et S00 lui-même exige que le
propriétaire neutralise/autorise d'abord la transition (sinon fusionner S00 est encore
un déploiement automatique).

---

_Ce qui suit est la sortie verbatim de la passe Sol xhigh, préservée sans lissage._

## Verdict

Le travail peut commencer par les branches de découverte et de spécification, mais toute fusion ou implémentation est actuellement en **NO-GO**.

Le blocage principal est structurel : sur la référence locale `origin/main` observée (`1710301`), chaque push vers `main` déclenche le déploiement production. Le job `deploy` n’a pas de gate GitHub `environment:` avec approbateur obligatoire; il ne fait qu’enregistrer un Deployment après le pré-flight. Cela contredit directement `SPEC_RAW_USER_REVIEW_2026-08-12.md` §1 et §10.

Les règles et la spec demandées ont été lues à `8b85003`. Aucun fichier, commit, PR, déploiement, boucle H2A ou événement Track n’a été créé ou modifié.

## 1. Baseline à figer avant exécution

1. Le commit exact est `8b850037b563d4de7b127c43cd6cd71c6f92e5f5`.
2. `8b85003` n’est pas dans la lignée de la référence locale `origin/main`; leur merge-base observé est `cfa01c9`.
3. Le checkout conducteur est `9ea4949`, 2 commits devant et 158 derrière `origin/main`, avec des modifications Track et des artefacts non suivis.
4. Les futures branches doivent donc partir d’un `BASE_SHA` explicitement déclaré par le conducteur après convergence de `main`, jamais de ce checkout ni des racines sales Geo/poc-k8s/Sentropic.
5. Chaque branche vit dans `./tmp/<slug>`, passe par des commandes `make`, utilise `ENV=test-*` ou `ENV=e2e-*`, puis merge commit uniquement.
6. Maximum quatre branches actives par vague; une branche dépassant environ 10–15 fichiers doit être rescindée avant extension de périmètre.

## 2. Découpage décisionnel

Les travaux suivants sont réversibles et peuvent être préparés sans décision propriétaire :

- inventaires de contrats, architecture existante et écarts;
- reproductions minimales des régressions;
- fixtures nettoyées et critères d’acceptation;
- audits de licences et de disponibilité des paquets;
- modélisation de scénarios, sans choisir une politique;
- tests rouges isolés sans écriture externe;
- recherche environnementale Geo, sans capture ni publication.

Les décisions suivantes exigent un dossier propriétaire complet avant implémentation.

### Lot décision A — accès, confidentialité et collaboration

- **A1 — Identité et frontière de tenant** : account/workspace/tenant, groupes nommés, appartenance et désactivation. Radar ne possède actuellement que `account_users`; aucun modèle tenant/groupe n’a été trouvé.
- **A2 — Matrice d’autorisation** : lire, annoter, sélectionner, archiver, restaurer, partager et promouvoir pour chaque cible typée; politique d’archive « tous utilisateurs » incluse.
- **A3 — Rétention et audit** : historique d’édition, suppression, tombstone, cascade, conservation et export. Le modèle Sentropic observé permet un hard delete par ligne et la suppression d’une racine sans supprimer ses réponses; ce comportement ne peut pas être adopté implicitement.
- **A4 — Confirmation MCP** : identité de l’acteur, état de confirmation, délégation de confiance, idempotence, trace d’audit et reprise après confirmation.

### Lot décision B — exploitation, données et produits

- **B1 — Préproduction et promotion** : topologie, isolation, autorité de promotion, RPO/RTO, critères de rollback et budget/capacité.
- **B2 — Autorité Geo/Immo** : classes canoniques, versionnement, ownership des preuves, frontière couche utilisateur/couche canonique et promotion explicite.
- **B3 — Fournisseurs cartographiques et environnementaux** : licence, attribution, coûts, confidentialité, disponibilité et stratégie de repli.
- **B4 — Vérité mesurée** : SLO de fraîcheur, population 1 000+, dénominateurs KPI, exclusions, états inconnus et seuils d’acceptation.

Chaque lot doit recevoir :

1. une passe architecture Immo GPT‑5.6 Sol xhigh;
2. une validation architecture Geo pour les contrats concernés;
3. une revue indépendante Fable/Sol;
4. un relevé séparé des désaccords;
5. une décision explicite du propriétaire.

Aucune de ces revues ou décisions n’est réputée acquise par le présent plan.

## 3. Plan de vagues

Les identifiants ci-dessous sont des identifiants de plan, pas des identifiants Track.

### Vague D0-A — spécifications réversibles

| ID | Repo / branche | Propriétaire | Sortie bornée |
|---|---|---|---|
| D01 | Radar `docs/user-review-production-safety-contract` | Immo architecture + plateforme | État actuel CI/CD, séparation build/preprod/prod, migrations, backup/restore, rollback et deux artefacts distincts `PREPROD_ACCEPTANCE` / `PRODUCTION_AUTHORIZATION`. |
| D02 | Radar `docs/collaboration-security-retention-contract` | Immo architecture + sécurité | Cibles typées, matrice RBAC, groupes, visibilité, rétention, historique, suppression, audit, commentaires/chat-ui et confirmation MCP. |
| D03 | Radar `docs/geo-immo-layer-contract` | Immo architecture | Types distincts règlement/source PDF/grille-norme/document preuve/couche environnementale/couche utilisateur; états d’absence honnêtes; contrat MCP. |
| D04 | Radar `docs/kpi-truth-contract` | Data/KPI | Définition, numérateur, dénominateur, exclusions, instant, fraîcheur, qualité et reproductibilité de chaque KPI demandé. |

Ces branches peuvent être développées en parallèle, mais ne doivent pas être fusionnées tant que le déploiement automatique de `main` n’est pas neutralisé.

### Vague D0-B — validation cross-repo réversible

| ID | Repo / branche | Propriétaire | Dépendance / preuve |
|---|---|---|---|
| D05 | poc-k8s `docs/radar-preprod-topology` | Plateforme poc-k8s | Inventaire namespace, réseau, secrets, DNS, stockage, quotas, backups et coûts. Aucune création de ressource. |
| D06 | Geo `docs/immo-layer-serving-contract` | Geo WP6 architecture | Validation du contrat D03 contre les contrats Geo déjà servis et les clés `{city_slug, zone_ref_canon_v1, reglement_number}`. |
| D07 | Geo `docs/warden-environmental-source-audit` | Geo architecture | Passe Sol xhigh; réutilisation auditée de `ca-qc-constraints` — BDZI, GRHQ, CPTAQ — avec autorité, licence, fréquence, CRS, couverture et limites. |
| D08 | Radar `docs/user-review-ui-regression-baselines` | Vues/recette | Reproductions datées : signal/PDF, Saint‑Stanislas, Sutton, recherche lot/zone, contrôles carte. Aucun diagnostic causal inventé. |

`Warden` est traité comme ville pilote, pas comme dépôt distinct.

### Gate S0 — premier et seul changement autorisé avant les autres fusions

| ID | Repo / branche | Portée | Gate |
|---|---|---|---|
| S00 | Radar `fix/production-deploy-human-gate` | Workflow CD uniquement : push `main` construit les images sans muter le cluster; promotion par SHA/digest immuable sur dispatch humain; job `environment: production`; refus si approbateur requis non configuré. | Le propriétaire doit d’abord neutraliser temporairement le workflow actuel ou autoriser explicitement cette transition contrôlée. La fusion de S00 reste sinon elle-même un déploiement automatique. |

Preuve requise : matrice des événements `pull_request` / `push main` / dispatch preprod / dispatch prod, test de refus sans approbation, absence de commande Kubernetes sur simple push, et inspection des réglages GitHub Environment.

### Vague S1 — socle de sécurité

| ID | Repo / branche | Sortie |
|---|---|---|
| S01 | poc-k8s `feat/radar-preprod-environment` | Environnement isolé, quotas, réseau, stockage, secrets et endpoint; aucun secret dans Git. |
| S02 | Radar `feat/preprod-migration-harness` | Fixtures production-shaped nettoyées; tests forward, backward/compensation, double exécution et schéma mixte supporté. |
| S03 | poc-k8s `feat/radar-backup-restore-drill` | Backup planifié, checksum, restauration dans une cible vierge, vérification applicative et reçu de drill. Acceptation après S01. |
| S04 | Radar `chore/user-review-acceptance-harness` | Remplacer les cibles `make test-e2e` et `make test-smoke` actuellement placeholders; isolation d’environnement et captures rendues déterministes. |

### Vague S2 — promotion preprod et corrections indépendantes

| ID | Repo / branche | Dépendances | Acceptation principale |
|---|---|---|---|
| S05 | Radar `feat/preprod-promotion-workflow` | S00, S01, S02 | Promotion manuelle vers preprod par SHA; migration séparée; rollback documenté; aucune voie implicite vers prod. |
| P01 | Radar `fix/signal-evidence-pane` | D08 | Test rouge puis association document/PDF restaurée; provenance visible; aucune substitution par `effet_densifiant`; document source, règlement et grille distingués. |
| P02 | Radar `fix/city-list-saint-stanislas` | D08 | Même état réel de ville visible dans la recherche et la liste non filtrée; pagination, tri, éligibilité et visibilité testés. |
| P03 | Radar `fix/kpi-truth-api` | D04 + décision B4 | API renvoyant valeur, définition, dénominateur, exclusions, instant, fraîcheur et qualité; états inconnus non convertis en zéros. |

P01 et P02 ne doivent partager aucun fichier parent de navigation sans lease explicite.

### Vague P2 — UI et contrat Geo

| ID | Repo / branche | Dépendances | Acceptation principale |
|---|---|---|---|
| P04 | Radar `feat/zone-lot-search` | P01 | Recherche, classement, clavier, focus, résultat vide et conservation de la sélection; tests de composants. |
| P05 | Radar `feat/map-basemap-controls` | décision B3 | Légende/mesure alignées; icône claire; carte/satellite; annotations conservées; fills de zonage retirés en satellite; attribution et échec de tuiles testés. |
| P06 | Radar `fix/kpi-truth-ui` | P03 | Chaque KPI affiche définition, source, denominator/exclusions, fraîcheur et état de confiance. |
| G01 | Geo `fix/regulation-served-association` | D06 | Numéro, URL, millésime, provenance et états d’absence servis sans inférence municipale. Audit broad-city produit. |

### Vague P3 — données et intégrations

| ID | Repo / branche | Dépendances | Acceptation principale |
|---|---|---|---|
| R01 | Radar `fix/regulation-end-to-end-render` | G01; résolution PR #509 | Contrats API/UI/MCP alignés; minutes exclues; absence de zone/règlement/URL/inaccessibilité/non-résolution distinctes; preuve Sutton rendue. |
| F01 | Radar `feat/daily-refresh-orchestrator` | D04 + décision B4 | Shards, locks, idempotence, rate limits, backoff, retries, watermarks, classifications d’échec, métriques, alertes et replay manuel. Aucun manifeste prod. |
| G02 | Geo `feat/warden-environmental-pilot` | D07 + décision B3 | Acquisition cluster→S3 uniquement, provenance/licence/CRS, validation géométrique et artefact Warden reproductible. |
| C01 | Radar `feat/collaboration-identity-scope` | décisions A1–A2 | Tenant/workspace/groupe, membership et contrôles fail-closed; migration additive testée. |

Si F01 nécessite également une migration DB, C01 et F01 ne fusionnent pas en parallèle : le conducteur réserve et ordonne les numéros de migration.

### Vague P4 — activation contrôlée et fondations collaboratives

| ID | Repo / branche | Dépendances | Acceptation principale |
|---|---|---|---|
| F02 | Radar `chore/daily-refresh-cron-gates` | F01, S01–S05 | Remplace ou répare les deux CronJobs suspendus; image immuable, sharding 1 000+, alertes, déploiement preprod seulement. |
| L01 | Radar `feat/environmental-layer-ui` | G02 | Rendu Warden, attribution, provenance, légende, états indisponibles; aucune donnée utilisateur. |
| C02 | Radar `feat/collaboration-domain-foundation` | C01, décisions A2–A3 | Références typées et versionnées, schéma audit/tombstone, transitions sélection/archive, politique de concurrence. |
| SNT1 | Sentropic `feat/radar-comments-host-contract` — **conditionnelle** | D02 | Seulement si l’audit prouve qu’un contrat générique ou une version publiée manque. Sentropic garde types/modules réutilisables; Radar garde identité, authz, persistence et validation de membership. |

La disponibilité publiée de `@sentropic/comments`, de `chat-ui` et de `mcp-platform` doit être vérifiée avant SNT1. Radar déclare actuellement `@sentropic/chat-ui:^0.5.0`, alors que la branche Sentropic observée expose `0.33.0`; cela ne prouve pas quelle version est installable.

### Vague P5 — verticales collaboratives et couche utilisateur

| ID | Repo / branche | Dépendances | Acceptation principale |
|---|---|---|---|
| C03 | Radar `feat/collaboration-selection-archive` | C02 | Panier privé/partagé, Markdown TipTap nettoyé, archive personnelle/partagée, raison obligatoire, acteur/scope/date/réversion visibles. |
| C04 | Radar `feat/collaboration-annotations` | C02, SNT1 si nécessaire | Notes typées, ancres, threads, réponses, follow et historique; intégration du chat-ui courant, pas de système parallèle. |
| G03 | Geo `feat/city-user-layer-service` | décisions A/B2/B3 | Stockage owner-scoped, provenance, quota/rétention, partage, revue, suppression; aucun passage automatique au canon Geo. |
| M01 | Radar `feat/mcp-human-confirmation-adapter` | décision A4; paquet vérifié | Machine d’état confirmation, idempotence, authz et audit; aucune écriture possible avant état `resumed`. |

C03 et C04 doivent consommer le schéma C02 sans ajouter deux migrations concurrentes. Leur unique seam partagé — enregistrement des routes/navigation — appartient à un intégrateur désigné.

### Vague P6 — MCP, rendu custom et acceptation

| ID | Repo / branche | Dépendances | Acceptation principale |
|---|---|---|---|
| M02 | Radar `feat/mcp-feedback-endpoint` | C04, M01 | Problèmes suggérés proactivement, confirmation explicite, validation et trace; test prouvant zéro écriture avant confirmation. |
| L02 | Radar `feat/custom-layer-mcp-endpoint` | G03, M01 | Création pour une ville, scope owner/share, quota/rétention et reçu de provenance; pas de promotion canonique implicite. |
| L03 | Radar `feat/custom-layer-rendering` | G03 | Rendu, attribution, permissions, indisponibilité et suppression reflétés sans fuite cross-user. |
| A01 | Radar `chore/user-review-preprod-acceptance` | toutes les verticales retenues | Scénarios cross-domain, preuves rendues, résultats de fraîcheur, restore/rollback et dossier preprod consolidé. Aucun déploiement prod. |

## 4. Preuves obligatoires

| Domaine | Preuves minimales |
|---|---|
| CI | `make typecheck`, `make lint`, `make build`, `make test` avec `ENV=test-<slug>`; cibles scoped pendant le développement. |
| UI | Tests composants + `make test-e2e E2E_SPEC=… ENV=e2e-<slug>` après S04; screenshots Saint‑Stanislas, signal/PDF, Sutton et contrôles carte. |
| Sécurité collaboration | Matrice allow/deny pour toutes les actions et cibles; deux tenants, utilisateurs/groupes, membre retiré, archive globale refusée sans rôle; tests XSS Markdown/TipTap. |
| Rétention | Edit/delete/tombstone/cascade, export d’audit, restauration et concurrence; aucune hypothèse héritée du hard delete Sentropic. |
| Geo/règlements | Tests de contrat Geo→Radar→MCP; audit all-city; aucun niveau municipal utilisé comme preuve d’une relation signal-règlement. |
| KPI | Jeux de données avec `verified`, `estimated`, `partial`, `unknown`, `not-applicable`; recalcul indépendant identique et hash de corpus. |
| Fraîcheur | Deux exécutions idempotentes, shard en échec, lock concurrent, rate-limit, retry, replay, watermark; résultat mesuré pour Saint‑Rémi, pas seulement Job `Succeeded`. |
| Environnement/custom | Licence et attribution; Warden reproductible; isolation owner/share; quota/rétention; suppression; test de non-promotion canonique. |
| Exploitation | Backup restauré et contrôlé, migration forward/rollback, rollback applicatif, SHA servi et endpoint public; preuves conservées hors secrets. |

## 5. Gates de production

La séquence est stricte :

1. **G-P0** — S00 actif et réglage GitHub Environment vérifié.
2. **G-P1** — décisions A/B signées et contrats revus; aucun dissent bloquant masqué.
3. **G-P2** — CI complète, migrations sur fixtures nettoyées, images et manifests immuables.
4. **G-P3** — preprod isolée et SHA servi attesté.
5. **G-P4** — backup restauré, migration rollback et application rollback effectivement joués.
6. **G-P5** — tests d’isolation tenant/groupe, rétention, confirmation MCP et sécurité passés.
7. **G-P6** — acceptation fonctionnelle et data : Saint‑Stanislas, Sutton, Saint‑Rémi, KPI reproductibles, Warden, custom layer.
8. **G-P7** — artefact `PREPROD_ACCEPTANCE` signé. Il n’autorise rien en production.
9. **G-P8** — artefact distinct `PRODUCTION_AUTHORIZATION`, signé par le propriétaire, contenant SHA/digests, migration, backup ID, rollback, fenêtre et responsables.
10. **G-P9** — promotion humaine; post-check TLS/cluster, SHA API/UI, smoke read-only, observation et rollback si seuil dépassé.

No-go automatique si : fuite cross-tenant, confirmation MCP contournable, backup non restaurable, rollback non prouvé, source/licence non approuvée, KPI mensonger, fraîcheur non mesurée, CronJob encore dépendant de `:latest`, ou désaccord critique non résolu.

## 6. Collisions Track et travaux existants

### Collision append-only Track

Deux chaînes concurrentes partent du même stream de longueur 785 :

- le checkout conducteur ajoute `01KZKZ4…` — carte responsive/mesure — puis `01KZMM3…` — matrice KPI — jusqu’à 787;
- `docs/steve-meeting-track` ajoute sept autres événements au même parent, commit `e5993b4`.

Une fusion Git naïve perdrait l’ordre append-only. Le writer Track désigné doit réémettre une seule chaîne après convergence. Les agrégats suivants doivent être réutilisés par titre/ID s’ils survivent, jamais recréés :

- `01KZWGABRAD4XWWW4GFTP15HT2` — preprod/backups/rollback, WP7;
- `01KZWGABWBCYKE8X642NGR3522` — collaboration, WP6;
- `01KZWGAC0MCCSHZWJZ44T11C42` — UX, WP6;
- `01KZWGAC4Z9CM0VMXX2WHM776W` — refresh/KPI, WP1;
- `01KZWGAC98CSTZE7P1S860WWZY` — règlement/normes, WP4;
- `01KZWGACDV8DN8Q298JCW736V7` — environnement/custom layers, WP1;
- `01KZWGACJ4847NQRBNPYAXF50M` — gouvernance/H2A, WP9.

Aucun nouveau WP racine n’est justifié. Le classement KPI entre WP1 et l’item actuel WP6 est un dissent de structure à résoudre, pas à corriger automatiquement.

### PR et branches en collision

- **Règlements** : PR #509, #435 et branches locales connexes. #509 est directement devant `origin/main`; R01 ne démarre qu’après décision merge/close/delta.
- **KPI** : PR #498, #474, #460 et #461; #498 est déjà en retard sur `main`. P03 commence par un audit de delta.
- **Geo/Immo** : PR #451 et #425; #425 indique explicitement une migration infrastructure en cours et ne doit pas être traité comme contrat accepté.
- **Preuve/coverage** : #434, #438 et #433.
- Les changements récemment intégrés autour du drawer, de la provenance de zone et des KPI (#504, #506, #507) imposent des tests rouges sur le dernier `BASE_SHA`, pas une réimplémentation de la spec du 12 août.
- `feat/uat-prod-e2e-harness` et `fix/rail-selected-city-stability` sont déjà ancêtres de la référence `origin/main` observée; leurs worktrees ne prouvent pas un travail encore actif.
- Geo est sur `feat/cadre-acquisition` avec un root très sale; poc-k8s est sur `feat/ovh-canada-migration`, 11 commits devant et sale; Sentropic est détaché et sale. Aucun de ces roots ne peut être réutilisé.
- Les boucles H2A Geo existantes `loop-msjicm32`, `loop-msjicpek`, `loop-msjid51c`, `loop-msjid8i2` et `loop-msjidbup` ont zéro ref observée. Leur création ou leur liveness ne constitue pas une preuve de livraison.

## 7. Ownership cross-repo

- **Radar** : identité hôte, authz, persistence/audit collaboratif, UI, consommation Geo, MCP métier, KPI, orchestration refresh et workflow applicatif.
- **Sentropic** : contrats et modules génériques comments/chat/MCP, publication/versioning. Il ne porte pas les politiques tenant/retention propres à Radar.
- **Geo** : acquisition, licence, CRS, provenance, qualité, données canoniques et service des couches utilisateur; aucune capture locale.
- **poc-k8s** : environnements, namespace, réseau, secrets, stockage, quotas, capacité, backup et DNS.
- **Propriétaire** : décisions A/B et chaque autorisation production.
- **Conducteur Track** : unique writer append-only et résolution des collisions.
- **Conducteurs de repo** : leases de branches, worktrees propres et statut des PR/H2A existants.

## 8. Boucle objective H2A proposée

À créer uniquement après convergence et revue du plan.

**Objectif :** « Livrer les exigences owner du 12 août jusqu’à une acceptation preprod reproductible et obtenir une décision propriétaire explicite de promotion, sans écriture production autonome ni promotion implicite d’une couche utilisateur. »

### Participants requis

- conducteur Immo;
- architecture Immo Sol xhigh;
- conducteur/architecture Geo;
- plateforme poc-k8s;
- owner Sentropic si SNT1 est nécessaire;
- sécurité/confidentialité;
- reviewer indépendant Fable/Sol;
- propriétaire pour les décisions et le gate final.

Les perennial/session IDs exacts doivent être découverts et attestés avant `join`; les sessions `scope:default` existantes ne sont pas réutilisées par supposition.

### Refs

- `BASE-AND-TRACK`
- `SPEC-PROD`, `SPEC-COLLAB`, `SPEC-GEO`, `SPEC-KPI`
- `DECISION-A`, `DECISION-B`
- `PROD-HUMAN-GATE`
- `PREPROD-FOUNDATION`
- une ref par branche de P01 à L03
- `PREPROD-ACCEPTANCE`
- `PRODUCTION-DECISION`
- `PRODUCTION-ROLLOUT`, créée seulement après un GO explicite

Chaque `done` doit référencer PR, merge SHA, résultat `make`, preuve d’acceptation et décision associée. « CI green », « PR merged » ou « loop done » n’autorise jamais la production.

### Cadence et stop

- rapport à l’entrée de chaque branche;
- rapport à chaque lot/commit vérifié;
- résumé quotidien tant que la boucle est active;
- blocker immédiatement, avec owner et dépendance;
- arrêt terminal seulement sur annulation propriétaire, NO-GO explicite, incident de sécurité, invalidation du contrat ou impossibilité cross-repo confirmée;
- un simple retard reste `blocked/report`, pas `stopped`;
- si le propriétaire rend un NO-GO production, `PRODUCTION-DECISION` peut être terminé avec cette décision, mais `PRODUCTION-ROLLOUT` n’existe pas.

## 9. Dissent candidates à préserver

1. Hard delete Sentropic vs tombstone/audit/rétention Radar.
2. Archive « tous utilisateurs » ouverte aux collaborateurs vs réservée à un rôle modérateur.
3. Stockage des couches utilisateur dans Geo vs métadonnées/ACL dans Radar et blobs géographiques dans Geo.
4. Un CronJob quotidien monolithique 1 000+ villes vs orchestration sharded par source et SLO de fraîcheur.
5. Satellite externe vs fournisseur contractuel/self-hosted compte tenu licence, coût et confidentialité.
6. Adoption de `@sentropic/mcp-platform` vs adaptateur Radar limité, tant que stabilité et version publiée ne sont pas vérifiées.
7. Contrat règlement représentatif par signal vs relation explicite signal→zone→règlement avec preuve propre.
8. Préproduction par namespace partagé vs cluster/base/storage séparés.
9. KPI « moyen » global vs moyenne pondérée/par ville; le dénominateur et les inconnus changent le sens produit.
10. Promotion d’une couche utilisateur : copie canonique revue et versionnée vs changement de statut en place — cette dernière option compromettrait la séparation demandée.

Ces points doivent rester visibles jusqu’aux décisions propriétaires; ils ne doivent pas être lissés par consensus.

## Addendum conducteur — 2026-08-14 : vue 3D & capitalisation modules design system (autour de P05)

Rattaché à la vague **P05** (`feat/map-basemap-controls`). Spec dédiée :
`SPEC_EVOL_3D_MAPS_2026-08-14.md` ; dossier de décision :
`reports/DOSSIER_DECISION_3D_MAPS_2026-08-14.md`. Revue Fable 5 = PRÊTE-AVEC-RÉSERVES.

**Décisions owner (2026-08-14) :**
- **Capitalisation** : les vues cartographiques (dont la 3D) sont capitalisées en
  **modules UI du design system (`sent-tech-design-system`), validés par geo** (le DS porte
  les modules, geo valide la correction géo/domaine + contrat data, immo consomme). Architecture
  détaillée déléguée à un **complément de proposition design-system + geo** (revu geo-archi + 5.6 Sol
  + Fable 5). `@sentropic/geo-ui-svelte` = point de départ, statut geo-vs-DS ouvert.
- **Vue 3D niveau zone** : rendu photoréaliste type Google Earth en vue zone, satellite 2D au-dessus.
  **Déclencheur = règle combinée** (seuil zoom z≥14 OU sélection sémantique de zone).
- **Spike comparatif autorisé** (Google direct vs Cesium vs MapTiler vs self-hosted, chiffré, sans
  engagement de dépense) pour trancher fournisseur/moteur/clé.
- **Séquencement** : la 3D se développe **en parallèle de P05** ; le fond satellite 2D livré par P05
  reste le prérequis fonctionnel du repli 2D et du mode imagerie → **point de synchronisation
  d'intégration**, pas un bloqueur amont du chantier 3D.

**Décisions restées ouvertes** : D8 (fournisseur du fond satellite 2D, dans P05), D9 (choroplèthe
municipal + aplats de lots en mode imagerie). **Revue en cours** : geo-cond + geo-archi (dossier +
contrat) et lane design-system (proposition de capitalisation).
