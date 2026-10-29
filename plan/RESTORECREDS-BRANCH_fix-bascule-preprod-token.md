# Feature: Permanent preprod restore credential

## Objective
Replace the expired bascule CI credential with a permanent ServiceAccount token.

## Scope / Guardrails
- Owner decision: 2026-10-29, approximately 11:00 UTC; no credential expiration.
- Worktree: `tmp/restore-creds`; branch: `fix/bascule-preprod-token`, from `origin/main`.
- No Python, environment-file reads, production operations, push or GitHub writes.
- No secret values in git, command output or logs; kubeconfig stays outside git.
- Use only the supplied tenant admin kubeconfig and explicit preprod namespace.
- Standalone external Makefile avoids the root Makefile's environment include.
- All make commands end with `ENV=test-restore-creds`; no application stack needed.
- Commits have no co-author trailer or AI attribution, per owner instruction.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/bascule-preprod/secret-ci-bascule-preprod-token.yaml`
  - `deploy/ci/bascule-preprod/CRED_CYCLE.md`
  - `deploy/ci/bascule-preprod/README.md`
  - `plan/RESTORECREDS-BRANCH_fix-bascule-preprod-token.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, application code, production resources and secrets
  - GitHub secrets, `PREPROD_CD_ENABLED`, `BASCULE_SCHEDULE_ENABLED`
- **Conditional Paths (allowed only with explicit exception)**:
  - None.
- **Exception process**:
  - Record reason, impact and rollback before any scope extension.

## Feedback Loop
- [x] Owner authorizes the permanent token and preprod Secret creation.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Infrastructure credential only; no UI UAT or local services required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read project, security and workflow rules; confirm branch and clean tree.
  - [x] Confirm the workflow's base64 kubeconfig contract and existing SA.
  - [x] Confirm no permanent token Secret exists for this SA in preprod.
- [x] **Lot 1 — Permanent credential**
  - [x] Add and apply the token Secret manifest only in preprod.
  - [x] Export a mode-0600 base64 kubeconfig outside the repository.
  - [x] Verify SA identity, absent JWT expiration, radar-api read and workflow RBAC.
  - [x] All 44 auth can-i checks pass; Job patch is denied and not required.
- [x] **Lot 2 — Documentation & delivery**
  - [x] Document manual rotation, revocation and recovery verification.
  - [x] Check scope and diffs; commit selectively without attribution.
  - [x] Prepare kubeconfig handoff; GitHub update remains with the conductor.

## Merge & close
- [ ] Deferred to conductor: GitHub secret update, workflow recovery, push and PR.
