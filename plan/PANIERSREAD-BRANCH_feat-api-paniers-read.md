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
- [ ] Third-pass context/state: reproduce closure after the second catalog and stale business refusals during real PostgreSQL writes through createApp.
- [x] Third-pass discovery: lock approval before the atomic, share-locked active membership query; revalidate selected access and the entire set; 12 BASE writer races reproduce stale results on `65b6d3162`.
- [x] Second-pass discovery: reproduce eight PostgreSQL suspension races at the last membership await; revalidate approval with the BASE shared account lock before returning either membership sample; delivery range starts at `8c0ad35c`.
- [x] Second-pass mutations: all 18 mutants killed by domain assertions, with 28 failing cases then 28 passing cases after byte-exact restoration; includes the previous 15 mutants, final discovery approval, account lock and current rights.
- [x] Second-pass final acceptance: code `2a0132bb88ad1ca96d9976262e3d5897325a9a05`, evidence `tmp/classification-evidence/20261026T082806-5-qualify`; 3,899 API passes, 76 conditional skips, 61 classification passes without skips, 18 killed/restored mutants, lint/typecheck/build and owned-resource teardown passed.
- [x] Second-pass targeted acceptance: `631c384cf`, evidence `tmp/classification-evidence/20261026T080647-5-targeted`; 26 PostgreSQL/createApp tests passed without skips, API/test typecheck and lint passed, owned resources removed with volumes.
- [x] Second-pass qualification diagnosis: `20261026T081148-5-qualify` passes all 3,899 API tests, then rejects the lock mutant because Vitest reports a resolved `.rejects` check as `Error`; use direct domain assertions so the mutation gate requires and observes `AssertionError`.
- [x] Second-pass account lock: concurrent PostgreSQL `FOR UPDATE NOWAIT` fails with `55P03` while either discovery membership transaction holds BASE approval; the dedicated mutant remains part of final qualification.
- [x] Second-pass context: compare current signal/lot rights under the BASE workspace lock and revalidate approval last; discard changed samples within three attempts; share transactional activation/cutover/destination availability logic.
- [x] PANIERSREAD-EX3: owner-requested Astra B2 correction extends scope to the canonical parser in `api/src/routes/graph-signals.ts`; preserve persisted document metadata for degraded reads; rollback removes only parser/dedup metadata additions.
- [x] Astra review corrections: six fixes qualified with discriminating tests and mutations; full CI API selection, lint/typecheck/build pass; local delivery range is `bf339830..HEAD`.
- [x] Review acceptance: code `c771f9c9c7d7b3413d916f7773490a034c9ff836`, evidence `tmp/classification-evidence/20261026T072625-5-qualify`; 3,885 API passes, 76 conditional skips, 47 classification passes without skips, 15 killed/restored mutants and owned-resource teardown.
- [x] Review tooling: six additional killed/restored mutation scenarios, syntax/lint gates and delivery range based on `bf339830`.
- [x] Review context: final authority revalidation on closed paths and durable resampling through the real PostgreSQL scope reader.
- [x] Review queries: reject unknown/repeated prototype parameters with typed unit regression cases; the HTTP case accompanies the route refusal tests.
- [x] Review authentication: return typed private JSON refusals on all three browser read routes; HTTP prototype query refusals are covered too.
- [x] Review documents: preserve canonical persisted dates and validated source-link evidence, including search/state during S3 failure.
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
