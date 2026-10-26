# Feature: A2-BASE facade integration

## Objective
- [x] Deliver T08/T09/T13/T14 from e32138c9, without activation or push.

## Scope / Guardrails
- [x] Astra correction resumes from d8f2cc06: deliver the adapter before 6H using the internal legacy reader; scoped reads, maintenance refusal and legacy retirement remain enforced.
- [x] Make only; no environment files, Python, dependencies or migrations.
- [x] Single writer; test-a2base-rest ports 18926/15926/11926; ENV last; one Docker campaign, one worker, 10 GiB disk floor, owned cleanup.
- [x] Local backup Git only; subject-only commits at most 150 changed lines; audited prerequisite-only bundle import.

## Branch Scope Boundaries (MANDATORY)
- [x] BRARTEFACTS-EX10: owner-authorized second-pass fixes from 66ff7898 allow only scope.ts maintenance error helpers and packages/immo-mcp/src/signal-read-error.ts plus its test, despite the general MCP exclusion. Preserve all other reader guards and error categories; revert the helper/decoder changes together if API-to-MCP retryability fails. Deliver a separate prerequisite-66ff7898 bundle without push.
- [x] BRARTEFACTS-EX9: allow only api/src/services/graph/regulatory-status-archi.test.ts to follow the mapper's established API relocation; preserve canonical status passthrough and MCP classifier independence through the strict decoder. Impact is test-only; revert if the real mapper/HTTP regressions do not validate the invariant.
- [x] BRARTEFACTS-EX8: allow api/src/routes/graph-signals.ts solely to extract its existing read-only card reader for server-side reuse; preserve HTTP status, filters, archives and enrichment behavior; revert extraction and adapter together if parity fails.
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
- [x] Full qualification 20261026T074920-10-qualify passes 370 targeted API cases, full CI API 3903 passed/76 conditional skips, MCP 373, seventeen killed mutants/34 controls/150 executions and thirteen compiled-image cases. Final runner audit requires down -v --remove-orphans before image build, then a separate idle check before rebuilding synthetic dependencies and CT-8/schema bootstrap inside the image; rerun the image proof with runtime source unchanged.
- [x] Campaign 20261026T074206-10-qualify caught inherited TS2379: omit the optional workspace barrier when absent instead of explicitly passing undefined under exactOptionalPropertyTypes; retain owned cleanup and rerun qualification.
- [x] Extend mutation controls to workspace rebinding, entry/enrichment maintenance categories and the MCP decoder; retain thirteen existing mutants, lint the helper/decoder and require thirteen network/image cases. Preserve earlier bundles and audit only commits above 66ff7898.
- [x] Add production-facade workspace-switch regressions and entry/enrichment maintenance assertions through the MCP decoder; exercise real-storage maintenance over sockets for missing, legacy and scoped epochs.
- [x] Bind the original scoped workspace and revalidate it before projection access; distinguish maintenance at entry and enrichment and decode it as a retryable MCP cutover. Baseline 20261026T073802-5-test reproduces the remaining 403-versus-409 defect in the inherited patch.
- [ ] Qualify second-pass workspace binding and retryable maintenance with deterministic regressions, killed mutants and restored-byte controls; rerun affected suites, full CI API collection, MCP, graph-signals and compiled-image network proofs before/after 6H.
- [x] Integration typecheck requires a defined synthetic S3 endpoint under exactOptionalPropertyTypes; reject missing fixture wiring explicitly before constructing the real S3 client.
- [x] Reproduced Docker's label inequality filter returning no foreign containers despite a live foreign stack; inspect explicit project labels and wait before image build instead of trusting that filter.
- [x] Targeted campaign 20261025T230043-5-test PASS: 82 API cases including eleven real-storage MCP network cases and 48/5/2 graph/date/budget regressions, plus eight MCP baseline cases; zero failures/skips and owned cleanup PASS. Add explicit legacy fence 503/410 and failing-archive parity assertions.
- [x] Add two controlled mutants: removing the preactivation reader fails missing-epoch parity; any internal legacy read after activation fails the scoped no-call assertion. Final qualification includes the CI API npm test entrypoint and complete collection.
- [x] T14 grows to eleven network/image cases: missing, legacy and scoped epochs return date and document hash resolved from stored PDF metadata, preserve human-specific archives/reveal, and deny warm-session revocation; preactivation cases assert no scoped state exists.
- [x] Network/image fixture supports databases never activated and uses the genuine S3ObjectStore against isolated object storage; seed synthetic PDF bytes and metadata for documentary assertions.
- [x] Reproduced the blocking defect on an unactivated database: three business assertions fail with facade 503 versus legacy 200. Replace facade preactivation refusal expectations and explicitly assert zero internal legacy calls after 6H.
- [x] Route missing/legacy epochs through the shared legacy reader with verified viewer and reveal semantics; recheck membership and epoch after enrichment. Scoped BASE remains unchanged and never invokes legacy; maintenance and explicit retirement stay closed.
- [x] Machine guard also waits for Docker build processes and checks foreign stacks before image build; increase isolated /tmp to 1 GiB after npm cache overflow, retaining 10 GiB host disk stop and owned cleanup.
- [x] Add a genuinely unactivated PostgreSQL fixture and missing/legacy epoch parity assertions against the production graph-signals route.
- [x] Extract the existing legacy card read once; both callers share visibility, empty-city behavior, per-card degradation and one enrichment budget.
- [x] T08: canonical domain projection and filters before limit; explicit shared-builder regressions and cross-retry budget.
- [x] T08 code: port the removed MCP mapper to API, preserve canonical priorities and apply domain filters before limit; qualification pending.
- [x] T09: facade mounted after protect, default closed, private refusals and authorized empty success.
- [x] T09 implementation: exact facade after protect with private headers before authentication, optional server-only binding absent at startup; inherited probes isolated from the production path.
- [x] T09 real createApp/PostgreSQL fixture and empty/private/default-denial cases written; no local facade callback replaces the production route.
- [x] T13: createApp/PostgreSQL authority, archives, races and cutover groups, separate commits.
- [x] T13 authority group written against the production facade: current account approval, 0/1/N memberships, outsider and explicit destination refusals.
- [x] T13 archive group written: personal/common OR masking, other-member privacy, reveal guards, identity keys, restoration and SQL read-only snapshots, hidden targets never enriched.
- [x] T13 races group written: deterministic document barriers for membership/account/source/archive changes, explicit selector stability, plus an observed PostgreSQL lock wait followed by revocation.
- [x] Initial T13 state group qualified scoped reads and epoch refusals; Astra corrections supersede missing/legacy facade refusals with positive reads from a genuinely unactivated database, retaining maintenance and unresolved scoped-history guards.
- [x] Production facade filter qualification includes a late matching PostgreSQL card with limit=1 and preserved firm status.
- [x] Initial T08/T09 gate PASS: 74 API tests across six explicit files plus eight MCP baseline cases, no failures/skips; documentary waiting measured 2,025ms/one resolution; owned cleanup status 0.
- [x] T14: explicit MCP E2E runner, complete HTTP search through production facade and image evidence.
- [x] T14 network fixture written: SDK/Streamable HTTP, socket token issuer verifying incoming signatures, signed exchanged JWT/JWKS, real createApp/A3 facade and PostgreSQL; no business response injection.
- [x] T14 seven socket E2E cases written: three legacy states, two humans, same-human concurrent renewed scopes, cross-session refusal, warm-cache revocations and capability closure.
- [x] An eighth network case covers private refusal of original bearer, encoded/suffixed paths, POST, duplicate and authority query keys; header-only middleware covers malformed signal paths without widening A3 authority.
- [x] Explicit test-base-adapter-e2e target requires eleven non-skipped network cases; thirteen bounded behavioral mutants cover epoch routing, authority, masking, revision/budget, projection and the closed binding.
- [x] Image preparation written: locked dependencies, API declaration build and production-style bundles; network fixture imports compiled API/MCP entrypoints in the image, without source mounts or installs at runtime.
- [x] Qualification keeps one owned stack for static checks, explicit API/MCP scopes, the complete CI API collection, thirteen mutants with controls, declaration/bundle build and eleven compiled-image network cases.
- [x] Static runner proof PASS: require_scope accepts the explicit network suite and rejects the directory prefix from design review r2; mutation receipts include executed control counts.
- [x] Reservation race reproduced: local flock available, global flock busy and a new E3 stack started after the empty-container observation. Retry the global reservation every 60 seconds and recheck containers while holding it; never start a second stack or treat reservation failure as qualification.
- [x] Queue on the same global flock before observing container quiescence, retaining 60-second ownership checks; this prevents repeated new campaigns from taking each brief empty-container window. Earlier waits created no owned resources.
- [x] Qualification: scoped checks and authority/masking mutations, no required skipped cases.
- [x] Campaign 20261025T222444-6-qualify: API/MCP/integration typechecks and lint PASS, 340 API cases/32 files, 95 MCP cases/13 files, zero failures/skips; eleven named mutants killed with 22 passing controls and exact restoration; eight socket E2E cases pass; documentary budget 2,031ms/one resolution; CT-8 and owned cleanup pass.
- [x] Image build reached valid bundles/declaration output but Buildx attempted a write under read-only ~/.docker. Set BUILDX_CONFIG to the owned workspace evidence path and repeat only image qualification and the explicit T08 regressions; runtime source is unchanged.
- [x] Image campaign 20261025T223128-5-image PASS on d39eaa8c: static checks, 72 API + eight MCP baseline cases, then eight real network cases against compiled API/MCP inside image sha256:6bcbbba4cf2a38d06d4634515da15b9475e4959d7c859802e4aee9c811e59271, no source/dependency mounts. Zero failures/skips; owned cleanup status 0 and no container/volume/network remains.
- [x] Independent audit: eleven restored mutation file hashes match qualified 2ce816f8 exactly; 22 controls/114 passing executions. API/MCP source bytes are identical at 2ce816f8, image d39eaa8c and final documentary delivery.

