# Feature: Cutover RBAC for KEDA autoscalers with fail-fast check

## Objective
- [x] Fix preprod `prepare` refusal `httpscaledobjects.http.keda.sh is forbidden` from the inventory autoscaler scan.

## Scope / Guardrails
- [x] Worktree `tmp/cutover-rbac-keda`, branch `fix/cutover-rbac-keda`, base `origin/main` (`d3c17381`).
- [x] Local tests only; no cluster command, no environment files, no Python; Make only, ENV last; `down -v`.
- [x] No attribution trailers; push without PR; `PREPROD_CD_ENABLED` and `BASCULE_SCHEDULE_ENABLED` untouched.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/cutover*`, `deploy/cutover/**`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans.

## Plan / Todo (lot-based)
- [x] Lot 1: Role rules for KEDA `scaledobjects`/`scaledjobs`/`httpscaledobjects`, `verticalpodautoscalers`, Argo `rollouts` (get/list), preprod and prod.
- [x] Lot 2: `rbac_preflight` checks every Role right with `kubectl auth can-i` before any lock in `prepare` and `run`, listing missing rights.
- [x] Lot 3: fake-cluster access log; tests prove every access is granted by `rbac-<env>.yaml` and the parser matches the Role.
