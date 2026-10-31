# Feat: PostgreSQL 16 -> 18 upgrade by logical replication (L1 code)

## Objective
Ship the code of lot L1 of the PG18 upgrade plan: pinned PG18 images, test stacks
on PG18, the `radar-pg18` StatefulSet on XFS with `file_copy_method=clone`,
label-based PostgreSQL filters in the cutover tool, the pod-pinned Service
selector in the manifest, the `pg-replicate` / `pg-verify` / `pg-switch` /
`pg-reverse` verbs and the documented procedure (`deploy/cutover/PG18-UPGRADE.md`).

## Scope / Guardrails
- No cluster write from this branch; the preprod L2/L3 acts are the conductor's.
- 0 Python; Bash, jq, kubectl, docker compose only.
- Production stays disabled (`config.json` has no `prod.pgUpgrade`).
- Make-only; `ENV` last; one Docker stack at a time; `down -v` after each stack.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/20-postgres-postgis.yaml`
  - `deploy/k8s/pg18/**`
  - `deploy/overlays/preprod-pg18/**`
  - `deploy/cutover/**`
  - `deploy/ci/run-db-backup.sh`
  - `tools/make/cutover-*`
  - `tools/make/base-api-compose.sh`, `tools/make/base-api-pwa-verify.sh`, `tools/make/paniers-lot6-verify.sh`
  - `plan/PG18-BRANCH_feat-pg18-upgrade.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `api/drizzle/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `docker-compose.yml` (PG18-EX1)
  - `.github/workflows/ci.yml` (PG18-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `attention` PG18-EX1 `docker-compose.yml`: the dev/test/e2e postgres moves to the
  pinned PG18 image, mounted at `/var/lib/postgresql` on a new volume `postgres18-data`
  (the 18 image refuses a mount at `/var/lib/postgresql/data`). Impact: the root UAT
  `dev` stack starts on an empty PG18 database until the owner dumps/restores
  (procedure in PG18-UPGRADE.md); the PG16 volume is never touched. Rollback: revert
  the commit; the PG16 volume is still there.
- [x] `attention` PG18-EX2 `.github/workflows/ci.yml`: runs the new hermetic cutover
  tests and `test-pg`. Rollback: revert the step.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one PR, orthogonal atomic commits; #956 lands first or this branch rebases on it.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Inventory (read-only, preprod radar_next)**
  - [x] 0 application table without primary key (82 tables + spatial_ref_sys).
  - [x] Extensions: postgis 3.4.3, btree_gist, pg_trgm; image-created postgis_topology (0 topology), postgis_tiger_geocoder (seed lookup rows only), fuzzystrmatch; no application dependency.
  - [x] Sequences: 2 serial (drizzle migration tables); 0 identity, 0 matview, 0 large object, 0 partitioned; 1 stored generated column.
  - [x] Roles: 4, all SCRAM; wal_level=replica; collation en_US.utf8.
- [x] **Lot 1 — Code**
  - [x] Pinned images (PG18 digest; PG16 digest = the running one).
  - [x] Compose/test stacks on PG18.
  - [x] `radar-pg18` StatefulSet (XFS, clone, fs-probe), direct Services, replication NetworkPolicy.
  - [x] Service selector pinned by pod in the manifest; PG16 `wal_level=logical`.
  - [x] Label-based PostgreSQL filters (controllers, consumers, snapshot, closure endpoints).
  - [x] Per-environment `dumpImage` (cutover render, CD backup).
  - [x] Verbs `pg-replicate`, `pg-verify`, `pg-switch`, `pg-reverse`.
  - [x] Procedure `deploy/cutover/PG18-UPGRADE.md`.
  - [ ] Lot gate:
    - [ ] `make -f deploy/cutover/operator.mk test-pg ENV=test-cutover`
    - [ ] `make -f deploy/cutover/operator.mk test test-api ENV=test-cutover`
    - [ ] `make test ENV=test-pg18`
- [ ] **Lot N — Merge & close**
  - [ ] Push branch (no PR from this session).
