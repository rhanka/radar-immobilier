# Bascule prod v1.2.20 — procédure sous i-cond

**GO owner reçu pour le provisionnement puis la bascule. Exécution par i-cond dès les portes vertes. Cette lane reste en lecture seule en prod.**
Candidate : `b7724bdd9015a4f26319897bf240baaf9ee636ae`.
La branche de procédure reste distincte. La préparation est intégrée par merge. Aucun tag ni merge dans main.

Toutes les commandes passent par `rtk make -f deploy/prod-cutover/prod-cutover.mk`.
`ENV` vient toujours en dernier. Aucun `.env` chargé.
`ENV=prod` reste en lecture seule ici. `provision-prod APPLY=1` est une action future non exécutée.
`ENV=execution-prod` désigne une bascule future autorisée.
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

**État actualisé le 14/11.**
k8s a fourni le bucket privé `radar-immobilier-artifacts`, préfixe `artifacts/radar-immobilier/`.
Endpoint : `https://s3.bhs.io.cloud.ovh.net`. Région : `bhs`.
La clé limitée est disponible dans le `.env` opérateur. Aucun `.env` lu ici.
Champs : `ARTIFACTS_PROD_S3_ACCESS_KEY`, `ARTIFACTS_PROD_S3_SECRET_KEY`, `ARTIFACTS_PROD_S3_USER`,
`ARTIFACTS_PROD_S3_USERID`, `ARTIFACTS_PROD_S3_ENDPOINT`, `ARTIFACTS_PROD_S3_REGION`,
`ARTIFACTS_PROD_S3_BUCKET`, `ARTIFACTS_PROD_S3_PREFIX`.
Put/list/get/delete dans le préfixe sont attestés. Les accès hors préfixe sont refusés.
DNS fourni : `*.pages.immo.sent-tech.ca → 51.79.100.177`, TTL 300. Aucun DNS pour l’hôte nu.
Rotation tous les 90 jours. Prochaine : 11/02/2027. k8s renouvelle la clé. immo actualise le Secret.

immo prend en charge le Certificate wildcard et l’Ingress de contenu, en miroir préprod.
Issuer : `ClusterIssuer/letsencrypt-prod`, DNS-01. Traefik websecure vers `radar-api:http`.
immo importe le Secret S3, génère les trois clés upload/reader et les mots de passe MCP.
immo crée les deux rôles MCP et leurs URL internes. Le migrateur applique ensuite les grants.
Le tenant admin possède les droits create requis. Le précheck les revérifie.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk provision-prod ENV=prod
# Action future. Non exécutée pendant cette préparation.
rtk make -f deploy/prod-cutover/prod-cutover.mk provision-prod APPLY=1 ARTIFACTS_PROD_ENV_FILE=<chemin-absolu-prive> ENV=prod
```

Défaut : `--dry-run`. Aucun fichier privé lu. Aucun objet créé.
APPLY lit uniquement les champs S3 attendus du fichier privé 0600. Aucun sourcing ni affichage.
Les secrets passent en mémoire et sur stdin. Les clés existantes sont conservées.
Un objet incomplet ou divergent bloque avant création. Une reprise conserve les créations déjà faites.
Précheck : cluster exact, verrou libre, droits, pod DB unique, base radar, rôles restreints,
clés existantes, URL MCP et spécifications Certificate/Ingress.
Aucun Deployment, ConfigMap, service ou donnée applicative modifié.

**Dry-run prod réussi. Objets prévus :**

- Secret `radar-artifacts-prod`.
- Secret `radar-artifacts-upload-page-prod`.
- Secret `radar-artifacts-reader-prod`.
- Secret `immo-mcp-artifact-writer`.
- Secret `immo-mcp-account-reader`.
- Certificate `radar-artifact-content-prod`.
- Ingress `radar-artifact-content`.
- Rôle DB `immo_mcp_artifact_writer`.
- Rôle DB `immo_mcp_account_reader`.

cert-manager créera le Secret `radar-artifact-content-prod-tls`. Attendre Certificate Ready.
Les rôles sont des LOGIN sans privilèges administratifs. Les grants candidats attendent les migrations.

**CORS requis.** Le navigateur fait des PUT signés directement vers S3.
k8s pose le CORS avec son principal administrateur OVH via `PutBucketCors`.
Corps exact : `deploy/prod-cutover/artifacts-cors.json`. Origine prod seule, PUT/GET/HEAD,
headers content-type/content-length, ETag exposé, cache 300 s.
Son outil S3 sécurisé appelle `put-bucket-cors` sur le bucket indiqué, avec cet endpoint et cette région.
Puis `get-bucket-cors` et OPTIONS depuis `https://immo.sent-tech.ca`. Refuser une origine étrangère.
La clé limitée n’a aucun droit `PutBucketCors` attesté. Ce droit porte sur le bucket entier.
Les accès racine sont refusés. Ne pas élargir cette clé. Le principal administrateur k8s doit agir.
La cible immo ne modifie pas le bucket. `precheck` appelle désormais `GetBucketCors` avant les autres contrôles.
Une règle absente, illisible ou différente du JSON attendu bloque la bascule.
La clé du Secret doit permettre cette lecture. Un AccessDenied bloque aussi. k8s règle ce droit sans élargir les accès objet.

