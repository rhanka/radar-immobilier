# Bascule prod v1.2.20 — procédure sous i-cond

**NO-GO. Répétition technique faite. Recette humaine et prérequis prod attendus. Aucune mutation prod par cette lane.**
Candidate : `b7724bdd9015a4f26319897bf240baaf9ee636ae`.
La branche de procédure reste distincte. La préparation est intégrée par merge. Aucun tag ni merge dans main.

Toutes les commandes passent par `rtk make -f deploy/prod-cutover/prod-cutover.mk`.
`ENV` vient toujours en dernier. Aucun `.env` chargé.
`ENV=prod` reste en lecture seule. `ENV=execution-prod` désigne une exécution future autorisée.
Le kubeconfig est fixé à `$HOME/.kube/radar-prod-tenant-admin.kubeconfig`.

## Décisions owner du 13 novembre

D1 : tout le train part. La préprod devient la prod.
D2 : comptes, espaces, capacités, gestionnaires et modérateurs identiques à la préprod actuelle.
D3 : statiques actifs. Live désactivé. API et MCP : contrôle general, git off,
edge 0, qualification/invitations/redrive false. Le rendu est dans prod-settings.json.
D4 : créneau au plus tôt après répétition réussie, revue et levée des prérequis.
Décision owner vers 19 h le 13/11 : **« Tout ce soir, bascule décalée »**.
Le périmètre reste complet. Les artefacts statiques sont actifs. Le live reste à 0.
RPO accepté : perte des données de PV rafraîchies lors de la restauration. Le refresh les regénère.
Aucune durée chiffrée de perte n’a été fixée par l’owner. Ne pas en inventer.
L’archive préliminaire RO, le roster et le plan sont prêts. La répétition technique est faite sous i-cond.
Voir [les preuves et la commande exacte](../../deploy/prod-cutover/PREPARATION.md).

## Prérequis artefacts prod avant la fermeture

Les noms de clés ci-dessous ont été lus en préprod le 13/11. Aucune valeur affichée.
Le Secret account-reader y est utilisé. Il est donc aussi requis en prod.
Les références API/MCP sont obligatoires dans `prod-bindings.cjs`.
Le précheck refuse un Secret absent, une clé vide ou le TLS absent. Aucun GO implicite.
Le contrôle RO du 13/11 refuse déjà `radar-artifacts-prod`, absent.
Un inventaire RO du 13/11 confirme les six Secrets artefacts de ce tableau absents en prod.

| Prérequis | Objet prod et clés | Responsable |
| --- | --- | --- |
| S3 statique | `radar-artifacts-prod` : `ARTIFACTS_S3_ACCESS_KEY`, `ARTIFACTS_S3_SECRET_KEY` | k8s gouverne le mint et la rotation. Bucket dédié et droits bornés. |
| Page d’upload | `radar-artifacts-upload-page-prod` : `secret` | immo génère 32 octets aléatoires, encodés en 64 caractères hexadécimaux. |
| Reader | `radar-artifacts-reader-prod` : `ARTIFACTS_READER_GRANT_SECRET`, `ARTIFACTS_READER_SESSION_SECRET` | immo génère chaque clé sur 32 octets. Même Secret pour toutes les instances API. |
| Writer MCP | `immo-mcp-artifact-writer` : `IMMO_MCP_ARTIFACT_DATABASE_URL` | k8s fournit l’URL privée. La cible de rôles crée `immo_mcp_artifact_writer`, absent aujourd’hui. |
| Account reader MCP | `immo-mcp-account-reader` : `IMMO_MCP_ACCOUNT_DATABASE_URL` | k8s fournit l’URL privée. La cible de rôles crée `immo_mcp_account_reader`. |
| Contenu HTTPS | `radar-artifact-content-prod-tls` : `tls.crt`, `tls.key` ; Ingress `radar-artifact-content` | k8s fournit DNS wildcard, certificat et Ingress avant capture de la fenêtre. |

