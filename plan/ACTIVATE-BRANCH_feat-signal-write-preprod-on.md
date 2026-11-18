# Feature: Activate MCP signal writes by default in preprod

## Objective
- [x] Make preprod signal writes the default now that its prerequisites are verified.

## Scope / Guardrails
- [x] Base: main. Branch feat/signal-write-preprod-on; worktree tmp/signal-write-preprod-on.
- [x] No environment files, Python, kubeconfig, merges or generated commit trailers.
- [x] Make-only commands; ENV last; isolated stacks removed with down -v.
- [x] Nothing applied to a cluster, database or bucket. Prod unchanged.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: deploy/overlays/preprod/**, deploy/overlays/preprod-signal-write/** (removal), deploy/ci/reconcile-preprod-mcp.test.sh, .github/workflows/build-push-images.yml, docs/operator/mcp-signal-write-runbook.md, docs/spec/SPEC_EVOL_MCP_SIGNAL_WRITE.md, this plan.
- [x] Forbidden: deploy/k8s/** (prod base), .security/**, root Makefile, docker-compose*.yml, rules/**, other branch plans.

## Plan / Todo (lot-based)
- [x] Lot 1: preprod overlay announces immo:signals:write and sets the flag to "1"; redundant preprod-signal-write overlay removed.
- [x] Lot 2: prod render verified inert (no scope, flag "0"); preprod render references Secret immo-mcp-signal-writer; read-only degradation kept.
- [x] Lot 3: deploy-preprod fails loudly before reconcile if the Secret is missing.
- [x] Lot 4: runbook and spec updated (preprod active by default, remaining prod steps).
- [x] Lot 5: render gates pass; PR opened, CI followed.