## Séquence exacte de ce soir pour i-cond

Chaque ligne est exécutée séparément. Arrêter au premier code non nul. Ne pas lancer le CD pendant la fenêtre.
Acteur conducteur : **i-cond**. Exécution immo et k8s selon les étapes ci-dessous.
Les GO provisionnement et bascule sont acquis. i-cond les matérialise dans l’attestation privée ; ne pas les redemander.
La recette et la décision de réouverture restent consignées avant ouverture.

Préparer le processus opérateur sans sourcing de fichier. Aucun `.env` ne doit être lu.
k8s fournit le port-forward prod en loopback `127.0.0.1:25432`, les fichiers pgpass privés
`prod-admin.pgpass` et `prod-ro.pgpass`, et l’injection de PGPASSWORD pour le hook.
Le rôle destination est `radar`. Le rôle source reste `radar_db_ro_prod`.
Les identités S3 de sauvegarde sont injectées dans le processus, jamais dans les arguments.
Les clients PG16 et s5cmd opérateur doivent être disponibles. Ne pas mettre le `bin` de la copie 25433 dans PATH.
k8s fournit aussi une **nouvelle base jetable vide** `radar_cutover_final` en loopback `127.0.0.1:25435`.
Elle vient de template0. Les rôles du dump préexistent, comme dans rehearsal-roles.sql.
Son pgpass est `final-copy.pgpass`. Ne pas réutiliser la copie de recette déjà migrée.
Le fichier S3 de provisionnement s’appelle `s3-provision.input`, mode 0600 ; seuls les champs attendus y figurent.
`previous-release.json` est le manifeste historique indépendant. Ne pas le dériver des sondes publiques.
`prod-approval.json` contient owner, SHA candidat, expiration future, host/port/database,
planSha256 et rosterSha256. Les empreintes portent sur les fichiers préparés, sans les réécrire.