Configuration S3 : bucket `radar-immobilier-artifacts`, endpoint `https://s3.bhs.io.cloud.ovh.net`, région `bhs`.
k8s confirme ces trois valeurs avant le rendu. Elles restent dans les ConfigMaps, sans identifiants.
Variable de rendu : `ARTIFACTS_CONTENT_HOST=pages.immo.sent-tech.ca`, sans schéma ni wildcard.
`render` produit les ConfigMaps. `content-ingress` produit l’Ingress, avec le même hôte wildcard et TLS.
Chaque cible exige un `CONFIGURATION` absolu neuf. Aucun apply dans cette lane.

Provisionnement **futur**, par l’acteur indiqué, après autorisation séparée :

```sh
rtk make -f deploy/prod-cutover/artifacts.mk s3-secret PROVISION_OWNER=k8s ARTIFACTS_S3_ENV_FILE=<dotenv-S3-prive> ENV=provision-prod
rtk make -f deploy/prod-cutover/artifacts.mk generated-secrets PROVISION_OWNER=immo ENV=provision-prod
```

Le dotenv dédié ne contient que les deux clés S3. k8s le fournit à la cible. Aucun agent ne le lit.
La cible ne le source jamais. `kubectl create --from-env-file` ne l’affiche pas.
Ces cibles conservent les Secrets existants. Elles ne renouvellent pas les clés à chaque appel.
Les fichiers aléatoires temporaires sont privés puis supprimés. Aucune valeur aléatoire ne sort sur stdout.
Ces cibles ne sont exécutées ni par la répétition ni par le précheck RO.

Rotation S3 : k8s crée un nouvel identifiant limité au bucket. Il met à jour le Secret sans afficher ses valeurs.
Il redémarre API/MCP sous contrôle du verrou, puis valide publication et lectures statiques.
Il révoque ensuite l’ancien identifiant. En échec, il rétablit le Secret antérieur avant révocation.
Tracer date, responsable et identifiant de version du Secret. Ne jamais tracer les clés.
Rotation upload/reader : même coordination. La rotation reader invalide les grants et sessions existants.

Le migrateur candidat réapplique les grants. Il **ne crée pas** les rôles absents.
Après fermeture et preuve de terminaison, exécuter `artifact-roles RUN=<RUN> ENV=execution-prod`.
La cible exige le GO exact et la propriété du verrou. Elle crée des LOGIN sans privilèges administratifs.
Les mots de passe viennent des URLs privées des Secrets, sans argument SQL ni affichage.
Les rôles existants sont conservés. Après les 44 migrations, `transition` réapplique les grants restreints.
La lecture des noms/courriels reste désactivée en prod. Aucun rôle n’est créé dans cette lane.

Rendu exigé sur API et MCP : `ARTIFACTS_CONTROL_MODE=general`, `IMMO_ARTIFACTS_GIT_MODE=off`,
`IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=0`, qualifications/invitations/redrive false.
`IMMO_ARTIFACTS_BUILDER_URL` doit être absent, y compris des env directs et des ConfigMaps appliquées.
Le test de rendu vérifie ces portes, le bucket, l’endpoint, la région et l’accord hôte/Ingress/TLS.

Recette artefacts obligatoire avant GO de réouverture :

1. Avec un compte autorisé, publier un petit HTML statique depuis la page d’upload ou MCP.
2. Lire son URL HTTPS publique. Vérifier le contenu, le certificat et le type HTML, sans cookie de session immo.
3. Lire le même artefact par MCP authentifié. Vérifier le même identifiant, la révision et le contenu.
4. Vérifier refus hors espace et publication live indisponible. Relever SHA, URL, statut et durée, sans jeton.

Ce smoke artefacts complète le smoke de santé. Son résultat doit être consigné séparément.

## Ordre de bascule

