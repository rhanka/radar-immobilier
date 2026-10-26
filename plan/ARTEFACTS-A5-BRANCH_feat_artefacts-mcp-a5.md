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