```sh
export KUBECONFIG="$HOME/.kube/radar-prod-tenant-admin.kubeconfig"
export PLAN="$HOME/.local/share/radar-prod-copy/plan.json"
export ROSTER="$HOME/.local/share/radar-prod-copy/roster.json"
export RELEASE="$PWD/deploy/prod-cutover/release.json"
export PREVIOUS_RELEASE="$HOME/.local/share/radar-prod-copy/previous-release.json"
export CURSOR_REFERENCE="$HOME/.local/share/radar-prod-copy/classification-cursor.secret"
export APPROVAL="$HOME/.local/share/radar-prod-copy/prod-approval.json"
export OUTPUT="$HOME/.local/share/radar-prod-copy/prod-window-v1220"
export CONFIGURATION="$HOME/.local/share/radar-prod-copy/configuration-tonight.json"
export EVIDENCE="$OUTPUT/drain.json"
export ARCHIVE="$HOME/.local/share/radar-prod-copy/prod-final-v1220.dump"
export FINAL_OUTPUT="$HOME/.local/share/radar-prod-copy/final-restore-v1220"
export PGHOST=127.0.0.1 PGPORT=25432 PGUSER=radar PGDATABASE=radar
export PGPASSFILE="$HOME/.local/share/radar-prod-copy/prod-admin.pgpass"
export SOURCE_PGHOST=127.0.0.1 SOURCE_PGPORT=25432 SOURCE_PGUSER=radar_db_ro_prod SOURCE_PGDATABASE=radar
export SOURCE_PGPASSFILE="$HOME/.local/share/radar-prod-copy/prod-ro.pgpass"
export BACKUP_ENDPOINT=https://s3.bhs.io.cloud.ovh.net
export BACKUP_URI=s3://sentropic-pgbackup/immo/v1220/tonight
export CUTOVER_ALLOW_PROD=b7724bdd9015a4f26319897bf240baaf9ee636ae
```

**1. immo, 30–90 s. Provisionner avant toute fermeture.** Le premier appel reste RO.
Le second est la mutation autorisée exécutée par i-cond. Création seule, clés existantes conservées.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk provision-prod ENV=prod
rtk make -f deploy/prod-cutover/prod-cutover.mk provision-prod APPLY=1 ARTIFACTS_PROD_ENV_FILE="$HOME/.local/share/radar-prod-copy/s3-provision.input" ENV=prod
rtk make -f deploy/prod-cutover/prod-cutover.mk certificate-wait ENV=prod
```

**2. k8s puis immo, 1–5 min.** k8s pose le CORS demandé avec son principal administrateur.
Attendre Certificate Ready, wildcard DNS et droits GetBucketCors. Le précheck doit sortir avec code 0.
La configuration doit être un nouveau fichier. À la reprise, conserver le fichier déjà rendu.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk cors-precheck ENV=prod
rtk make -f deploy/prod-cutover/prod-cutover.mk precheck ENV=prod
rtk make -f deploy/prod-cutover/prod-cutover.mk render ENV=prod
```

**3. k8s sous i-cond, 30–90 s.** Capturer avant drain. Même RUN pour toute la suite.
Le répertoire OUTPUT privé doit exister en 0700 avant la preuve de drain.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk window-start ENV=execution-prod
export RUN=$(rtk make -s -f deploy/prod-cutover/prod-cutover.mk window-run ENV=prod)
rtk make -f deploy/prod-cutover/prod-cutover.mk window-configure RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk window-close RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk window-evidence RUN="$RUN" ENV=execution-prod
```

i-cond reporte le JSON exact de `drain.json` dans `prod-approval.json`, champ drain.
Ajouter writersStopped=true. Le RUN du drain est celui du verrou. Conserver les empreintes approuvées.
Ce sont les constatations du drain réel, jamais celles de la copie.

**4. immo, 3–8 min. Sauvegarde finale et restauration de contrôle.** Dump observé : 72 s.
Restauration observée : 114 s. L’upload et la relecture S3 ajoutent leur durée réelle.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk backup RUN="$RUN" ENV=execution-prod
export RESTORE_SHA256=$(rtk make -s -f deploy/prod-cutover/prod-cutover.mk backup-sha ENV=prod)
rtk make -f deploy/prod-cutover/prod-cutover.mk restore-test PGHOST=127.0.0.1 PGPORT=25435 PGUSER=radar PGDATABASE=radar_cutover_final PGPASSWORD= PGPASSFILE="$HOME/.local/share/radar-prod-copy/final-copy.pgpass" OUTPUT="$FINAL_OUTPUT" RUN="$RUN" ENV=test-prod-cutover-final
rtk make -f deploy/prod-cutover/prod-cutover.mk accept-final-restore ENV=prod
```

