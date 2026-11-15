# Feature: Codify the live prod ConfigMap keys (radar-api, immo-mcp-config)

## Objective
Make the sources the prod CD applies (deploy/k8s/30-api.yaml, deploy/k8s/40-immo-mcp-http-deploy.yaml) carry every live key, artifacts and classification cursor included, and gate it in CI, so a client-side apply cannot prune them again (incident 2026-11-14, v1.2.20 partial apply).

## Scope / Guardrails
- Scope limited to the two prod ConfigMaps, their required key list and the offline gates.
- Non-secret values only; credentials stay secretKeyRef entries.
- No cluster write (deploy freeze for the T3 auth cutover); the annotation alignment command is prepared, not run.
- Make-only workflow, no direct Docker commands.
- Branch development in `./tmp/fix-prod-cm-codify`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/30-api.yaml`
  - `deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml`
  - `deploy/k8s/prod-configmap-keys.json`
  - `deploy/ci/check-prod-configmap-keys.sh`
  - `deploy/ci/check-prod-configmap-keys.test.sh`
  - `deploy/ci/check-h3-preprod-render.sh`
  - `deploy/ci/h3-disabled-fixture.sh`
  - `plan/PRODCM-BRANCH_fix-prod-configmap-codify.md`
  - `deploy/overlays/preprod/patch-immo-mcp-config.yaml` (comments only)
  - `deploy/overlays/preprod/kustomization.yaml` (delete patch for the two PROD env literals)
  - `docs/spec/mcp/claude-ai-connector-setup.md`
  - `packages/immo-mcp/src/server-http.ts` (comment only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `deploy/prod-cutover/**` (owned by feat/prod-cutover-v1220)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` (PRODCM-EX1)
- **Exception process**:
  - PRODCM-EX1: one CI step in `ci.yml` runs the new gate and its mutation tests. Impact: one offline step in the quality job. Rollback: remove the step.

## Feedback Loop
- [x] `attention`: the production base now carries artifact keys; `check-h3-preprod-render.sh` masks only the key names of the listed radar-api keys, inside ConfigMap radar-api data; values are still checked and the same key elsewhere still fails (review #1114).
- [x] `clarification` (i-cond): Deployment radar-api carries the live PROD env literals POSTGRES_HOST and NODE_OPTIONS=--max-old-space-size=640; the preprod overlay deletes them (preprod render unchanged).
- [ ] `attention`: preprod render gains `IMMO_ARTIFACTS_LIVE_REDRIVE_ENABLED: "false"` on radar-api (inherited, equals the code default).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`; worktree `./tmp/fix-prod-cm-codify` from origin/main.
  - [x] Map the prod apply paths (k8s-apply-mcp.yaml, build-push-images.yml deploy job).
- [x] **Lot 1 — Codify and gate**
  - [x] Add the live prod keys to both base ConfigMaps (artifacts, cursor key id, JWKS URL, MCP scopes).
  - [x] Required key list `deploy/k8s/prod-configmap-keys.json` (exact live key set).
  - [x] Gate `check-prod-configmap-keys.sh` (check / extract / read-only diff) + mutation tests, wired in CI.
  - [x] Lot gate: `make k8s-validate ENV=ci`, render tests under `deploy/ci/`.
- [ ] **Lot 2 — After T3 (operator, not this branch)**
  - [ ] `kubectl apply set-last-applied` on the two ConfigMaps from the extracted source, then read-only diff.
