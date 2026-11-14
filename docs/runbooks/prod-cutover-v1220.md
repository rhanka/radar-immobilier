# Bascule prod v1.2.20 — procédure sous i-cond

**NO-GO. La répétition sur copie prod reste à faire. Aucune mutation prod par cette lane.**
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
RPO accepté : perte des données de PV rafraîchies lors de la restauration. Le refresh les regénère.
Aucune durée chiffrée de perte n’a été fixée par l’owner. Ne pas en inventer.
L’archive préliminaire RO, le roster et le plan sont prêts. La répétition reste à lancer par i-cond.
Voir [les preuves et la commande exacte](../../deploy/prod-cutover/PREPARATION.md).

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
Mesurer backup, restauration, DDL, WAL, 6H, recette et reprise sur cette copie.
Trois heures, dont 45 minutes de reprise, restent un budget non validé.
Attendre la CI verte et la ratification finale. Aucun GO prod dans ce rapport.
