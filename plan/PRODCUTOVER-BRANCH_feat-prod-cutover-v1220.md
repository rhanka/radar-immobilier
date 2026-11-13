# Feature: Procédure de bascule prod v1.2.20

## Objective
- [x] Préparer la bascule de b7724bdd9015a4f26319897bf240baaf9ee636ae sous i-cond.
- [ ] Faire ratifier le GO par l’owner après répétition sur copie.

## Scope / Guardrails
- [x] Prod en lecture seule. Aucun dump, tag, migration ou acte cluster exécuté.
- [x] Aucun .env, secret affiché, kubeconfig par défaut ou exécution Python.
- [x] Worktree tmp/prod-cutover, branche feat/prod-cutover-v1220 depuis origin/main.
- [x] ENV toujours dernier. Aucune fusion. Aucun trailer de contribution.
- [x] Opérations applicatives en Node et binaires natifs selon instruction owner.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths : deploy/prod-cutover/**, docs/runbooks/prod-cutover-v1220.md, ce plan.
- [x] Forbidden Paths : Makefile, docker-compose*.yml, rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, autres plans.
- [x] Conditional Paths : aucun changement cluster, SQL applicatif ou workflow.
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
- [x] Revue #1100, points 1–2 : fenêtre opérateur sous radar-change-lock cutover. Capture avant drain. Déploiement privé, réouverture sur GO séparé. CD après recette.
- [ ] Revue #1100 : gardes, empreintes 6H, reçu copie et rollback complet. Validation et publication.
- [x] GO lié aux octets du roster et du plan. Empreintes dans les reçus. Garde de propriété avant backup, DDL, grants et rollback.
- [x] Copie : reçu backup.json physique, propriétaires et ACL restaurés. Intégration réelle 13 → 44 → 13. Deux rollbacks et accès legacy vérifiés sur archive synthétique.
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
