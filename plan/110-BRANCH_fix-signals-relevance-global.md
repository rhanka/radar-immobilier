# Feature: Global signal relevance filtering

## Objective
Apply Pertinence consistently to the signal header, city list, map and selected cards using existing city cubes.

## Scope / Guardrails
- No API changes, heavy reads, restoration or reclassification changes.
- Preserve archive-free list semantics pending #1092.
- Worktree: `tmp/relevance-global`; branch: `fix/signals-relevance-global`.
- No environment files, Python, attribution trailers or merge.
- Dedicated runtime: `test-relevance-global`, UI 5328, API 8828, Maildev 1128; CDP 127.0.0.1:9333 only.
- Make commands use ENV last; tear down the runtime with volumes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/signals/signal-filter-counts*`
  - `ui/src/lib/components/maps/SignauxRail*`
  - `ui/src/lib/components/maps/SignauxMapView*`
  - `ui/src/lib/components/maps/GeoCityMapBase.svelte`
  - `ui/e2e-qa/signals-relevance*`
  - `ui/e2e-qa/harness/signals-relevance*`
  - `ui/vite.config.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - `api/**`, other branch plans
- **Conditional Paths**:
  - None.

## Feedback Loop
- No pending decision.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; bounded UI correction.

## UAT Management (in orchestration context)
- [x] Browser verification uses an isolated runtime and the authorized CDP endpoint.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Read project rules and harness debug/test skills.
  - [x] Confirm origin/main baseline 0742dae with #1090.
- [ ] **Lot 1 — Regression and correction**
  - [x] Prove browser regression red on the baseline: expected 5/3, got 8/4 without selection and 7/4 with Delson (CDP native checkbox clicks).
  - [x] Share cube-based counts across rail and map; filter fills, outlines and labels to matching cities.
  - [ ] Verify period, axes, exclusions and selection with real clicks.
- [ ] **Lot 2 — Gates and delivery**
  - [ ] Typecheck, lint, test-ui, browser regression green.
  - [ ] Push and open PR to main without merging.
  - [ ] Tear down isolated stack with volumes.
