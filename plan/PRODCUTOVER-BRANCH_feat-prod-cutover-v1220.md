# Feature: Procédure de bascule prod v1.2.20

## Objective
- [x] Préparer la bascule de b7724bdd9015a4f26319897bf240baaf9ee636ae sous i-cond.
- [ ] Faire ratifier le GO par l’owner après répétition sur copie.

## Scope / Guardrails
- [x] Prod en lecture seule. Dump RO autorisé par D4 le 13/11. Aucun tag, migration ou écriture cluster.
- [x] Aucun .env, secret affiché, kubeconfig par défaut ou exécution Python.
- [x] Worktree tmp/prod-cutover, branche feat/prod-cutover-v1220 depuis origin/main.
- [x] ENV toujours dernier. Aucune fusion. Aucun trailer de contribution.
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
- [ ] deferred : répétition réelle dépend d’une archive prod autorisée et du roster approuvé.

## Orchestration Mode (AI-selected)
- [x] Mono-branch. Deux lectures indépendantes de conception. Implémentation unique.

## UAT Management (in orchestration context)
- [x] Aucun changement UI. Pas de stack UAT.
- [x] Tests dédiés ENV=test-prod-cutover. Ports réservés API 18821, UI 15321, Maildev 11121.

## Plan / Todo (lot-based)
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
