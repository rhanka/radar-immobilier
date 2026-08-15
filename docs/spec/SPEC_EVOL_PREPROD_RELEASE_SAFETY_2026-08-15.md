# SPEC_EVOL — Sûreté de release & pré-production

> **Statut** : EVOL — contrat de sûreté à réaliser ; aucun gate, environnement
> de pré-production, backup production ni artefact d'autorisation n'est réputé
> exister du seul fait de cette spécification.
> **Baseline vérifiée** : checkout `2427d8d98148a7f5961880af91a7c39f0416da48`,
> lu le 2026-08-15.
> **Contre-vérification post-revue** : au même checkout, l'inventaire des
> chemins d'écriture production de la section 2 est inchangé ;
> `35b-populate-geo-cronjob.yaml` reste hors `kustomization.yaml`, sans champ
> `suspend` et sur `radar-api:latest`, et le seul `environment:` déclaré dans
> les workflows reste `github-pages`. Cela ne prouve pas l'état live du cluster.
> **Sources d'intention** :
> [`SPEC_RAW_USER_REVIEW_2026-08-12.md` §1, §10.7 et §11](SPEC_RAW_USER_REVIEW_2026-08-12.md)
> et [`PLAN_USER_REVIEW_2026-08-12.md`](PLAN_USER_REVIEW_2026-08-12.md),
> vagues D01, D05 et S00–S05.
> **Verdict actuel** : **NO-GO structurel pour toute fusion ou opération pouvant
> écrire en production** ; la transition S00→S05 est sous gel total de release
> production, sous la seule exception break-glass bornée de la section 3.4.

## 1. Contexte & intention

### 1.1 Intention de sûreté

La release-safety recherchée sépare cinq actes qui sont aujourd'hui partiellement
confondus :

1. construire un artefact depuis un commit identifié ;
2. publier cet artefact sous une référence immuable ;
3. le déployer et l'accepter en pré-production ;
4. autoriser explicitement une promotion précise en production ;
5. exécuter cette promotion avec backup, migration, vérification et rollback
   conditionnel.

Une CI verte, une PR fusionnée, un environnement de pré-production disponible ou
un artefact `PREPROD_ACCEPTANCE` ne vaut jamais permission de production. Cette
séparation matérialise l'exigence §10.7 du RAW et doit être vraie autant dans les
workflows que dans la garde des credentials et l'état réel du cluster.

### 1.2 NO-GO vérifié

Le workflow `.github/workflows/build-push-images.yml` est déclenché sur chaque
`push` vers `main`. Son job `deploy`, sans `environment:` à approbateur, réapplique
la configuration MCP, puis exécute `kubectl set image` sur l'API, l'UI et, s'il
existe, le MCP. Le déploiement production est donc aujourd'hui un effet
automatique d'un push `main`.

Trois autres surfaces Actions écrivent également sur une surface publique ou
sur le cluster sans gate `production` : le déploiement GitHub Pages, le lancement
des Jobs one-shot et l'apply MCP. Le seul `environment:` déclaré dans tous les
workflows du dépôt est `github-pages`; la présence de required reviewers sur cet
environment n'est pas vérifiable par lecture Git.

Le risque ne se limite pas aux commandes `kubectl`. Le build publie
`radar-api:latest`, tandis que l'API et plusieurs CronJobs/Jobs déclarent
`:latest` avec `imagePullPolicy: Always`. Une recréation de pod ou la création
d'un Job peut donc charger du code non accepté sans nouveau `kubectl set image`.

**Décidé (owner 2026-08-15)** : `radar-populate-geo-daily` doit être suspendu
immédiatement dans le live, avant S00. Le repo ne permet pas d'affirmer s'il
existe ou s'exécute actuellement ; la suspension et l'absence de Job dérivé
actif doivent donc être vérifiées hors repo et reçues comme action de sûreté.

Sémantique de transition retenue comme **propriété documentée GitHub, à
confirmer par test** : pour un événement `push`, GitHub évalue le workflow du
commit poussé. Une modification S00 qui neutralise le déploiement automatique
devrait donc pouvoir empêcher son propre déploiement. Cette propriété n'est pas
un fait audité dans ce repo, ne draine aucun run déjà en cours et ne protège pas
un `workflow_dispatch` exécuté depuis une ancienne ref. S00 doit la confirmer et
fermer ces deux cas par des contrôles hors du seul fichier de workflow.

Deux blocages externes sont nommés et suivis explicitement :

- **`EXT-GH-ENV-CAPABILITY`** — disponibilité effective des required reviewers
  pour un environment selon le plan et la visibilité GitHub du dépôt. Le
  pré-vol Pages montre déjà qu'une capacité GitHub peut être « unavailable for
  this repository plan », sans établir le cas des environments ; ce blocage
  reste à lever hors repo avant S00.
- **`EXT-APPROVAL-OWNER-UNIQUE`** — l'ancienne formulation « initiateur ≠ seul
  approbateur » rendait le modèle owner-unique insatisfiable si elle visait
  aussi l'owner humain. **Résolu par décision owner 2026-08-15** : cette
  séparation vise les agents ; l'OWNER humain reste l'unique autorité
  d'approbation production. L'implémentation et ses tests restent à réaliser.

### 1.3 État non acquis

Aucun terme `preprod` ou `staging` n'apparaît dans les workflows, le Makefile ou
les manifestes Kubernetes inspectés. Ceux-ci ne décrivent que le namespace
`radar-immobilier` et le DNS public `immo.sent-tech.ca`. La pré-production, ses
backups, ses quotas et ses coûts ne sont donc pas attestés par ce dépôt.

De même, aucun producteur de `PREPROD_ACCEPTANCE` ou de
`PRODUCTION_AUTHORIZATION` n'est implémenté dans les surfaces inspectées. Ces
noms n'existent que dans le plan du 12 août et deviennent des contrats cibles
dans la présente spécification.

### 1.4 Rattachement au plan

| Vague | Responsabilité dans cette évolution | Sortie attendue |
| --- | --- | --- |
| D01 | Contrat Radar de release-safety | Présente spécification : état actuel, gates, migrations, backup/restore, rollback et preuves. |
| D05 | Topologie `poc-k8s`, lecture seule | Inventaire vérifié du namespace, réseau, secrets, DNS, stockage, quotas, backups et coûts de la future pré-production. |
| Pré-S00 | Action de sûreté owner, hors release | Suspension live reçue de `radar-populate-geo-daily` et absence de Job dérivé actif. |
| S00 | Premier changement autorisé | Neutralisation de toute promotion automatique, environment humain et fermeture des anciennes refs/credentials. |
| S01 | Fondation `poc-k8s` | Pré-production isolée, bornée et observable. |
| S02 | Harness migrations Radar | Fixtures nettoyées production-shaped et matrice de migration reproductible. |
| S03 | Backup/restore `poc-k8s` | Backup planifié et restore drill reçu. |
| S04 | Harness d'acceptation Radar | Producteur déterministe des preuves, sans placeholder. |
| S05 | Promotion pré-production Radar | Promotion manuelle par SHA/digest, migration séparée et aucun chemin implicite vers prod. |

