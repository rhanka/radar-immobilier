# Feature: Recoverable zero-downtime cutover

## Objective
- [x] Address PR #956's second blocking review without losing acknowledged writes or logs.

## Scope / Guardrails
- [x] Work in `tmp/cutover-zd`, branch `feat/cutover-zero-downtime`; preserve the inherited tests.
- [x] Make only, ENV last, no Python, no environment files, no cluster operations or kubeconfig changes.
- [x] Commit without trailers or attribution; push without force or rebase.
- [x] Tests use the portless `test-cutover` stack; remove volumes after each campaign.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/cutover*`, `deploy/cutover/**`, this plan.
- [x] Forbidden Paths: root `Makefile`, root compose files, `rules/**`, agent entry points, other plans.
- [x] Conditional Paths: none required by this repair.

## Feedback Loop
- [x] Owner authorizes finishing the interrupted builder's work, test-first fixes, commits and push.
- [x] Test runner's blanket wait on unrelated Docker stacks blocks local verification; serialize the cutover project with its own lock and allow its portless stack to coexist with other projects.
- [x] Shared Docker disk I/O blocks fixture writes and package installation; keep test state/dependencies in bounded tmpfs mounts and permit reuse of the identical local tools image.
- [x] An unobserved mutating Job stays blocked; recovery neither deletes consumers nor releases its lock. Existing interruption scenarios assert this stronger invariant.

## Orchestration Mode (AI-selected)
- [x] Sequential work in this session, without delegated or background workflows.

## UAT Management (in orchestration context)
- [x] No deployment or UAT; local synthetic Kubernetes and container tests only.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, fast-forward branch, inspect inherited changes and reproduce failures.
- [x] Lot 1: persist switch intent before exposing prepared writers; partial-switch retention reproduced first.
- [x] Lot 2: retire prepared writers before measuring abandoned writes; the regression commits a final request at SIGTERM.
- [x] Lot 3: unknown routing, prepared/adopted Deployment reads and Pod phases block deletion; four focused state tests pass.
- [x] Lot 4: incomplete log streams never authorize deletion; previous instances, restarts and stream failures are covered (ten passing exporter tests).
- [x] Lot 5: retry safe failed or missing verification Jobs on recovery (24 red reproductions, 30 passing helper tests).
- [ ] Lot 6: targeted and full operator tests pass; remove the test stack and volumes.
- [ ] Lot 7: push atomic commits and write the French report with file lines and SHAs.
