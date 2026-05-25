# Feature: K8s tenant, POC deployment, and infra contract

## Objective
Create the `radar-immobilier` Kubernetes POC tenant, deploy API + Postgres +
Obscura + Maildev, and document S3/DNS/secrets for `immo.sent-tech.ca`.

## Scope / Guardrails
- Cluster-owner resources live in `../poc-k8s`; tenant workload manifests live
  in this repo under `deploy/k8s/**`.
- Cross-repo work uses a separate `poc-k8s` worktree under this repo's ignored
  `./tmp/feat-poc-k8s-radar-tenant/`; never mutate the dirty
  `/home/antoinefa/src/poc-k8s` checkout and never use system `/tmp`.
- No production secrets, kubeconfigs, IAM keys, or `.env` values in Git.
- Make-only workflow; `ENV=<env>` is always the last make argument.
- Tests use `ENV=test-k8s-tenant` or `ENV=e2e-k8s-tenant`, never `dev`.
- Discussion may be French; code/docs/spec/commits stay English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/04-BRANCH_feat-k8s-tenant-radar-and-infra.md`
  - `PLAN.md`
  - `docs/spec/SPEC_EVOL_INFRA.md`
  - `deploy/k8s/**`
  - `.security/findings/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` except this file
  - `docs/spec/input/**`
- **Conditional Paths**:
  - `../poc-k8s/**` -> BR04-EX1
  - `Makefile` -> BR04-EX2
  - `.github/workflows/**` -> BR04-EX3
  - `api/**` -> BR04-EX4
  - `obscura/**` -> BR04-EX5
  - `.env.example` -> BR04-EX6
- **Exception process**: declare reason, impact, and rollback here before
  touching a conditional path.

## Feedback Loop
### BR04-EX1 — Cross-repo tenant contract in `../poc-k8s`
- **Reason**: `poc-k8s` owns Namespace, ResourceQuota, LimitRange,
  ServiceAccount/RBAC, and cluster-owner NetworkPolicy.
- **Impact**: create `tmp/feat-poc-k8s-radar-tenant/` worktree; add
  `tenants/radar-immobilier/**`; update capacity table only on a clean base.
- **Rollback**: delete the tenant folder and table row in the `poc-k8s` branch.

### BR04-EX2 — Make targets for deploy and security scan
- **Reason**: BR04 must replace `deploy-k8s` and `security-scan` placeholders.
- **Impact**: add K8s vars, validate/deploy/secret/S3/image/scan targets.
- **Rollback**: restore placeholder targets and remove BR04 variables.

### BR04-EX3 — Deployment workflow
- **Reason**: CI must validate manifests; manual POC deploy needs a workflow.
- **Impact**: add `.github/workflows/deploy-k8s.yml`; optionally extend CI.
- **Rollback**: delete the workflow and CI validation step.

### BR04-EX4 — API runtime config
- **Reason**: K8s may require probe/CORS/S3 path-style config adjustments.
- **Impact**: small API config/app changes only, no new domain behavior.
- **Rollback**: revert API config/app changes and rely on current `/health`.

### BR04-EX5 — Obscura image metadata
- **Reason**: K8s needs a reproducible deployable Obscura image.
- **Impact**: `obscura/Dockerfile` metadata/health fixes only.
- **Rollback**: restore the Dockerfile.

### BR04-EX6 — Environment contract documentation
- **Reason**: operators need non-secret deployment variable names.
- **Impact**: `.env.example` may gain placeholder-only K8s/S3 variables.
- **Rollback**: remove the added examples.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cross-repo PR**
- [ ] **Multi-branch**
- Rationale: radar code/docs/workflows are one branch; `poc-k8s` needs one
  separate cluster-owner PR referenced by the radar PR.

## UAT Management
- Operational smoke only: `GET https://immo.sent-tech.ca/health` returns `200`
  with DB and object-store probes healthy.
- If GitHub Pages uses `VITE_API_BASE_URL`, confirm the health badge reads the
  K8s API.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/security.md`.
  - [x] Confirm worktree `tmp/feat-k8s-tenant-radar-and-infra/`.
  - [x] Confirm `tmp/` is ignored for worktrees.
  - [x] Read `../poc-k8s/contracts/README.md` and tenant examples.
  - [x] Confirm `/home/antoinefa/src/poc-k8s` is dirty and must not be edited.
  - [x] Define `ENV=test-k8s-tenant`, `ENV=e2e-k8s-tenant`, `ENV=poc`.
  - [x] Declare BR04 scope exceptions.

- [ ] **Lot 1 — Infra spec and tenant contract**
  - [ ] Create/update `docs/spec/SPEC_EVOL_INFRA.md`.
  - [ ] Create clean `poc-k8s` worktree at `tmp/feat-poc-k8s-radar-tenant/`.
  - [ ] Add `tenants/radar-immobilier/{00-namespace,30-netpol,README}.yaml`
    or `.md` in the `poc-k8s` branch.
  - [ ] Update `poc-k8s/contracts/README.md` capacity table if cleanly based.
  - [ ] Lot gate: radar lint plus K8s validation after Lot 2 adds the target.

- [ ] **Lot 2 — Radar-owned K8s manifests**
  - [ ] Add `deploy/k8s/{kustomization,api,postgres-postgis,obscura,maildev,ingress,secrets.example}.yaml`.
  - [ ] Include probes, requests/limits, PVC `5Gi`, internal Maildev, and
    `immo.sent-tech.ca` API ingress.
  - [ ] Lot gate: `make k8s-validate ENV=test-k8s-tenant` and
    `make typecheck ENV=test-k8s-tenant`.

- [ ] **Lot 3 — Make deploy, S3, and scan wiring**
  - [ ] Implement `deploy-k8s`, `k8s-validate`, `k8s-create-secrets`,
    `s3-init-poc`, `s3-status-poc`, image build/push, and `security-scan`.
  - [ ] Lot gate: `make build ENV=test-k8s-tenant` and
    `make security-scan ENV=test-k8s-tenant` when images are available.

- [ ] **Lot 4 — CI/CD workflow**
  - [ ] Add manual K8s deploy workflow using GitHub Secrets.
  - [ ] Add non-secret manifest validation and SCA coverage to CI.
  - [ ] Lot gate: open PR and verify CI with the full 40-character head SHA.

- [ ] **Lot 5 — POC deployment smoke**
  - [ ] Ensure bucket `radar-immobilier-raw` exists in Scaleway project
    `09ac728a-e3b9-4a5b-9749-664b0f147c70`.
  - [ ] Create/rotate K8s secrets out-of-band.
  - [ ] Apply tenant contract, deploy radar manifests, and smoke `/health`.
  - [ ] Record accepted risk/blocker in `.security/findings/**` or the spec.

- [ ] **Lot 6 — Docs consolidation**
  - [ ] Update spec with final decisions, PR links, and smoke evidence.
  - [ ] Update `PLAN.md` and this branch file with merge-ready state.

- [ ] **Lot 7 — Merge & close**
  - [ ] Push branch, open PR, verify CI green, merge via merge commit, preserve
    branches, and archive this file to `plan/done/`.