La documentation D01 et l'inventaire D05 peuvent être préparés en NO-GO. La
suspension live de `35b` est l'action de sûreté immédiate ordonnée avant S00 ;
elle n'autorise aucune release. S00 reste le premier changement de comportement
du repo à rendre effectif. S01–S05 ne constituent jamais, seuls ou ensemble, une
autorisation de production.

## 2. Inventaire vérifié des chemins d'écriture production

### 2.1 Surfaces GitHub Actions

| Workflow / job | Déclencheur actuel | Mutation vérifiée | `environment:` actuel | Conclusion |
| --- | --- | --- | --- | --- |
| `build-push-images.yml` / `build-push` | `push main` et `workflow_dispatch` | Pousse `:<sha-court>`, `:latest` et un tag optionnel dans le registre Scaleway; miroir GHCR best-effort. | Aucun | La publication de `:latest` est une mutation production indirecte tant qu'une charge prod le consomme. |
| `build-push-images.yml` / `deploy` | Même workflow; exécuté si `github.ref == refs/heads/main` | `kubectl apply` de `40-immo-mcp-http-deploy.yaml`, puis `kubectl set image` sur `radar-api`, `radar-ui` et éventuellement `radar-immo-mcp`; attend les rollouts. | Aucun | **Chemin automatique production sur push `main`.** Le pré-vol vérifie le cluster, pas une approbation humaine. |
| `deploy-gh-pages.yml` / `deploy` | `push main` et `workflow_dispatch` | Construit puis publie l'UI avec `actions/deploy-pages@v4` et `pages: write` lorsque le pré-vol constate Pages disponible. | `github-pages` | La voie de déploiement public est déclenchée automatiquement. Disponibilité de Pages et reviewers réels sont inconnus. |
| `run-job.yaml` / `run` | `workflow_dispatch`, choix `mapper`, `snapshot` ou `projection` | Supprime puis recrée un Job dans `radar-immobilier`; les trois Jobs peuvent écrire en Postgres. | Aucun | Dispatch manuel ne signifie pas approbation. Le timeout de `kubectl wait` est actuellement transformé en `exit 0`; un run vert ne prouve pas le succès du Job. |
| `k8s-apply-mcp.yaml` / `apply` | `workflow_dispatch` | Applique `30-api.yaml`, le Deployment/Ingress MCP et les NetworkPolicies, puis redémarre le MCP. | Aucun | Peut remettre l'image API à `:latest` si le live avait été épinglé, puis déclencher un rollout par changement du pod template. |

Le secret `KUBE_CONFIG_DATA` est référencé par les trois workflows Kubernetes.
Son scope réel — repository, organization ou environment — et sa rotation ne
sont pas visibles dans Git.

### 2.2 Surfaces Makefile et opérateur

| Cible | Garde actuelle | Mutation | Écart de sûreté |
| --- | --- | --- | --- |
| `deploy-k8s` | `K8S_DEPLOY_CONFIRM=1` **et** `KUBECONFIG` non vide | `kubectl apply -k deploy/k8s` | La garde existe déjà, mais ne représente ni reviewer ni artefact autorisé. Le chemin prepare-only retourne succès et peut créer un faux positif d'automatisation. |
| `deploy-db-migrate-k8s` | Même double condition, avec refus explicite | Supprime, applique et attend `radar-db-migrate`, puis affiche ses logs | Aucun backup, verify applicatif, rollback/compensation ou lien avec le digest autorisé. |
| `push-api-image` via `push-images` | Accès au registre seulement | Réécrit `radar-api:<API_VERSION>` **et** `radar-api:latest` | Tant que prod tire `latest`, cette cible peut changer le code futur sans `K8S_DEPLOY_CONFIRM`. |
| `push-ui-image` | Accès au registre seulement | Pousse `radar-ui:<UI_VERSION>` | Le caractère immuable du tag et les droits de réécriture du registre sont inconnus. |

Les kubeconfigs directs, accès registre directs et commandes opérateur décrites
dans les commentaires des manifestes sont des chemins potentiels hors Actions.
Leurs détenteurs, leur audit et leur RBAC ne sont pas vérifiables depuis ce repo.

### 2.3 Images et charges susceptibles d'exécuter en production

| Manifeste / charge | Inclusion Kustomize | Image / pull policy | État déclaré | Risque actuel |
| --- | --- | --- | --- | --- |
| `30-api.yaml` / Deployment `radar-api` | Oui | `radar-api:latest`, `Always` | 1 replica, stratégie `Recreate` | Un reschedule/recreate tire le dernier code publié sans promotion. |
| `34-refresh-cronjob.yaml` / `radar-refresh-scrape` | Oui | `radar-api:latest`, `Always` | `suspend: true` | Suspendu, mais réactivation ou Job dérivé tirerait un tag mutable. |
| `34-refresh-cronjob.yaml` / `radar-refresh-projection` | Oui | `radar-api:latest`, `Always` | `suspend: true` | Même risque. |
| `35-consistency-snapshot-cronjob.yaml` | Oui | `radar-api:latest`, `Always` | `suspend: true` | Même risque. |
| `35b-populate-geo-cronjob.yaml` / `radar-populate-geo-daily` | **Non** | `radar-api:latest`, `Always` | Aucun `suspend`, donc déclaré actif par le manifeste | Charge quotidienne hors bundle déclaratif. Son existence et son état live restent inconnus ; suspension live requise avant S00. |
| `40-immo-mcp-http-deploy.yaml` / `radar-immo-mcp` | Non | `radar-api:latest`, `Always` | 1 replica si appliqué | Apply manuel et workflow MCP peuvent tirer `latest`. |
| Jobs `31`, `32`, `33`, `35-consistency-snapshot-job`, `35-run-geo-mapper-job`, `35a` | Non | `radar-api:latest`, `Always` | One-shot manuels; certains exposés par `run-job.yaml` | Un dispatch peut exécuter un code différent de celui accepté. Le Job `31` contient en plus un migrateur de schéma. |
| `36-db-migrate-job.yaml` | Non | `radar-api:main-8909943-pdfgeo`, `Always` | Apply manuel | Image ancienne et découplée de la release autorisée; immutabilité du tag non prouvée. |
| `32b-reproject-etape-job.yaml` | Non | `radar-api:etape-1781485930`, `Always` | One-shot manuel | Tag fixe mais digest et immutabilité registre non prouvés. |
| `50-ui.yaml` / `radar-ui` | Oui | `radar-ui:main-8909943-pdfgeo`, `Always` | 1 replica, `Recreate` | Le CD le remplace par un SHA court; le manifeste demeure découplé du release bundle. |