**5. immo, 1–6 min. Point de non-retour : premier COMMIT DDL dans migrate.**
Dès ce commit, un retour d’images seul est interdit. Le retour exige la restauration complète.
Les 31 DDL ont pris 34–50 s dans deux séries. Le scénario de maxima séparés dépasse 18 min. Ne pas garantir cinq minutes.
La procédure conserve ses délais bornés. Aucun délai ne vaut preuve de terminaison.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk artifact-roles RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk migrate RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk transition RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk verify ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk window-deploy RUN="$RUN" ENV=execution-prod
```

Exiger 44 empreintes, open-success, scoped, zéro non résolu et barrière ouverte.
Le rollout et le smoke privés gardent routes fermées, schedules suspendus et verrou présent.
**6. i-cond, immo et Product Owner, 5–15 min.** Faire la recette privée décrite ci-dessous.
Inclure publication HTML, lecture HTTPS privée à l’URL canonique et lecture MCP du même artefact.
Les Ingress publics restent en maintenance. Dans un second terminal avec le même environnement,
lancer le proxy privé :

```sh
export ARTIFACTS_CONTENT_HOST=pages.immo.sent-tech.ca
rtk make -f deploy/prod-cutover/prod-cutover.mk window-private-https RUN="$RUN" ENV=execution-prod
```

k8s fournit quatre fichiers privés hors dépôt : TLS_CERT/TLS_KEY pour immo.sent-tech.ca,
CONTENT_TLS_CERT/CONTENT_TLS_KEY pour le wildcard ARTIFACTS_CONTENT_HOST. Les exporter par chemin,
sans afficher leur contenu. Le conteneur nginx candidat utilise les port-forwards existants.
Il écoute seulement sur 127.0.0.2:443. Aucun Ingress n’est modifié.
Pour curl : `curl -q --noproxy '*' --resolve immo.sent-tech.ca:443:127.0.0.2 https://immo.sent-tech.ca/health`.
Pour le HTML : utiliser `--resolve <hôte-exact-de-la-page>:443:127.0.0.2` et son URL HTTPS canonique.
Pour publier et lire via MCP, conserver la même résolution privée et l’authentification habituelle.
Le navigateur de recette doit résoudre immo.sent-tech.ca et le wildcard de contenu vers 127.0.0.2.
Vérifier le certificat sans option insecure. Depuis un autre poste sans cette résolution,
les mêmes routes doivent répondre en maintenance. Arrêter le terminal privé par Ctrl-C avant réouverture.
Le trap supprime le proxy et les port-forwards. Un refus conserve le verrou et la fermeture.
Consigner les preuves sans jeton. Si acceptée, i-cond consigne reopen=true et run dans APPROVAL.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk window-reopen RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk smoke ENV=prod
```

Réouverture : 30–90 s attendues. Observer ensuite le premier refresh complet.
Sans résolution privée, relire aussi le même HTML par HTTPS et le même artefact par MCP.
Cette lecture confirme le chemin Ingress restauré. Un refus déclenche la décision de reprise ci-dessous.
La réouverture est le second seuil : une restauration ultérieure perd aussi les nouvelles écritures.
Budget opérateur : 15–35 min hors attente k8s et refresh. Réserver 15 min pour la reprise.

**Retour arrière, immo puis k8s sous i-cond, 3–10 min attendues.**
Avant toute tentative de migration, si configuration, fermeture ou sauvegarde échoue,
exécuter la voie d’abandon suivante. Elle ne demande ni backup.json ni RESTORE_SHA256.
Elle termine le drain, vérifie les 13 empreintes historiques, restaure ConfigMaps, env,
images, routes et schedules sous le même verrou. Aucun dump n’est restauré.
Une tentative de migration ou un schéma divergent refuse cette voie et impose la restauration complète.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk window-abort RUN="$RUN" ENV=execution-prod
```

