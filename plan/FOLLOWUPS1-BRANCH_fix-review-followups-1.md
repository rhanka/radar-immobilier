# Feature: Merged review follow-ups

## Objective
- [x] Close H3 P4, H4 P2 and 6B review observations without product changes.

## Scope / Guardrails
- [x] Use the owner-provided `fix/review-followups-1` worktree at base `455b9d90`.
- [x] No Python, environment file reads, deployment or dependency changes.
- [x] Use Make only, ENV last, isolated test stacks and complete volume cleanup.
- [x] Stop campaigns below 10 GiB free disk space.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/h3-render-workload.awk`
  - `deploy/ci/check-h3-preprod-render.test.sh`
  - `packages/artifacts-host/src/mcp-app-adapter.test.ts`
  - `api/tests/integration/facets-http-write.spec.ts`
  - `plan/FOLLOWUPS1-BRANCH_fix-review-followups-1.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other plans.
- **Conditional Paths (allowed only with explicit exception)**:
  - None; mutation tooling and evidence stay in ignored `tmp/followups-1/`.

## Feedback Loop
- [x] Owner brief authorizes this worktree and subject-only commits without trailers.
- [x] Verification observation (owner: conductor): `object-storage-inventory-job.test.sh` fails 11 assertions because it expects retired inventory resources and launchers; the full shell gate remains red. No inventory resource is restored in this branch.

## Orchestration Mode (AI-selected)
- [x] Single branch, three atomic commits; no merge or push requested.

## UAT Management (in orchestration context)
- [x] No UI or product behavior change; automated verification only.

## Plan / Todo (lot-based)
- [x] Lot 1 — Exact denial Service selector and four-phase shell regression.
- [x] Lot 2 — Missing caller key fixture with valid binding and no dispatch.
- [x] Lot 3 — Malformed discard reason fixture with valid displayed fingerprint.
- [x] Final gate executed — Kubernetes render, 22/23 deploy shell suites passing, 153 package tests, 2 scoped integration tests, typecheck and lint passing.
- [x] Evidence — Copy, mutation, old-test pass, new-test failure, restore and cmp for each point.
- [x] Delivery — Three atomic commits; bundle from `455b9d90` and uncommitted French report prepared by the local delivery target.
