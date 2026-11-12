# Feature: Refresh policy without Gemini

## Objective
- [x] Make durable the owner decision of 2026-11-12: no Gemini route in the scheduled refresh policy, preprod and prod (Google disabled the account behind the `cloud-code` seat). The live `radar-refresh-pv` CronJobs were already patched in place; without this change the next CD apply restores Gemini.

## Scope / Guardrails
- [x] Isolated worktree, branch `fix/refresh-no-gemini`, base `origin/main`.
- [x] Manifests and offline render contracts only; no cluster command, no environment files, no Python; no attribution trailers; no merge.
- [x] Primary model unchanged (`openai / gpt-6-astra / medium`).

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `deploy/k8s/34-refresh-cronjob.yaml`, `deploy/k8s/refresh-cronjobs/**`, `deploy/ci/README.md`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans, `api/**`.

## Plan / Todo (lot-based)
- [x] Lot 1: `radar-refresh-pv` falls back to `openai / gpt-6-astra / low`, `REFRESH_VERIFY_ENABLED=0`, no `REFRESH_VERIFY_*` route; comments updated.
- [x] Lot 2: `radar-refresh-requeue-abandoned` seat probe falls back to `openai / gpt-6-astra / low`.
- [x] Lot 3: `verify-renders` requires the new values and refuses any `gemini` in both CronJobs; mutation tests in `verify-renders.test.sh`.
- [x] Lot 4: `deploy/ci/README.md` cascade description updated.
