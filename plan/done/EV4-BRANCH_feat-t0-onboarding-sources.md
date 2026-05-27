# Feature: ÉV4 T0 Onboarding / Sources

## Objective
A T0 "Onboarding / Sources" demo view: selectable source-catalogue checklist (reusing
`sourceEvaluations`), a 2-year retro-analysis framing panel, and a demo "Lancer l'onboarding" CTA.
Wired as the first demo view.

## Scope / Guardrails
- UI-only (+ a pure helper module). No domain/scoring change expected (log if needed).
- Make-only, `ENV=test-t0-onboarding-sources` last; root `dev` stable; worktree `tmp/t0-onboarding-sources`.
- English code; French UI. No Co-Authored-By trailer. Type-only imports (verbatimModuleSyntax).

## Branch Scope Boundaries
- **Allowed**: `docs/spec/SPEC_EVOL_T0_ONBOARDING.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `ui/src/lib/onboarding/**`, `ui/src/lib/components/onboarding/**`, `ui/src/lib/demo/views.ts`,
  `ui/src/lib/components/NavMenu.svelte`, `ui/src/App.svelte`, `docs/superpowers/plans/**`, `plan/EV4-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  other `plan/*BRANCH*`, `api/**`, `ui/src/lib/source-review/**` (read-only reuse of `sourceEvaluations` — import, don't edit).
- **Conditional**: `packages/**` only if a missing field is found (log `EV4-EXn`).

## Orchestration Mode
- [x] Mono-branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — baseline**: worktree + env `test-t0-onboarding-sources` (ports 8816/5316/1116); `make install ENV=test-t0-onboarding-sources`.
- [ ] **Lot 1 — onboarding helpers**: `ui/src/lib/onboarding/onboarding-data.ts` (+ test) — `groupByRecommendation`, `defaultSelection` (build-now ids), `summarize(selectedIds)` (counts by tier), `RETRO_WINDOW_MONTHS_DEFAULT=24`, French label maps; pure, over imported `sourceEvaluations`. Tests assert grouping covers the catalogue, defaultSelection ⊂ build-now, summarize counts by tier. Gate.
- [ ] **Lot 2 — OnboardingView.svelte**: checklist grouped by recommendation (build-now pre-checked, toggles), tier/access/cost chips + contribution line; retro-analysis panel (24-month default + selector + illustrative estimate label + recurrent cadence); "Lancer l'onboarding" CTA → confirmation summary (selected count by tier + window), demo-stub note. Component/data test. Gate (typecheck/lint/test-ui/build).
- [ ] **Lot 3 — wire**: add `"onboarding"` to `DemoView` (first); NavMenu item (first, icon e.g. Rocket/PlayCircle); App.svelte branch. Gate + UAT note.
- [ ] **Lot 4 — docs + close**: update spec/escalations; `PLAN.md` ÉV4 status; PR + CI (full SHA) + merge-commit + archive plan to `plan/done/`.