Le scan exhaustif doit aussi traiter les autres tags `:latest` inclus dans le
bundle (`minio/minio`, `radar-obscura`, `maildev/maildev`), même lorsque leur
`imagePullPolicy` vaut `IfNotPresent` ou que leurs replicas valent zéro. Un
nouveau nœud ou un cache absent suffit à rendre un tag mutable effectif.

**Décidé (owner 2026-08-15)** : aucune charge planifiée de production ne peut
utiliser `:latest`. `radar-populate-geo-daily` ne doit jamais suivre
implicitement le code applicatif neuf : il exécute un **pipeline data figé**, en
version maîtrisée par le CI/CD et épinglée sur `:<sha-complet>`. Sa remise en
service est interdite tant qu'un lot de correction gaté n'a pas, sur le même
bundle, remplacé l'image mutable, réintégré le CronJob aux `resources` de
`kustomization.yaml`, rendu et scanné ce bundle, puis prouvé l'image live et son
digest. La suspension live immédiate est une action distincte et préalable à ce
lot ; elle ne vaut pas correction déclarative.

### 2.4 État migrations, backups et pré-production

- `make test` démarre Postgres/MinIO puis exécute les migrations une fois avant
  la suite. Il ne constitue pas la matrice de migration demandée en section 5.
- `db-seed` est un placeholder. Aucun chargeur de fixture production-shaped
  nettoyée n'est branché dans le chemin CI inspecté.
- `36-db-migrate-job.yaml` ne contient que l'appel au migrateur. Le Makefile
  l'applique séparément du déploiement; il n'y a ni backup, ni post-check
  applicatif, ni rollback.
- `31-graph-projection-job.yaml` est une deuxième voie de migration : backfill
  0004, migration Drizzle et projection, sur `:latest`, hors kustomization.
- `make db-backup` et `make db-restore` ciblent le stack Compose local :
  `pg_dump` vers un fichier local, puis restauration SQL avec `psql`. Aucun
  planificateur, checksum, cible vierge, smoke applicatif ou reçu RPO/RTO de
  production n'est défini dans les surfaces inspectées.
- Les commentaires de `00-namespace.yaml` et `70-networkpolicy.yaml` attribuent
  ResourceQuota, LimitRange et politiques de base à l'opérateur `poc-k8s`.
  Ces commentaires ne prouvent pas leur état live.

## 3. Gate de production humain

### 3.1 Invariants du gate

Les invariants suivants sont obligatoires avant toute levée du NO-GO :

1. **Décidé (owner 2026-08-15)** : les agents et la CI peuvent initier et
   pousser une release, mais l'**OWNER humain est l'unique approbateur
   production**. Lorsque GitHub supporte les required reviewers, un Environment
   nommé **`production`** les impose avec l'OWNER comme seul approbateur. La
   contrainte « initiateur ≠ seul approbateur » s'applique aux initiateurs
   agents : aucun agent n'approuve son propre déploiement ni ne détient
   l'autorité équivalente. Elle n'interdit pas à l'OWNER humain d'initier puis
   d'approuver seul l'opération.
2. Chacune des quatre surfaces Actions de mutation — promotion cluster du
   build, Pages, `run-job`, `k8s-apply-mcp` — possède un job bloquant lié à
   `environment: production`. Aucun job mutateur ne peut contourner ce job par
   une autre branche conditionnelle. Si `EXT-GH-ENV-CAPABILITY` démontre que le
   dépôt ne peut pas imposer de required reviewers, ce chemin reste fermé
   jusqu'à l'installation d'un gate de substitution owner-ratifié : passage du
   dépôt en public si cela rend la capacité disponible, upgrade du plan, ou
   validation d'un artefact d'autorisation signé hors GitHub avant tout accès
   aux credentials production.
3. `push main` peut construire et publier des références immuables, mais ne
   lance ni `kubectl`, ni Job, ni migration, ni déploiement Pages, ni écriture
   d'un tag mutable consommable par production.
4. Les credentials de production ne sont disponibles qu'aux jobs liés à
   l'environment protégé. Les anciens secrets repository/organization capables
   de muter le cluster ou un tag consommé par prod sont retirés puis révoqués.
5. Toute promotion reçoit un `PRODUCTION_AUTHORIZATION` valide, à usage unique,
   dont le commit, les digests, la migration, la cible et la fenêtre
   correspondent exactement à l'opération demandée.
6. Un workflow lancé depuis une ancienne ref ne reçoit aucun credential ou
   permission lui permettant une mutation production.
7. Un échec ou timeout de Job est fatal. Les logs seuls et un run vert sans
   condition Kubernetes `Complete` ne valent pas preuve.
8. Toute mutation production hors `PRODUCTION_AUTHORIZATION` ou procédure
   break-glass valide est détectée en continu et alertée entre deux audits,
   selon le contrat de section 3.5.

Le point 2 a un prérequis externe bloquant : **avant S00**, vérifier hors repo le
plan et la visibilité GitHub réels ainsi que la disponibilité effective des
required reviewers pour ce dépôt. L'indice du pré-vol Pages sur une capacité
« unavailable for this repository plan » ne permet pas d'extrapoler la réponse
pour les environments. L'une des trois substitutions ci-dessus doit être
choisie et mise en place si la capacité est indisponible ; cette spec ne suppose
ni la disponibilité ni le choix.

GitHub Pages requiert une transition particulière : les anciennes refs
référencent déjà `environment: github-pages` et obtiennent un `GITHUB_TOKEN`
éphémère avec `pages: write`. Pendant et après S00, `github-pages` doit donc
également être protégé, derrière l'autorisation production de l'OWNER, ou la
voie historique doit être désactivée structurellement. Ajouter seulement
`production` au workflow courant ne ferme pas une ancienne ref.

### 3.2 Références d'images immuables

Toutes les charges capables de s'exécuter avec des données ou credentials de
production — Deployments, StatefulSets, CronJobs et Jobs, incluses ou non dans
kustomization — doivent respecter le contrat suivant :

- aucun `:latest`, tag optionnel réassignable ou tag métier mutable ;
- au minimum un tag `:<sha-complet>` propre au commit construit, jamais le SHA
  court de sept caractères ;
- digest OCI résolu et enregistré dans les preuves ;
- impossibilité vérifiée de réassigner le tag SHA, ou déploiement direct par
  digest si le registre ne garantit pas l'immutabilité ;
- même digest entre build, pré-production, autorisation et production ;
- scan du rendu Kustomize **et** des manifestes hors Kustomize ;
- vérification live des `image` demandées et des `imageID` réellement servies ;
- pour toute charge planifiée production, version du pipeline promue
  explicitement par CI/CD et impossibilité de suivre automatiquement une
  release applicative ou un tag `:latest`.

La politique couvre explicitement `30-api`, les trois CronJobs suspendus,
`35b-populate-geo-daily`, MCP, tous les one-shots, les deux voies de migration
et les images tierces `:latest`. Suspendre une charge ou la sortir de
kustomization ne constitue pas une neutralisation d'image. Pour `35b`, le
contrat supplémentaire « pipeline data figé + `:<sha-complet>` + gestion CI/CD
et inclusion Kustomize » est un gate de réactivation, pas une recommandation.

