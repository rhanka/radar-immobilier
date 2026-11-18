# Feature: Muse refresh fallback in preprod

## Objective
- [x] Point the preprod refresh fallback at the imported muse account; prod keeps gemini.

## Scope / Guardrails
- [x] Base: main. Branch feat/refresh-fallback-muse-preprod; worktree tmp/fallback-muse-preprod.
- [x] No environment files, Python, kubeconfig, merges or generated commit trailers.
- [x] Make-only commands; ENV last; isolated stacks removed with down -v.
- [x] Nothing applied to a cluster, database or bucket. No prod change.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: deploy/k8s/refresh-cronjobs/**, deploy/k8s/refresh-cronjobs-prod/kustomization.yaml (comments), this plan.
- [x] Forbidden: deploy/k8s/34-refresh-cronjob.yaml (shared base), .security/**, root Makefile, docker-compose*.yml, rules/**, other branch plans.

## Plan / Todo (lot-based)
- [x] Lot 1: preprod overlay sets REFRESH_FALLBACK_* and REFRESH_CLASSIFY_FALLBACK_* to muse/muse-wonder-1.0/low.
- [x] Lot 2: fallback provider becomes intended divergence n°5 (contract projection excludes both families; verify-renders pins each render to the gemini or muse pair, classify included).
- [x] Lot 3: render proof — preprod muse, prod gemini; verify-renders and its mutation tests pass.
- [x] Lot 4: PR opened, CI followed.
