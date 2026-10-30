# Feature: Prepared database cutover under five minutes

## Objective
- [ ] Apply the approved `conception-cutover-fast.clean.md` without redesign.

## Scope / Guardrails
- [x] Worktree `tmp/cutover-5min`, branch `feat/cutover-prepare-5min`, base `05c418f7`.
- [x] Local tests only; no production or preproduction operations, no environment files, no Python, no secret output.
- [x] Make only, ENV last; no attribution trailers; push without force and do not create a PR.
- [x] Preserve `PREPROD_CD_ENABLED` and `BASCULE_SCHEDULE_ENABLED`.
- [x] Use the standalone test stack `ENV=test-cutover`, without published ports; remove volumes after tests.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/cutover*`, `deploy/cutover/**`, `deploy/ci/bascule-preprod/backup*`, `deploy/ci/bascule-preprod/db-restore-backup-job.tmpl.yaml`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans, client materials.
- [x] Conditional Paths: `.github/workflows/build-push-images.yml` through CUTOVERFAST-EX1.

## Feedback Loop
- [x] CUTOVERFAST-EX1: owner requests mandatory prepare CI gate; impact is a blocking preparation job; rollback reverts this branch's workflow changes.
- [x] Keep the existing daily `MODE=restore` path as explicitly required by the design.
- [ ] Record any simple interpretation of an open implementation detail and remaining infrastructure prerequisites.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation lots.

## UAT Management (in orchestration context)
- [x] No UAT or deployment: the owner has an active preproduction cutover.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, confirm branch, identify isolated Make targets.
- [ ] Lot 1: bulk version resolution and sweep exclusion, backup selftests (9,418 unpinned candidates, 268 pages).
- [ ] Lot 2: database identity, explicit target env, parallel restore and Secret patch RBAC implemented; validation pending.
- [ ] Lot 3: prepared stamp ownership and freshness implemented; lifecycle, smoke and cleanup follow.
- [ ] Lot 4: prepared verification, switch, rollback and early writer suspension.
- [ ] Lot 5: mandatory CI preparation gate and fake-cluster acceptance tests.
- [ ] Lot 6: existing controller suite, empty-HOME checks, API suite, lint, typecheck, down -v.
- [ ] Lot 7: selective atomic commits and push; no PR.