### 3.3 Garde locale `K8S_DEPLOY_CONFIRM`

`K8S_DEPLOY_CONFIRM` est conservé comme garde obligatoire pour
`deploy-k8s` et `deploy-db-migrate-k8s`, avec les propriétés cibles suivantes :

- absence de confirmation, kubeconfig, cluster attendu, namespace attendu,
  digest autorisé ou identifiant d'autorisation : refus avant toute mutation et
  code de sortie non nul pour une intention de déploiement ;
- pré-vol positif sur l'identité du cluster, puis vérification RBAC minimale ;
- aucune valeur par défaut ne peut désigner la production ;
- journal du commit, digest, cible, acteur et autorisation ;
- la garde ne remplace jamais un reviewer. Le chemin local ordinaire est soit
  routé vers la promotion Actions protégée, soit classé
  `PROC-BG-PROD-HOTFIX` avec credentials séparés, approbation hors bande et
  audit.

Le comportement prepare-only peut subsister comme commande de préparation
explicitement nommée; il ne doit pas rendre vert un appel qui prétend déployer.

### 3.4 Séquence de transition S00

**Décidé (owner 2026-08-15)** : de l'ouverture de S00 à la fermeture formelle de
S05, la politique de release est un **gel total production**. Aucun déploiement,
migration, Job, réactivation de CronJob, déploiement Pages ou changement de tag
consommable par production n'est permis pendant la mise en place. Les builds
immuables et les opérations strictement préprod peuvent reprendre lorsqu'ils
sont isolés ; ils n'ouvrent pas production.

La seule exception est la procédure nommée **`PROC-BG-PROD-HOTFIX`**. Elle est
bornée à un hotfix nécessaire pour rétablir ou préserver un service production
en incident critique ; elle exclut release ordinaire, fonctionnalité, rattrapage
de roadmap, rafraîchissement data et contournement des lots S00–S05. Avant toute
mutation, l'OWNER autorise hors bande un incident, un SHA/digest, une cible, un
périmètre, une fenêtre courte et un rollback précis. L'exécution utilise un
credential break-glass distinct, temporaire et à moindre privilège, puis produit
un audit horodaté des acteurs, commandes/runs, état avant/après, backup requis,
vérifications et écarts. À la fin de la fenêtre, le credential est révoqué, le
live est rapproché du déclaratif, le drift est traité et l'incident est clos ou
escaladé. Cette exception n'ouvre aucune voie ordinaire et ne raccourcit aucun
gate S00–S05.

La transition ne commence pas par un merge ordinaire. Elle suit cet ordre :

1. **Suspendre `35b` avant S00.** Suspendre
   `radar-populate-geo-daily` dans le live, vérifier qu'aucun Job dérivé n'est
   actif et conserver le reçu. Cette action de sûreté n'est pas une release.
2. **Autoriser la transition et déclarer le gel.** Le propriétaire autorise
   explicitement l'opération S00, sans autoriser une release applicative.
   Désactiver les quatre voies mutatrices ou retirer leur autorité, puis
   inventorier les accès directs.
3. **Lever le prérequis de gate externe.** Vérifier
   `EXT-GH-ENV-CAPABILITY`, puis créer/protéger `production` avec l'OWNER unique
   approbateur, protéger aussi `github-pages` et définir la politique de refs ;
   si nécessaire, installer d'abord l'une des substitutions ratifiées en 3.1.
4. **Drainer.** Annuler ou laisser terminer sous surveillance tous les runs
   capables d'écrire en production, y compris ceux en attente. Consigner leurs
   IDs et vérifier l'absence de Job/rollout résiduel.
5. **Fermer les anciennes refs.** Déplacer les credentials vers l'environment
   ou le gate de substitution, révoquer/rotater les secrets antérieurs et tester
   une ancienne ref représentative. Pour Pages, retirer ou protéger la
   permission historique.
6. **Neutraliser les tags mutables live.** Épingler l'état réellement servi,
   inventorier `35b` et les Jobs hors bundle, et arrêter toute publication de
   `:latest` avant qu'un nouveau build puisse être tiré par un reschedule. Le
   lot de correction `35b` reste gaté par son pipeline figé et sa réintégration
   Kustomize avant toute réactivation.
7. **Fusionner S00 et tester la propriété de push.** Le commit S00 doit
   construire sans mutation ; le run réel confirme que le workflow neutralisé
   est bien celui évalué pour son push. La propriété documentée GitHub n'est
   acceptée qu'après ce test et les étapes 1–6.
8. **Prouver la fermeture.** Exécuter la matrice push/dispatch/ref ancienne,
   les refus sans approbation, le scan d'images, l'inspection live et la
   détection continue de drift.
9. **Rouvrir seulement le build immuable et la préprod.** Les promotions
   préprod restent distinctes, avec leur autorité et leurs preuves. La
   production reste gelée jusqu'à la fermeture formelle de S05, puis ne peut
   être ouverte que par son gate ordinaire et un `PRODUCTION_AUTHORIZATION`.

### 3.5 Détection continue du drift production

Au plus tard avant toute réouverture de credentials après S00, un détecteur
continu en lecture seule couvre toutes les surfaces de mutation de la section 2
et rapproche chaque événement et état live du dernier bundle autorisé. Il
couvre au minimum les créations/modifications/suppressions de ressources
Kubernetes, images et templates de CronJobs/Jobs, déploiements Pages, écritures
de tags registre consommables par production et usages des accès directs
auditables.

Toute mutation sans ID de `PRODUCTION_AUTHORIZATION` valide ou sans ID
`PROC-BG-PROD-HOTFIX` ouvert déclenche une alerte immédiate à l'OWNER, bloque
toute nouvelle promotion, préserve l'événement et l'état avant/après, puis exige
un rapprochement explicite. L'identité du détecteur ne détient aucun droit de
mutation production. La latence d'alerte, la rétention et le canal doivent être
décidés et testés avant acceptation ; un audit périodique ne remplace jamais
cette surveillance entre deux audits.

## 4. Pré-production isolée dans `poc-k8s`

### 4.1 Contrat d'isolation

S01 crée une pré-production réelle sous responsabilité `poc-k8s`; D05 doit
d'abord en arrêter la topologie sans créer de ressource. L'environnement ne
partage aucune identité de runtime ni donnée écrivable avec production.

