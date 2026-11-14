# Feature: Procédure de bascule prod v1.2.20

## Objective
- [x] Préparer la bascule de b7724bdd9015a4f26319897bf240baaf9ee636ae sous i-cond.
- [x] GO owner reçu pour provision-prod puis bascule, après procédure verte. Exécution prod réservée à i-cond.

## Scope / Guardrails
- [x] Prod en lecture seule. Dump RO autorisé par D4 le 13/11. Aucun tag, migration ou écriture cluster.
- [x] Aucun .env, secret affiché, kubeconfig par défaut ou exécution Python.
- [x] Worktree tmp/prod-cutover, branche feat/prod-cutover-v1220 depuis origin/main.
- [x] Pre-lock PG clients use a process UUID when drain evidence is absent; regression verifies stable labels and explicit RUN precedence (31 guards pass).
- [x] ENV toujours dernier. Merge prep autorisé. Aucune fusion dans main. Aucun trailer de contribution.
- [x] Opérations applicatives en Node et binaires natifs selon instruction owner.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths : deploy/prod-cutover/**, docs/runbooks/prod-cutover-v1220.md, ce plan.
- [x] Forbidden Paths : Makefile, docker-compose*.yml, rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, autres plans.
- [x] Conditional Paths : aucun changement cluster, SQL applicatif ou workflow.
- [x] Préparation isolée sur feat/prod-cutover-v1220-prep, même point de départ que #1100. Commits ajoutés uniquement.
- [x] PRODCUTOVER-EX1 : correction owner du point 4. `deploy/cutover/atomic-restore.sh` accepte la conservation des propriétaires. Défaut historique conservé. Repli : retirer cette option.

## Feedback Loop
- [x] clarification : instruction owner prime pour français et absence de trailers.
- [x] acknowledge : deux revues de conception. Backup final après drain. Comptes préexistants.
- [ ] deferred : recette humaine par i-cond après revue. Répétition technique et deux rollbacks faits. Même copie remise au candidat. PV et compte Product Owner de recette à fournir.

## Orchestration Mode (AI-selected)
- [x] Mono-branch. Deux lectures indépendantes de conception. Implémentation unique.

## UAT Management (in orchestration context)
- [x] Aucun changement UI. Pas de stack UAT.
- [x] Tests dédiés ENV=test-prod-cutover. Ports réservés API 18821, UI 15321, Maildev 11121.

## Plan / Todo (lot-based)
- [x] Runbook final : commandes d’abandon, récupération, HTTPS privé et diagnostic explicite. Gardes 28/28 ; contrôleurs 12/12 ; workflows 6/6 ; PostgreSQL 13 → 44 → 13 ; ESLint et syntaxe verts. Aucun tag, merge ou accès prod.
- [x] Test Docker ajouté pour le TLS du proxy candidat : publication API, HTML et MCP avec certificat synthétique vérifié. Les fichiers privés restent 0600 ; aucun assouplissement TLS. Scénarios Docker séquentiels, budgets inchangés.
- [x] FINAL-EX2 : cinq workflows appelant le contrôleur passent au kubeconfig temporaire explicite exporté. Raccord bloquant pour conserver le CD différé avec la nouvelle garde. Aucune autre étape changée. Repli : retirer ensemble garde et raccord.
- [x] Recette HTTPS privée : proxy nginx candidat sur 127.0.0.2:443, port-forwards supervisés et résolution locale. Publication, lecture HTML et MCP testées ; routes publiques inchangées. Aucun secret affiché.
- [x] Relecture finale : abandon sans sauvegarde sur schéma 13 ; récupération du reçu après réouverture, accord owner sur la perte des écritures et reprise du même RUN. Gardes et scénarios contrôleur validés.
- [x] FINAL-EX1 : verdict #1100, garde kubeconfig dans tools/make/cutover-{release,cluster,smoke}.sh et doubles associés. Refus avant kubectl si absent ou défaut. Repli : retirer ce correctif. Aucun accès prod exécuté.
- [x] Corps PR : séquence exacte de ce soir, acteurs, durées, COMMIT DDL et réouverture comme seuils, reprise complète, tag v1.2.20 différé au SHA candidat. Nouveau dry-run RO : neuf créations prévues, aucune valeur affichée.
- [x] Cause Docker corrigée dans runtime : stdin ignoré sans input, pipe conservé pour SQL. Tests TERM/KILL d’origine verts, assertions et délais inchangés. verify-local ordonne gardes, Docker, PostgreSQL, lint/contrôleurs et syntaxe.
- [x] Preuve de drain testée dans les trois scénarios de fenêtre ; répertoire privé créé avant écriture. Intégration PostgreSQL remise au vert par attente TCP après l’initialisation. Diagnostics Docker limités à l’état, au RUN et au code contrôleur.
- [x] Exécution i-cond explicitée : commandes autonomes de lecture CORS/TLS/RUN, preuve de drain sous verrou, reçu de restauration finale contrôlé et tag candidat différé. Lint et huit scénarios verts ; 26 gardes et deux interruptions Docker réelles vertes.
- [x] Remise au vert #1100 : chemin Node portable, contrôleurs/IdP dans le conteneur isolé, garde GetBucketCors bloquante sans mutation S3. Dry-run RO : cinq Secrets, un Certificate, un Ingress, deux rôles MCP.
- [x] Publication finale : quatre commits après la tête initiale, runbook dans le corps #1100. Relance contrôleur : 3/8 passent ; Node conteneur absent de l’hôte et IdP local en échec. Validation complète ouverte.
- [x] Runbook final : responsabilités infra/immo corrigées, neuf objets prévus en dry-run RO, CORS administrateur k8s, analyse prudente du rejeu 6H.
- [ ] Validation Docker finale : deux scénarios réels sans démarrage observé ; lint interrompu pendant reconstruction. Stockage local à 97 %. Aucun GO.
- [x] APPLY préparé : import S3 privé, génération des clés, Secrets create-only, rôles sans privilèges, Certificate et Ingress. Jamais exécuté en prod.
- [x] Provision prod : inventaire RO, précheck cluster/RBAC/DB/objets. Dry-run sans lecture de dotenv. APPLY futur séparé, création seule.
- [x] Runbook destiné au corps de la PR actualisé : vingt gardes, trois séries de 31 DDL, double rollback, erreurs, projection et six Secrets manquants. Aucun GO prod. Copie conservée au candidat pour recette humaine.
- [x] Rapport des trois séries DDL, double rollback et audit publié dans REHEARSAL.md. Socle projeté 292,984 s ; scénario de maxima séparés 1104,965 s ; coupure totale non validée. Vingt tests, huit scénarios et ESLint réussis. Down -v des tests terminé.
- [x] Préparation de l’image de tests séparée du budget lint. Pull des quatre images de copie par digest. Lectures locales bornées, contrôlées et sans écriture ; source SQL et images candidates inchangées.
- [x] Remise au candidat : DDL 50,097 s ; 6H 3,897 s ; rejeu 138,218 s ; vérification RO par exec 0,787 s ; services 52,547 s ; smoke 0,087 s. Copie ouverte pour recette humaine. Vingt gardes passent. Le reader local refuse un UPDATE vide et tout autre environnement.
- [x] Dix-huit gardes passent. Régression d’interruption : le client Docker est arrêté avant suppression du conteneur nommé. L’audit après double rollback confirme 27 propriétaires, public, lecture legacy et refus du writer candidat.
- [x] Smoke local réussi en 0,042 s. TLS, SHA servi et CORS borné contrôlés depuis l’hôte. Huit scénarios contrôleur/IdP et lint passent. Six Secrets artefacts absents en prod, constat RO. Premier rollback complet 108,501 s.
- [x] Deuxième passage : 31 DDL en 34,361 s ; 0041 en 0,405 s ; 0044 en 10,809 s. Double 6H open-success en 3,767 s puis 2,569 s. Client de diagnostic orphelin supprimé après contrôle exact. Date de fin invalide désormais refusée. Copie restaurée gardée en échec.
- [x] Dossier mis à jour avec décision owner vers 19 h : Tout ce soir, bascule décalée. Smoke statique HTML/public/MCP requis avant réouverture. K8s reste responsable du mint S3, des URLs DB et de DNS/TLS/Ingress.
- [x] Copie : restauration réelle 110,847 s après base template0. Mesures et diagnostics sans lignes métier. Génération idempotente des trois clés validée sur kubectl simulé. Seize tests ciblés passent.
- [x] Rendu statique prod : hôte paramétrable et Ingress TLS cohérent, builder absent. Cible future artifact-roles sous verrou et drain, car le migrateur ne crée pas les rôles absents. Aucun provisionnement prod exécuté.
- [x] Prérequis artefacts prod : noms des cinq Secrets lus en préprod, cibles de génération idempotente et import S3 futur par k8s. Précheck refuse chaque Secret absent ou clé vide. Test de rendu statique, sans builder, et hôte de contenu paramétrable.
- [x] Répétition lancée sous i-cond. Deux défauts locaux établis : readiness sur socket temporaire et port non publié sur réseau interne. Sonde TCP et clients/hook sur réseau isolé corrigés. Connexion SQL vérifiée.
- [x] B3 validé : 15 gardes, ESLint, huit scénarios contrôleur/IdP et deux coupures Docker réelles TERM/KILL. Reprise/rollback refusés avant arrêt, admis après disparition. Erreurs Docker/stop/rm refusées. Stack lint isolée supprimée avec down -v ; aucun hook de test restant.
- [x] B3 : lane feat/prod-cutover-v1220-hookfix. Hooks et clients temporaires étiquetés par RUN, --rm, délai et trap. Reprise et rollback refusés avant disparition confirmée. Arrêt explicite STOP_RUN_CONTAINERS=1.
- [x] Dossier et runbook actualisés : commande exacte de copie, recette locale, terminaisons, double rollback, prérequis externes prod et conservation du SHA historique.
- [x] Validation : 13 gardes, huit scénarios contrôleur/IdP, ESLint, import de l’image, Compose et intégration PostgreSQL réussis. Budgets installation/scénarios/nettoyage séparés après un nettoyage interrompu. Relance complète réussie, down -v terminé.
- [x] Un refus CD conserve une fenêtre reprenable avec le même RUN. Le marqueur manuel est sauvé sous verrou avant la porte d’inactivité.
- [x] Authentification de recette testée : refus hors roster et mauvais mot de passe, nonce, PKCE, code unique, rotation refresh et délégation MCP. Readiness locale et OUTPUT distinct par répétition.
- [x] Répétition en une commande : attestation locale liée aux empreintes, restore, DDL, double 6H, vérification, services et smoke local. Échec : nettoyage down -v. Recette manuelle avant double rollback.
- [x] Stockage de recette : buckets locaux, CORS borné et import privé de documents par empreinte. Aucun téléchargement de services prod.
- [x] Stack recette rendue et validée : API/UI/MCP candidats par digest, S3 mock épinglé, TLS local, comptes et rôles séparés. Ports loopback et réseau interne.
- [x] IdP de recette isolé : roster fermé, mot de passe local, PKCE, nonce, code unique, refresh rotatif et échange MCP borné au sujet.
- [x] Contrat hook strict conservé. Sonde PostgreSQL locale terminée pour la preuve initiale. Régressions des preuves Docker et des doublons ConfigMap.
- [x] Raccordements prod préparés : références Secret obligatoires, contrôle de continuité du curseur, ingress statique API. Snapshot et rollback des ConfigMaps et env. Aucune application prod.
- [x] Preuves locales : inventaire Docker réel, consommateurs terminés, identité de la copie, même UUID avant et après recette. Refus si un conteneur ou hook tourne encore. Doublons ConfigMap refusés.
- [x] Merge des six commits prep. Gardes B1/B2 : manifeste historique indépendant, SHA court/complet, digests, verrou, stamp et runs CD. Tests de refus et reprise historique ajoutés.
- [x] Validation préparation : dix tests, deux scénarios contrôleur et ESLint réussis. Rendu et Compose validés sans lancement. Catalogue custom lisible. Modes privés et arrêt du port-forward contrôlés. Stack lint supprimée avec down -v.
- [x] D1–D4 intégrées au runbook et aux prérequis. RPO PV regénérable acceptée, créneau au plus tôt après répétition. Lint renderer : global inutilisé retiré.
- [x] Preuves privées prêtes : dump RO 72 s, 283590496 octets, double empreinte identique. Manifeste Actions comparé octet pour octet. Six comptes prod approuvés correspondent au roster.
- [x] Runtime copie : clients PG16 conteneurisés, image PostGIS épinglée, rôles NOLOGIN locaux et port 25433. Commandes préparées, aucune copie restaurée ni stack démarrée.
- [x] D3 : rendu prod API/MCP et receiver. Statiques general, git off, edge/qualifications/redrive live fermés. Test du rendu et conservation des octets du plan.
- [x] D2/D4 : extraction préprod privée 0600, plan 6H et roster. Cibles autonomes de dump RO et de pull par digest. Répétition non lancée.
- [x] Revue #1100, points 1–2 : fenêtre opérateur sous radar-change-lock cutover. Capture avant drain. Déploiement privé, réouverture sur GO séparé. CD après recette.
- [x] Revue #1100 : gardes, empreintes 6H, reçu copie et rollback complet. Validation locale réussie.
- [x] GO lié aux octets du roster et du plan. Empreintes dans les reçus. Garde de propriété avant backup, DDL, grants et rollback.
- [x] Copie : reçu backup.json physique, propriétaires et ACL restaurés. Intégration réelle 13 → 44 → 13. Deux rollbacks et accès legacy vérifiés sur archive synthétique.
- [x] Gardes GO, propriété du verrou et configuration bornée. Refus avant grants si octets modifiés. Reprise services liée au reçu physique de rollback.
- [x] Contrôleur : capture avant drain même sans ConfigMap 6H. Configuration et fermeture sous verrou. Promotion concurrente refusée. Smoke public en échec : routes refermées et verrou conservé.
- [x] Le contrôle des propriétaires de schémas révèle le défaut public omis du dump PostgreSQL 16. Reset corrigé avec pg_database_owner dans la voie conservant les propriétaires.
- [x] Runbook et plan CD réécrits. Tag après recette et réouverture. Préconditions de copie, propriétaires et GO exact documentés.
- [x] Validation finale : neuf gardes ; deux scénarios contrôleur ; ESLint ; intégration PostgreSQL 16/PostGIS. DDL synthétique 2,775 s. Deux rollbacks complets, ACL de schémas et tables, propriétaires et refus du rôle candidat vérifiés. Stacks supprimées avec down -v.
- [x] Publication : ancien gh pr edit refusé par le champ projectCards retiré de GitHub. Cible pr-body passée à gh api REST, avec le même fichier de runbook.
- [x] Lot 0 : règles, dossier PREPA-PROD complet, contrat 6H et CD.
- [x] Lot 1 : cibles autonomes et précontrôles sans écriture prod.
- [x] Lot 2 : sauvegarde, restauration, migrations mesurées et hook 6H préparés.
- [x] Lot 3 : six tests des refus et test PostgreSQL natif de reprise transactionnelle.
- [x] Lot 4 : runbook, prérequis, décisions owner, PR draft #1100 vers main.
- [ ] Lot 5 : revue complémentaire harness. Aucun GO implicite.
- [x] Runbook, prérequis et décisions rédigés. Syntaxes CJS/Bash et tests ciblés passent.
- [x] Revue formelle selection-failed documentée : MCP h2a et métadonnées auteur manquants.
- [x] Image API candidate absente localement ; aucun pull ni hook réel lancé.
- [x] Branche publiée, aucune fusion ni aucun tag. Répétition réelle et GO restent à venir.
- [x] Lint ciblé réussi dans le conteneur de tests Node. Nettoyage down -v effectué.
