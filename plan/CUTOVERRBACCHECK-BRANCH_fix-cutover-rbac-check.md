# Feature: RBAC preflight checks only served resource types

## Objective
- [x] Fix the main CD `prepare` refusal: preflight asked can-i for nonexistent KEDA group/resource pairs and for CRDs not installed.

## Scope / Guardrails
- [x] Worktree `tmp/cutover-rbac-check`, branch `fix/cutover-rbac-check`, base `origin/main`.
- [x] Local tests only; no cluster command, no environment files, no Python; Make only, ENV last; `down -v`; no attribution trailers; no PR.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/make/cutover*`, `deploy/cutover/**`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans.

## Plan / Todo (lot-based)
- [x] Lot 1: one Role rule per KEDA group (`keda.sh` scaledobjects/scaledjobs, `http.keda.sh` httpscaledobjects), preprod and prod.
- [x] Lot 2: preflight skips types absent from `kubectl api-resources`; fake API serves built-ins and installed CRDs, can-i denies unserved types.
- [x] Lot 3: tests for group pairing, unserved-type skipping and served denied rights.
