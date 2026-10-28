# Feature: Préparation fiable du véhicule 6H préprod

## Objective
- [x] Livrer les quatre correctifs et la répétition complète locale, sans préprod ni push.

## Scope / Guardrails
- [x] Worktree dédié `tmp/bascule-6h-fix`, branche `fix/bascule-6h-vehicle`, base origin/main.
- [x] Make uniquement ; ENV en dernier ; aucun Python ni fichier d'environnement lu.
- [x] Tests locaux isolés `test-bascule-6h-vehicle`, aucun port public requis.
- [x] Toute pile Compose est supprimée avec `down -v` en sortie.
- [x] Commits sur une ligne, sans corps ni trailer ; aucun push ni fusion.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: `tools/make/base-preprod*`, `tools/make/bascule-6h-vehicle*`, `deploy/base-preprod/*`, `docs/spec/BASE_API_ACTIVATION.md`, `RAPPORT-SOL-BASCULE-6H.md`, `plan/6HVEHICLE-BRANCH_fix-bascule-6h-vehicle.md`.
- [x] **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, autres plans, code applicatif et migrations.
- [x] **Conditional Paths**: aucun écart nécessaire ; aucune dépendance ajoutée.

## Feedback Loop
- [x] Le journal historique ne contient pas le message réseau ni l'erreur JSON ; ne pas inventer une cause historique.
- [x] Track reste sous son écrivain désigné ; fournir le plan source sans modifier `.track`.

## Orchestration Mode (AI-selected)
- [x] Une branche, corrections successives limitées et commits atomiques.

## UAT Management (in orchestration context)
- [x] Aucun UAT et aucune action en préprod ; fixtures CDP uniquement ; aucun navigateur réel contacté.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Base et preuves**
  - [x] Lire règles, preuves, code natif et méthode debug/test.
  - [x] Capturer les tests natifs de référence : 266 cas réussis.
- [x] **Lot 1 — Sonde et chemins exposés**
  - [x] Diagnostics masqués reproduits en rouge ; cause historique du TypeError toujours non établie.
  - [x] Sonde versionnée, chemins publics inclus dans les préfixes API seuls, tests verts.
- [x] **Lot 2 — UTC et erreurs explicites**
  - [x] Reproduction rouge des décalages et du refus silencieux.
  - [x] Normalisation à la construction, diagnostic des preuves non UTC, tests verts.
- [x] **Lot 3 — Rollback initialisé**
  - [x] Reproduction rouge de l’appel sans contexte et du chemin de récupération.
  - [x] Entrée native initialisée et répétition de rollback réussie au premier appel.
- [x] **Lot 4 — Actions et durée du gel**
  - [x] Reproduction rouge du message anonyme et du gel trop court.
  - [x] Identité du run bloquant, préflight de fenêtre, tests verts.
- [x] **Lot 5 — Répétition et livraison**
  - [x] Activation → Q1 → redémarrage → Q2 → preuve → filtre natif → réouverture → lectures authentifiées simulées.
  - [x] Runbook anglais et rapport français avec limites.
  - [x] Tests natifs, contrôles statiques, revue finale, commits contrôlés et bundle vérifié.
  - [x] Aucun push ni fusion ; revues conducteur astra et wonder hors livraison locale.
- [ ] **Lot 6 — Seconde passe Fable et astra (#940)**
  - [x] Reproduire en rouge fractions UTC, diagnostic de champ et récupération tardive.
  - [x] Fractions acceptées, champ invalide nommé ; reclose-api tardif admis sous gel actif.
  - [x] Dates nulles, non textuelles et +00:00 refusées avec le champ nommé.
  - [x] Reproduire le refus sans mutation de close après réouverture (create tenté, AlreadyExists).
  - [x] close refuse le Service existant avant toute écriture ; rendu API partagé sans mutation.
  - [x] Entrée reclose-api manquante reproduite ; fixture de replicas et resourceVersion fidèle.
  - [x] reclose-api natif, versions relues et restauration exacte passent sous gel tardif.
  - [x] Ajouter reclose-api, snapshot actualisé et tests de concurrence.
  - [x] Trois mutations de récupération rejetées ; baseline et restauration passent.
  - [x] Raccorder le test de contexte et qualifier la récupération complète tardive.
  - [x] Documenter la requalification réelle du dump ; aucune exécution en préprod.
  - [x] Rapport de seconde passe rédigé avec les preuves et les limites opérationnelles.
  - [ ] Vérifier le bundle r2 descendant d’ec867041 ; aucun push.
