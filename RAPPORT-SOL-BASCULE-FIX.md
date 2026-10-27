# Correction des blocages de bascule préprod — 27 octobre 2026

Les deux défauts d’outillage sont corrigés et les vérifications locales passent.
Aucun push, build Docker, déploiement, accès cluster ou bascule DB effectué.
Le rapport complet de la tentative 6H du 27 octobre a été lu avant modification.

## Fermeture retenue

- Aucune CRD : un Service ClusterIP sans sélecteur ni endpoints reçoit tous
  les backends des Ingress du namespace, y compris les backends par défaut.
- La liste déclarée doit couvrir exactement les Ingress présents. Le Service
  est lié à la tentative ; ses EndpointSlices et anciens Endpoints sont relus.
- Les Deployments consommateurs sont arrêtés et tous les CronJobs suspendus.
  PostgreSQL reste disponible pour le Job opérateur. Les contrôles de processus
  survivants, anciennes instances, Jobs actifs, endpoints et gel CD restent requis.
- Le Job reste non prêt et exige toujours l’acteur métier autorisé et les droits
  de l’opération. Aucun garde d’identité image, DB ou reçu n’a été assoupli.
- Avant mutation : sauvegarde de chaque spec Ingress complète avec nom, UID,
  binding et image dans `ingress-snapshot.json`. Chaque patch teste UID et spec.
  Hosts, TLS, classe Ingress et annotations existantes sont conservés.
- `restore-ingresses` restaure exactement ces specs, après contrôle de fermeture
  et de tous les UID ; il vérifie le résultat et conserve les reçus/empreintes.
  Il ne redémarre aucun consommateur et ne modifie aucun état DB.
- Q1/Q2 gardent tous les Ingress publics fermés. `tunnel-api` ouvre seulement
  `127.0.0.1:18872` vers l’API qualifiée ; la session métier reste exigée.
  Après Q2 seulement, `reopen-api` expose santé/auth/workspaces. UI, MCP,
  autres Ingress, CronJobs et CD restent fermés.

Le mode d’emploi et les paramètres `maintenance.service`, `ROUTES` et le tunnel
sont documentés dans `docs/spec/BASE_API_ACTIVATION.md`, section préprod.
Une restauration de routes n’autorise jamais le retour de consommateurs legacy
après transition scoped ; la reprise DB reste une opération forward-only protégée.

## Identité de construction

Le workflow transmet désormais le SHA complet de 40 caractères à l’image API,
y compris lors du build de secours depuis un tag. Le Dockerfile refuse les
identités courtes ou malformées ; `unknown` reste réservé au build local et
continue d’être refusé par le véhicule opérateur. Le fichier immuable
`/workspace/api/release-sha` et `GIT_SHA` portent la même identité complète.

Les tags d’image CD et l’identité UI restent à sept caractères. Les trois gardes
de version servie comparent l’API au SHA complet et l’UI au SHA court. Le garde
de rollback reconnaît également un tag fautif court dans le SHA API complet.

## Vérifications

Commande : `rtk make -f tools/make/bascule-fix.mk verify ENV=test-bascule-fix`.
Campagne finale : **2026-10-27T10:22:02Z**.

| Vérification | Résultat |
|---|---|
| Syntaxe shell et espaces du diff | PASSED |
| Opérateur hermétique, cluster sans commandes CRD | PASSED — 129 cas |
| Couverture Ingress, chemins/default backend, endpoints, survivants/CD | PASSED |
| Restauration exacte, UID remplacé, snapshot étranger, restauration dangereuse | PASSED |
| Fermeture publique pendant Q1/Q2 et tunnel loopback | PASSED |
| Couche réelle du Dockerfile : identités complètes/locales et refus invalides | PASSED — 8 cas |
| Corps réels des gardes workflow prod/préprod/historique | PASSED — 12 cas |
| Rollback, dont SHA API complet correspondant au tag fautif | PASSED — 14 assertions |
| Rendus kustomize préprod et base production | PASSED |
| Points d’entrée API : 25 références, 101 fichiers, 24 points d’entrée | PASSED |
| Régressions des points d’entrée image | PASSED — 47 cas |
| Rendu H3 désactivé et isolation auth préprod | PASSED |
| `actionlint` | SKIPPED — binaire indisponible |
| Build/push image, dry-run serveur, vérification du contrôleur réel, activation 6H | SKIPPED — hors intervention locale |

FAILED final : **0**. Deux reproductions négatives ont précédé les corrections :
l’ancien préflight refuse le cluster sans CRD, et l’ancienne couche Dockerfile
accepte à tort une identité courte. Les corrections passent les mêmes régressions.
Un premier lancement du rendu utilisait un mauvais chemin/paramètre dans le
nouveau runner ; le runner a été corrigé avant la campagne finale.

