# Mode opératoire immo — préparation uniquement

Cette branche prépare la candidate b7724bd. Elle ne sera pas taguée comme version applicative.
Le manifeste `release.json` vient de l’artefact `cutover-release-<SHA>` du build main 43506353942.
Ses deux digests sont épinglés. MCP et CronJobs applicatifs emploient l’image API.
Les sources SQL et le journal doivent correspondre aux objets Git du SHA candidat.

## Cibles autonomes

| Cible | Effet | Borne |
| --- | --- | --- |
| `prerequisites` | Liste les binaires disponibles. Aucun environnement chargé. | 150 s |
| `precheck ENV=prod` | Lectures HTTP, cluster, SQL read-only et disque. Refuse toute porte invalide. | 150 s, requêtes 15 s |
| `backup` | Dump custom avec ACL et propriétaires ; SHA-256 ; S3 ; lecture de retour. | dump 840 s, trois transferts 180 s chacun |
| `restore-test` | Archive vérifiée vers base jetable. Rôles préexistants requis. Produit restore.json et backup.json liés à cette copie. | 1 800 s |
| `migrate` | Préfixe exact ; 31 transactions DDL + reçu Drizzle atomique ; temps par fichier et WAL. | 5 s verrou, 300 s instruction, 540 s fichier |
| `transition` | Migrateur candidat pour grants de service, puis hook 6H candidat. | 550 s ; garde interne 535 s |
| `verify` | Lecture de 44 empreintes, espace scoped, barrière, comptes et appartenances. | plafond global 3 600 s |
| `smoke` | UI, SHA UI/API, DB/S3, refus anonyme espaces/MCP, discovery OAuth. | 6 × 10 s |
| `rehearsal` | restore-test → migrate → transition → verify → rollback → rollback. Services locaux arrêtés. Le smoke et la recette exigent la séquence manuelle. | plafond global 3 600 s |
| `rollback` | Reset schémas + restauration atomique complète ; ACL originales séparées. | 1 800 s + ACL 60 s |
| `k8s-plan`, `cd-plan` | Affichent les actes futurs. Aucune exécution cluster/tag/workflow. | 150 s |
| `test`, `integration`, `down` | Gardes puis DDL natif synthétique ; nettoyage `down -v`. | 90 / 300 s |
| `lint` | ESLint et test du contrôleur dans le runtime Node, puis `down -v`. | 180 s |
| `window-*` | Capture, fermeture, déploiement privé et réouverture séparée. Même verrou cutover. Exécution prod future uniquement. | 1 200 s par acte |

Chaque cible d’exécution a un plafond externe de 3 600 secondes. Arrêt puis vérification du journal si issue indéterminée.
`migration-times.jsonl` conserve chaque durée. `migrations.json` mesure aussi le WAL global ; d’autres écritures peuvent augmenter cette valeur.
Les reçus lient SHA, empreinte et identité physique de base. Conserver OUTPUT dans un répertoire privé hors Git.
Les erreurs n’affichent ni SQL, ni ligne métier, ni secret. Les entrées JSON refusent les fichiers .env et les liens symboliques.

## Répétition sur copie : prérequis manquants

La répétition prod **n’a pas eu lieu**. Aucun dump prod n’a été lancé.
Le rôle `radar_db_ro_prod` existe. Ses identifiants n’ont pas été lus. Aucun canal de connexion RO utilisable par cette lane n’a été attesté.
L’hôte possède Node, Docker, s5cmd et kubectl. Il ne possède ni psql, ni pg_dump, ni pg_restore dans PATH.
Fournir un runtime opérateur avec les clients natifs PostgreSQL 16, sans installer de rôle prod par cette lane.

L’owner doit fournir ou faire autoriser :

