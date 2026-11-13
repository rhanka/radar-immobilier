# Bascule prod v1.2.20 — procédure sous i-cond

**NO-GO. La répétition sur copie prod reste à faire. Aucun acte prod exécuté par cette lane.**
Candidate : `b7724bdd9015a4f26319897bf240baaf9ee636ae`.
La branche de procédure reste distincte. Aucun tag ni merge ici.

Toutes les commandes passent par `rtk make -f deploy/prod-cutover/prod-cutover.mk`.
`ENV` vient toujours en dernier. Aucun `.env` chargé.
`ENV=prod` reste en lecture seule. `ENV=execution-prod` désigne une exécution future autorisée.
Le kubeconfig est fixé à `$HOME/.kube/radar-prod-tenant-admin.kubeconfig`.

## Ordre de bascule

| Ordre | Acteur | Acte et porte |
| --- | --- | --- |
| 1 | immo | `precheck ENV=prod`. Relever santé, SHA, verrou, 13 empreintes, taille et disque. |
| 2 | owner | Autoriser l’archive. Ratifier comptes, droits et plan exact. Signer planSha256 et rosterSha256 dans APPROVAL. |
| 3 | immo | Sur copie : restore-test, migrate, transition, verify. Démarrer les services locaux isolés. Faire smoke et recette. Les arrêter. Prouver leur terminaison. Faire rollback deux fois. Vérifier schéma 13, données, propriétaires, ACL et accès de l’ancienne release. |
| 4 | owner | Ratifier fenêtre, RPO et opérateur de reprise. Autoriser la prise du verrou. Aucun GO DDL implicite. |
| 5 | k8s | `window-start ENV=execution-prod`. Prendre radar-change-lock, type cutover. Capturer l’ancienne release par API/UI Ready et sondes publiques. Capturer routes, réplicas, suspensions et UID avant arrêt. Conserver le RUN affiché. |
| 6 | k8s | `window-configure RUN=<RUN> ENV=execution-prod`. Appliquer les ConfigMaps approuvées sous ce même verrou. `window-close RUN=<RUN> ENV=execution-prod`. Fermer les routes et arrêter les consommateurs. Neutraliser les contrôleurs non supportés avant la fenêtre. |
| 7 | immo | Fournir EVIDENCE avec ce RUN et les UID terminés. `backup RUN=<RUN> ENV=execution-prod`. Sauvegarde finale après drain. SHA-256, S3 et lecture de retour. Restaurer cette archive sur une nouvelle copie. Conserver son reçu restore.json. |
| 8 | owner | GO avant le premier commit DDL. APPROVAL lie destination, SHA candidat, drain, planSha256 et rosterSha256. Le reçu restore.json porte l’empreinte du backup final. |
| 9 | immo | `migrate RUN=<RUN> ENV=execution-prod`, puis `transition RUN=<RUN> ENV=execution-prod`. Exiger 44 empreintes, open-success, scoped, zéro non résolu et barrière ouverte. Faire verify. |
| 10 | k8s | `window-deploy RUN=<RUN> ENV=execution-prod`. Réutiliser restart_services et private_smoke. Images API/UI/MCP et CronJobs par digest. Routes fermées, CronJobs suspendus et verrou conservé. |
| 11 | immo, PO | Recette privée via accès opérateur isolé. API SHA complet, UI b7724bd, DB/S3 et MCP. Les services candidats peuvent écrire après GO 6H. Aucun ancien écrivain ne redémarre. |
| 12 | owner, k8s | GO distinct : APPROVAL porte reopen=true et run=<RUN>. `window-reopen RUN=<RUN> ENV=execution-prod`. Restaurer routes et suspensions exactes. Smoke public. Libérer le verrou après contrôles. Observer le prochain refresh complet. |
| 13 | owner, CD | Après acceptation et réouverture seulement : GO tag v1.2.20 au SHA candidat. promote-prod fait prepare puis run. L’API candidate est Ready. Les routes sont ouvertes. La base est déjà migrée. |

## Raccordement au CD

Le promote candidat ne sait pas recevoir une fenêtre destructive fermée.
prepare/run attendent des consommateurs observables. run exige une API Ready et des URL publiques.
Son budget peut déclencher une réouverture automatique. Il ne pilote donc pas les étapes 5 à 12.
La fenêtre capture l’ancienne release et l’inventaire avant le drain.
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
Il exige le reçu de rollback et le schéma 13. Il fait le smoke privé.
Vérifier les accès de l’ancienne release avant un nouveau GO de réouverture.
Ne pas cumuler cette voie avec Rollback release ou le rollback générique du CD.

Premier commit DDL : un simple retour d’images ne suffit plus.
Première réouverture : restaurer l’archive perd les nouvelles écritures.
Une nouvelle décision owner sur le RPO est alors requise.

## Recette et prérequis restants

Recette : six périodes et dates ; Pertinence globale ; total/liste/carte ; URL canonique et navigation.
Vérifier exclusions PIIA/dérogations, Écartés et droits de reprise.
Vérifier MCP réel, refus anonyme et prochain refresh complet.
Le reclassement exige un compte PO autorisé. Relever cible, latence, SHA et preuves.
Le tri Chaperon reste interdit par #1080. Les artefacts restent fermés.

Fournir une archive prod autorisée et récente. Joindre empreinte indépendante, provenance et heure du snapshot.
Prévoir PostgreSQL 16/PostGIS jetable, clients PostgreSQL 16 et tous les rôles propriétaires/destinataires.
Charger l’image API au digest épinglé. Fournir roster OIDC, plan 6H et GO exact.
Fournir preuves réelles de terminaison, documents et compte de recette.
Préparer UI/API/MCP locaux sur la copie. Neutraliser refresh et sorties prod.
Prévoir OUTPUT privé, câblage curseur/MCP, fenêtre, RPO et opérateur de reprise.
Voir [les entrées détaillées](../../deploy/prod-cutover/README.md).

Tests isolés : neuf gardes, contrôleur simulé et PostgreSQL avec archive synthétique.
Restauration, 31 migrations, reprise et deux rollbacks complets y sont vérifiés.
Ces preuves ne remplacent pas la copie prod ni le rejeu réel du hook candidat.
Mesurer backup, restauration, DDL, WAL, 6H, recette et reprise sur cette copie.
Trois heures, dont 45 minutes de reprise, restent un budget non validé.
Attendre la CI verte et la ratification finale. Aucun GO prod dans ce rapport.
