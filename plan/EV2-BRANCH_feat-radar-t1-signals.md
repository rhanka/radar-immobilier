# Feature: ÉV2 Radar T1 — signals feed

## Objective
A "Signaux (T1)" demo view: triage feed of `Signal` entities (value /10 + confidence shown
separately, status, sort, status filter, real/sim filter, "Approfondir"), seeded from the 3
pilots + synthetic signals. Reuses ÉV1's `@radar/domain` Signal + `@radar/scoring` filterRealMode.

## Scope / Guardrails
- Scope: UI only (+ a demo data module). No `@radar/domain` schema change expected (log if needed).
- Make-only, `ENV=test-radar-t1-signals` last; root `dev` stays stable; worktree `tmp/radar-t1-signals`.
- All new code/text English; UI copy French. No Co-Authored-By trailer.

## Branch Scope Boundaries
- **Allowed**: `docs/spec/SPEC_EVOL_RADAR_T1.md`, `docs/spec/UAT_EV2_EV7_ESCALATIONS.md`,
  `ui/src/lib/demo/**`, `ui/src/lib/scoring/**`, `ui/src/lib/components/signals/**`,
  `ui/src/lib/components/NavMenu.svelte`, `ui/src/App.svelte`, `ui/package.json`,
  `docs/superpowers/plans/**`, `plan/EV2-BRANCH_*`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`,
  other `plan/*BRANCH*`, `api/**`.
- **Conditional**: `packages/radar-domain/**` only if a missing Signal field is found (log `EV2-EXn`).

## Orchestration Mode
- [x] Mono-branch (UI feature, single test cycle).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — baseline**: confirm worktree + env `test-radar-t1-signals` (ports API 8814/UI 5314/Maildev 1114); `make install ENV=test-radar-t1-signals`.
- [ ] **Lot 1 — demo signals data**: `ui/src/lib/demo/radar-t1-signals.ts` — `demoSignalsT1: Signal[]` (3 real pilot signals + 2-3 synthetic `mode:"simulation"`), value from `SIGNAL_TYPE_VALUES`. `+ .test.ts` (≥5 signals, parse via `Signal`, value/confidence present). Gate.
- [ ] **Lot 2 — SignalsT1View + SignalRow**: `ui/src/lib/components/signals/SignalsT1View.svelte` + `SignalRow.svelte` — table, value & confidence separate columns, status chip, sort (value/confidence independent), status filter, real/sim filter via `filterRealMode`, "Approfondir" (sets status à-approfondir in-memory + emits navigate). Component/data test. Gate (typecheck/lint/test-ui/build).
- [ ] **Lot 3 — wire**: add `"signaux"` to `DemoView`; NavMenu item; App.svelte branch + Approfondir → switch to `"grilles"`. Gate + UAT note.
- [ ] **Lot 4 — docs + close**: update spec/escalations; `PLAN.md` ÉV2 status; PR + CI (full SHA) + merge-commit + archive plan to `plan/done/`.
