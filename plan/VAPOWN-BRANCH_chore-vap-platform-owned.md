# Chore: Hand `radar-ci-trigger-suspend-only` VAP Ownership to Platform (`chore/vap-platform-owned`)

## Objective
Remove tenant-side CD application and cluster-scoped RBAC for `ValidatingAdmissionPolicy` and `ValidatingAdmissionPolicyBinding` `radar-ci-trigger-suspend-only` now owned by `poc-k8s` (`platform/78-radar-immobilier-ci-guards.yaml`, commit `25a4a34`), while preserving the `--dry-run=server` anti-RCE gate in `.github/workflows/bascule-bundle-cd.yml`.

## Scope / Guardrails
- Isolated worktree `./tmp/vap-platform-owned` branched from `origin/main`; root checkout untouched.
- Zero Python, zero `.env` or kubeconfig reads, zero live cluster mutations, no PR merge.
- Remove `deploy/ci/bascule-preprod/vap-ci-trigger-suspend-only.yaml`, its `deploy/ci/prod-cd-paths.json` entry, and the workflow steps that applied it.
- Delete `ClusterRole/radar-ci-bascule-prod-vap` and `ClusterRoleBinding/radar-ci-bascule-prod-vap` from `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml` (the impersonation `--dry-run=server` gate patches `batch/v1` `CronJob/radar-db-backup-prod` only and reads zero `admissionregistration.k8s.io` resources).
- Keep the fail-closed `--dry-run=server` anti-RCE gate (`jobTemplate` mutation denied, `suspend` flip allowed, `Role/radar-ci-trigger-prod` neutralized on failure).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/VAPOWN-BRANCH_chore-vap-platform-owned.md`
  - `deploy/ci/bascule-preprod/vap-ci-trigger-suspend-only.yaml` (deleted)
  - `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml`
  - `deploy/ci/bascule-preprod/EVIDENCE_CAPTURE_RUN.md`
  - `deploy/ci/bascule-preprod/CD_NATIVE_MIGRATION.md`
  - `deploy/ci/prod-cd-paths.json`
  - `deploy/ci/check-prod-cd-paths.test.mjs`
  - `tools/make/cutover-workflows.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional / Exception-Gated Paths**:
  - `.github/workflows/bascule-bundle-cd.yml` (requires `VAPOWN-EX1`)
- **Exception process**:
  - `VAPOWN-EX1` declared below in `## Feedback Loop`.

## Feedback Loop
- **VAPOWN-EX1 (`clarification` / pre-authorized by brief)**:
  - Scope: `.github/workflows/bascule-bundle-cd.yml`.
  - Reason: Brief explicitly requires removing the VAP apply steps from `.github/workflows/bascule-bundle-cd.yml` while retaining its `--dry-run=server` anti-RCE gate.
  - Impact: `bascule-bundle-cd.yml` stops applying cluster-scoped VAP resources owned by `poc-k8s` (`platform/78-radar-immobilier-ci-guards.yaml`, commit `25a4a34`), while continuing to verify VAP enforcement fail-closed on every bundle apply.
  - Rollback strategy: Revert the workflow commit on `chore/vap-platform-owned`.

## Orchestration Mode (AI-selected)
- [x] **Single-agent**
- Rationale: Focused manifest, RBAC, workflow, test, and runbook update on a single branch.

## UAT Management (in orchestration context)
- Not applicable (CI/CD manifest governance and hermetic offline tests only).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & RBAC verification**
  - [x] Verify all VAP and `ClusterRole` references across `deploy/`, `.github/workflows/`, and `tools/`.
  - [x] Confirm `--dry-run=server` anti-RCE gate requires zero `admissionregistration.k8s.io` read permission.
- [x] **Lot 1 — Remove tenant VAP manifest & ClusterRole RBAC**
  - [x] Remove `deploy/ci/bascule-preprod/vap-ci-trigger-suspend-only.yaml` and its `deploy/ci/prod-cd-paths.json` mapping.
  - [x] Delete `ClusterRole/radar-ci-bascule-prod-vap` and `ClusterRoleBinding/radar-ci-bascule-prod-vap` from `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml`.
- [x] **Lot 2 — Update workflow, docs & hermetic tests**
  - [x] Remove VAP apply and propagation-sleep steps from `.github/workflows/bascule-bundle-cd.yml`, keeping the `--dry-run=server` anti-RCE gate intact.
  - [x] Update `EVIDENCE_CAPTURE_RUN.md`, `CD_NATIVE_MIGRATION.md`, `check-prod-cd-paths.test.mjs`, and `cutover-workflows.test.mjs`.
- [ ] **Lot 3 — Verification, PR & green CI**
  - [x] Run `check-prod-cd-paths.mjs`, hermetic workflow/backup/cutover tests, and `lint`.
  - [ ] Push `chore/vap-platform-owned`, open PR against `main`, confirm green CI checks, and deliver report.