## Docs consolidation
- [x] Astra campaign 20261025T232411-10-qualify PASS on e6ef67590f379f3be818876838346c3093f824b0: 363 targeted API cases/35 files, full API 3896 passed/76 conditional skips/zero failures, MCP 372/46 files, thirteen killed mutants and 26 passing controls/132 executions; all restored hashes match Git independently.
- [x] Compiled image sha256:7102f426b7e08f43e64512a6e42a81e75dad6486a5da78697da010269043155f passes eleven network cases including real S3 metadata before/after 6H; typechecks, lint, declarations, bundles, CT-8 and down -v --remove-orphans pass; no owned container, volume or network remains.
- [x] Final documentation changes only this plan after the qualified candidate; correction bundle is based on d8f2cc06, with source bytes preserved and no push or activation.
- [x] Export the correction bundle from prerequisite d8f2cc06 under its own filename, preserving the initial bundle and its recorded hash; audit every new commit and import into a prerequisite-only fresh repository.
- [x] French companion report with evidence, per-commit numstat, delivered SHA and bundle hash; report remains outside its own hashed bundle. Final commit updates only this plan, preserving qualified runtime bytes.

## Merge & close
- [ ] Integration owner imports bundle; T15/H5 and T16/T17 delivery receipts remain separately assigned.
