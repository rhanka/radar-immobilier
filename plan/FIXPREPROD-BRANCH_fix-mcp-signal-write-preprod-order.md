# Fix: MCP signal-write preprod commissioning order

## Objective
- [x] Remove the preprod CrashLoopBackOff and success-on-crash from the #1107 commissioning.

## Scope / Guardrails
- [x] Base: main (a5f23a5ae, #1107 merged). Branch fix/mcp-signal-write-preprod-order; worktree tmp/mcp-signal-preprod-order.
- [x] No environment files, Python, kubeconfig, merges or generated commit trailers.
- [x] Make-only commands; ENV last; isolated stacks removed with down -v.
- [x] Nothing applied to a cluster, database or bucket.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: deploy/overlays/preprod/**, deploy/overlays/preprod-signal-write/**, deploy/ci/reconcile-preprod-mcp.test.sh, .github/workflows/build-push-images.yml, packages/immo-mcp/src/signal-store*, docs/operator/mcp-signal-write-runbook.md, docs/spec/SPEC_EVOL_MCP_SIGNAL_WRITE.md, this plan.
- [x] Forbidden: .security/**, root Makefile, docker-compose*.yml, rules/**, other branch plans.

## Plan / Todo (lot-based)
- [x] Lot 1: preprod overlay inert by default (flag "0", scope unannounced); separate preprod-signal-write activation overlay.
- [x] Lot 2: signal binding degrades to read-only with an explicit log when the flag is on and the Secret is absent; unit test.
- [x] Lot 3: preprod CD rollout status for radar-immo-mcp is blocking.
- [x] Lot 4: runbook and spec state the exact order (role, migration + grants, Secret, IdP scope, activation) and the corrected missing-Secret behavior.
- [x] Lot 5: targeted make tests, renders and deploy gates pass; stacks removed with down -v; PR opened, CI followed.
