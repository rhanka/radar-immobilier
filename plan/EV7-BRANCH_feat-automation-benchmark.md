# Feature: ÉV7 Automatisation + benchmark (last évolution)

## Objective
An "Automatisation" demo view: continuous treatment cadence cards (initial/recurrent/deepening) +
a stub connectors list + a per-stage agent benchmark recap (reusing the honest comparison data).
Closes the ÉV1–ÉV7 track. Descriptive/demo only — no real scheduler.

## Scope / Guardrails
- UI-only (+ pure data/helpers). No domain/scoring change expected (log if needed).
- Make-only, `ENV=test-automation-benchmark` last; root `dev` stable; worktree `tmp/automation-benchmark`.
- English code; French UI. No Co-Authored-By trailer. Type-only imports (verbatimModuleSyntax).

## Branch Scope Boundaries
- **Allowed**: `docs/spec/SPEC_EVOL_AUTOMATION_BENCHMARK.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `ui/src/lib/automation/**`, `ui/src/lib/components/automation/**`, `ui/src/lib/demo/views.ts`,
  `ui/src/lib/components/NavMenu.svelte`, `ui/src/App.svelte`, `docs/superpowers/plans/**`, `plan/EV7-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  other `plan/*BRANCH*`, `api/**`, `ui/src/lib/demo/benchmark-data.ts` (read-only reuse — import, don't edit),
  `ui/src/lib/components/comparison/**` (read-only).
- **Conditional**: `packages/**` only if a missing field is found (log `EV7-EXn`).

## Orchestration Mode
- [x] Mono-branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — baseline**: worktree + env `test-automation-benchmark` (ports 8819/5319/1119); `make install ENV=test-automation-benchmark`.
- [ ] **Lot 1 — automation data/helpers**: `ui/src/lib/automation/automation-data.ts` (+ test) — `TREATMENTS` (3 cadence cards: initial/récurrent/approfondissement, French), `CONNECTORS` (stub list w/ status), `benchmarkRecap()` deriving a compact per-agent/stage recap from `ui/src/lib/demo/benchmark-data.ts` (read-only). Tests: 3 treatments, connectors stub statuses, recap covers the benchmark agents without inventing values. Gate.
- [ ] **Lot 2 — AutomationView.svelte**: 3 cadence cards + connectors list (clear "démo/non connecté") + benchmark recap table (pointer to Comparaison view). Component/data test. Gate (typecheck/lint/test-ui/build).
- [ ] **Lot 3 — wire**: add `"automatisation"` to `DemoView` (last); NavMenu item (icon e.g. Workflow/Zap); App.svelte branch. Gate + UAT note.
- [ ] **Lot 4 — docs + close**: update spec/escalations; `PLAN.md` ÉV7 status (track complete); PR + CI (full SHA) + merge-commit + archive plan to `plan/done/`. Then FINAL drumbeat summary + UAT readiness note; STOP the loop.