| Ordre | Acteur | Acte et porte |
| --- | --- | --- |
| 1 | immo | `precheck ENV=prod`. Relever santé, SHA, verrou, 13 empreintes, taille et disque. |
| 2 | owner, i-cond | Archive RO autorisée et prise. D2 fixe comptes et droits préprod. Fournir APPROVAL liant les empreintes exactes du roster et du plan privés. |
| 3 | immo | Sur copie : restore-test, migrate, transition, verify. Démarrer les services locaux isolés. Faire smoke et recette. Les arrêter. Prouver leur terminaison. Faire rollback deux fois. Vérifier schéma 13, données, propriétaires, ACL et accès de l’ancienne release. |
| 4 | owner | D4 fixe au plus tôt après répétition et accepte la perte PV regénérable. Désigner l’opérateur de reprise. Autoriser la prise du verrou. Aucun GO DDL implicite. |
| 5 | k8s | `window-start ENV=execution-prod`. Prendre radar-change-lock, type cutover. Capturer l’ancienne release par API/UI Ready et sondes publiques. Capturer routes, réplicas, suspensions et UID avant arrêt. Conserver le RUN affiché. |
| 6 | k8s | `window-configure RUN=<RUN> ENV=execution-prod`. Appliquer les ConfigMaps approuvées sous ce même verrou. `window-close RUN=<RUN> ENV=execution-prod`. Fermer les routes et arrêter les consommateurs. Neutraliser les contrôleurs non supportés avant la fenêtre. |
| 7 | immo | Fournir EVIDENCE avec ce RUN et les UID terminés. `backup RUN=<RUN> ENV=execution-prod`. Sauvegarde finale après drain. SHA-256, S3 et lecture de retour. Restaurer cette archive sur une nouvelle copie. Conserver son reçu restore.json. |
| 8 | owner | GO avant le premier commit DDL. APPROVAL lie destination, SHA candidat, drain, planSha256 et rosterSha256. Le reçu restore.json porte l’empreinte du backup final. |
| 9 | immo | `artifact-roles RUN=<RUN> ENV=execution-prod`, puis `migrate RUN=<RUN> ENV=execution-prod` et `transition RUN=<RUN> ENV=execution-prod`. Exiger 44 empreintes, open-success, scoped, zéro non résolu et barrière ouverte. Faire verify. |
| 10 | k8s | `window-deploy RUN=<RUN> ENV=execution-prod`. Réutiliser restart_services et private_smoke. Images API/UI/MCP et CronJobs par digest. Routes fermées, CronJobs suspendus et verrou conservé. |
| 11 | immo, PO | Recette privée via accès opérateur isolé. API SHA complet, UI b7724bd, DB/S3 et MCP. Les services candidats peuvent écrire après GO 6H. Aucun ancien écrivain ne redémarre. |
| 12 | owner, k8s | GO distinct : APPROVAL porte reopen=true et run=<RUN>. `window-reopen RUN=<RUN> ENV=execution-prod`. Restaurer routes et suspensions exactes. Smoke public. Libérer le verrou après contrôles. Observer le prochain refresh complet. |
| 13 | owner, CD | Après acceptation et réouverture seulement : GO tag v1.2.20 au SHA candidat. promote-prod fait prepare puis run. L’API candidate est Ready. Les routes sont ouvertes. La base est déjà migrée. |

## Raccordement au CD

