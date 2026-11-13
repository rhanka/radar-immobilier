# Bascule prod v1.2.20 — décision sous i-cond

**NO-GO tant que la copie prod, le roster et la restauration ne sont pas validés.**
Candidate : `b7724bdd9015a4f26319897bf240baaf9ee636ae`. Aucun tag créé par cette lane.

| Ordre | Acteur | Acte et porte |
| --- | --- | --- |
| 1 | immo | `precheck ENV=prod`. SHA initial `79c2bd9`, santé, verrou libre, 13 empreintes exactes, taille et disque. |
| 2 | owner | Valider roster, droits, MCP, périmètre, fenêtre et opérateur de reprise. Autoriser une archive de répétition. |
| 3 | immo | Sur copie : `restore-test`, `migrate`, `transition`, `verify`, `smoke`. Recette authentifiée. Mesurer backup/restauration/DDL/6H/recette/WAL. |
| 4 | k8s | Installer les références de configuration approuvées. Inventorier UID, images, routes, réplicas et suspensions. Suspendre refresh/watchdog et tout autre écrivain. Fermer routes publiques et internes. Arrêter API/MCP, workers, Jobs et maintenance. Neutraliser autoscalers. Prouver le drain. |
| 5 | immo | Sauvegarde **finale après drain** : `backup`. SHA-256, S3, téléchargement de contrôle. Restaurer cette même archive sur une nouvelle copie avec `restore-test`. Garder les écrivains arrêtés. |
| 6 | owner | GO juste avant le premier commit DDL. Reçus liés à la sauvegarde finale. Sinon, réouverture par k8s sans migration. |
| 7 | immo | `migrate` : 31 transactions, 0014–0044. Puis `transition` : hook 6H existant. Exiger `open-success`, `scoped`, zéro non résolu, barrière ouverte. `verify` lit l’état et les appartenances. |
| 8 | owner, CD, k8s | GO tag `v1.2.20` au SHA exact. Chemin CD existant : manifeste immuable du build `43506353942`, prepare puis run. UI/API/MCP/CronJobs par digest. Garder la fermeture externe jusqu’à recette. |
| 9 | immo, PO | Porte served-sha UI `b7724bd`, API SHA complet. Santé et smoke. Recette ci-dessous. |
| 10 | owner, k8s | GO réouverture. Rétablir exactement réplicas, routes et suspensions initiales. Observer le prochain refresh complet. |

Mesures du 13/11 : six tests de garde réussis. Test PostgreSQL 16 natif : 31 migrations sur base **synthétique vide**, **2,649 s** au dernier essai ; 31 commits, rejeu sans DDL et annulation transactionnelle vérifiés. Campagne : 5,781 s. `down -v` effectué. Aucun temps de copie prod, sauvegarde, restauration, 6H ou recette disponible.

**Fenêtre d’indisponibilité : non validée.** Elle couvre drain + sauvegarde finale + restauration de test + DDL + 6H + rollout + recette. Réserver provisoirement trois heures, dont 45 minutes de reprise. C’est un budget, pas une mesure. La voie prepared-db préprod à cinq minutes ne mesure pas cette migration prod.

**Retour arrière.** Avant DDL : aucun changement de schéma ; si restauration nécessaire, immo utilise `rollback`. Après le premier commit DDL : restauration complète impérative, sans down. `rollback` remet les schémas et données de l’archive finale, puis ses ACL originales. Les rôles destinataires doivent préexister. k8s lance **Rollback release** pour API/UI et remet MCP/CronJobs aux digests inventoriés. Le rollback cutover peut remettre l’inventaire entier du run. Ne pas cumuler les deux voies. Vérifier schéma 13, SHA et droits avant réouverture.

**Points de non-retour.** Premier commit DDL : simple rollback images insuffisant. Première réouverture aux écritures : restaurer l’archive finale perd les nouvelles écritures ; nouvelle décision owner sur le RPO. Aucune réouverture automatique autorisée par ce runbook.

**Recette fonctionnelle.** Compte et espace approuvés. Six périodes et dates ; Pertinence globale, total/liste/carte ; URL canonique, F5, lien, Précédent/Suivant ; exclusions PIIA et dérogations ; Écarté visible et droits de reprise ; reclassement réel seulement par PO autorisée sur cible choisie ; MCP réel et refus anonyme ; image, reprise et résultat du prochain refresh. Relever ville, période, latence, SHA et preuves. Une case non testée reste ouverte.

**GO final :** copie représentative chronométrée ; backup final restauré ; 44 empreintes ; 6H ouvert ; curseur et MCP opérationnels ; digests conformes ; recette acceptée ; reprise DB/images/ACL répétée. Tout écart impose NO-GO. La reprise du tri Chaperon reste interdite par #1080.

## Préparation opérateur et décisions

Le détail des entrées et des prérequis est dans [le mode opératoire](../../deploy/prod-cutover/README.md).
Toutes les cibles utilisent `make -f deploy/prod-cutover/prod-cutover.mk <cible> ... ENV=<env>`, avec ENV en dernier.
`ENV=prod` reste en lecture seule. `ENV=execution-prod` est un verrou d’exécution future avec attestation owner ; il n’a jamais été utilisé ici.

Dernier relevé du 13/11 : UI/API `79c2bd9`, trois Deployments Ready, **verrou désormais absent**, 13 empreintes exactes, base `804631011` octets, disque libre `4132028` KiB. Le rôle `radar_db_ro_prod` existe. Les deux rôles MCP recherchés sont absents. Ce relevé ne prouve aucun accès de dump. Aucun acte de reprise du verrou n’a été effectué par cette lane.

Décisions owner encore requises : roster des sujets OIDC prod ; gestionnaires et modérateurs par espace ; accès MCP et éventuel receiver strict ; maintien de la fermeture artefacts ; traitement distinct du tri Chaperon ; autorisation d’archive et conservation des données personnelles sur copie ; fenêtre, RPO et opérateur de reprise ; acceptation des protections GitHub actuelles ou renforcement avant tag.