Les journaux, rendus et empreintes sont dans `tmp/bascule-fix-evidence/` :
`test-operator.log`, `test-workflow.log`, `render.log`, `verification.sha256`.
La revue manuelle est consignée dans `review.md`. La sélection des pairs selon
`harness-review` est `selection-failed` : aucun catalogue mesh accessible dans
la session pour établir deux modèles admissibles sur hôte Claude. Aucun
consensus indépendant n’est revendiqué ; aucun pair n’a été lancé.

## Livraison locale

- Branche : `fix/bascule-preprod-blockers`.
- Base : `7510a0d1f3e89891f1f9dc58c786b18431c78037`.
- SHA du code vérifié : `b02772543b82dc8fc9f9bd715ea143fe88a8faf2`.
- Métadonnées Git partagées en lecture seule : commits conservés dans
  `tmp/bascule-fix-evidence/backup.git`, sans modification du Git partagé.
- Bundle : `tmp/bascule-fix-evidence/bascule-fix.bundle`.
- Reçu final : `tmp/bascule-fix-evidence/delivery.json` porte le SHA de livraison
  incluant ce rapport, le SHA-256 du bundle et le chemin du dépôt d’audit.
- Audit : chaque commit ≤150 lignes, sujet Conventional Commits anglais ≤72
  caractères, sans corps ni trailer ; `git diff --check`, `bundle verify`,
  import dans un dépôt distinct, égalité du SHA/arbre et `git fsck`.
- Aucun fichier d’environnement lu, aucune exécution Python, aucune pile Docker
  démarrée ou arrêtée, aucun push. La qualification réelle et la nouvelle bascule
  nécessitent l’image reconstruite/publiée et leurs propres reçus opérateur.

## Corrections revues astra

Les deux revues de la PR #929, `astra-929-a.md` et `astra-929-b.md`, ont été
lues en entier dans `.lanes/conductor/tmp/revues/` du checkout racine. Leurs
deux constats bloquants et le constat non bloquant sont acceptés et corrigés.
Cette série commence strictement après `76636465d6fce99b323f843f8c639e86167b002c`.

**Restauration et concurrence.** Le snapshot conserve désormais UID et
resourceVersion initiaux ainsi que les specs/versions renvoyées par chaque
patch de fermeture. La restauration compare tous les Ingress à l’état fermé
dérivé du snapshot initial et aux versions fermées sauvegardées. Un changement
de host, TLS, UID ou version est refusé avant toute écriture. Les patchs testent
atomiquement UID, resourceVersion et spec fermée sauvegardée ; une course après
le contrôle préalable échoue explicitement. Aucun nouvel état concurrent
n’est accepté comme base de restauration. Les anciennes sauvegardes dépourvues
de versions fermées complètes sont refusées. Le readback vérifie les specs
initiales en excluant uniquement la version avancée par la restauration.

**Réseau hors Ingress.** L’outil inventorie tous les Services, EndpointSlices,
anciens Endpoints et ports hôte des pods et modèles de workloads du namespace,
ainsi que les types de routes disponibles. Il refuse NodePort, LoadBalancer,
ExternalName, IP externes, champs nodePort, publication d’adresses non prêtes,
hostNetwork/hostPort et routes/politiques alternatives non prises en charge.
Le contrôle des endpoints couvre tout le namespace : pendant la maintenance,
seuls les pods PostgreSQL inventoriés sont admis par nom/UID ; après activation,
les pods API de l’image qualifiée peuvent être admis sous l’isolation vérifiée.
Les refus réseau interviennent avant les mutations de fermeture ou le
redémarrage de l’API, et sont revérifiés après son démarrage/redémarrage.

La voie retenue reste un **contrôle avec refus documenté**, sans installation
ni modification automatique de NetworkPolicy. Une politique default-deny
d’Ingress couvrant tout le namespace est requise. Les autorisations additives
doivent viser exclusivement PostgreSQL ou les pods Traefik avec sélecteurs de
pod et de namespace stricts. Des règles plus larges, même inutilisées à cet
instant, sont refusées. La simple présence de ces objets n’est pas une preuve
de leur application : `maintenance.networkIsolation` doit porter des sondes CNI
réelles récentes, liées au binding, à l’image, au contexte, au namespace et à
l’empreinte exacte des politiques et de leurs versions. Ces sondes couvrent
les IP de pods/Services et l’origine nœud, avec la couverture source/nœud
décrite dans le runbook. Absence de support, de preuve ou divergence : refus.
La compatibilité des politiques actuelles et le comportement réseau réel de
la préprod restent `unverified` ; aucune qualification CNI n’est fabriquée.