Le promote candidat ne sait pas recevoir une fenêtre destructive fermée.
prepare/run attendent des consommateurs observables. run exige une API Ready et des URL publiques.
Son budget peut déclencher une réouverture automatique. Il ne pilote donc pas les étapes 5 à 12.
La fenêtre capture l’ancienne release et l’inventaire avant le drain.
Fournir `PREVIOUS_RELEASE`, manifeste historique indépendant avec SHA complet et digests vérifiés.
La capture exige les mêmes digests et un SHA servi égal au complet ou à ses sept premiers caractères.
Elle conserve les valeurs réellement servies pour les sondes de rollback. Le manifeste candidat reste strict.
Sous le verrou acquis, la fenêtre refuse radar-prepared-db en preparing ou d’état inconnu.
Elle refuse les runs v* non terminés de build-push-images, qui porte le job promote-prod.
Elle refuse aussi les dispatchs actifs dont la cible est indéterminée et les Jobs CD non terminés.
Les pages GitHub sont toutes consultées. Un échec de lecture fait refuser. Aucun abandon par délai.
Après DDL et 6H, elle déploie les digests épinglés du build main `43506353942`.
Elle réutilise les fonctions du contrôleur. Elle ne lance ni prepare, ni run, ni les DDL du CD.
Elle attend le GO séparé avant reopen. Aucun blocage externe ne doit empêcher le smoke public à cette étape.
Le tag ultérieur promeut les mêmes images. Son inventaire désigne alors la candidate.
La reprise vers le schéma 13 reste celle de cette procédure.

## Verrou et reprise

Chaque acte écrivant reprend le même radar-change-lock. Le type reste cutover.
Le marqueur manualV1220 distingue cette procédure. Aucun nouveau mécanisme de verrou.
Entre les commandes, l’exécuteur est marqué stopped. Le verrou reste présent.
La commande suivante exige le RUN original. Elle utilise le CAS et la preuve de fin existants.
Un exécuteur actif ou de fin inconnue ne peut pas être repris. Aucun délai ne libère le verrou.
Une promotion concurrente échoue à la prise du verrou.
Les opérations DB vérifient aussi le RUN et l’exécuteur exact avant écriture.
Les copies restent locales. Elles ne prennent aucun verrou prod.

Après échec, garder la fermeture. Lire `operator.mk status ENV=prod`.
Reprendre par les commandes de cette fenêtre avec le RUN original.
Une capture interrompue avant drain se reprend par `window-start RUN=<RUN>`.
Ne pas utiliser le resume générique pour ce record manuel. Aucun effacement forcé.

## Retour arrière

Après tout déploiement partiel, refaire `window-close RUN=<RUN> ENV=execution-prod`.
Mettre à jour la preuve de terminaison. Garder le même RUN.
Avant DDL, les données sont inchangées. Le rollback de sauvegarde reste possible.
Après le premier commit DDL, la restauration complète est obligatoire.
`rollback RUN=<RUN> ENV=execution-prod` remet schémas et données de l’archive finale.
Il conserve les propriétaires et rejoue les ACL originales. Les rôles doivent préexister.
`window-rollback-services RUN=<RUN> ENV=execution-prod` remet les images inventoriées.
Il restaure d’abord les ConfigMaps et les env inventoriés avant configuration.
Il exige le reçu de rollback et le schéma 13. Il fait le smoke privé.
Vérifier les accès de l’ancienne release avant un nouveau GO de réouverture.
Ne pas cumuler cette voie avec Rollback release ou le rollback générique du CD.

Premier commit DDL : un simple retour d’images ne suffit plus.
Première réouverture : restaurer l’archive perd les nouvelles écritures.
La perte de données PV regénérables est acceptée par D4. Toute perte hors de ce périmètre exige une décision distincte.

## Recette et prérequis restants

Recette : six périodes et dates ; Pertinence globale ; total/liste/carte ; URL canonique et navigation.
Vérifier exclusions PIIA/dérogations, Écartés et droits de reprise.
Vérifier MCP réel, refus anonyme et prochain refresh complet.
Le reclassement exige un compte PO autorisé. Relever cible, latence, SHA et preuves.
Le tri Chaperon reste interdit par #1080. Les statiques sont actifs selon D3. Le live reste désactivé.

