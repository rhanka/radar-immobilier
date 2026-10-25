# Feature: A2-BASE facade integration

## Objective
- [ ] Deliver T08/T09/T13/T14 from e32138c9, without activation or push.

## Scope / Guardrails
- [x] Make only; no environment files, Python, dependencies or migrations.
- [x] Single writer; test-a2base-rest ports 18926/15926/11926; ENV last; one Docker campaign, one worker, 10 GiB disk floor, owned cleanup.
- [x] Local backup Git only; subject-only commits at most 150 changed lines; audited prerequisite-only bundle import.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: API mcp-signal-search routes, mcp-signal-* services, mcp-signal-search* integration tests, tools/make/base-api-a2rest*, this plan.
- [x] **Conditional Paths**: api/src/app.ts under exclusive CT-1/CT-2 integration lease; parent plan EX7; root companion report outside hashed bundle.
- [x] **Conditional Paths**: a2base-mcp-fixture.ts replaces its superseded test-only facade with the production route; no A3 receiver or MCP package edits.
- [x] **Forbidden Paths**: MCP package, A3/H5 receivers, auth/config/startup, migrations, manifests/lockfile, root Makefile/Compose, rules, bootstrap, other plans.
- [x] **Exception process**: BRARTEFACTS-EX7 records rationale, impact and recovery before conditional edits.

## Feedback Loop
- [x] Assigned developer/tester/integrator owns the app and isolated runner lease for T09/T14. CT-3/CT-9 remain unchanged.

## Orchestration Mode (AI-selected)
- [x] Sequential implementation and machine-serialized qualification.

## UAT Management (in orchestration context)
- [x] No UI/UAT change; root checkout and stable dev data preserved.

## Plan / Todo (lot-based)
- [ ] T08: canonical domain projection and filters before limit; explicit shared-builder regressions and cross-retry budget.
- [x] T08 code: port the removed MCP mapper to API, preserve canonical priorities and apply domain filters before limit; qualification pending.
- [ ] T09: facade mounted after protect, default closed, private refusals and authorized empty success.
- [x] T09 implementation: exact facade after protect with private headers before authentication, optional server-only binding absent at startup; inherited probes isolated from the production path.
- [x] T09 real createApp/PostgreSQL fixture and empty/private/default-denial cases written; no local facade callback replaces the production route.
- [ ] T13: createApp/PostgreSQL authority, archives, races and cutover groups, separate commits.
- [x] T13 authority group written against the production facade: current account approval, 0/1/N memberships, outsider and explicit destination refusals.
- [x] T13 archive group written: personal/common OR masking, other-member privacy, reveal guards, identity keys, restoration and SQL read-only snapshots, hidden targets never enriched.
- [x] T13 races group written: deterministic document barriers for membership/account/source/archive changes, explicit selector stability, plus an observed PostgreSQL lock wait followed by revocation.
- [x] T13 state group written: canonical parity while legacy serves, legacy 503/410 with independent open scoped reads, missing/legacy/barrier epochs and unresolved history refusals.
- [x] Production facade filter qualification includes a late matching PostgreSQL card with limit=1 and preserved firm status.
- [x] Initial T08/T09 gate PASS: 74 API tests across six explicit files plus eight MCP baseline cases, no failures/skips; documentary waiting measured 2,025ms/one resolution; owned cleanup status 0.
- [ ] T14: explicit MCP E2E runner, complete HTTP search through production facade and image evidence.
- [x] T14 network fixture written: SDK/Streamable HTTP, socket token issuer verifying incoming signatures, signed exchanged JWT/JWKS, real createApp/A3 facade and PostgreSQL; no business response injection.
- [x] T14 seven socket E2E cases written: three legacy states, two humans, same-human concurrent renewed scopes, cross-session refusal, warm-cache revocations and capability closure.
- [x] An eighth network case covers private refusal of original bearer, encoded/suffixed paths, POST, duplicate and authority query keys; header-only middleware covers malformed signal paths without widening A3 authority.
- [x] Explicit test-base-adapter-e2e target requires seven non-skipped network cases; eleven bounded behavioral mutants cover authority, masking, revision/budget, projection and the closed binding.
- [x] Image preparation written: locked dependencies, API declaration build and production-style bundles; network fixture imports compiled API/MCP entrypoints in the image, without source mounts or installs at runtime.
- [x] Qualification can keep a single owned stack for static checks, explicit API/MCP scopes, eleven mutants with controls, declaration/bundle build and eight compiled-image network cases.
- [x] Static runner proof PASS: require_scope accepts the explicit network suite and rejects the directory prefix from design review r2; mutation receipts include executed control counts.
- [x] Reservation race reproduced: local flock available, global flock busy and a new E3 stack started after the empty-container observation. Retry the global reservation every 60 seconds and recheck containers while holding it; never start a second stack or treat reservation failure as qualification.
- [x] Queue on the same global flock before observing container quiescence, retaining 60-second ownership checks; this prevents repeated new campaigns from taking each brief empty-container window. Earlier waits created no owned resources.
- [ ] Qualification: scoped checks and authority/masking mutations, no required skipped cases.

## Docs consolidation
- [ ] French companion report with evidence, per-commit numstat, delivered SHA and bundle hash.

## Merge & close
- [ ] Integration owner imports bundle; T15/H5 and T16/T17 delivery receipts remain separately assigned.