| Concern | Exigence cible | Preuve d'acceptation |
| --- | --- | --- |
| Namespace / cluster | Namespace distinct si cluster partagé, ou cluster dédié selon décision §9; labels et ServiceAccounts propres. | Inventaire API Kubernetes horodaté; absence de ressource préprod dans `radar-immobilier`. |
| Réseau | Default-deny ingress/egress; allowlists minimales; refus explicite vers Postgres, stockage et APIs internes prod. | Matrice de tests réseau positifs/négatifs depuis un pod préprod non privilégié. |
| Secrets | Secrets préprod propres, émis et rotables séparément; aucun secret prod copié ou fallback vers prod. | Inventaire de noms/scopes et tests d'absence d'accès, sans révéler les valeurs. |
| DNS/TLS | Hôte non production distinct, certificat propre et aucune collision de cookie/callback OAuth. | Résolution, certificat et callbacks vérifiés sur l'endpoint préprod. Le nom exact reste à décider. |
| Base de données | Instance/base et credentials séparés; aucune connexion possible vers la base prod. | Identifiant de cible, test d'écriture sentinelle en préprod et refus équivalent en prod. |
| Stockage objet | Bucket ou frontière d'accès séparée, sans droits sur les objets prod; aucune clé ou préfixe partagé sans politique prouvée. | Tests `allow/deny`, identité du store et inventaire des données de fixture. |
| Stockage persistant | PVC et politique de rétention propres; restauration de drill vers une cible vierge. | PVC/storage class/capacité et résultat de restore consignés. |
| Quotas/capacité | ResourceQuota, LimitRange, requests/limits et capacité pour migrations, restore et smoke simultanés. | `describe`/métriques montrant respect des quotas et absence d'éviction pendant le scénario d'acceptation. |
| Coûts | Budget, estimation et mesure séparés; alertes et règle d'arrêt des charges non nécessaires. | Rapport de coût attribuable à préprod; seuils encore à décider. |
| Données | Fixtures production-shaped nettoyées; aucune copie brute de données prod non autorisée. | Dataset ID/hash, reçu de nettoyage et contrôle de non-réidentification défini par le propriétaire des données. |
| Observabilité | Logs, événements, métriques, identité du digest et versions de schéma accessibles sans secret. | Liens/IDs de runs et export machine-readable rattachés à l'acceptation. |

Les commentaires du repo actuel sur un namespace partagé `poc-k8s`, un
ResourceQuota opérateur et des NetworkPolicies ne satisfont pas ces preuves.
L'état du repo `poc-k8s` et l'état live doivent être audités dans D05.

### 4.2 Promotion vers pré-production

S05 déploie en pré-production un release bundle identifié par SHA complet,
digests OCI, hash des manifestes et version de schéma. Il n'effectue aucun
rebuild et ne résout jamais `latest`.

L'autorité d'acceptation préprod est le rôle technique dédié
**`PREPROD_ACCEPTANCE_AUTHORITY`**, porté par le validateur déterministe S04.
Cette identité de service ne signe qu'après satisfaction des gates S04/S05, ne
détient aucun secret, droit d'approbation ou credential production et ne peut
émettre de `PRODUCTION_AUTHORIZATION`. Agents et CI peuvent soumettre le bundle
et les preuves au validateur, mais ne peuvent ni forger ni remplacer sa
décision. L'OWNER humain est séparément l'unique
`PRODUCTION_AUTHORIZATION_AUTHORITY`. L'identité concrète, la clé et le stockage
du validateur restent à arrêter dans O9 ; cette inconnue d'implémentation ne
permet pas de confondre les deux autorités.

Le job préprod :

1. refuse tout credential ou endpoint production ;
2. vérifie l'identité de la cible et l'isolation ;
3. applique le bundle exact ;
4. exécute migration, tests applicatifs, rollback répété et restore drill
   requis pour la release ;
5. produit les preuves de section 7 ;
6. soumet les preuves au `PREPROD_ACCEPTANCE_AUTHORITY`, seul émetteur de
   l'acceptation préprod ;
7. ne crée aucune `PRODUCTION_AUTHORIZATION` et ne déclenche aucune prod.

## 5. Migrations sûres

### 5.1 État actuel vérifié

Le chemin CI actuel applique les migrations une fois sur la base de test avant
les tests. Il ne charge pas une fixture production-shaped nettoyée et ne prouve
ni double exécution, ni backward/compensation, ni schéma mixte.

Le chemin prod `36-db-migrate-job.yaml` est un apply manuel épinglé au tag
`main-8909943-pdfgeo`, distinct du release bundle. Il n'intègre ni backup, ni
vérification applicative, ni rollback. Le Job `31` constitue un deuxième chemin
de migration couplé à un backfill et une projection, sur `:latest`. S02/S05
doivent consolider ces voies : aucun Job autonome ou caché ne peut migrer prod.

### 5.2 Matrice CI obligatoire

Chaque ensemble de migrations candidat est exécuté via des cibles `make`
déterministes à créer dans S02/S04. Les noms exacts de ces futures cibles ne sont
pas imposés ici; le reçu doit enregistrer leur commande complète.

| Cas | Exécution exigée | Condition de succès |
| --- | --- | --- |
| Fixture | Charger un dataset production-shaped, nettoyé, versionné et hashé. | Schéma de forme, cardinalités et invariants attendus; preuve de nettoyage liée au hash. |
| Forward | Partir de la version réellement supportée N-1 et appliquer N. | Migration complète, aucune perte hors contrat, invariants métier et contraintes valides. |
| Double exécution | Rejouer exactement l'étape autorisée ou son orchestrateur. | Aucun delta inattendu, doublon, corruption ou effet secondaire non idempotent. Si un replay est interdit, le refus est explicite et sans mutation. |
| Backward / compensation | Exécuter le down sûr ou la procédure compensatoire déclarée. | Retour à l'état contractuel, ou état compensé documenté et vérifié; aucune promesse de down fictive. |
| Schéma mixte A | Ancienne application sur nouveau schéma pendant la fenêtre de rollout. | Lectures/écritures contractuelles supportées, ou fenêtre de maintenance explicitement requise. |
| Schéma mixte B | Nouvelle application sur ancien schéma si l'ordre de promotion peut créer ce cas. | Comportement supporté ou blocage avant rollout. Le cas peut être déclaré non applicable seulement avec preuve de séquence. |
| Données limites | NULL, volumes élevés, doublons historiques, contraintes et encodages représentatifs de la forme prod. | Résultats déterministes et temps/ressources dans les seuils décidés. |

La mention « idempotent » dans un commentaire de Job ne remplace pas cette
matrice et ne se généralise pas à toutes les migrations.

### 5.3 Chemin de migration production

La chaîne prod est un état contrôlé unique. Le backup préalable est produit et
validé avant que le propriétaire signe l'autorisation qui le référence :

`backup identifié → authorization signée et validée → migrate exact → verify → promote`

avec la branche d'échec obligatoire :

`verify en échec → arrêt du trafic/rollout selon runbook → rollback applicatif + backward/compensation ou restore → verify rollback`.

Le rollback n'est pas exécuté systématiquement après un succès en production.
Il est effectivement répété en pré-production, puis armé et vérifiable dans le
chemin prod. Chaque étape doit :