1. Une archive custom récente de `radar` et son SHA-256 indépendant. Provenance prod et heure du snapshot requises. Ou une autorisation future de dump RO.
2. Un accès réseau explicite à la DB et le rôle RO existant. CONNECT, USAGE des schémas, SELECT des tables, séquences et journal ; aucune capacité DML/DDL, superuser, réplication ou bypass RLS. Vérifier les grants hérités. Les credentials restent injectés par l’opérateur.
3. Une instance PostgreSQL 16/PostGIS jetable locale. Base `radar_cutover_<identifiant>`, hôte 127.0.0.1, localhost ou ::1. Aucun port partagé avec UAT. Tous les rôles propriétaires et destinataires de l’archive doivent préexister. Le rôle opérateur doit pouvoir restaurer propriétaires et ACL. Accès à `pg_control_system()` requis.
4. L’image API candidate déjà présente dans Docker. `image-check` constate son absence locale ; le runner interdit le pull implicite. Référencer `RELEASE=<chemin absolu du manifeste épinglé>`. Le hook réel reste non vérifié tant que ce prérequis manque.
5. Un plan 6H approuvé. Les comptes doivent être présents et approuvés dans la copie. PLAN pointe vers ce JSON. ROSTER pointe vers le tableau JSON exact de ses accounts. APPROVAL contient owner, sha, expiresAt, planSha256 et rosterSha256. Ces empreintes SHA-256 portent sur les octets des fichiers. Toute modification, même de format, exige un nouveau GO. Voir `../cutover/plan.example.json`.
6. Une preuve réelle de terminaison des processus de restauration/migration de la copie. Ne pas inventer de preuve prod. `EVIDENCE` contient run UUID, release SHA complet, instances et completedAt ISO de moins de 24 h.
7. UI/API/MCP candidats locaux pointant vers cette même copie. Refresh et sortie réseau vers la prod désactivés. `SMOKE_URL=http://127.0.0.1:<port>` doit servir ces services. Un compte de recette local autorisé et les documents nécessaires sont requis.

Entrées communes : `OUTPUT` absolu et privé ; `ARCHIVE` absolu ; `RESTORE_SHA256` ; PGHOST, PGPORT, PGUSER, PGDATABASE explicites. Les clients natifs utilisent PGPASSFILE. Le hook reçoit PGPASSWORD par injection de processus, sans argument secret ni fichier .env. Les noms de variables seules sont transmis à Docker.

