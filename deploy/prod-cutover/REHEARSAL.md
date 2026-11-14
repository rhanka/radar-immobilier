# Répétition sur copie — 13 novembre 2026

Aucune écriture prod. Aucun GO prod. Décision : « Tout ce soir, bascule décalée ».
Candidate : `b7724bdd9015a4f26319897bf240baaf9ee636ae`.
Run achevé jusqu’au double rollback : `e64455b4-15a0-4a94-badf-5c2a370bd742`.
La même copie est remise au candidat. Elle reste ouverte à la recette humaine.
Premier passage DDL : `138e09c0-d018-44fe-ae99-5fa8a6b80228`. Il a refusé avant 6H sur la preuve Docker.
Les reçus complets restent privés dans `~/.local/share/radar-prod-copy`.
Les valeurs publiées ci-dessous excluent comptes, identifiants et données métier.

## Durées mesurées

| Étape | Durée en secondes | Résultat |
| --- | ---: | --- |
| Dump RO préliminaire, déjà pris le 13/11 à 18 h 16 | 72 | 283590496 octets ; double empreinte identique |
| Restauration, premier passage DDL | 110,847 | Archive prod vers copie vide |
| Restauration, copie conservée | 113,569 | Même archive ; 13 migrations |
| 31 DDL, copie conservée | 34,361 | 44 empreintes validées |
| 31 DDL, premier passage | 727,757 | 44 empreintes validées ; 6H non exécuté sur ce passage |
| Transition 6H initiale | 3,767 | open-success ; scoped ; barrière ouverte ; zéro non résolu |
| Rejeu 6H | 2,569 | Même résultat |
| Vérification | 7,224 | Six comptes et appartenances ; droits attendus |
| Services et stockage, reprise après corrections | 10,601 | Reprise sur services déjà créés ; ne mesure pas un démarrage froid |
| Smoke santé | 0,042 | UI, SHA, DB/S3, refus anonyme et discovery MCP |
| Rollback complet 1 | 108,501 | Restauration atomique + ACL originales ; schéma 13 |
| Rollback complet 2 | 286,380 | Même restauration complète ; schéma 13 |
| Remise finale : 31 DDL | 50,097 | Retour à 44 sur la même copie |
| Remise finale : 6H initial | 3,897 | open-success |
| Remise finale : rejeu 6H | 138,218 | open-success ; latence de lancement incluse |
| Remise finale : vérification | 0,787 | Lecture via exec, forcée read-only |
| Remise finale : services et stockage | 52,547 | Redémarrage après arrêt |
| Remise finale : smoke | 0,087 | Smoke de santé et TLS/CORS depuis l’hôte réussis |

WAL : 347989216 octets sur la copie conservée.
Premier passage : 370208912 octets.
TLS local, SHA servi et préflight CORS ont aussi été vérifiés depuis l’hôte.
La recette humaine et le smoke artefacts authentifié restent à faire.
Après les deux rollbacks, les propriétaires des 27 tables correspondent au catalogue de l’archive.
public appartient à pg_database_owner. Le rôle applicatif radar lit le journal à 13.
Le writer candidat ne lit plus ce journal. Les ACL originales ont été rejouées sans erreur.

## Durée de coupure projetée

Le socle projeté avec la remise finale vaut **292,984 s, soit 4 min 52,984 s**.
Calcul : dump 72 + restauration 113,569 + DDL 50,097 + 6H initial 3,897 + vérification 0,787 + services 52,547 + smoke 0,087.
Le rejeu 6H de test est exclu de ce calcul. La procédure prod appelle 6H une seule fois.
En remplaçant DDL et 6H par leurs maxima observés séparément, ce socle vaut **1104,965 s, soit 18 min 24,965 s**.
Ce scénario combine des mesures de passages différents. Il ne constitue ni une répétition complète mesurée, ni une borne haute.

