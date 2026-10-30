# Feature: Prepared database cutover under five minutes

## Objective
- [x] Apply the approved `conception-cutover-fast.clean.md`, with the simple interpretations recorded below.

## Scope / Guardrails
- [x] Worktree `tmp/cutover-5min`, branch `feat/cutover-prepare-5min`, base `05c418f7`.
- [x] Local tests only; no production or preproduction operations, no environment files, no Python, no secret output.
- [x] Make only, ENV last; no attribution trailers; push without force and do not create a PR.
- [x] Preserve `PREPROD_CD_ENABLED` and `BASCULE_SCHEDULE_ENABLED`.
- [x] Use the standalone test stack `ENV=test-cutover`, without published ports; remove volumes after tests.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/cutover*`, `deploy/cutover/**`, `deploy/ci/bascule-preprod/backup*`, `deploy/ci/bascule-preprod/db-restore-backup-job.tmpl.yaml`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans, client materials.
- [x] Conditional Paths: `.github/workflows/build-push-images.yml` through CUTOVERFAST-EX1; `.github/workflows/ci.yml` through CUTOVERFAST-EX2.

## Feedback Loop
- [x] CUTOVERFAST-EX1: owner requests mandatory prepare CI gate; impact is a blocking preparation job; rollback reverts this branch's workflow changes.
- [x] CUTOVERFAST-EX2: include new prepared-cutover acceptance tests in the existing CI test pattern; impact is local fake-cluster coverage time; rollback restores the previous pattern.
- [x] Keep the existing daily `MODE=restore` path as explicitly required by the design.
- [x] Prepared API smoke checks health, release SHA and anonymous refusal; full UI/MCP smoke remains at cutover.
- [x] Runner polls cluster Jobs for up to 50 minutes: the stated runner wall budget of five minutes contradicts waiting for 25–40 minute Jobs.
- [x] Infrastructure prerequisites: CREATEDB (asserted by reset), PVC capacity for two databases (5 Gi today), updated namespace RBAC.
- [x] Keep the short claim lock outside the ten-minute drain; suspend schedules immediately after inventory, then drain after slot claim/release.
- [x] Release cutover enforces a shared 295-second work budget; cleanup can exceed it to preserve closed recovery state after failure.
- [x] Keep the daily freshness limit at 24 hours; the 26-hour bound applies to prepared releases.
- [x] Add explicit ten-minute drain refusal, latestComplete date change and 27-hour dump refusal coverage.
- [x] Initial typecheck passed; lint identified explicit Node globals missing from the new test helpers, now imported.
- [x] Preserve recovery after a Secret patch with a lost checkpoint; retry compares either the old or already-selected target, without restoring again.
- [x] The shared release budget starts before cluster preflight, including identity checks in the five-minute bound.
- [x] Prepared 6H drain/shutdown evidence uses observed, terminated restore/DDL Pod UIDs and the observed drain timestamp.
- [x] Daily restore and its recovery are preprod-only; production uses the prepared, image-only release path.
- [x] Local PostgreSQL integration: parallel custom-archive restore, CREATEDB refusal, live-database protection and release migration hash verification.
- [x] Successful full validation: 67 controller tests with empty HOME, 208 API tests across 30 files, and the PostgreSQL database guard integration test.
- [x] Successful final replay after the 6H evidence correction: 18 selected controller checks, including production refusal and interrupted-switch recovery.
- [x] Backup selftests: 215 restore checks, 265 daily-backup checks, 92 inter-tenant bascule checks; no failures.
- [x] Typecheck, lint (including final changed test files), shell/JQ syntax, whitespace checks and 23 no-Python guard checks passed.
- [x] Dedicated test stack removed with `operator.mk down` (`down -v --remove-orphans`); no deployment or live duration measurement performed.
- [x] 2026-10-30 preprod restore failure: atomic schema reset + replay without `--clean`, shared by daily and prepared restore; failed restore/backup relaunchable by `resume`.
- [x] 2026-10-30 recovery backup 403: per-environment `recoveryBucket`, write/list probe Job before closure.
- [x] PostgreSQL integration test restores a 13-migration archive onto 27 migrations with 20 dependent foreign keys.
- [x] Restore Job sized per environment (250m/1Gi requests, 1500m/2Gi limits) for the preprod ResourceQuota; `-j 4` kept.
- [x] PR #946 review: prepare job armed by `PREPROD_CD_ENABLED` (read only); budget starts at closure with automatic rollback and reopening on exhaustion; prepare records `recoveryReference`; additive docs copy documented.

## Orchestration Mode
- [x] Mono-branch, sequential implementation lots.

## UAT Management (in orchestration context)
- [x] No UAT or deployment: the owner has an active preproduction cutover.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, confirm branch, identify isolated Make targets.
- [x] Lot 1: bulk version resolution and sweep exclusion, backup selftests (9,418 unpinned candidates, 268 pages).
- [x] Lot 2: database identity, explicit target env, parallel restore and Secret patch RBAC implemented and validated locally.
- [x] Lot 3: prepare lifecycle, ownership, freshness, isolated API smoke and cleanup implemented and validated locally.
- [x] Lot 4: prepared verification, switch, rollback and early writer suspension implemented and validated locally.
- [x] Lot 5: CI gate and fake-cluster preparation, failures, freshness, switch, rollback and schedule tests implemented and validated locally.
- [x] Lot 6: empty-HOME controller suite, backup/bascule selftests, API suite, lint, typecheck, syntax and down -v passed.
- [x] Lot 7: selective atomic commits pushed to `origin/feat/cutover-prepare-5min` without force; no PR created.
- [x] Lot 8: atomic relaunchable restore, per-environment recovery bucket with early probe, infrastructure prerequisites table.
