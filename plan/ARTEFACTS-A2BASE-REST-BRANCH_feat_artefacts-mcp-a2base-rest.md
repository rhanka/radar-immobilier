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
- [ ] T13: createApp/PostgreSQL authority, archives, races and cutover groups, separate commits.
- [ ] T14: explicit MCP E2E runner, complete HTTP search through production facade and image evidence.
- [ ] Qualification: scoped checks and authority/masking mutations, no required skipped cases.

## Docs consolidation
- [ ] French companion report with evidence, per-commit numstat, delivered SHA and bundle hash.

## Merge & close
- [ ] Integration owner imports bundle; T15/H5 and T16/T17 delivery receipts remain separately assigned.
