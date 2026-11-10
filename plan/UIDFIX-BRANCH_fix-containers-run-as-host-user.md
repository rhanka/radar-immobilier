# Feature: Run bind-mount writer containers as the host user

## Objective
Stop radar containers from leaving root-owned files in bind mounts
(`node_modules`, `tmp/`, workspace outputs) by running every
bind-mount writer as the host user, following the pattern merged in
Sentropic PRs #973 and #987 (`fix/compose-host-user`,
`fix/compose-backup-owner`).

## Scope / Guardrails
- Fresh clone `~/src/radar-immobilier-uid` from `origin/main`; branch
  `fix/containers-run-as-host-user`; PR to `main`.
- Owner order 2026-11-08 (ubuntu janitor relay): containers run as root
  and leave root files the user cannot delete without sudo.
- Make-only workflow; `ENV=<env>` always last in `make` commands.
- Tests on `ENV=test-*` / `ENV=e2e-*` only, never `ENV=dev`.
- No Python. Never read `.env`.
- Commits carry no `Co-Authored-By`, `Claude-Session` or
  "Generated with" line.
- Report: `LANE-REPORT.md` at the clone root (PR, CI, modified
  services/targets).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/UIDFIX-BRANCH_fix-containers-run-as-host-user.md`
  - `LANE-REPORT.md`
  - `e2e/Dockerfile` (new: Chromium system deps for the UID-mapped runner)
  - `api/Dockerfile.dev` (new: poppler-utils baked for the UID-mapped
    dev/test api; no application code touched)
- **Forbidden Paths (must not change in this branch)**:
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/*` (other branches)
  - Application code under `api/`, `ui/`, `packages/` (except the e2e
    runner script listed under UIDFIX-EX1)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile`, `docker-compose*.yml` (UIDFIX-EX1)
  - `tools/make/e2e-real.sh`, `tools/make/e2e-real-runner.sh` (UIDFIX-EX1)
  - `tools/make/git-artifact.compose.yml` (UIDFIX-EX1)
  - `tools/make/artefacts-a4-run.sh`, `tools/make/artefacts-a5-run.sh`
    (UIDFIX-EX1)
  - `deploy/k8s/refresh-cronjobs/refresh-018.mk` (UIDFIX-EX1)
- **Exception process**:
  - Declare exception ID `UIDFIX-EXn` in `## Feedback Loop` before
    touching any conditional/forbidden path.

## Feedback Loop
- `acknowledge` UIDFIX-EX1 (declared before any edit): touch
  `Makefile`, `docker-compose.yml`, `docker-compose.dev.yml`,
  `docker-compose.test.yml`, `docker-compose.e2e.yml`,
  `tools/make/git-artifact.compose.yml`, `tools/make/e2e-real.sh`,
  `tools/make/e2e-real-runner.sh`, `tools/make/artefacts-a4-run.sh`,
  `tools/make/artefacts-a5-run.sh` and
  `deploy/k8s/refresh-cronjobs/refresh-018.mk`.
  - Reason: these files are the whole substance of the owner order
    (compose `user:` mapping, Makefile `UID`/`GID` export, raw
    `docker run` user flags); the default forbidden list would make
    the ordered change impossible.
  - Impact: dev/test/e2e bind-mount writer services run as
    `UID:GID`; named-volume-only services (`postgres`, `minio`,
    `obscura`, `maildev`, production `api`/`ui` images) unchanged.
    Fresh named `node_modules` volumes are handed to the host user
    by a one-off root `chown` step before the first install.
  - Rollback: revert the branch commits; stacks fall back to root
    containers (previous behaviour).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one orthogonal infra change, one final proof cycle.

## UAT Management (in orchestration context)
- No UI surface impacted; no UAT checkpoint. Proof stacks run on
  isolated `ENV=test-uidfix*` projects and are torn down with
  `down -v`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` (via `AGENTS.md` mandatory read order).
  - [x] Read Sentropic PRs #973 (`dbd91c938`, `f5d7d0a35`) and #987
    in `~/src/sentropic` (`git log`/`git show`).
  - [x] Fresh clone from `origin/main`; branch created and verified.
  - [x] Inventory every compose service (bind writer vs named-volume
    only) and every raw `docker run` with a workspace mount.
  - [x] Declare UIDFIX-EX1 above before touching forbidden paths.

- [ ] **Lot 1 — Compose user mapping**
  - [x] `docker-compose.dev.yml`: `user:` + `HOME=/tmp` +
    `npm_config_cache=/tmp/npm-cache` on `api` and `ui`.
  - [x] `docker-compose.test.yml`: same on `api`.
  - [x] `docker-compose.e2e.yml`: same on `e2e`; production `api`/`ui`
    unchanged (no bind mounts).
  - [x] `docker-compose.yml` (base) unchanged: no bind mounts;
    `postgres`/`minio`/`obscura`/`maildev` unchanged.
  - [x] `tools/make/git-artifact.compose.yml`: `user:` on `node`
    (writes the `tmp/git-artifact-proof` bind).

- [x] **Lot 2 — Makefile and raw `docker run`**
  - [x] `Makefile`: `export UID := $(shell id -u)`,
    `export GID := $(shell id -g)`, `DOCKER_RUN_USER` flag set.
  - [x] One-off root `chown` of the named `node_modules` volumes
    before the first UID-mapped install (test and dev stacks).
  - [x] `deploy/k8s/refresh-cronjobs/refresh-018.mk`: host-user flags
    on the two `bundle-*` targets mounting `$(ROOT):/workspace`.
  - [x] `tools/make/artefacts-a4-run.sh` / `artefacts-a5-run.sh`:
    host-user flags on the image-probe `docker run` (evidence bind).
  - [x] `tools/make/e2e-real.sh`: export `UID`/`GID`, chown the e2e
    named volumes once as root before `prepare`.
  - [x] `e2e/Dockerfile` (new) + runner: Chromium system deps baked
    in the image; `playwright install --only-shell` without
    `--with-deps` (apt needs root, the runner no longer is root).

- [x] **Lot 3 — Proof**
  - [x] `make test-api ENV=test-uidfix`
  - [x] `make typecheck ENV=test-uidfix`
  - [x] Short e2e on an isolated ENV (`make test-e2e ENV=test-uidfix-e2e`)
  - [x] `find <workspace> -user root` returns nothing after the runs.
  - [x] `down -v` teardown of every proof stack.
  - [x] Lot gate: no root-owned file left in the workspace.

- [x] **Lot 4 — Report, PR, close**
  - [x] `LANE-REPORT.md`: PR link, CI status, modified
    services/targets, inventory of untouched `docker run` calls.
  - [x] Push branch, open PR to `main`, verify CI.
  - [ ] Merge commit only if ordered (default: leave PR open).
