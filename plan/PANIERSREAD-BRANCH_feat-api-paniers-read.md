# Feature: Classification read API

## Objective
- [x] Deliver the v4 signal context, search and state read contracts.

## Scope / Guardrails
- [x] Worktree `tmp/api-paniers-read`, base `600d78485965361c89109bf61eccaa0250cf7284`.
- [x] Make only; no environment files, migrations, push or activation.
- [x] Test mapping: ENV=test-api-paniers, API_PORT=18927, UI_PORT=15927, MAILDEV_UI_PORT=11927.
- [x] One Docker campaign; local backup history; commits at most 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/src/services/facets/classification-*`, `api/src/routes/scoped-classification*`, `api/tests/integration/classification-*`, `tools/make/classification*`, this plan, delivery report.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, bootstrap files, other plans, migrations, write/transport profiles.
- [x] Conditional Paths: `api/src/app.ts`, mounting only under PANIERSREAD-EX1.

## Feedback Loop
- [x] PANIERSREAD-EX3: owner-requested Astra B2 correction extends scope to the canonical parser in `api/src/routes/graph-signals.ts`; preserve persisted document metadata for degraded reads; rollback removes only parser/dedup metadata additions.
- [ ] Astra review corrections: qualify six fixes with discriminating tests and killed/restored mutations, full CI API selection, lint/typecheck, then audit local commits and bundle above `bf339830`.
- [x] Review tooling: six additional killed/restored mutation scenarios, syntax/lint gates and delivery range based on `bf339830`.
- [x] Review context: final authority revalidation on closed paths and durable resampling through the real PostgreSQL scope reader.
- [ ] Review queries: reject unknown/repeated prototype parameters with typed unit and HTTP regression cases.
- [ ] Review authentication: return typed private JSON refusals on all three browser read routes.
- [ ] Review documents: preserve canonical persisted dates and validated source-link evidence, including search/state during S3 failure.
- [x] PANIERSREAD-EX1: owner instruction assigns the integrator this workspace; preserve all mounts, add the closed read router; rollback removes that mount.
- [x] PANIERSREAD-EX2: extend `projection-revisions-fixture.ts` with optional event fields to reuse the unresolved-history fixture for lot history; test-only, default unchanged; rollback removes optional fields.
- [x] PS-04 handoff documented: H5 state binding waits for A6/A7; no transport activation in this branch.
- [x] Qualified code SHA: `f8a8079655eff3646d16e3ba459d7181fd0b2ac9`; evidence `tmp/classification-evidence/20261025T235202-5-qualify`.

## Orchestration Mode (AI-selected)
- [x] Single branch, sequential implementation and Docker verification.

## UAT Management (in orchestration context)
- [x] API-only synthetic qualification; root dev/UAT untouched.

## Plan / Todo (lot-based)
- [x] P0-01 primitives and inputs (strict decoding and fixed public errors).
- [x] P0-02 heads and count contracts (strict nested schemas and invariants).
- [x] P0-03 bounded canonical card (explicit public fields and safe URLs).
- [x] P0-04 family context (durable gates, separate rights, no head read).
- [x] P0-05 nullable catalog (guarded persisted associations, nullable labels, version).
- [x] P0-06 discovery 0/1/N (whole membership set revalidated, transports closed).
- [x] P0-07 closed route (private headers before authentication, no activation).
- [x] P0-08 authority/context tests (real createApp, PostgreSQL, 0/1/N).
- [x] P1-01 population and native keys (canonical city reader, no Vivier filter).
- [x] P1-02 scoped heads and archive union (BASE readers and persisted profiles).
- [x] P1-03 counters (eight-target oracle, history/archive before basket).
- [x] P1-04 clock and order (persisted civil dates, binary ties, missing last).
- [x] P1-05 signed cursor (strict HMAC/keyring, opaque reader context, five minutes).
- [x] P1-06 continuation (binding/error order, stable expiry, limit+1, size test).
- [x] P1-07 coherent 6L1 orchestration (three total attempts, catalog revalidation).
- [x] P1-08 card projection (one canonical cache/deadline, explicit DTO, 2 MiB).
- [x] P1-09 mounting (operator-injected keyring; absent configuration closes search).
- [x] P1-10 PostgreSQL privacy tests (two readers/workspaces/cities, private-token stability).
- [x] P1-11 races and pagination (P1-11a/b: authority, source/catalog and singleton races).
- [x] PS-01 current state DTO (shared canonical item projection, missing-source union).
- [x] PS-02 reveal and guards (explicit reveal, separate restoration, error revalidation).
- [x] PS-03 route and missing sources (typed reveal, absent source with/without history).
- [x] Gates: 37 classification cases, full API suite (3875 passed; 76 conditional skips), nine killed/restored mutants, lint, typecheck and build; includes the personal-archive read race.
- [x] Delivery: bounded commit audit, owned-resource teardown, bundle imported and verified in an empty audit repository; separate French receipt carries the final bundle hash.
