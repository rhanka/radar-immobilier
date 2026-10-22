# Feature: provider acceptance for Sentropic artifact deliveries

## Objective
Qualify the six requested H4 v3 provider behaviors against real PostgreSQL/S3.
Keep current host API names in one test adaptation module pending spec r2.

## Scope / Guardrails
- [x] Assigned worktree `.worktrees/861c-provider-acceptance`, branch
  `test/861c-provider-acceptance`, base `71f41b72`; root UAT stays untouched.
- [x] Make only, Docker execution, no Python, no `.env` reads or real data.
- [x] Test mapping: `ENV=test-861c-provider-acceptance`, API 18986, UI 15986,
  Maildev 11986; no published ports in the test compose files.
- [x] Check disk before campaigns; stop below 10 GiB available.
- [x] Every test stack ends with `down -v --remove-orphans`; ENV is last.
- [x] No provider/runtime changes, added dependencies or lockfile changes.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: this plan;
  `api/tests/integration/artifacts-provider-acceptance.spec.ts`;
  `api/tests/integration/artifacts-provider-contract.helpers.ts`;
  `tools/artifact-host.mk`; `RAPPORT-SOL-PROVIDER-ACCEPTANCE.md`;
  ignored evidence and local Git metadata under `tmp/861c-provider-acceptance/`.
- [x] **Forbidden Paths**: root Makefile, compose files, rules, agent entrypoints,
  other plans, runtime sources, manifests, lockfiles, upstream repositories.
- [x] **Conditional Paths**: no additional paths required.
- [x] Exception process: record reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR861C-EX1: execution brief authorizes runner changes and commits without
  body/trailer, superseding Muse's earlier scope. Rollback: remove new targets.
- [x] BR861C-EX2: user authorizes a single adaptation module for provisional
  extension names. Rollback: remove that test-only helper.
- [x] Shared Git metadata is outside writable scope; local commits and bundle use
  ignored metadata, leaving the assigned checkout's shared refs untouched.
- [x] Cases 4/5 must qualify the selected provider profile, not just Radar's
  existing replay/hash compensation; they require selection before dispatch.

## Orchestration Mode (AI-selected)
- [x] Single assigned branch; no runtime implementation or merge requested.

## UAT Management (in orchestration context)
- [x] No UI change; automated isolated API qualification only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read baseline, scope, six-case packet and H4 v3 contracts.**
- [ ] **Lot 1 — Typed, callable contract adapter; gated suite and cleanup.**
- [ ] **Lot 2 — Refusal after lock wait; below-HTTP S3/connection failures.**
- [ ] **Lot 3 — Bidirectional replay, ordered conflict, selected profile.**
- [ ] **Lot 4 — Reproducible runner and tests included in static checking.**
- [ ] **Lot 5 — Full CI-equivalent API suite with acceptance disabled.**
- [ ] **Lot 6 — Enabled suite: archive each expected contract failure.**
- [ ] **Lot 7 — Typecheck, lint and API build with declarations.**
- [ ] **Lot 8 — Review, French report, atomic commits and verified bundle.**

## Verification commands
- [ ] `rtk make -f tools/artifact-host.mk test-api API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
- [ ] `rtk make -f tools/artifact-host.mk test-provider-acceptance ARTIFACTS_PROVIDER_ACCEPTANCE=1 API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
- [ ] `rtk make -f tools/artifact-host.mk typecheck-provider-acceptance typecheck lint build-api API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
- [ ] `rtk make -f tools/artifact-host.mk down API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