Après une réouverture réussie, le verrou a été libéré. Avant toute restauration,
l’owner consigne dans APPROVAL `rollbackAfterReopen=true`, `acceptPostReopenWriteLoss=true`
et le RUN initial. Cette décision accepte la perte de **toutes les écritures depuis la sauvegarde finale**,
y compris celles après réouverture. Sans cette décision, ne pas restaurer.
Reprendre le reçu radar-cutover-receipt avec la commande suivante. Elle crée le verrou par create exclusif,
vérifie RUN, inventaire, fin de l’exécuteur et inactivité CD, puis referme sans recapturer l’état candidat.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk window-recover RUN="$RUN" ENV=execution-prod
```

En cas de fermeture interrompue après récupération, reprendre window-close avec ce même RUN.
Continuer ensuite la restauration complète ci-dessous. Conserver OUTPUT, archive et manifeste historique initiaux.
Au moindre refus : garder le même RUN. Ne pas supprimer le verrou. Après rollout partiel, refermer d’abord.
Si un hook survit, ajouter STOP_RUN_CONTAINERS=1 à window-close ; la disparition doit être prouvée.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk window-close RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk window-evidence RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk rollback RUN="$RUN" ENV=execution-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk window-rollback-services RUN="$RUN" ENV=execution-prod
```

Vérifier schéma 13, propriétaires, ACL et accès legacy. Ne pas rejouer les grants candidats.
Après window-evidence, actualiser aussi le champ drain d’APPROVAL avant rollback ; conserver le RUN.
Faire la recette privée historique. Consigner reopen=true/run, puis window-reopen avec le même RUN.
Un smoke candidat échouera sur l’ancienne version : utiliser le smoke historique intégré à window-reopen.
Après réouverture, toute perte hors PV régénérables exige décision owner avant restauration.