- consommer le même SHA/digest et la même migration que l'autorisation ;
- être sérialisée par un verrou/concurrency group ;
- produire un reçu horodaté avant de débloquer la suivante ;
- échouer fermé si le backup, le checksum, la compatibilité ou la cible diffère ;
- vérifier schéma, invariants de données et smoke applicatif read-only ;
- empêcher le déploiement applicatif si la migration échoue ;
- empêcher toute migration autonome depuis `run-job`, Job `31`, Makefile ou
  ancienne ref.

L'ordre exact application/schéma, la stratégie expand-contract et le choix
down/compensation/restore restent des décisions de section 9.

## 6. Backups & restore drill

### 6.1 Contrat de backup

S03 fournit un mécanisme de production planifié, distinct des cibles Compose
locales. Son inventaire doit couvrir tous les stores autoritatifs confirmés par
D05; PostgreSQL est explicitement concerné, tandis que le périmètre exact
MinIO/buckets externes reste à établir.

Chaque backup doit avoir :

- un ID stable, la cible, la fenêtre et la version de schéma ;
- un checksum calculé à la création puis revérifié avant restauration ;
- une politique documentée de fréquence, rétention, chiffrement, localisation
  et contrôle d'accès ;
- un statut explicite `complete` ou `failed`, jamais déduit de la seule présence
  d'un objet/PVC ;
- des logs et métriques sans secret ;
- une association au release bundle lorsque le backup précède une migration.

Les valeurs de RPO, RTO, fréquence et rétention ne sont pas inventées dans
cette spec : elles requièrent une décision propriétaire et plateforme.

### 6.2 Restore drill reproductible

Le drill périodique suit ce protocole :

1. sélectionner un backup selon une règle déclarée, sans choisir a posteriori
   uniquement un backup connu comme bon ;
2. vérifier son checksum et ses métadonnées ;
3. créer une cible vierge qui ne partage ni volume ni base avec prod ;
4. restaurer les données et objets entrant dans le périmètre ;
5. vérifier schéma, cardinalités, contraintes et échantillons déterministes ;
6. démarrer le digest applicatif prévu contre la cible restaurée ;
7. exécuter un smoke applicatif read-only et les invariants métier ;
8. mesurer le point restauré et la durée réelle, puis calculer RPO/RTO observés ;
9. produire le reçu, détruire ou isoler la cible selon la politique décidée.

### 6.3 Reçu de drill

Le reçu machine-readable contient au minimum : backup ID, checksum, stores
couverts, horodatages début/fin, point de données restauré, RPO/RTO observés,
identité de la cible vierge, version de schéma, digest applicatif, contrôles
exécutés, résultats, run IDs, acteur et éventuelles dérogations. Une simple
capture d'écran, un Job `Succeeded` ou un PVC existant ne suffit pas.

## 7. Deux artefacts distincts et objectif de preuves non contournables

### 7.1 `PREPROD_ACCEPTANCE`

Cet artefact atteste qu'un release bundle précis a satisfait le contrat dans
une pré-production précise. Il contient au minimum :

- ID d'acceptation, date, environnement, namespace/cluster et endpoint ;
- SHA source complet, digests OCI API/UI/MCP/Jobs et hash du bundle de
  manifestes ;
- version et hash de l'ensemble de migrations ;
- dataset ID/hash, version de forme et reçu de nettoyage ;
- run IDs CI/préprod et résultats de la matrice de migration ;
- reçu du restore drill, preuve du rollback migration et du rollback
  applicatif répétés ;
- images réellement servies (`imageID`), version de schéma et smokes ;
- signature du `PREPROD_ACCEPTANCE_AUTHORITY` de section 4.2 et éventuelles
  réserves.

`PREPROD_ACCEPTANCE` ne contient aucun pouvoir de déploiement et n'est jamais
un input suffisant pour un job production. Son identité de service, sa clé et
ses permissions sont distinctes de celles de l'OWNER et de production.

### 7.2 `PRODUCTION_AUTHORIZATION`

Cet artefact est distinct, postérieur et signé par l'**OWNER humain**, unique
`PRODUCTION_AUTHORIZATION_AUTHORITY`. Un agent ou la CI peut préparer la
demande, jamais l'approuver ni la signer. L'artefact lie exactement :

- l'ID de `PREPROD_ACCEPTANCE` accepté ;
- le SHA et les digests à promouvoir, sans substitution ni rebuild ;
- la cible production et le périmètre de mutation ;
- l'ensemble de migrations, le backup ID/checksum préalable et le runbook de
  rollback/compensation ;
- la fenêtre, l'expiration, les responsables d'exécution/observation et les
  seuils d'arrêt ;
- l'identité de l'approbateur et un nonce/ID à usage unique.

Le job production valide la structure, la signature, la non-expiration, la
non-révocation, l'usage unique et la correspondance de chaque champ. Toute
divergence échoue avant accès aux credentials.

### 7.3 Nature des preuves et limite actuelle

Les preuves minimales visées comme non contournables sont :

- digest OCI résolu au registre puis `imageID` observé sur la cible ;
- SHA source complet et hash du bundle de manifestes ;
- run ID Actions et conclusion des étapes, y compris la condition Kubernetes
  réelle des Jobs ;
- dataset ID/hash et reçu de nettoyage ;
- backup ID/checksum et reçu de restauration ;
- résultat signé des validateurs d'acceptation et d'autorisation.

Les captures d'écran peuvent corroborer une preuve de rendu ou une action
humaine, mais ne remplacent aucun de ces identifiants. Le format, le stockage,
la signature et la durée de conservation des deux artefacts restent à décider;
ils doivent être machine-readable, immuables, auditables et exempts de secrets.

La **non-falsifiabilité reste un objectif, pas un fait acquis**, tant que O9
n'a pas arrêté et fait tester le format canonique, le stockage immuable, les
autorités et clés de signature, la révocation, l'expiration et l'anti-rejeu. En
attendant, aucun fichier, log, conclusion CI ou déclaration de signataire ne
peut être qualifié seul de preuve non falsifiable.

## 8. Critères d'acceptation reproductibles