Archive prod RO prête : 283590496 octets, dump 72 s, deux empreintes identiques.
PostgreSQL 16/PostGIS et clients conteneurisés préparés. Rôles recréés par copy-up local.
Images API/UI téléchargées par digest. Roster OIDC et plan 6H privés prêts. Fournir GO exact.
La commande `copy-rehearse OWNER=i-cond ENV=rehearsal` prépare l’attestation locale et les preuves Docker.
Elle prépare UI/API/MCP, IdP et S3 isolés. Refresh et sorties prod sont absents.
La recette humaine exige encore les PV autorisés et un compte Product Owner existant.
Le câblage prod est préparé dans prod-bindings et prod-content-ingress.json. Aucun objet prod n’est provisionné.
K8s doit fournir les Secrets, rôles, grants, bucket et DNS/TLS. L’IdP prod doit autoriser les scopes annoncés.
Le wildcard pages doit précéder la capture de fenêtre. `CURSOR_REFERENCE` désigne la clé privée conservée.
window-deploy refuse une clé différente. L’opérateur de reprise reste à désigner.
Voir [les entrées détaillées](../../deploy/prod-cutover/README.md).

Tests isolés : 13 gardes, huit scénarios contrôleur/IdP et PostgreSQL avec archive synthétique.
Restauration, 31 migrations, reprise et deux rollbacks complets y sont vérifiés.
Ces preuves ne remplacent pas la copie prod ni le rejeu réel du hook candidat.
Les mesures backup, restauration, DDL, WAL, 6H, smoke et reprise figurent ci-dessous.
Trois heures, dont 45 minutes de reprise, restent un budget non validé.
Attendre la CI verte et la ratification finale. Aucun GO prod dans ce rapport.

## Mesures de la répétition du 13/11

Commande lancée sous i-cond. Prod restée en lecture seule.
Run de la copie conservée : `e64455b4-15a0-4a94-badf-5c2a370bd742`.
Le [rapport détaillé](../../deploy/prod-cutover/REHEARSAL.md) garde les erreurs et les trois séries DDL.
Les reçus complets restent privés. Aucun secret ni sujet OIDC dans ce tableau.

| Étape | Secondes | Résultat |
| --- | ---: | --- |
| Dump RO préliminaire déjà pris | 72 | 283590496 octets ; double empreinte identique |
| Restauration de la copie conservée | 113,569 | 13 empreintes |
| 31 DDL | 34,361 | 44 empreintes |
| 6H initial | 3,767 | open-success ; scoped ; barrière ouverte ; zéro non résolu |
| Rejeu 6H | 2,569 | Même résultat |
| Vérification comptes et espace | 7,224 | Six appartenances et droits conformes |
| Reprise services et stockage | 10,601 | Sur services déjà créés ; démarrage froid non mesuré ici |
| Smoke santé | 0,042 | UI, SHA, DB/S3, refus anonymes et discovery MCP |
| Rollback complet 1 | 108,501 | Schémas, données et ACL originales ; retour à 13 |
| Rollback complet 2 | 286,380 | Même restauration complète ; retour à 13 |
| Remise finale : DDL / 6H / rejeu 6H | 50,097 / 3,897 / 138,218 | Même copie remise au candidat |
| Remise finale : vérification / services / smoke | 0,787 / 52,547 / 0,087 | 44 empreintes ; services et stockage prêts ; smoke réussi |

Après les deux rollbacks : propriétaires des 27 tables conformes au catalogue de l’archive.
Propriétaire de public : pg_database_owner. Lecture du rôle applicatif radar réussie.
Lecture du writer candidat refusée. Aucun grant candidat rejoué au schéma 13.
TLS local, SHA servi et préflight CORS vérifiés depuis l’hôte.
La recette humaine, les PDF et le smoke artefacts authentifié restent à consigner.

La copie reste à `https://recette.localhost:15321`, au schéma candidat. Aucun down -v sur cette copie avant recette humaine.
**Coupure projetée : socle de 292,984 s, soit 4 min 52,984 s, avec la remise finale.**
Calcul : 72 + 113,569 + 50,097 + 3,897 + 0,787 + 52,547 + 0,087.
Le rejeu 6H est exclu. La procédure prod ne l’appelle qu’une fois.
En combinant les maxima DDL et 6H observés séparément, ce socle atteint 18 min 24,965 s.
Ce scénario combine des passages différents. Il ne borne pas la coupure totale fermeture → réouverture.
Il faut ajouter drain, transfert S3 et lecture de retour, rôles, déploiement k8s,
recette privée, décisions GO et réouverture. Ces étapes prod ne sont pas mesurées.
**La coupure totale reste non validée.** Le dump final après drain reste obligatoire.
Le rollback ajoute le retour des configurations et images, le smoke privé et un GO distinct.

