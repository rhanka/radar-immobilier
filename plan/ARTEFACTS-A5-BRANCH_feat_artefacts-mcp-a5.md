# Feature: H4 P7 guarded artifact MCP composition

## Objective
- [x] Deliver four artifact tools with the preserved twelve-tool namespace and the qualified shared service (local A5/P7 closure).

## Scope / Guardrails
- [x] Baseline: `c49bb8548fe62df6df7c3d53cd08105af83a1e6c`; branch: `feat/artefacts-mcp-a5`.
- [x] Resumed facade delivery starts at `5ea88ce1`; merge-only helper import, no history rewrite or push.
- [x] Repository-local worktree; Make-only container execution; no environment-file reads, Python or push.
- [x] Test environment: `test-artefacts-a5`; API/UI/Maildev: `18924/15924/11924`; ENV last.
- [x] Local delivery repository; English single-subject commits, no trailer, <=150 changed lines and <=15 files.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `packages/immo-mcp/src/**`, `packages/immo-mcp/config/**`, `packages/artifacts-host/src/**`.
- [x] Allowed Paths: artifact integration tests, `tools/make/artefacts-a5*`, `tools/h4-mcp.mk`, operator documentation, this plan.
- [x] Forbidden Paths: root Makefile, compose files, rules, agent bootstrap, other plans, business implementation, client materials.
- [x] Conditional Paths: manifests/lockfiles, API Dockerfile and `api/src/artifacts/**` for the shared tuple/runtime.
- [x] A5-EX1: owner facade instruction authorizes additive 0024 coordinator/policy SQL and journal append; preserve every existing entry, rollback by disabling the new host, never dropping durable rows.

## Feedback Loop
- [x] A4 receipt acknowledged: twelve tools and published MCP tuple; common host/API still use artifacts 0.1.2.
- [x] A1 dependency implemented here under the owner facade instruction: transactional policy/quota, durable failures, operation receipts and shared composition.
- [x] Merge 313fcf44 as a real second parent; use its final helpers in four conflicts. Track event blob unchanged on both parents and merge.
- [x] CT-1/CT-2: owner facade instruction supersedes the earlier missing-lease hold; append 0024 without changing existing migrations.
- [x] CT-4 through CT-8: 23 frozen entries plus 0024; fresh, upgrade, preserved sentinel, equal schema and replay pass (`20261025T220700-17/migration-proof.json`).
- [x] CT-9: exact image `113cf88d...`, source `33f232f3`, sixteen real tools, SQL/S3, replay, ordered conflict and restart (`20261025T223315-17`).

## Orchestration Mode (AI-selected)
- [x] Single writer in the assigned branch; no concurrent Docker campaigns; machine lock plus 60-second occupancy checks.

## UAT Management (in orchestration context)
- [x] Synthetic isolated tests only; root UAT remains unchanged.