| ID | Protocole | Succès observable |
| --- | --- | --- |
| RS-01 — push `main` | Pousser un commit témoin ne changeant pas la release, puis inspecter tous les runs associés. | Artefacts immuables possibles; zéro `kubectl`, Job, migration, Pages deploy et écriture de tag mutable. |
| RS-02 — gate quatre surfaces | Faire déclencher chaque surface par un agent sans approbation OWNER, puis refuser/laisser expirer ; répéter avec le gate de substitution si O13 l'impose. | Run bloqué/refusé avant credential; aucun agent ne peut s'auto-approuver; zéro diff cluster/Pages/DB/registre mutable. |
| RS-03 — ancienne ref | Dispatcher une sélection représentative de refs antérieures aux gates. | Aucun credential prod disponible; aucune mutation. `github-pages` est également protégé ou désactivé. |
| RS-04 — promotion autorisée | Faire autoriser par l'OWNER un bundle de test par artefact valide. | Seuls cible, SHA/digests, migration et fenêtre autorisés sont accessibles; toute substitution échoue fermée. |
| RS-05 — images statiques | Scanner tous les `.yaml`, le rendu Kustomize et les manifestes hors bundle. | Aucun tag mutable pour une charge pouvant joindre prod; chaque SHA se résout au digest attesté. |
| RS-06 — images live | Inventorier Deployments, StatefulSets, CronJobs et Jobs du namespace prod, y compris `35b`. | `image`, template CronJob et `imageID` correspondent à l'autorisation; drift et ressources hors bundle sont explicitement nuls ou approuvés. |
| RS-07 — Makefile | Exécuter les cas négatifs sans confirmation, sans kubeconfig, mauvais cluster/namespace, mauvais digest et autorisation absente/expirée. | Aucune commande mutante; sortie non nulle. `PROC-BG-PROD-HOTFIX` est le seul chemin direct d'exception et produit l'audit séparé exigé. |
| RS-08 — RBAC | Exécuter une matrice `kubectl auth can-i` avec l'identité du deployer. | Allowlist minimale dans la cible; refus des Secrets, autres namespaces et verbes non requis. |
| RS-09 — préprod | Exécuter les tests réseau, secrets, DB, stockage, DNS, quota et coût de section 4. | Isolation positive et négative prouvée; aucun endpoint/credential/donnée écrivable prod. |
| RS-10 — migrations | Rejouer toute la matrice de section 5 sur le dataset hashé. | Forward, double exécution/refus sûr, backward/compensation, schémas mixtes et invariants conformes. |
| RS-11 — backup/restore | Sélectionner un backup planifié et exécuter le protocole complet sur cible vierge. | Checksum, smoke applicatif, RPO/RTO observés et reçu complet conformes aux seuils décidés. |
| RS-12 — rollback | En préprod, injecter un échec après migration puis un échec applicatif post-rollout. | Promotion arrêtée; compensation/restore et rollback applicatif ramènent un état vérifié dans les seuils. |
| RS-13 — séparation des artefacts | Présenter seulement `PREPROD_ACCEPTANCE`, tenter de le signer avec l'identité OWNER, puis présenter une autorisation altérée/expirée/réutilisée. | Production refuse chaque cas. Les deux autorités et leurs permissions sont distinctes; seul un `PRODUCTION_AUTHORIZATION` signé par l'OWNER, valide et à usage unique ouvre le gate. |
| RS-14 — Job réel | Provoquer un timeout/échec contrôlé d'un Job de test préprod. | Le run échoue; ni logs présents ni conclusion verte ne masquent l'absence de condition `Complete`. |
| RS-15 — acceptation §11 | Consolider l'endpoint préprod, le restore, le rollback et l'approbation humaine. | Préprod existe; restore et rollback sont attestés; le propriétaire rend séparément GO ou NO-GO. Seul un GO explicite satisfait le critère de promotion §11; un NO-GO est une décision valide mais ne l'accepte pas. Aucun déploiement n'est implicite. |
| RS-16 — drift continu | Sur cible isolée, injecter puis retirer des drifts représentatifs de chaque surface §2 et exercer les événements sentinelles non mutants du détecteur production. | Chaque mutation sans autorisation corrélée alerte l'OWNER dans le seuil décidé, bloque une nouvelle promotion et conserve l'avant/après; le détecteur ne peut rien muter. |
| RS-17 — `35b` figé | Avant S00, inspecter/suspendre le CronJob live et vérifier l'absence de Job dérivé actif ; avant toute réactivation, rendre le bundle Kustomize corrigé et inspecter l'image live. | Suspension reçue avant S00; puis `35b` inclus déclarativement, sur le pipeline data `:<sha-complet>` attesté et son digest, sans `:latest` ni suivi implicite d'une release applicative. |
| RS-18 — gel / break-glass | Pendant S00→S05, tenter une release ordinaire et répéter en préprod le protocole `PROC-BG-PROD-HOTFIX`, y compris expiration/révocation. | La release ordinaire est refusée; seule l'autorisation OWNER bornée à l'incident ouvre le credential temporaire et l'audit complet; sa clôture révoque l'accès et rapproche le drift. |

Chaque protocole enregistre le commit du harness, la commande `make` ou le run
Actions exact, l'environnement, les données, les horodatages et les artefacts.
Un résultat non reproductible sur le même bundle reste `inconnu`, jamais
`accepté`.

## 9. Décisions ouvertes, décisions owner & dissents à préserver

| ID | Décision / statut | Contrat ou options à instruire | Données nécessaires |
| --- | --- | --- | --- |
| O1 — topologie préprod | Niveau d'isolation `poc-k8s` | Cluster partagé avec namespace/base/stockage strictement séparés **vs** cluster, base et stockage dédiés. | D05 : risques de blast radius, capacité, réseau, opérations et coûts. |
| O2 — référence immuable | Forme déployée | Digest OCI direct **vs** tag `:<sha-complet>` non réassignable + digest attesté. | Capacités et politique d'immutabilité réelles des registres SCW/GHCR. |
| O3 — portée du gate | Définition de « production » | Cluster seulement **vs** cluster + Pages + registre + DB/stockage + Jobs + opérateurs directs. | Inventaire des credentials, owners et surfaces publiques. Tant que non décidé, la portée conservatrice est la seconde. |
| O4 — Pages | Articulation des environments | Job `production` puis job Pages protégé **vs** mécanisme compatible avec les contraintes GitHub Pages et un gate unique. | Réglages Pages/environments live et test d'ancienne ref. |
| O5 — accès direct | Traitement de Make/kubeconfigs après la transition | Interdiction hors Actions **vs** maintien de `PROC-BG-PROD-HOTFIX`, sous approbation OWNER unique, séparation agent/approbateur, credentials séparés et audit. | RBAC live, détenteurs et exigences incident. |
| O6 — migration | Rollback de schéma | Down transactionnel, compensation forward, restore, ou combinaison selon migration. | Nature des migrations, durée, volumes et ordre app/schéma. |
| O7 — schéma mixte | Fenêtre de compatibilité | Expand-contract sans coupure **vs** maintenance explicite. | Tests N/N-1, SLO et contraintes produit. |
| O8 — backup | Couverture et objectifs | PostgreSQL seul ou PostgreSQL + MinIO/buckets externes; fréquence/rétention/RPO/RTO à fixer. | Inventaire des stores autoritatifs, volumétrie, coût et criticité. |
| O9 — preuves | Gouvernance des artefacts | Format, signature, stockage immuable, rétention, expiration/révocation et anti-rejeu. | Identités et clés concrètes des deux autorités, tooling plateforme et exigences d'audit. La non-falsifiabilité reste un objectif jusqu'à clôture. |
| O10 — `35b` / charges planifiées | **Décidé (owner 2026-08-15).** Suspendre `35b` immédiatement avant S00 ; ne jamais lui faire tirer du code neuf implicitement. | Pipeline data figé, version CI/CD maîtrisée sur `:<sha-complet>`, réintégration Kustomize et lot de correction gaté avant réactivation. L'activation future des autres CronJobs suspendus reste à instruire, sous la règle absolue « aucune charge planifiée prod sur `:latest` ». | État live, reçu de suspension, ownership, coûts, SLO de fraîcheur, rendu déclaratif et images/digests attestés. |
| O11 — modèle d'approbation | **Décidé (owner 2026-08-15).** Agents/CI initient et poussent ; l'OWNER humain est l'unique approbateur production. | L'invariant initiateur ≠ seul approbateur vise les agents : jamais d'auto-approbation agent. Il ne rend pas le modèle owner-unique insatisfiable. | Tests négatifs d'auto-approbation, identité du reviewer/signataire OWNER et séparation effective des credentials. |
| O12 — fenêtre intérimaire S00→S05 | **Décidé (owner 2026-08-15).** Gel total des releases production pendant toute la transition. | Seul `PROC-BG-PROD-HOTFIX`, borné à un incident critique, autorisé par l'OWNER, temporaire et audité, peut muter production. | Reçus d'ouverture/fermeture du gel, exercice préprod, révocation du credential et preuve de refus des releases ordinaires. |
| O13 — plan/visibilité GitHub | **Décidé (owner 2026-08-15).** La disponibilité des required reviewers est un prérequis externe, jamais une hypothèse repo. | Vérifier plan/visibilité hors repo ; si indisponible, dépôt public si la capacité devient disponible, upgrade plan, ou artefact d'autorisation signé hors GitHub. Le choix concret n'est fait qu'après le constat. | Plan, visibilité et réglages réels du dépôt ; test de blocage avant credential. `EXT-GH-ENV-CAPABILITY` reste ouvert jusqu'à ce constat. |

