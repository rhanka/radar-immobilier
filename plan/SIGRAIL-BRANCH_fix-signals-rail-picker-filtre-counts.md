# Fix: Signaux rail — period picker and Filtre counts

## Objective
Fix the two preprod symptoms of the « Signaux · Villes » rail reported by the owner on 2026-11-13: the « Période des signaux » picker no longer unfolds, and the Filtre dropdown counts read 0 unless a city is selected.

## Scope / Guardrails
- Debug lane (harness debug: evidence first, root cause before fix); branch `fix/signals-rail-picker-filtre-counts` from `origin/main` (`a45c45e8b`); no merge.
- Preprod read on Chrome CDP port 9333 only; no environment file read; no operator kube config.
- Commits carry no AI attribution trailer (owner instruction).

## Root causes (evidence)
- **Picker**: `@sentropic/design-system-svelte` 0.35.1 → 0.37.2 (commit `1c6c8604d`, PR #1044) made `MenuPopover` use the Popover API (`popover="manual"` + `showPopover()`, panel kept in place). The rail's `positionTimeRangePopover` action (commit `7d09a4cad`) still re-parented the panel to `[data-st-theme]`; removing a shown popover from the document hides it (`display: none`). Preprod (`a45c45e`): `aria-expanded="true"`, panel `display:none`, `:popover-open` false; a forced `showPopover()` displays it. Local QA harness: broken on `a45c45e` and `d4642bb` (before #1082), working on `791955a` (before the DS bump). #1082 is not involved.
- **Filtre counts**: since `417181db8` (PR #1044) the counts are computed by `filtreCountsFor(filtreScopedNodes)` over the selected city's loaded detail only; without a selection the detail is empty, so every count is 0. Design gap, not a #1082 regression.

## Decision: faceted counts
Each criterion counts the signals that pass every OTHER active criterion (period, Pertinence, other Filtre boxes), never its own: the counts follow the active filters (owner, 2026-11-13), an axis reads what the view shows with it checked, and a checked exclusion keeps showing what it hides instead of 0.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`, `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`, `ui/src/lib/components/maps/SignauxMapView.classement.test.ts`
  - `ui/src/lib/signals/signal-filter-counts.ts`, `ui/src/lib/signals/signal-filter-counts.test.ts`
  - `ui/src/lib/signals/graph-signals-by-city-client.ts`, `ui/src/lib/maps/maps-data.ts`
  - `packages/radar-domain/src/vivier/filtre-cube.ts`, `packages/radar-domain/src/vivier/filtre-cube.test.ts`, `packages/radar-domain/src/index.ts`
  - `api/src/services/graph/graph-store.ts`, `api/src/services/graph/filtre-cube-parity.test.ts`
  - `api/src/routes/graph-signals.test.ts` (typed by-city mocks gain `filtreCube`)
  - `api/src/artifacts/reader-by-city.ts`, `api/src/artifacts/reader-by-city.test.ts`
  - `docs/spec/SPEC_BASE_API.md`
  - `plan/SIGRAIL-BRANCH_fix-signals-rail-picker-filtre-counts.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `.github/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `package.json`, `package-lock.json`
  - `plan/NN-BRANCH_*.md` (other branches)
- **Conditional Paths**: none.

## Feedback Loop
- [x] attention: the jsdom suites have no Popover API, so the DS never sets `popover` there; the picker regression test installs a minimal model (show, and hide on removal) to observe the browser rule.
- [x] attention: the by-city artifact reader schema is strict; `filtreCube` is added there (optional) so the artifact transport does not answer 502.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Reproduction**: preprod via CDP 9333 (SHA served `a45c45e` = main); local QA harness on `a45c45e`, `d4642bb`, `791955a`.
- [x] **Lot 1 — Picker**: drop the portal action, keep the DS panel in place; scoped width rule; tests (fail before, pass after).
- [x] **Lot 2 — Filtre counts**: domain Filtre cube, served per city by the by-city aggregate (one classification per row), client faceted counts over the whole perimeter, live cube for the selected city; tests (fail before, pass after) and API parity test.
- [ ] **Lot 3 — Gates and delivery**
  - [x] `make typecheck`, `make lint`, `make test-ui` (`ENV=test-sigpicker`); scoped `make test-api` (`ENV=test-sigpicker-api`, then `down -v`).
  - [x] PR #1084 to `main` (no merge).
  - [ ] CI green; preprod check after deploy (picker unfolds; Filtre counts without selection).