## Plan / Todo (lot-based)
- [x] Artifacts 0.2.1: published integrity verified before container installation; exact API/host/MCP pins, four lock entries changed and audit gate passed (20261026T130511-18).
- [x] Artifacts 0.2.1: HTTP, coordinator and dispatch use mapHostError; delete the coordinator denial wrapper and redundant error reclassification; retain phase diagnostics.
- [x] Artifacts 0.2.1: align the provider registry, embedded configuration, tuple/image proofs and operator guide; assert exactly four lock changes from e9d4696c.
- [ ] Artifacts 0.2.1: qualify both corrected acceptance cases, Q1/Q2/acceptance 31/32/6, CI-selected API, MCP, host, lint, types, audit and the sixteen-tool image.
- [ ] Artifacts 0.2.1: deliver commits of at most 150 lines from e9d4696c, audit the bundle in a fresh repository and update the companion report without push.
- [x] Read mandatory rules, approved A5/P7 design, CT clauses and A4 handoff.
- [x] Compile the complete published profile and bind exactly four selected tools.
- [x] Preserve twelve-tool parity and guarded startup; artifact request authority stays immutable (contract composition).
- [x] Qualify profile/selection, lifecycle/composition, failure-closed bindings and discriminating mutations.
- [x] Reproduce semantic-key exception; project public refusals before authority creation; 26 targeted cases pass after correction.
- [x] Q1 31/31, Q2 32/32, acceptance 6/6; production quota processes, restart, denial rollback, ledger deduplication and stale policy refusal pass.
- [x] Ordinary API CI selection: 3,914 passed, 76 pending, zero failures (`20261025T222306-17`); MCP 401/401 and host 151/151 (`20261025T221438-17`).
- [x] Typecheck, lint, security audit (66 gate tests) and API build; two authority/binding mutants killed.
- [x] Final source `33f232f3`: 74/74 enabled provider/production regressions, published archives, bounded lockfile and profile receipt (`20261025T222817-17`); clean preserved source archives.
- [x] Final cleanup uses the transaction already opened by the public PostgreSQL executor; real cleanup/restart regression and final image pass.
- [x] Exact A5 image qualification complete; default recovery still preserves twelve tools.
- [x] Record exact package/image/configuration provenance and limitations. Pre-close bundle audited in fresh `bundle-audit.nMeWyC`; re-anchor the final documentation commit with the same audit procedure.
- [ ] Independent consensus reviews, remote CI and A7 deployment receipts remain external integration gates.
- [x] Astra A5: Implement server-resolved unique membership at common artifact admission.
- [x] Astra A5: Recheck and lock scope membership on the coordinator connection, including replay.
- [x] Astra A5: Use transactional approval in the HTTP commit guard without acquiring another pool client.
- [x] Astra A5: Normalize actual pg-pool acquisition errors at dispatch, lock and outcome boundaries.
- [x] Astra A5: Wire fresh common admission into the production MCP binding and HTTP control routes.
- [x] Astra A5: Add real PostgreSQL/S3 fixtures and durable artifact, release, receipt and quota snapshots.
- [x] Astra A5: Cover all four production MCP tools after expiry, cohort removal and missing/ambiguous membership.
- [x] Astra A5: Cover synchronized upload revocation, full durable rollback, revoked replay and PostgreSQL row locks.
- [x] Astra A5: Cover actual pg-pool saturation, single-client writes and HTTP route membership admission.
- [x] Astra A5: Add twelve semantic mutation controls with restored-source PostgreSQL baselines.
- [x] Astra A5: Anchor review-fix delivery and fresh-repository bundle audit at 658663dd.
- [x] Astra A5: 11/11 PostgreSQL regressions pass; propagate typed host refusals after publication waits and add the thirteenth mutation.
- [x] Astra A5: supply explicit memberships for legitimate H2/production quota fixtures; preserve all Q1/Q2/acceptance assertions.
- [x] Astra A5: adapt HTTP query doubles and inject the admission outage on the real reserved coordinator client; retain refusal/accounting assertions.
- [x] Astra A5: preserve the public participant fence type and assert the precise account refusal after a publication key wait.
- [x] Astra A5: 23/23 compatibility tests pass; retain the participant type and qualify final gates under one Docker campaign lock.
- [x] Astra A5 final source bca8578b: 11/11 PostgreSQL/S3 regressions, 13/13 correction mutants and restored controls; qualification 20261026T080743-18.
- [x] Astra A5 frozen Q1/Q2/acceptance: 31/31, 32/32, 6/6; CI-selected API 3925 passed, 76 pending, zero failures; MCP 401/401 and host 151/151.
- [x] Astra A5 typecheck, lint, API build, 66 audit tests, audit gate, two preserved authority mutants and published tuple/profile proofs pass.
- [x] Astra A5 exact image 9621953e: sixteen tools, four artifact operations, restart/replay, ordered conflict, account/membership refusals and durable counts; 20261026T081420-18.
- [x] Astra A5 campaign teardown complete: no project containers, volumes or networks; deliver locally from 658663dd without push and preserve the companion report.
- [x] Astra r2: bind entry admission to the configured workspace and retain its resolved identity.
- [x] Astra r2: freeze HTTP call membership and refresh transaction authority after membership waits, including replay.
- [x] Astra r2: carry immutable workspace authority through the production MCP binding.
- [x] Astra r2: guard idle and reserved pg clients through callback and promise acquisitions; discard broken clients.
- [x] Astra r2: classify both pg-pool saturation and connection-open timeouts as retryable unavailability.
- [x] Astra r2: map HTTP admission and dispatch outages to redacted 503 responses on the complete control route.
- [x] Astra r2: qualify foreign membership, replacement during upload, revoked replay and real HTTP pool saturation on PostgreSQL.
- [x] Astra r2: prove process survival, retryable failure and recovery with real pg_terminate_backend cuts; reproduce opening timeout.
- [x] Astra r2: prove activation expiration after an observed membership lock wait through the production MCP replay binding.
- [x] Astra r2: retain a single ensure authority evaluation per coordinator guard; refresh activation inside the locked policy read.
- [x] Astra r2: extend semantic mutations and test discovery; bind the image fixture to its workspace and audit delivery from 3ef57173.
- [x] Astra r2: preserve delegated pool getters using a guarded view; adapter instrumentation and real connection-break regressions pass.
- [x] Astra r2: preserve private 500 handling for unclassified backend errors; five route regressions pass; keep the first-pass delivery audit intact.
- [x] Astra r2 final source 00e27239: 21/21 PostgreSQL regressions, 20/20 semantic mutants and restored controls; Q1/Q2/acceptance 31/31, 32/32, 6/6; API 3938 passed and 76 pending; MCP 401/401 and host 165/165 (20261026T094858-20).
- [x] Astra r2: typecheck (zero errors, seven Svelte warnings), lint, API build, 66 audit tests, audit gate, two authority mutants and published tuple/profile proofs pass; migration, Track and lockfile remain unchanged from 3ef57173.
- [x] Astra r2 image 657ce854: sixteen tools, SQL/S3 effects, restart/replay, ordered conflict, account/membership revocation and durable counters pass (20261026T094905-20); isolated containers, volumes and networks removed.
- [x] Astra r2: pre-close bundle from 3ef57173 audited in fresh astra-bundle-audit.xwSEzQ; re-anchor this documentation-only commit with the same independent audit; local delivery only, no push.
