# Feature: H4 P6 stateful MCP composition

## Objective
- [ ] Compose twelve existing tools through cluster-mesh with request-bound authority.

## Scope / Guardrails
- [x] Assigned worktree/branch; baseline `77cb9553`; no push or deployment.
- [x] Standalone Make, RTK, containers only; never read environment files.
- [x] `ENV=test-artefacts-a4`, API 18923, UI 15923, Maildev 11923; ENV last.
- [x] One machine-wide Docker campaign; stop below 8 GiB; remove project resources.
- [x] Local backup Git repository; <=150 changed lines per commit; subject only.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: `packages/immo-mcp/**`, `tools/make/artefacts-a4*`, `tools/h4-mcp.mk`, this plan, report, operator guide.
- [x] **Forbidden Paths**: root Makefile/Compose, rules, bootstrap, other plans, shared API startup/auth/SQL, product UI, upstream repositories.
- [x] **Conditional Paths**: package manifests/lockfile and `packages/artifacts-host/**` only for the assigned published tuple and directly blocking compatibility.

## Feedback Loop
- [x] BRA4-EX1: assigned integrator owns dependency/P6 runner edits; preserve A2 guards; restore closed admission on failure.
- [x] BRA4-EX2: minimal `api/Dockerfile` externalization and MCP metadata/dependency copy preserve cluster-mesh dynamic loaders in the actual runtime; rollback removes those three image hunks; shared API source/SQL remain untouched.
- [ ] External operator account bindings, deployment digest and P7 storage acceptance remain separate receipts.

## Orchestration Mode (AI-selected)
- [x] Single assigned branch; qualified slices delivered as a base-relative bundle.

## UAT Management (in orchestration context)
- [x] Root dev/UAT untouched; synthetic automated qualification only.

## Plan / Todo (lot-based)
- [x] Lot 0: constraints, branch and local delivery tooling.
- [x] Lot 1: published MCP tuple and required compatibility; API artifact service migration belongs to A5.
- [x] Lot 2: single bridge, twelve bindings and session lifecycle.
- [x] Lot 3: synthetic stdio and trusted account binding.
- [ ] Lot 4: MCP/API suites, mutations, lint/typecheck and runtime image.
- [ ] Lot 5: evidence report, atomic commit audit and independent bundle import.
