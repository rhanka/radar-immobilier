# Fix: residential tri-state in the Signals filter (unknown is not non-residential)

## Objective
The default Signals view (`/geo/region/quebec?mode=signal`, period 3 months,
Zonage + Résidentiel + Précoce, PIIA and derogation exclusions) shows 0 signals
out of 853 in the window. Make the `r` axis respect the residential tri-state
(`oui` / `non` / `indetermine`): an early-stage signal (notice of motion, draft
bylaw) whose residential nature is unknown passes the Résidentiel filter
instead of being treated as non-residential.

## Root cause (measured on a read-only prod dump, 2026-10-06 01:08 UTC, API sha 782d20c)
- Filters are computed at read time: `/api/graph-signals/by-city`
  (`aggregateGraphSignalProjectionRows`: period + PIIA/derogation exclusions)
  and the client projection (`projectComposedVivierB`: z/r/p), both through
  `classifyGraphNodeVivierV2` and the shared predicate `isResidentialEligible`.
- Cumulative on the 853 window signals: PIIA 593 → derogations 336 → no server
  exclusion 331 → zonage 236 → résidentiel 9 → précoce 0.
- All 853 window nodes were created by the recurring PV refresh (first prod node
  2026-09-28). They carry no `description`, `category` or `kind` (35/4238
  descriptions vs 6255/7221 for the June extraction), so the residential axis
  stays `indetermine` and the instrument `autre`.
- Since PR #422/#423 (2026-07-25) `r` keeps `indetermine` only for
  `rezonage`/`refonte`, which drops every refresh node from the default view.
- The tri-state decision is `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md` §1
  (lines 10-12) and §3 (line 34, "indéterminé GARDÉ").

## Scope / Guardrails
- Scope limited to the shared `r` predicate, its tests, the B′ contract text and
  a read-only data dry-run script.
- No reclassification lexicon change (legacy A `r` golden untouched).
- Make-only workflow; tests on `ENV=test-sigres`, `down -v` after each stack.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-domain/src/vivier/counts.ts`
  - `packages/radar-domain/src/vivier/counts.test.ts`
  - `ui/src/lib/signals/vivier-view-mode.ts`
  - `ui/src/lib/signals/vivier-view-mode.test.ts`
  - `ui/src/lib/components/maps/SignauxRailFilterHarness.test.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `api/src/scripts/residential-tristate-dry-run.ts`
  - `api/src/scripts/residential-tristate-dry-run.test.ts`
  - `docs/spec/SPEC_CONTRAT_VIVIER_BPRIME_v1.md`
  - `plan/SIGRES-BRANCH_fix-signal-filters-residential-unknown.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths**: none used.

## Feedback Loop
- attention: with Précoce checked, `r` no longer removes any non-excluded
  signal of the default view (z∩r∩p = z∩p = 61 on the window). It still filters
  late-stage unknowns that are neither rezonings nor reforms when Précoce is
  unchecked. Owner to confirm this is the intended reading of the tri-state.
- attention: 359 explicit `non` verdicts rest only on context markers
  (agricole, stationnement, riverain, milieux humides, inondable, conservation,
  environnement). Not changed here (golden lexicon); owner decision.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & root cause** (read-only prod dump, filter-by-filter counts)
- [x] **Lot 1 — Test first**: domain, API aggregate (event-26-220 shape) and UI
      projection tests reproduce the exclusion (red).
- [x] **Lot 2 — Fix**: `isResidentialEligible` keeps early-stage unknowns other
      than individual authorisations (derogation, PIIA); rail harness test and
      B′ contract updated.
- [x] **Lot 3 — Data dry-run**: `residential-tristate-dry-run.ts` (read-only,
      `--apply` refused, S3 canonical or PG dump source).
- [x] **Lot gate** (`ENV=test-sigres`, stack removed with `make clean`):
      `make typecheck` exit 0, `make lint` exit 0, `make test` exit 0 — api
      2131 passed / 6 skipped, ui 1639 passed / 10 todo, radar-domain 292,
      radar-sources 1293, radar-scoring 57, immo-mcp 64.
