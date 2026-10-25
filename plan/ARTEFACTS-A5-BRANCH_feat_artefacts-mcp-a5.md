# Feature: H4 P7 guarded artifact MCP composition

## Objective
- [ ] Deliver four artifact tools with the preserved twelve-tool namespace and the qualified shared service.

## Scope / Guardrails
- [x] Baseline: `c49bb8548fe62df6df7c3d53cd08105af83a1e6c`; branch: `feat/artefacts-mcp-a5`.
- [x] Repository-local worktree; Make-only container execution; no environment-file reads, Python or push.
- [x] Test environment: `test-artefacts-a5`; API/UI/Maildev: `18924/15924/11924`; ENV last.
- [x] Local delivery repository; English single-subject commits, no trailer, <=150 changed lines and <=15 files.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `packages/immo-mcp/src/**`, `packages/immo-mcp/config/**`, `packages/artifacts-host/src/**`.
- [x] Allowed Paths: artifact integration tests, `tools/make/artefacts-a5*`, `tools/h4-mcp.mk`, operator documentation, this plan.
- [x] Forbidden Paths: root Makefile, compose files, rules, agent bootstrap, other plans, business implementation, client materials.
- [x] Conditional Paths: manifests/lockfiles and API Dockerfile for the published tuple/runtime; SQL requires a recorded CT-1/CT-2 lease.

## Feedback Loop
- [x] A4 receipt acknowledged: twelve tools and published MCP tuple; common host/API still use artifacts 0.1.2.
- [ ] A1 dependency: transaction participant, persistent quota/ledger, operation receipts migration and guarded production composition are not delivered in this baseline.
- [ ] PR #918 owns Q1/Q2/helper corrections; do not modify or copy those files here.
- [x] CT-1/CT-2: no SQL lease found; clarification requested; keep A1 separate and activation closed without a receipt.
- [ ] CT-8/CT-9: standalone and combined schema/image receipts remain required after A1 integration.

## Orchestration Mode (AI-selected)
- [x] Single writer in the assigned branch; no concurrent Docker campaigns; machine lock plus 60-second occupancy checks.

## UAT Management (in orchestration context)
- [x] Synthetic isolated tests only; root UAT remains unchanged.

## Plan / Todo (lot-based)
- [x] Read mandatory rules, approved A5/P7 design, CT clauses and A4 handoff.
- [x] Compile the complete published profile and bind exactly four selected tools.
- [ ] Preserve twelve-tool parity and guarded startup; artifact request authority stays immutable.
- [ ] Qualify profile/selection, lifecycle/composition, failure-closed bindings and discriminating mutations.
- [ ] Qualify shared HTTP/MCP provider finalization, cross-process replay/conflict, restart, quota and denial persistence after A1 is available.
- [x] Ordinary API: 3,838 passed, 76 pending; MCP: 398 passed; host: 158 passed; separate exchange service E2E: 1 passed.
- [x] Typecheck, lint, security audit (66 gate tests) and API build; two authority/binding mutants killed.
- [ ] Final source qualification after semantic-refusal correction; exact runtime recovery image proof.
- [ ] Record exact package/image/configuration provenance, limitations, delivered SHA and independently audited bundle.
- [ ] Independent consensus reviews, remote CI and A7 deployment receipts remain external integration gates.
