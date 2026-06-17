# Hotfix: UI Svelte client runtime

## Objective
Fix the production white page caused by the UI browser bundle resolving Svelte's server runtime, then deploy a verified UI image to the `poc` Kubernetes environment.

## Scope / Guardrails
- Scope limited to the UI Vite resolver, CI/bundle smoke guards, and the production UI deployment tag.
- No API, database, ontology, or data migration change.
- Make-only workflow; no direct npm/node/docker from the agent shell.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree `./tmp/fix-ui-svelte-client-runtime`.
- Automated tests run on `ENV=fix-ui-svelte-client-runtime`, never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `ui/vite.config.ts`
  - `plan/HOTFIX-BRANCH_fix-ui-svelte-client-runtime.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `api/**`
  - `packages/**`
  - `ui/src/**`
  - other `plan/*BRANCH*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` -> HOTFIX-EX1
  - `.github/workflows/ci.yml` -> HOTFIX-EX2
  - `deploy/k8s/50-ui.yaml` -> HOTFIX-EX3

## Feedback Loop
- HOTFIX-EX1: `Makefile`
  - Reason: add make-only smoke targets that fail when the built UI bundle or UI image embeds Svelte server runtime strings.
  - Impact: CI and operators gain a precise regression gate for the observed blank-page failure.
  - Rollback: remove `smoke-ui-bundle` and `smoke-ui-image-bundle`.
- HOTFIX-EX2: `.github/workflows/ci.yml`
  - Reason: run the bundle smoke guard immediately after `make build`.
  - Impact: pull requests fail before merge if the browser bundle regresses to the server runtime.
  - Rollback: remove the `Smoke UI bundle` step.
- HOTFIX-EX3: `deploy/k8s/50-ui.yaml`
  - Reason: pin production UI deployment to the verified hotfix image tag.
  - Impact: the `poc` deployment rolls out the corrected bundle.
  - Rollback: restore the previous image tag.

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: production regression is isolated to the UI build/runtime artifact and needs one narrow hotfix branch.

## UAT Management
- Production verification uses the deployed public URL `https://immo.sent-tech.ca`.
- No root `ENV=dev` UAT is required for this hotfix because the failure is deployment-bundle specific.

## Plan / Todo
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`.
  - [x] Load harness debug workflow.
  - [x] Confirm isolated repository-local worktree `./tmp/fix-ui-svelte-client-runtime`.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Declare HOTFIX exceptions for Makefile, CI, and deploy manifest.

- [x] **Lot 1 — Root cause & minimal fix**
  - [x] Reproduce/observe production symptom: browser console reports `lifecycle_function_unavailable` and `mount(...) is not available on the server`.
  - [x] Inspect the published UI image and confirm server-runtime Svelte strings in the browser bundle.
  - [x] Force Vite resolution conditions to prefer browser/client Svelte entrypoints.

- [x] **Lot 2 — Regression guards**
  - [x] Add `make smoke-ui-bundle`.
  - [x] Add `make smoke-ui-image-bundle`.
  - [x] Wire `make smoke-ui-bundle ENV=ci` into CI after build.
  - [x] Run `make build ENV=fix-ui-svelte-client-runtime`.
  - [x] Run `make smoke-ui-bundle ENV=fix-ui-svelte-client-runtime`.
  - [x] Build `radar-immobilier-ui:main-d4ff77e-clientfix`.
  - [x] Run `make smoke-ui-image-bundle UI_VERSION=main-d4ff77e-clientfix ENV=fix-ui-svelte-client-runtime`.

- [ ] **Lot 3 — Publish, deploy, and close**
  - [ ] Commit hotfix.
  - [ ] Push branch.
  - [ ] Push verified UI image tag.
  - [ ] Apply Kubernetes deployment.
  - [ ] Verify public URL with browser-console smoke.
  - [ ] Open PR.
  - [ ] Verify CI green.
  - [ ] Merge commit into `main`.
  - [ ] Preserve branch.
