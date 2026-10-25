# Feature: A2-BASE scoped MCP adapter and strict A3 receiver

## Objective
- [ ] Replace the retired signal HTTP reader with the approved scoped contract; qualify typed errors, exchange isolation and the strict receiver without production activation.

## Scope / Guardrails
- [x] Assigned worktree `tmp/a2base-mcp`, branch `feat/artefacts-mcp-a2base-mcp`, base `dce9b366cacfe984605d401a78a99a03f0287212` includes qualified API T01/T03–T07.
- [x] Use make only, ENV last; never read environment files, install dependencies on the host, add dependencies or migrations.
- [x] Reserve `ENV=test-a2base-mcp`, API/UI/Maildev ports `18921/15921/11921`; no root UAT changes.
- [x] Shared Git remains read-only; local backup Git uses this worktree, selective staging, subject-only Conventional Commits of at most 150 changed lines.
- [x] One Docker stack machine-wide; check every 60 seconds, one test worker, stop below 10 GiB free, owned down with volumes and orphans on exit.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `packages/immo-mcp/src/{data-source,signal-read-*,signal-search-*,tool-handlers,tools,exchange-config}.ts`, related tests and actual A4 dispatcher if present.
- [x] **Allowed Paths (implementation scope)**: `api/src/artifacts/strict-receiver*`, `api/src/config.ts`, strict configuration tests, `api/src/routes/auth.ts`, `api/tests/integration/{a2base-mcp*,artifacts-strict*}`.
- [x] **Allowed Paths (implementation scope)**: `tools/make/base-api-a2mcp*`, this plan; parent plan only for the exception.
- [x] **Forbidden Paths (must not change in this branch)**: root Makefile, compose files, rules, bootstrap files, other branch plans, migrations, dependency manifests/lockfile, API search facade/services/card constructor, app/startup, H5.
- [x] **Conditional Paths**: parent ARTEFACTS plan under BRARTEFACTS-EX6; test-only local facade mounting does not authorize production T08/T09.
- [x] **Exception process**: BRARTEFACTS-EX6 recorded before implementation; CT-3 and CT-9 remain unchanged.

## Feedback Loop
- [x] BRARTEFACTS-EX6: approved A2-BASE MCP/A3 delta owns the exact paths above, because BASE retires its legacy reader. Impact: strict search-only H4 profile, renewed route/schema/policy/image receipt, typed refusals and scoped HTTP adapter. No business writes, production mount or activation. Recovery preserves the current image before activation, then closes only signal capability and uses a qualified scoped/strict image.
- [x] T08/T09 remain API-owned; integration tests mount the facade locally on createApp and must not be reported as delivered production wiring.
- [x] H5/A6/A7, combined images, CT-8/CT-9 acceptance and operator deployment receipt remain integration duties; no main merge or push authorized.

## Orchestration Mode (AI-selected)
- [x] Single assigned branch and single writer; local backup Git avoids shared metadata writes.

## UAT Management (in orchestration context)
- [x] No UI change or UAT requested; root checkout and fixed UAT ports remain untouched.

## Plan / Todo (lot-based)
- [x] Lot 0: read approved design and both reviews; identify ownership and explicit suite collection requirement; bootstrap local delivery tooling.
- [x] T02: fixed public typed errors and MCP serialization; 503/410/404/payload tests; preserve scope/stub behavior.
- [x] T10: scoped HTTP request, strict response validation, no legacy mapper/fetch or 404 success.
- [x] T11: exchanged bearer only, typed authorization invalidation, cache and concurrent invocations isolated.
- [x] T12a: exact GET route and strict raw query decoding; no legacy or broad-prefix authority.
- [x] T12b: route/schema/policy/image receipt wiring and negative configuration proofs; defaults remain closed.
- [x] Qualification: unit and createApp/PostgreSQL integration for each slice, authority/masking mutants, inherited graph-signals/date-parity regressions.
- [x] Static checks PASS at 20261025T173554; 289 API and 372 MCP tests PASS at 20261025T173649, zero skips. Mutation campaign stopped after seven kills because an authority failure was a TypeError; no false PASS recorded. Improve the assertion, select the dedicated membership case and rerun all controls/mutants.
- [x] Final campaign 20261025T174804-5-mutations PASS on d86500e6: static checks, 289 API + 372 MCP tests across 66 explicit files, zero failures/skips; 13 named behavioral mutants killed, 26 passing controls/88 executions, independent JSON and exact archived-source byte audit PASS.
- [x] Approval mutant now proves refusal before business dispatch, rather than relying on a redundant downstream approval guard; no runtime guard was weakened.
- [x] CT-8 fresh/upgrade/rerun PASS locally, 23 hashes exactly once; owned down -v --remove-orphans status 0 with no owned container, volume or network remaining.
- [x] Delivery prepared: every commit numstat audited; mandatory bundle import into a blank prerequisite-only repository is enforced by the export target, with its final result recorded in the companion report.

## Docs consolidation
- [x] Root French companion report records slices, commands, evidence and remaining duties; export finalization supplies its final SHA, bundle hash and independent import audit. The report stays outside its own hashed bundle.

## Merge & close
- [ ] Integrator imports bundle and qualifies combined SHA/images; no activation, push or merge in this mission.
