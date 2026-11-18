# Fix: Preprod signal pre-flight without Secret reads

## Objective
- [x] Unblock preprod CD: no kubectl Secret check (CI account has 0 secret rights); prove signal state after rollout instead.

## Scope / Guardrails
- [x] Base: main. Branch fix/preprod-signal-preflight; worktree tmp/preflight-fix.
- [x] No environment files, Python, kubeconfig, merges or generated commit trailers.
- [x] Make-only commands; ENV last; isolated stacks removed with down -v.
- [x] Nothing applied to a cluster, database or bucket.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: .github/workflows/build-push-images.yml, packages/immo-mcp/src/server-http.ts, packages/immo-mcp/src/signal-write-state.test.ts, docs/operator/mcp-signal-write-runbook.md, this plan.
- [x] Forbidden: deploy/k8s/** (no new CI secret rights), .security/**, root Makefile, docker-compose*.yml, rules/**, other branch plans.

## Plan / Todo (lot-based)
- [x] Lot 1: remove the kubectl Secret pre-flight from deploy-preprod.
- [x] Lot 2: unauthenticated GET /mcp/.well-known/signal-write enum (active | read-only | disabled), unit tests.
- [x] Lot 3: post-rollout CD proof fails preprod deploy unless the state is active.
- [x] Lot 4: runbook corrected. PR opened, CI followed.