**Qualification sans Git privé.** Les substitutions `GIT_DIR/GIT_WORK_TREE`
sont réservées aux opérations de livraison. Le vérificateur utilise le Git
du checkout courant et conserve SHA, empreinte du diff et empreinte des
sources, y compris les nouveaux fichiers. Le test couvre un checkout neuf,
des métadonnées privées absentes/périmées et une redirection Git héritée.

**Vérifications finales :**

- `make -f tools/make/bascule-fix.mk verify-clean-checkout ENV=test-bascule-fix`
  exécute la commande `verify` documentée dans un clone ordinaire propre,
  dépourvu de `tmp/bascule-fix-evidence/backup.git`.
- SHA qualifié : `4e5e24e16fc63a16a657d568f8721028eeb2c477`, diff vide ;
  l’empreinte des sources correspond à celle du worktree de livraison.
- PASSED : 219 cas opérateur, dont host/TLS/version concurrents, course au
  patch, expositions directes, Service supplémentaire et sondes CNI absentes,
  périmées ou étrangères ; 3 cas d’identité du checkout ; 8 cas d’identité
  image ; 12 cas workflow ; 14 assertions rollback ; 47 cas points d’entrée ;
  rendus préprod/production, isolation auth/H3 et syntaxe shell.
- FAILED final : 0. Le test de concurrence a d’abord reproduit l’écrasement
  avec l’ancienne restauration, puis passe avec les préconditions sauvegardées.
- SKIPPED : `actionlint` absent ; image publiée, réseau/CNI réels, CI distante
  et activation 6H non exécutés. Aucun Docker, fichier d’environnement ou Python.
- Preuves et reçu du checkout propre : `tmp/bascule-fix-evidence/astra/fresh-qualification.json`.
- Nouveau bundle incrémental : `tmp/bascule-fix-evidence/astra/bascule-fix.bundle`.
  Son SHA de livraison et son SHA-256 sont dans `astra/delivery.json` ; audit
  par import distinct, contrôle SHA/arbre et `git fsck`. Les reçus antérieurs
  restent conservés hors du sous-répertoire `astra/`.
- Commits Conventional anglais ≤72 caractères, sans corps/trailer, ≤150 lignes
  chacun, dans `astra/backup.git`. Aucun push ni accès cluster effectué.

## Corrections seconde passe

La revue `astra-929-r2b.md` a été lue en entier. Cette série repart de
`d13986ce592f72d30d7eabb7a33495be473757b3`, déjà présent dans le dépôt de secours
et sur origin. Seuls les deux refus demandés ont été ajoutés au préflight.

- **PostgreSQL :** toute politique susceptible de sélectionner PostgreSQL doit
  borner chaque règle autorisante à des `podSelector` locaux avec `matchLabels`
  non vide. Une règle `{}`, un `from` absent/vide, un pair vide, un sélecteur de
  pods vide, un `namespaceSelector` ou un `ipBlock` sont refusés explicitement :
  `Unbounded PostgreSQL ingress sources are forbidden`. Les sélecteurs larges
  sans composant explicitement différent de PostgreSQL reçoivent le même
  contrôle. `ingress: []` n’autorise aucun accès et reste un refus réseau valide.
  L’ancien test positif `ingress: [{}]` est devenu négatif.
- **Middlewares Traefik :** les annotations `router.middlewares` et les clés
  ou valeurs d’annotations `traefik.*` mentionnant un middleware ou une
  référence de fournisseur (`@file`, `@kubernetescrd`, etc.) provoquent le refus
  `Traefik middleware annotations are forbidden`. Le contrôle précède toute
  création, modification ou mise à l’échelle lors de `close` et `start-api`.
  Aucun middleware n’est résolu ou supprimé, aucune autre mécanique ajoutée.

Vérifications ciblées : `make -f tools/make/bascule-fix.mk check ENV=test-bascule-fix`
et `make -f tools/make/bascule-fix.mk test-operator ENV=test-bascule-fix` :
**PASSED, 242 cas opérateur, aucun échec final**. Les nouveaux cas vérifient les
messages de refus et l’absence de toute commande mutante. Les annotations
Traefik ordinaires, comme une priorité numérique, restent couvertes positivement.
La régression PostgreSQL a été reproduite avant correction ; les résultats
synthétiques et journaux sont dans `tmp/bascule-fix-evidence/astra-r2/`.

Le nouveau bundle incrémental est `astra-r2/bascule-fix.bundle`, prérequis
`d13986ce` ; `astra-r2/delivery.json` consigne le SHA final, l’empreinte SHA-256
du bundle et son audit par import séparé, égalité SHA/arbre et `git fsck`.
Chaque commit est Conventional anglais ≤72 caractères, sans corps ni trailer,
≤150 lignes. Aucun push, accès cluster ou Docker ; aucun fichier d’environnement
lu ni nouvelle qualification de l’état réel de préprod revendiquée.