Exécution future sur copie, après fourniture de ces prérequis :

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk restore-test ENV=rehearsal
rtk make -f deploy/prod-cutover/prod-cutover.mk migrate ENV=rehearsal
rtk make -f deploy/prod-cutover/prod-cutover.mk transition ENV=rehearsal
rtk make -f deploy/prod-cutover/prod-cutover.mk verify ENV=rehearsal
rtk make -f deploy/prod-cutover/prod-cutover.mk smoke ENV=rehearsal
```

Arrêter ensuite tous les services locaux de cette copie. Mettre à jour EVIDENCE avec leur terminaison.
Garder le même RUN. Lancer deux fois `rollback ENV=rehearsal`.
Vérifier schéma 13, données, propriétaires, ACL et accès des rôles de l’ancienne release.
Le reçu backup.json est produit par restore-test. Ne pas copier ou fabriquer un reçu de sauvegarde prod.
Le reçu contient SHA candidat, empreinte de l’archive, RUN, drain et identité physique de la copie.
Le contrôle synthétique intégré répète cette restauration et ces accès avec une vraie archive custom.

Les variables sont injectées dans le processus avant ces commandes. Aucun chargement de fichier d’environnement.
Après restauration, un même reçu permet la reprise aux migrations déjà commises. Une nouvelle copie exige un nouveau OUTPUT.
Une interruption après commit de restauration mais avant reçu est indéterminée : recréer uniquement cette base jetable, puis restaurer. Ne pas effacer une base live pour débloquer une répétition.
Ne jamais présenter les 2,649 s du test synthétique comme la mesure de cette répétition.

## Sauvegarde finale et exécution prod future

`ENV=prod` refuse toutes les mutations avant connexion DB. Seuls précontrôle et smoke y sont permis.
La voie future `ENV=execution-prod` exige CUTOVER_ALLOW_PROD égal au SHA complet et APPROVAL pointant vers une attestation JSON privée.
Cette attestation contient sha, owner, expiresAt, host, port numérique et database exacts.
Elle contient aussi planSha256, rosterSha256, writersStopped=true et drain égal au JSON EVIDENCE.
Le RUN du drain égale celui de radar-change-lock. lockFree n’est plus une porte.
Chaque opération mutatrice reprend le verrou existant par CAS. Elle vérifie son exécuteur avant écriture.
La fenêtre conserve le verrou entre les commandes. Une promotion concurrente doit refuser.
Pour la réouverture, l’attestation porte aussi reopen=true et run=<RUN>.
La capture précède le drain. Les variables PLAN, ROSTER, RELEASE et APPROVAL restent explicites.
Le [runbook](../../docs/runbooks/prod-cutover-v1220.md) fixe l’ordre. Il diffère le tag après recette et réouverture.
CONFIGURATION est un JSON ConfigMap radar-cutover-6h, ou une List incluant aussi radar-api.
Le namespace est radar-immobilier. Le texte de plan.json doit avoir exactement l’empreinte du PLAN approuvé.
window-configure reprend le même verrou avant application. Les rôles et références Secret sont des prérequis provisionnés séparément.

Pour `backup`, SOURCE_PGHOST/PORT désignent le même serveur que PGHOST/PORT. SOURCE_PGDATABASE=radar et SOURCE_PGUSER=radar_db_ro_prod. SOURCE_PGPASSFILE est fourni par l’opérateur. Le mot de passe destination ne peut pas être repris côté source.
BACKUP_ENDPOINT=https://s3.bhs.io.cloud.ovh.net et BACKUP_URI=s3://sentropic-pgbackup/immo/v1220/<identifiant>. L’empreinte forme la clé de l’objet. Identité S3 injectée hors Git. Droits bucket pour immo, pas de purge ni de changement IAM dans cette lane.
Au moins quatre fois la taille DB libre est exigée côté dump et côté volume prod au précontrôle. Mesurer séparément la réserve de la copie, les index et le WAL ; ce seuil ne garantit pas le dimensionnement.
Le dump conserve propriétaires et ACL, pas les rôles globaux. Inventorier ces rôles avant GO.
La copie restaure ces mêmes droits. Le rollback conserve les propriétaires et rejoue les ACL au schéma 13.
Un refus de restauration ou d’ACL maintient le NO-GO.

Une sauvegarde préliminaire sert à la répétition. Le backup de reprise doit être repris **après le drain final**.
Restaurer cette archive finale en test. Copier son reçu restore.json dans le dossier opérateur de la prod. `migrate` compare son empreinte au backup final et lie le drain au run.
Après échec partiel d’upload, `backup` reprend le même dump, lié au même drain. Ne pas changer de contexte dans le même OUTPUT.
Après rollback, ne pas appliquer les grants du candidat au schéma 13. Restaurer les ACL de l’archive, puis faire vérifier les accès de v1.2.19.

## Comptes, espaces et accès à ratifier

Le hook **ne crée aucun compte**. Chaque sujet OIDC doit préexister, avec status=approved dans account_users.
Un plan contient un espace unique. Toutes les destinations doivent égaler workspaceSlug.
L’acteur figure dans accounts et possède manageMembers=true.
Le hook crée l’espace et ses appartenances actives si nécessaire. Il rattache les historiques personnels et active scoped. Il refuse droits révoqués, conflits et rattachements ambigus.

| Élément | Attendu ou décision owner |
| --- | --- |
| `agence-chaperon-immobilier` | Slug du plan exemple. Confirmer sa création et son libellé en prod. Aucun espace prod n’a été créé ici. |
| Comptes utilisateurs | Fournir chaque sujet OIDC prod et son espace. Aucun roster prod n’est encore approuvé. |
| Gestionnaires | Désigner au moins l’acteur avec manageMembers. Ne pas attribuer ce droit à tous par défaut. |
| Modérateurs | Désigner moderateArchive. Ce droit permet la reprise des archives partagées. |
| Autres membres | Appartenance active pour les lectures et opérations personnelles. Ne pas ouvrir les capacités lots 6K par effet de bord. |
| Curseur classement | k8s fournit CLASSIFICATION_CURSOR_KEY_ID et référence CLASSIFICATION_CURSOR_SECRET stable, ≥32 octets décodés. Valeurs jamais affichées. Le hook ne crée pas ces clés. |
| MCP connecté | Créer hors de cette lane les rôles SQL restreints approuvés. immo-mcp-account-reader fournit la référence IMMO_MCP_ACCOUNT_DATABASE_URL ; IMMO_MCP_DATABASE_NAME correspond à radar. Scopes immo:read et immo:search selon opération. Membership active requise ; plusieurs espaces exigent un sélecteur explicite. |
| Receiver strict | Décider séparément MCP_SIGNAL_SEARCH_ENABLED, STRICT_RECEIVER_* et l’identité workload. Ne pas activer le répertoire des personnes en prod. |
| Artefacts | Maintenir fermés sauf décision distincte. Le train applicatif ne vaut pas ouverture générale. |
| Tri Chaperon | #1080 interdit la prod. Aucun script de reprise appelé. Une reprise exige une nouvelle décision, une nouvelle procédure et une revue séparée. |

## Limites de revue

Deux lectures techniques indépendantes ont relevé puis fait corriger les défauts du véhicule.
Le consensus formel `harness/review` reste indisponible : outil MCP h2a absent et métadonnées exactes du modèle auteur non fournies. Aucun consensus formel revendiqué. La PR reste draft et le GO de production reste ouvert.
