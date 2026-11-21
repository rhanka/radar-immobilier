# Fix: Classification retry, ambiguous document date fallback, and upcoming sessions (#1164)

## Objective
Fix three gaps behind issue #1164 in one PR (`Refs #1164`):
1. Retry unclassified `Signal` and `DesignationEvent` nodes of a city in the current documentary-date window on subsequent refresh passes, reusing `REFRESH_CLASSIFY_*` primary/fallback models with a configurable per-city per-pass cap and strict protection of manual and valid AI classes.
2. Trigger the model documentary-date fallback when upstream `documentDate.status === "ambiguous"` and persist the resolved date.
3. Remove the `dateTo` upper bound on relative signal period presets so upcoming council sessions (e.g. J+4) stay visible.

## Scope / Guardrails
- Month-only precision and English month parsing are explicitly out of scope per owner decision.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree `./tmp/fix-1164-dates`.
- Automated test campaigns run on `ENV=test-1164-dates`, never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/signals/signal-date-filter.ts`
  - `ui/src/lib/signals/signal-date-filter.test.ts`
  - `ui/src/lib/router/signal-query-v1-mapping.test.ts`
  - `ui/e2e-qa/signals-period-perimeter.spec.ts`
  - `api/src/services/graph/refresh-corpus.ts`
  - `api/src/services/graph/refresh-corpus.test.ts`
  - `api/src/services/graph/refresh-run.ts`
  - `api/src/services/graph/refresh-run.test.ts`
  - `api/src/services/graph/refresh-classify-config.ts`
  - `api/src/services/graph/refresh-classify-config.test.ts`
  - `api/src/services/graph/refresh-classify.ts`
  - `api/src/services/graph/refresh-classify.test.ts`
  - `api/src/services/graph/reannotate-repository.ts`
  - `api/src/services/graph/reannotate-signals.ts`
  - `api/src/services/graph/class-annotations.ts`
  - `api/src/services/graph/refresh-two-step-db.test.ts`
  - `api/src/services/sources/document-date-metadata.ts`
  - `api/src/services/sources/document-date-metadata.test.ts`
  - `plan/1164-BRANCH_fix-1164-relative-dateto-ambiguous-fallback.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- Owner GO (2026-11-20): one PR (`Refs #1164`) delivering (1) bounded per-city classification retry on next refresh pass, (2) model fallback for `ambiguous` document date, and (3) open upper bound on relative period presets.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (three focused fixes for #1164 targeting one PR)
- [ ] **Multi-branch**
- Rationale: All three fixes address issue #1164 and belong in a single PR with one CI pass.

## UAT Management (in orchestration context)
- UAT, if requested by the owner, happens on the root checkout (`ENV=dev`, `http://localhost:5301`).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`.
  - [x] Create isolated repository-local worktree `./tmp/fix-1164-dates` on latest `origin/main`.
  - [x] Define isolated test environment `ENV=test-1164-dates` with dedicated ports (`API_PORT=18844`, `UI_PORT=15344`, `MAILDEV_UI_PORT=11144`, `POSTGRES_HOST_PORT=15544`, `S3_HOST_PORT=19144`).
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Fix 3: Open upper bound on relative period presets**
  - [x] Remove `end` (`dateTo`) for relative presets in `ui/src/lib/signals/signal-date-filter.ts`.
  - [x] Update and add J+4 regression tests in `ui/src/lib/signals/signal-date-filter.test.ts`, `ui/src/lib/router/signal-query-v1-mapping.test.ts`, and `ui/e2e-qa/signals-period-perimeter.spec.ts`.

- [ ] **Lot 2 — Fix 2: Model fallback for ambiguous document dates**
  - [ ] Attach `documentHeader` in `api/src/services/graph/refresh-corpus.ts` when `documentDate.status === "ambiguous"`.
  - [ ] Allow a `known` candidate to resolve an `ambiguous` sidecar in `api/src/services/sources/document-date-metadata.ts` without downgrading `ambiguous` to `unknown` or overwriting `known`.
  - [ ] Add unit tests in `api/src/services/graph/refresh-corpus.test.ts`, `api/src/services/sources/document-date-metadata.test.ts`, and `api/src/services/graph/refresh-run.test.ts`.

- [ ] **Lot 3 — Fix 1: Bounded classification retry on next refresh pass**
  - [ ] Add configurable `REFRESH_CLASSIFY_RETRY_LIMIT` and `REFRESH_CLASSIFY_RETRY_WINDOW_DAYS` in `api/src/services/graph/refresh-classify-config.ts`.
  - [ ] Add `missingOnly` and `preserveExistingAi` guards in `api/src/services/graph/reannotate-signals.ts`, `api/src/services/graph/class-annotations.ts`, and `api/src/services/graph/reannotate-repository.ts`.
  - [ ] Wire `retryUnclassifiedRefreshSignals` in `api/src/services/graph/refresh-classify.ts` and `api/src/services/graph/refresh-run.ts`.
  - [ ] Add unit and PostgreSQL integration tests in `api/src/services/graph/refresh-classify-config.test.ts`, `api/src/services/graph/refresh-classify.test.ts`, and `api/src/services/graph/refresh-two-step-db.test.ts`.

- [ ] **Lot 4 — Gate, PR & report**
  - [ ] Run `make typecheck`, `make lint`, `make test-ui`, and scoped `make test-api` on `ENV=test-1164-dates`.
  - [ ] Push branch, open PR (`Refs #1164`), and verify green CI.
  - [ ] Write summary report.
