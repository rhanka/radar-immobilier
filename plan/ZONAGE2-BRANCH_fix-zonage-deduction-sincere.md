# Fix: Sourced zoning-family deduction

## Objective
Correct unsupported zoning-family deductions, distinguish code-derived API data from source data, and make the Signaux map legends reflect the data actually available.

## Scope / Guardrails
- Scope is limited to zoning-family deduction, its documented provenance, and the four requested Signaux map UI regressions.
- Preserve owner choice B: a resolved family remains visible in the panel and legend; no provenance wording is added to the UI.
- Do not change numeric lot scoring, unrelated API behavior, deployment, or production data.
- Development stays in the existing `fix/zonage-deduction-sincere` worktree; tests use `ENV=test-zonage2`.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `docs/spec/SPEC_DEDUCTION_ZONAGE_CODE_FAMILLE.md`
  - `ui/src/lib/maps/lot-potential-visual.ts`
  - `ui/src/lib/maps/lot-potential-visual.test.ts`
  - `ui/src/lib/maps/zone-kind-style.ts`
  - `ui/src/lib/maps/zone-kind-style.test.ts`
  - `ui/src/lib/maps/zone-kind-filter.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.test.ts`
  - `api/src/services/geo/simulation/zone-kind.ts`
  - `api/src/services/geo/simulation/simulation-provider.test.ts`
  - `api/src/services/geo/lot-zone-enrichment.ts`
  - `api/src/services/geo/lot-zone-enrichment.test.ts`
  - `plan/ZONAGE2-BRANCH_fix-zonage-deduction-sincere.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - numeric lot-scoring implementation outside the allowed files
  - deployment configuration
- **Conditional Paths**:
  - none

## Feedback Loop
- [x] Owner decisions fixed by the mission: three-tier precedence, choice B, no provenance copy in the UI, and `kindSource: "code"` when the API falls back to the zone code.
- [x] Source basis fixed by `FABLE_DEDUCTION_ZONAGE_REPORT.md`; the report remains untracked.

## Plan / Todo
- [x] **Lot 0 — Baseline and evidence**
  - [x] Confirm branch and exact `origin/main` base.
  - [x] Read the Fable source report and relevant project rules.
  - [x] Trace both UI and API deduction paths and the rendered Checkbox DOM/CSS path.

- [x] **Lot 1 — Correct deduction and provenance**
  - [x] Correct unsupported UI/API token mappings and add negative regressions.
  - [x] Split conservation and recreation styles and verify rendered legend labels/colors.
  - [x] Add `kindSource: "code"` only for API code fallback and verify source/code cases.
  - [x] Commit as `fix(vues)`.

- [x] **Lot 2 — Correct Signaux map legends**
  - [x] Remove the CPTAQ-absence notice while retaining actionable states.
  - [x] Make the agricultural label conditional on actual CPTAQ presence.
  - [x] Fix number-toggle typography on the real DS label node and verify the DS style contract.
  - [x] Hide neutral-only lot entries while retaining the lot-number toggle.
  - [x] Commit as `fix(vues)` or `feat(vues)` by behavior.

- [x] **Lot 3 — Finalize specification and verification**
  - [x] Write the sourced status table, corrections, residual limits, precedence target, and API mechanism.
  - [x] Run focused UI/API tests, map suites, `svelte-check`, and branch scope verification.
  - [x] Commit as `docs(spec)` and produce the untracked `.sol-build-report-v2.md`.
