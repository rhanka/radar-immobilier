# Feat: daily prod backup (PostgreSQL + docs S3)

## Objective
A real, independent daily backup of production immo: dated, verified, retained
(daily 7 d / weekly 4 w / monthly 6 m), restorable by date, in the dedicated
bucket `radar-immobilier-backup` provisioned by the k8s lane.

## Scope / Guardrails
- CronJob `radar-backup-daily` in ns `radar-immobilier`, applied by the existing
  prod CD path (`bascule-bundle-cd.yml`, new independent job `apply-backup`).
- 0 Python, 0 new image (postgis/postgis:16-3.4 + the pinned radar-api digest).
- Bucket, identities, lifecycle, object lock: k8s lane (referenced only).
- No NetworkPolicy change (pod label `component: db-backup`).
- No cluster action from this branch; no merge, no workflow dispatch.
- All new code/doc text is English.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/backup/**`
  - `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml`
  - `deploy/ci/bascule-preprod/CRED_CYCLE.md`
  - `.github/workflows/bascule-bundle-cd.yml`
  - `.github/workflows/ci.yml`
  - `plan/BACKUP-BRANCH_feat-prod-daily-backup.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `deploy/k8s/70-networkpolicy.yaml` (no netpol widening)
  - Other branch plan files

## Orchestration Mode
- [x] **Mono-branch + merge commit**

## Plan / Todo
- [x] **Lot 1 — Job**: CronJob (dump initContainer + backup container), script, retention purge.
- [x] **Lot 2 — CD**: `apply-backup` job, RBAC name-scoped additions, SealedSecrets committed verbatim.
- [x] **Lot 3 — Docs**: README (provisioning, CD, verification), RETENTION, RESTORE, CRED_CYCLE rotation (90 d).
- [x] **Lot 4 — Verification**: offline selftest (CI + CD gate), eslint, offline manifest render,
  local dump run on PostGIS 16 with a `pg_read_all_data` role, real-SDK run against s3mock.
- [ ] **Lot 5 — Activation (k8s lane / conductor, after merge)**: re-apply RBAC, arm
  `BACKUP_DAILY_CD_ENABLED`, first run, restore-test (wave 2).
