# Feature: ÉV8 Recadrage démo — consolidation vues/UX

## Objective
Rendre la démo cohérente (parcours) selon `docs/spec/SPEC_EVOL_DEMO_RECADRAGE.md` (§3 consolidation,
§4 registre bugs, §5 reworks, §9 décisions scoring). Supprime l'ancien Radar, fusionne, clarifie,
retire le jargon, score /100. **Hors chat/h2a** (= ÉV9/ÉV10).

## Scope / Guardrails
- UI-focused (+ data demo). Make-only, `ENV=test-demo-recadrage-views` last ; worktree dédié.
- English code ; French UI ; type-only imports (verbatimModuleSyntax) ; no Co-Authored-By.
- Réutilise `source-review`/`benchmark-data` en lecture si besoin (import, pas d'édition destructrice non nécessaire).

## Branch Scope Boundaries
- **Allowed**: `ui/src/**`, `docs/spec/SPEC_EVOL_DEMO_RECADRAGE.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `packages/radar-domain/src/schemas/signal.ts` (ajuster SIGNAL_TYPE_VALUES si S1.2/S1.3), `docs/superpowers/plans/**`, `plan/EV8-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, other `plan/*BRANCH*`, `api/**`.

## Orchestration Mode
- [x] Mono-branch, UAT checkpoint après Lot 1 (squelette).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — baseline**: env `test-demo-recadrage-views` (ports 8820/5320/1120) ; `make install ENV=test-demo-recadrage-views`.
- [ ] **Lot 1 — squelette cohérent (UAT checkpoint)**: supprimer la vue `radar` + sa branche App + fichiers obsolètes (`radar-demo-data`, `AppShell`, `SignalQueue`, `dashboard`, `MetricStrip`, `MapPreview`, `OpportunityPanel`) **si non réutilisés ailleurs** ; retirer le jargon T0/T1/T3/T4 des libellés nav ; nouveau défaut `activeView="signaux"`. Gate. → **UAT.**
- [ ] **Lot 2 — Signaux**: afficher les 6 (badge simulation), valeur /10 + confiance lisibles, **dual-tri** (score /10 ↔ priorité VISION) + **bulle jaune** d'aide ; **dérogations = filtre** (retirer derogation-relevant=5/irrelevant=1) + trim types hors VISION (S1.3) ; Approfondir→Opportunités(signalId).
- [ ] **Lot 3 — Opportunités**: sémantique **réel/sim** effective (réel masque hypothèses/non-dispo + plafonne « surveillance » ; sim montre la cible) ; **score radar /100** en tête + détail /5 par axe.
- [ ] **Lot 4 — Onboarding**: sélecteur **municipalité QC** (Salaberry défaut) en étape 1 ; activation des sources en langage clair.
- [ ] **Lot 5 — Console**: absorbe **Revue des sources** ; retire jargon T3/T4 ; rendre cliquable (sélection source/job → détail) ou cadrage « démo ».
- [ ] **Lot 6 — Automatisation**: absorbe **Comparaison des agents** + explique les critères (M1–M7).
- [ ] **Lot 7 — Grilles**: refonte lisible adossée à S1 (2 mesures, grille par axe, non-disponible→renorm+plafond).
- [ ] **Lot 8 — close**: PLAN.md + PR + CI + merge-commit + archive plan.
