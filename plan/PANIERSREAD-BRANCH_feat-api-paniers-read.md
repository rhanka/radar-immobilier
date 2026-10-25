# Feature: Classification read API

## Objective
- [ ] Deliver the v4 signal context, search and state read contracts.

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
- [x] PANIERSREAD-EX1: owner instruction assigns the integrator this workspace; preserve all mounts, add the closed read router; rollback removes that mount.
- [ ] PS-04 H5 state binding waits for A6/A7; no transport activation in this branch.

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
- [ ] PS-01 current state DTO.
- [ ] PS-02 reveal and guards.
- [ ] PS-03 route and missing sources.
- [ ] Gates: targeted contracts/algorithms, createApp/PostgreSQL, mutations, CI API suite, lint, typecheck.
- [ ] Delivery: commit audit, clean-resource evidence, bundle imported in an empty audit repository, French report.