La coupure fermeture → réouverture ajoute le drain, le transfert S3 et sa lecture de retour,
les rôles, le déploiement k8s, la recette privée, les décisions GO et la réouverture.
Ces étapes prod ne sont pas mesurées ici. **La durée totale de coupure reste non validée.**
Le dump final doit être repris après drain. Le dump préliminaire ne valide aucun transfert S3 de reprise.
Le retour arrière exige au moins la restauration mesurée, jusqu’à 286,380 s observées,
puis le retour des ConfigMaps, des images, le smoke privé et un GO distinct.

## Les 31 migrations

Durées murales. Elles incluent le lancement du client conteneurisé et le commit.
Le stockage local était à 96 %, puis 97 % d’occupation. Les attentes IO ont été observées.
L’écart entre séries ne doit pas être attribué aux seuls DDL.

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

## Erreurs rencontrées et corrections

- Sonde prête sur le serveur temporaire Unix. Sonde TCP imposée.
- Port PostgreSQL absent sur réseau interne. Clients et hook passent par ce réseau.
- Schéma préchargé par PostGIS. Base de copie recréée depuis template0.
- Client de diagnostic interrompu avant démarrage. Preuve Docker refusée. Client supprimé après contrôle exact. Nettoyage nommé et date de fin valide exigés.
- Image UI absente du cache. Téléchargement au digest approuvé.
- UI sans accès au fichier nginx privé. UID de recette aligné sur celui de l’hôte.
- PutBucketCors non pris en charge par le mock S3 épinglé. CORS porté par le proxy local. Port du mock : 9090.
- Tests contrôleur interrompus, puis erreurs dans un essai sans dépendances. Isolation des fichiers de démarrage du shell et exécution séquentielle. Huit scénarios finaux réussis.
- Des lectures conteneurisées ont expiré à 60 s, y compris après la remise au candidat. La vérification locale passe désormais par exec avec read-only forcé et délai SQL de 15 s. Une tentative d’UPDATE sans ligne ciblée est refusée. Les mutations gardent leur voie initiale. La preuve détecte aussi les lecteurs exec actifs.
- Audit après rollback et remise au candidat lancés trop près. Les commandes ont refusé avant mutation mesurée. Le contrôle est repris seul.

Aucun échec des 31 transactions DDL dans les deux séries publiées.
Un échec après restauration garde désormais la copie arrêtée. La reprise conserve son identité et son RUN.
Validation : 20 gardes ciblées et huit scénarios contrôleur/IdP réussis. Le test d’interruption des clients passe.
Une relance finale a dû reconstruire l’image de tests. Le cache builder historique était en lecture seule.
Le cache est déplacé vers .cache. La reconstruction est séparée du budget des tests.
Une relance a dépassé 300 s pendant cette préparation. Le down -v explicite a terminé le nettoyage.
Une option --no-build non reconnue par Compose run a été retirée. Les délais des scénarios ne sont pas augmentés.

## Prérequis artefacts

Les cibles futures sont documentées dans le runbook. Elles n’ont pas été exécutées en prod.
Mint et rotation S3 : k8s. Génération upload/reader : immo, 32 octets par clé, sans affichage.
Rôles MCP : cible gardée sous verrou ; grants réappliqués par le migrateur.
Rendu : general, git off, live 0, qualifications et redrive false, aucune URL builder.
Hôte configurable : ARTIFACTS_CONTENT_HOST. Ingress et TLS cohérents avec ce nom.
Le précheck refuse chaque Secret absent ou clé vide. Les tests couvrent chaque refus.

Inventaire RO : les six Secrets S3, upload, reader, writer MCP, account-reader MCP et TLS manquent en prod.
K8s doit fournir le principal S3, le bucket et son CORS prod, les URLs privées DB,
DNS wildcard, TLS et Ingress. Immo doit générer les trois clés applicatives avant ouverture.
La publication HTML statique, la lecture publique HTTPS et la lecture MCP font partie de la recette.

