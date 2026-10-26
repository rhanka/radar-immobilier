# Fix: MCP delivery wiring

## Objective
Wire the qualified signal-search facade in the real API startup and prepare
the preprod account-reader and A2 exchange bindings before image delivery.

## Scope / Guardrails
- [x] Work only in `tmp/artefacts-main-probe`, branch `feat/artefacts-delivery`.
- [x] Make only; no Python, environment files, secret reads, push or deployment.
- [x] Test mapping: `ENV=test-artefacts-dlv`, API 18927, UI 15927, Maildev 11927.
- [x] One Docker campaign at a time; wait for foreign test containers.
- [x] Commits at most 150 changed lines, Conventional subject only.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/src/config.ts`, `api/src/index.ts`,
  `api/tests/integration/mcp-signal-search-*`, `deploy/k8s/**`,
  `deploy/overlays/preprod/**`, `tools/make/artefacts-delivery*`,
  `RUNBOOK-PREPROD-MCP-RACCORDEMENTS.md`, `RAPPORT-SOL-ARTEFACTS-DELIVERY.md`,
  this branch file.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`,
  `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans.
- [x] Conditional Paths: none; no migrations or dependency changes.

## Feedback Loop
- [x] Owner authorizes the two delivery corrections and local commits only.
- [x] Deployment wiring is an operator prerequisite; never read secret values.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: corrections and final qualification in the existing worktree.

## UAT Management (in orchestration context)
- [x] No UI changes; use isolated automated qualification, preserve root UAT.

## Plan / Todo (lot-based)
- [x] Lot 0: read constraints, review and startup/deployment evidence.
- [x] Lot 1: wire default-closed startup and test the real entrypoint.
  - [x] Red: three authorized epochs refused; green: startup/network suites pass.
- [x] Lot 2: reference account/exchange authority and document operator setup.
  - [x] Required MCP secrets, shared workload refs, closed API receipt refs, DB ingress.
  - [x] Pin the actual IdP token-route prefix; operator must qualify RFC 8693 support.
- [x] Lot 3: touched suites, CI API suite, MCP, Q1/Q2/acceptance, lint/types.
  - [x] Initial 146 targeted; API 3536/695 invalidated by second review; MCP 406; provider 31/32/6.
  - [x] Run the documented reader grants against PostgreSQL; authorization and write denial pass.
- [x] Lot 4: validate manifests, review changes, append delivery report.
  - [x] Kustomize base/preprod, client dry-run, YAML and isolation gates pass.
  - [x] Commits audited; operator prerequisites remain explicit, no live delivery claimed.
- [ ] Operator gate: provision/qualify preprod before any image rollout.
- [ ] Lot 5: resolve both second-review delivery blockers.
  - [x] Reproduce the exact operator probe against real MCP/API sockets.
  - [x] Match the public MCP contract and prove workspace selection at the API boundary.
  - [x] Add a reproducible qualification target with explicit DB activation and coverage floors.
  - [x] Document delegated boundary evidence, single-workspace selection and `workspace_missing` denial.
  - [x] Preserve probe failure evidence without throwing from a `finally` block.
  - [ ] Restore `LOT_MIGRATION_DB_TEST=1`; compare full API results to the prior baseline.
  - [ ] Repeat MCP, Q1/Q2/acceptance, lint, types and manifest qualification.
  - [x] Address review remarks and append the second-review delivery report.
  - [x] Record first final-run types/render success, fix the lint finding, and requeue qualification.
  - [ ] External PW-A owner: release its idle PostgreSQL/MinIO stack; `i-cond` notified through h2a.

## Merge & Close
- [x] No push or merge authorized by this task; return the final local SHA.