O11 ferme l'insatisfiabilité contractuelle `EXT-APPROVAL-OWNER-UNIQUE` relevée
par la revue. O13 ne ferme pas `EXT-GH-ENV-CAPABILITY` : il décide le prérequis
et les substitutions admissibles, pas la capacité réelle du dépôt.

Le dissent principal de migration est conservé explicitement : la chaîne
« backup → migrate → verify → rollback » ne signifie pas rollback systématique
après un succès prod. Elle signifie rollback effectivement répété en préprod et
branche de retour obligatoire, testée et armée sur échec production.

## 10. Hors périmètre & inconnues

### 10.1 Hors périmètre de cette EVOL

Cette spécification ne :

- modifie aucun workflow, manifeste, Makefile, réglage GitHub ou ressource
  `poc-k8s` ;
- ne crée ni environnement, secret, backup, dataset, artefact ou run ;
- ne choisit pas les seuils RPO/RTO, le budget ou le fournisseur de stockage ;
- ne donne aucune autorisation de production ;
- ne remplace pas les critères fonctionnels des autres items §11 :
  collaboration, panneaux, carte, fraîcheur municipale, règlements, KPI,
  Warden et couches utilisateur ;
- ne normalise pas les accès opérateur hors dépôt sans décision O3/O5.

### 10.2 Inconnues vérifiables seulement hors lecture repo

- protections de branche `main`, merge rules et règles Actions réelles ;
- plan et visibilité GitHub réels, donc disponibilité de required reviewers
  (`EXT-GH-ENV-CAPABILITY`) ;
- existence/configuration de `production`, présence effective de l'OWNER comme
  unique approbateur, impossibilité d'auto-approbation par un agent, politiques
  de refs et protections de `github-pages` ;
- scope, rotation et historique des secrets GitHub, notamment
  `KUBE_CONFIG_DATA` et credentials registre ;
- RBAC réel de `radar-ci-deployer`, détenteurs de kubeconfigs directs et accès
  break-glass ; le repo ne définit que le ServiceAccount applicatif `radar-app` ;
- état live : cluster réellement ciblé, digests servis, drift, Jobs résiduels et
  existence/activation de `radar-populate-geo-daily` ;
- topologie D05 réelle dans `poc-k8s` : cluster/namespace, réseau, DNS, secrets,
  stockage, quotas, capacité, backups et coûts ;
- caractère autoritatif de PostgreSQL, MinIO et des buckets externes, donc
  périmètre exact de backup/restore ;
- politique d'immutabilité et de rétention des registres SCW/GHCR ;
- valeurs RPO/RTO, fréquence, rétention, chiffrement et localisation des
  backups ;
- stratégie migration/compensation et fenêtre exacte de schéma mixte ;
- identité/clé concrète du `PREPROD_ACCEPTANCE_AUTHORITY`, format, stockage
  immuable, signature, expiration, révocation et anti-rejeu des deux artefacts ;
- mécanisme, couverture et latence réels de la détection continue de drift ;
- compatibilité exacte entre le gate `production` demandé et les contraintes
  de déploiement GitHub Pages.

### 10.3 Résumé

L'état actuel est un **NO-GO** : un push `main` déploie automatiquement le
cluster et déclenche la voie de déploiement Pages, des dispatches peuvent écrire
sans reviewer, et des charges prod peuvent tirer `:latest` sans nouvelle
promotion. `35b` doit être suspendu dans le live avant S00, puis ne peut être
réactivé qu'en pipeline data figé, épinglé et réintégré au bundle déclaratif.

Le chemin de sortie est séquencé sous **gel total production S00→S05**, avec
la seule exception `PROC-BG-PROD-HOTFIX` bornée et auditée : S00 ferme les
quatre surfaces, les anciennes refs, les credentials et les tags mutables et
installe la détection continue de drift ; D05/S01 isolent la préproduction ;
S02 sécurise les migrations ; S03 prouve backup/restore ; S04 porte le
`PREPROD_ACCEPTANCE_AUTHORITY` distinct ; S05 promeut un bundle immuable vers
préprod sans autoriser prod.

La production ne s'ouvre qu'après fermeture de S05 et avec un
`PRODUCTION_AUTHORIZATION` distinct, signé par l'OWNER humain unique, valide et
lié aux mêmes digests que `PREPROD_ACCEPTANCE`, après backup, migration et
vérification, avec rollback réellement répété et armé. La capacité GitHub des
required reviewers doit être prouvée hors repo ou remplacée par l'un des gates
O13 ratifiés.

### 10.4 Inconnues finales

La présente EVOL ne prétend pas connaître les réglages GitHub, reviewers,
plan/visibilité et capacité de required reviewers, protections de branche,
RBAC/deployers, credentials directs, état live du cluster, topologie `poc-k8s`,
existence/activation live de `35b`, digests réellement servis, stores
autoritatifs, RPO/RTO, coûts, politique registre, implémentation du détecteur de
drift ni mécanisme concret de signature. Ces inconnues sont des entrées
obligatoires de D05/S00–S05 ; aucune ne peut être remplacée par un commentaire
de manifeste, un screenshot, une CI verte ou une supposition.
