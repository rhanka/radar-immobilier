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
