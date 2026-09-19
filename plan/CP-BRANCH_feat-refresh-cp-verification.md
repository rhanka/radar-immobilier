# Feature: Refresh precision verification

## Objective
Apply the frozen v101b precision cascade to accepted PV extractions: Astra medium,
then Gemini low verification that can only remove unsupported acts and incident edges.
Record append-only document submission outcomes in the existing radar PostgreSQL database.

## Scope / Guardrails
- Work only in the conductor-provided `tmp/impl-cp-refresh` worktree, branch `feat/refresh-cp-verification`.
- Base: `0f83522aacf5c0915336d778189085a67c7eecfd` from `origin/main`.
- No commit, push, deployment, cluster operation, switch, or purge; conductor reviews and commits.
- Preserve extraction fallback and the quota circuit. Never verify a fallback output.
- Keep the frozen instruction verbatim. Use fake model transports in tests.
- Make-only execution; test environment `test-refresh-cp`, API 8896, UI 5396, Maildev 1196.
- Test compose exposes no host ports. Root dev/UAT is unchanged.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/graph/refresh-model-policy.ts`
  - `api/src/services/graph/refresh-verification*.ts`
  - `api/src/services/graph/refresh-run.ts`
  - `api/src/services/graph/refresh-document-outcomes.ts`
  - `api/src/db/schema.ts`
  - `api/drizzle/0012_refresh_document_outcomes.sql`
  - `api/drizzle/meta/_journal.json`
  - `api/src/scripts/refresh-pv.ts`
  - `api/tests/integration/refresh-018.spec.ts`
  - `deploy/k8s/34-refresh-cronjob.yaml`
  - `deploy/k8s/refresh-cronjobs/refresh-018.mk`
  - `deploy/ci/README.md`
  - `docs/reviews/refresh-cascade/production-acceptance.md`
  - `docs/reviews/refresh-astra/production-acceptance.md`
  - `plan/CP-BRANCH_feat-refresh-cp-verification.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - Other branch plans, dependencies, benchmark outputs, ontology, scoring, source adapters.
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None required.
- **Exception process**:
  - Record a CP-EXn rationale, impact, and rollback before expanding scope.

## Feedback Loop
- [x] Conductor brief authorizes the CronJob and offline render contract edits.
- [x] Frozen instruction located in the benchmark worktree; SHA-256 `cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68`.
- [x] Second-pass owner correction supersedes invariant 5: remove incident edges exactly as `precision-cascade.mjs` does.
- [x] CP-EX1: second-pass brief authorizes the dedicated append-only PostgreSQL outcome table, migration, and writer; no legacy ingestion tables touched. Rollback before release: remove only these additions; never purge outcome history.
- [ ] Independent review remains with the conductor, as assigned by the brief.
- [x] Second-pass `make test-api SCOPE='src/services/graph/refresh tests/integration/refresh-018.spec.ts' API_PORT=8896 UI_PORT=5396 MAILDEV_UI_PORT=1196 ENV=test-refresh-cp`: 163 tests passed across 9 files, fake model transports and real PostgreSQL/MinIO.
- [x] `make typecheck` and `make lint`, each with `COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.test.yml' API_PORT=8896 UI_PORT=5396 MAILDEV_UI_PORT=1196 ENV=test-refresh-cp`: passed. Typecheck reports 7 CSS warnings in untouched `SignauxSelPanel.svelte`.
- [x] `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=test-refresh-cp`: both offline overlays passed, including the production memory guard.
- [x] Live model behavior, benchmark gains, Job timing, remote CI, and cluster acceptance were not exercised in this implementation assignment.

## Orchestration Mode (AI-selected)
- [x] Single worktree; conductor owns review and commits.

## UAT Management (in orchestration context)
- [x] No UI change or UAT operation requested.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read project rules, harness guidance, and the full brief.
  - [x] Confirm branch, base, clean worktree, scope, environment, and Make targets.
- [x] **Lot 1 — Verification**
  - [x] Add frozen prompt, eligible act grouping, removal-only decisions, and counters.
  - [x] Keep accepted extraction on verification failures; preserve fallback/quota policy.
  - [x] Add durable verification receipts, policy identity, and four-call budget reservation.
  - [x] Cover all five invariants with fake transport tests and storage integration.
  - [x] Lot gate: scoped unit and integration tests, typecheck, lint.
- [x] **Lot 2 — Configuration and documentation**
  - [x] Wire `REFRESH_VERIFY_*` and Astra medium; update offline render assertions.
  - [x] Correct the three obsolete operational documents.
  - [x] Lot gate: preproduction and production offline `verify-renders`.
  - [x] Write the requested 15-line conductor status report.
- [x] **Lot 3 — Second-pass corrections**
  - [x] Reproduce the incident-edge bug with a failing test, then implement the benchmark's exact endpoint filter.
  - [x] Version the durable verification contract to avoid reusing earlier dangling-edge outputs.
  - [x] Add migration 0012 and the dedicated append-only metadata table, with date/status indexes and page count.
  - [x] Verify accepted/refused outcomes, retry history preservation, multichunk aggregation, and cache-only resumes.
  - [x] Confirm database `radar` and both indexes using only PostgreSQL; legacy tables are untouched.
  - [x] Report other benchmark divergences without changing them; document crash/DB outage limits.
- [ ] **Lot 4 — Conductor review & close**
  - [ ] Conductor review, commits, CI, and release decisions (outside this implementation assignment).