**7. i-cond, après recette acceptée et réouverture seulement. CD différé.**
La commande suivante cible le SHA candidat, jamais la tête de procédure. Ne pas l’exécuter dans cette préparation.
Durée de déclenchement : moins de 30 s. La durée du CD dépend de GitHub Actions.

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk release-tag TAG_GO=v1.2.20 ENV=release-prod
rtk make -f deploy/prod-cutover/prod-cutover.mk pr-status ENV=test-prod-cutover
```

Suivre le run `build-push-images` du tag jusqu’au succès de promote-prod. Aucun rebuild attendu.
Le tag refuse s’il existe déjà. En cas de push interrompu, vérifier la ref distante avant toute reprise.
Le down -v de la base finale jetable relève de k8s après conservation du reçu ; celui de la copie attend la fin de recette.

Rendu exigé sur API et MCP : `ARTIFACTS_CONTROL_MODE=general`, `IMMO_ARTIFACTS_GIT_MODE=off`,
`IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=0`, qualifications/invitations/redrive false.
`IMMO_ARTIFACTS_BUILDER_URL` doit être absent, y compris des env directs et des ConfigMaps appliquées.
Le test de rendu vérifie ces portes, le bucket, l’endpoint, la région et l’accord hôte/Ingress/TLS.

Validation des correctifs de relecture finale : 28 gardes, 12 scénarios contrôleur/IdP,
trois scénarios Docker (TERM, KILL, TLS candidat), intégration PostgreSQL 13 → 44 → 13,
cinq tests de workflows et un test du kubeconfig explicite sur les 11 configurations CD.
ESLint et syntaxe passent. Données synthétiques uniquement ; aucune mutation prod.

Recette artefacts obligatoire avant GO de réouverture :

1. Avec un compte autorisé, publier un petit HTML statique depuis la page d’upload ou MCP.
2. Lire son URL HTTPS canonique par le bypass loopback privé ci-dessus. Vérifier le contenu, le certificat et le type HTML, sans cookie de session immo. Vérifier aussi le refus public depuis un autre poste.
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

Après échec, garder la fermeture. Le diagnostic exige aussi le kubeconfig tenant explicite :
`rtk make -f deploy/cutover/operator.mk status KUBECONFIG="$HOME/.kube/radar-prod-tenant-admin.kubeconfig" ENV=prod`.
Un KUBECONFIG absent, multiple ou pointant vers le fichier par défaut est refusé avant kubectl.
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
Images API/UI téléchargées par digest. Roster OIDC et plan 6H privés prêts. Consigner le GO acquis dans APPROVAL.
La commande `copy-rehearse OWNER=i-cond ENV=rehearsal` prépare l’attestation locale et les preuves Docker.
Elle prépare UI/API/MCP, IdP et S3 isolés. Refresh et sorties prod sont absents.
La recette humaine exige encore les PV autorisés et un compte Product Owner existant.
Le câblage prod est préparé dans prod-bindings et prod-content-ingress.json. Aucun objet prod n’est provisionné.
Bucket et DNS sont fournis. immo provisionne Secrets, rôles, Certificate et Ingress. k8s confirme le CORS. L’IdP prod doit autoriser les scopes annoncés.
Le wildcard pages doit précéder la capture de fenêtre. `CURSOR_REFERENCE` désigne la clé privée conservée.
window-deploy refuse une clé différente. L’opérateur de reprise reste à désigner.
Voir [les entrées détaillées](../../deploy/prod-cutover/README.md).

Tests isolés : 26 gardes, huit scénarios contrôleur/IdP et PostgreSQL avec archive synthétique.
Restauration, 31 migrations, reprise et deux rollbacks complets y sont vérifiés.
Ces preuves ne remplacent pas la copie prod ni le rejeu réel du hook candidat.
Les mesures backup, restauration, DDL, WAL, 6H, smoke et reprise figurent ci-dessous.
Trois heures, dont 45 minutes de reprise, restent un budget non validé.
Attendre la CI verte et les préchecks prod. Le GO owner provisionnement puis bascule est acquis.

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
Le rejeu final de 138,218 s contre 2,569 s mesure toute l’invocation, lancement Docker inclus.
Les deux verdicts sont open-success. L’idempotence est validée. Une durée identique n’est pas garantie.
Le stockage local est à 97 % et des attentes IO sont observées. Cela étaye une contention locale.
Aucune mesure interne ne sépare SQL, lancement et IO. La cause exacte des 138 s reste non démontrée.
Ce délai n’est donc pas une durée fonctionnelle attendue de 6H.
En prod, c’est un risque de dépassement de fenêtre. Le scénario des maxima conserve cette mesure.
Après interruption, ne jamais relancer ou restaurer tant qu’un hook du RUN subsiste.
Le correctif hookfix impose étiquettes, trap et preuve de disparition. Après SIGKILL, arrêt explicite requis.
Conserver le verrou, examiner le verdict et le journal, puis reprendre le même RUN ou décider le rollback.
Les 4 min 53 s projetées ne garantissent pas la coupure. Les 18 min 25 s ne sont pas une borne haute.
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

## Validation de finalisation

Merge hookfix `e1dec8111` intégré par `d3866bbde`. Six conflits résolus.
Remise au vert depuis `61fdba631` : chemin Node issu de process.execPath, contrôleurs/IdP conteneurisés.
Le lanceur ferme stdin sans input. SQL conserve le pipe. Les tests Docker gardent le lanceur Node d’origine.
Readiness PostgreSQL : attendre TCP après le serveur temporaire d’initialisation.
Les preuves et les étiquettes de conteneurs conservent le RUN original.
Résultats : 26/26 gardes, dont les deux gardes containers.test.cjs ; 8/8 scénarios contrôleur/IdP ;
2/2 interruptions Docker TERM/KILL réelles ; 1/1 intégration PostgreSQL, avec deux rollbacks ; ESLint et syntaxe verts.
Aucune assertion supprimée. Aucun délai augmenté. Aucun test sauté.
Commande complète reproductible : `rtk make -f deploy/prod-cutover/prod-cutover.mk verify-local ENV=test-prod-cutover`.
Chaque stack de tests est nettoyée avec down -v. La copie de recette est conservée.
Dry-run prod RO : 5 Secrets, 1 Certificate, 1 Ingress et 2 rôles MCP à créer. Aucun APPLY exécuté.
dotenvRead=false et valuesPrinted=false. Aucun secret affiché.
Le CORS est maintenant une porte GetBucketCors bloquante. Le provisionnement puis le CORS k8s précèdent le precheck complet.
La CI du SHA publié est à consulter dans la PR. La revue formelle harness historique reste selection-failed.