Les clients conteneurisés et le commit sont inclus dans les durées DDL.
WAL : 347989216 octets sur la copie conservée ; 370208912 au premier passage.
Le stockage local est passé de 96 à 97 % d’occupation. Des attentes IO ont été observées.
L’écart entre séries ne prouve pas une durée propre aux seuls DDL.

| Migration | Avant retours, s | Remise finale, s | Premier passage, s |
| --- | ---: | ---: | ---: |
| 0014_facets_signal | 0,886 | 0,520 | 4,486 |
| 0015_artifacts_core | 0,744 | 0,544 | 130,672 |
| 0016_artifacts_lifecycle | 0,625 | 0,742 | 121,137 |
| 0017_workspace_memberships | 0,525 | 0,597 | 9,877 |
| 0018_facet_scope_bindings | 0,731 | 0,435 | 1,268 |
| 0019_facet_workspace_archive | 0,969 | 1,076 | 98,786 |
| 0020_facet_projection_revisions | 2,121 | 0,530 | 3,386 |
| 0021_facet_lot_history | 0,684 | 0,552 | 9,717 |
| 0022_facet_lot_cutover | 0,573 | 0,783 | 2,077 |
| 0023_facet_lot_versions_fence | 0,684 | 0,702 | 1,508 |
| 0024_artifacts_coordinator | 0,720 | 0,741 | 1,326 |
| 0025_artifacts_actor_quotas | 0,531 | 0,511 | 1,567 |
| 0026_artifacts_reader_tickets | 0,531 | 0,636 | 1,237 |
| 0027_pw_write_persistence | 0,551 | 0,723 | 80,455 |
| 0028_artifacts_p0b | 0,515 | 0,584 | 130,850 |
| 0029_artifacts_parity | 0,426 | 0,451 | 5,225 |
| 0030_admission_sync | 0,541 | 0,628 | 5,687 |
| 0031_artifacts_reader_tickets_ttl | 0,469 | 0,412 | 1,354 |
| 0032_artifacts_sharing_access_mode | 0,636 | 0,621 | 1,283 |
| 0033_artifacts_upload_sessions | 0,514 | 0,531 | 1,285 |
| 0034_artifacts_reader_consent | 0,549 | 0,713 | 89,929 |
| 0035_artifacts_upload_pages | 0,544 | 0,713 | 1,311 |
| 0036_artifacts_git_bindings | 0,539 | 0,659 | 1,133 |
| 0037_artifacts_live_drafts | 0,738 | 0,512 | 0,966 |
| 0038_artifacts_live_invitations | 0,613 | 0,699 | 0,912 |
| 0039_artifacts_host_build_ledger | 0,588 | 0,734 | 0,841 |
| 0040_artifacts_git_attach_intents | 0,709 | 0,519 | 0,739 |
| 0041_drop_artifacts_live_invitations | 0,405 | 0,445 | 0,713 |
| 0042_artifacts_live_invitations | 0,528 | 0,804 | 0,774 |
| 0043_artifacts_host_build_failure | 0,867 | 0,236 | 0,561 |
| 0044_signal_effective_dates | 10,809 | 10,462 | 9,285 |

Les refus rencontrés sont corrigés : readiness TCP, base template0, accès au réseau interne,
clients interrompus, image UI manquante, UID du proxy et CORS du mock.
Les gardes ont bloqué les preuves Docker invalides. Aucun échec DDL dans ces trois séries.
Vingt tests ciblés et huit scénarios contrôleur/IdP passent.
Le lint passe. Les stacks de tests ont été supprimées avec down -v.
