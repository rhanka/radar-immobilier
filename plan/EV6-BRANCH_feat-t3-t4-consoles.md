# Feature: ÉV6 T3/T4 consoles

## Objective
A "Console" demo view with tabs: T3 sources qualification + deep-dive (reusing the source inventory +
source-review components) and T4 jobs monitoring board (demo stubs, respecting the global réel/sim toggle).

## Scope / Guardrails
- UI-only (+ pure data/helpers). No domain/scoring change expected (log if needed).
- Make-only, `ENV=test-t3-t4-consoles` last; root `dev` stable; worktree `tmp/t3-t4-consoles`.
- English code; French UI. No Co-Authored-By trailer. Type-only imports (verbatimModuleSyntax).

## Branch Scope Boundaries
- **Allowed**: `docs/spec/SPEC_EVOL_T3_T4_CONSOLES.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `ui/src/lib/jobs/**`, `ui/src/lib/console/**`, `ui/src/lib/components/console/**`,
  `ui/src/lib/demo/views.ts`, `ui/src/lib/components/NavMenu.svelte`, `ui/src/App.svelte`,
  `docs/superpowers/plans/**`, `plan/EV6-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  other `plan/*BRANCH*`, `api/**`, `ui/src/lib/source-review/**` (read-only reuse — import, don't edit).
- **Conditional**: `packages/**` only if a missing field is found (log `EV6-EXn`).

## Orchestration Mode
- [x] Mono-branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — baseline**: worktree + env `test-t3-t4-consoles` (ports 8818/5318/1118); `make install ENV=test-t3-t4-consoles`.
- [ ] **Lot 1 — jobs + console data/helpers**: `ui/src/lib/jobs/jobs-data.ts` (`Job` type, `demoJobs` incl. simulation rows, `countsByStatus`, `filterJobsByMode` via `@radar/scoring` filterRealMode) + test; optional `ui/src/lib/console/console-data.ts` (T3 status helper over `sourceEvaluations`: group+count by recommendation) + test. Gate.
- [ ] **Lot 2 — ConsoleView + tabs**: `ui/src/lib/components/console/ConsoleView.svelte` (tab host) + `QualificationTab.svelte` (status board), `DeepDiveTab.svelte` (reuse SourceDeepDive/RecommendationBoard if clean, else thin panel), `JobsTab.svelte` (status chips + jobs table, global réel/sim aware). Component/data test. Gate (typecheck/lint/test-ui/build).
- [ ] **Lot 3 — wire**: add `"console"` to `DemoView`; NavMenu item (icon e.g. Gauge/MonitorDot); App.svelte branch. Gate + UAT note.
- [ ] **Lot 4 — docs + close**: update spec/escalations; `PLAN.md` ÉV6 status; PR + CI (full SHA) + merge-commit + archive plan to `plan/done/`.
