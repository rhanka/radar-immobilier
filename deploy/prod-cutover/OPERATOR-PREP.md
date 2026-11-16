# Préparation opérateur — i-cond

Préparation du 13 novembre 2026, avant la fenêtre v1.2.20.
Les fichiers privés sont dans `$HOME/.local/share/radar-prod-copy/`.
Leur mode est 0600. Les répertoires de sortie sont en 0700.
La lane reste sans écriture en prod.

| Point | État | Preuve ou limite |
| --- | --- | --- |
| 1. Port-forward | OK | Service `radar-postgres`. Écoute `127.0.0.1:25432`. Supervision avec reprise. |
| 2. Pgpass prod | OK | Rôles `radar` et `radar_db_ro_prod`. Les deux `select 1` passent en lecture seule. |
| 3. Sauvegarde S3 | Destination vérifiée ; suppression refusée | `radar-immobilier-backup/v1220-cutover/` : put et ls exit 0. Delete exit 1, `Access Denied` ; WRITER sans droit de suppression par contrat. |
| 4. Entrée S3 artefacts | OK | `s3-provision.input`. Les huit champs attendus, sans sourcing. |
| 5. Restauration finale | OK | Base vide `radar_cutover_final`, template0, PG16/PostGIS épinglé comme la répétition. Port 25435. Quatre rôles NOLOGIN et pgpass prêts. |
| 6. Ancienne release | OK | `previous-release.json`. Tag v1.2.19, SHA `79c2bd967dacb84d445bf6462ee70393515f6a38`. Run 42669916074, job 129343420788. Digests exportés et nommés dans le build du tag. Aucune sonde publique utilisée. |
| 7. Approbation | OK | Trois GO verbatim du 13/11, candidat exact, destination et empreintes du plan/roster. Expiration initiale : 14/11 à 06:55:52 UTC. Drain null et writersStopped false. À remplir après le drain réel. |
| 8. Fichiers de séquence | OK | Plan, roster, release, historique, curseur, approbation et configuration présents. Sorties privées créées. |

`drain.json`, `prod-final-v1220.dump` et `final-restore-v1220/restore.json`
seront produits pendant la fenêtre. Leur absence est attendue à cette étape.
Les identités S3 restent à injecter dans le processus i-cond depuis le fichier privé.
L’ancien bucket `sentropic-pgbackup` était incorrect pour RADAR_BACKUP_WRITER.
Le CronJob prod et le workflow quotidien ciblent `radar-immobilier-backup`.
La destination de bascule est dans `backup-destination.env` (0600), séparée des clés.
L’équipe k8s doit supprimer uniquement l’objet de test nommé dans la séquence
[de la PR #1100](../../docs/runbooks/prod-cutover-v1220.md), ou fournir une clé
dédiée permettant put/ls/delete sur `v1220-cutover/*`. Aucun droit IAM modifié ici.
Le test complet reste en échec sur delete ; la lecture de retour du dump final reste à vérifier.

Commande de préparation complète :

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk operator-prep ENV=prod
```

Elle conserve l’approbation et la configuration existantes. Elle refuse une copie
finale déjà remplie. Elle sort en erreur si le test S3 échoue.
Elle ne lance ni provisionnement, ni fenêtre, ni backup, ni migration.

Relance du tunnel seul :

```sh
rtk make -f deploy/prod-cutover/prod-cutover.mk operator-forward ENV=prod
```

Le superviseur lance `kubectl port-forward --address 127.0.0.1
svc/radar-postgres 25432:5432`. KUBECONFIG est fixé à
`$HOME/.kube/radar-prod-tenant-admin.kubeconfig`. Namespace : `radar-immobilier`.
Les PID sont conservés dans `prod-forward.pid` et `prod-forward-child.pid`.
Le statut se lit avec `operator-status` dans `operator-prep.mk`.

Pour les commandes de la fenêtre, ajouter les clients PG16 préparés :

```sh
export PATH="$HOME/.local/share/radar-prod-copy/operator-bin:$PATH"
```

Ces clients acceptent uniquement les destinations 25432/radar et
25435/radar_cutover_final. Ils utilisent le lanceur conteneurisé existant,
avec les étiquettes du RUN. Le dossier `bin` de la copie 25433 reste exclu.
