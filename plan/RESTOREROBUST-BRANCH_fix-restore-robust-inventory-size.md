# Feature: Robust restoration of pinned document versions

## Objective
- [x] Owner decision: restore an existing pinned version with matching backup ETag despite an inventory size anomaly; keep integrity refusals.

## Scope / Guardrails
- [x] Worktree `tmp/restore-robust`, branch `fix/restore-robust-inventory-size`, base `5d4c8567b966af7711df5fcc30f6c876f1d3e28e`.
- [x] Make-only, container execution, zero Python, no environment-file reads, no preprod/prod actions.
- [x] Standalone Make execution; cutover tests use empty HOME and `ENV=test-cutover`; teardown removes volumes.
- [x] Test stack publishes no host ports; root dev/UAT remains untouched.
- [x] English repository text; French owner communication; commits without attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `deploy/ci/backup/**`, `deploy/ci/bascule-preprod/**`, `deploy/cutover/job-wrapper.cjs`, `tools/make/cutover-wrapper.test.mjs`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, other branch plans.
- [x] Conditional Paths: `.github/workflows/**` only if required by the fix.
- [x] Ignored `tmp/restore-robust.mk` supplies local offline verification targets without loading the root Makefile.

## Feedback Loop
- [x] Incident evidence: listing size 790337, pinned version size 797540, matching backup ETag, no matching size among 28 versions.
- [x] Root-cause evidence: `buildInventory` retains source-listing Size while `backupDocs` copies the unversioned source later and records the returned destination version/ETag.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation; conductor owns PR creation.

## UAT Management (in orchestration context)
- [x] No UI change or UAT required; no environment cutover authorized.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules/skills, confirm clean branch/base and inspect incident/code.
- [ ] Lot 1 — Restore matching pinned ETag, report hashed size anomalies, preserve integrity guards and reconciliation.
- [x] Lot 2 — Record size from the exact copied backup version; regression-test concurrent source and backup rewrites (265 backup selftest assertions pass).
- [ ] Lot 3 — Replay offline backup/bascule selftests, cutover controller gates, lint and typecheck; down -v.
- [ ] Lot 4 — Review final diff, commit atomically, push branch without force; leave PR to conductor.
