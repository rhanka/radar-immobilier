# Feature: Fix handoff body size (413 on live-host handoff)

## Objective
Allow `POST /api/v1/artifacts/live-host/v1/handoff` (verified candidate, up to 64 MiB in JSON + base64 overhead) through the radar-ui nginx without raising the body limit of any other route.

## Scope / Guardrails
- Scope limited to nginx configs (cluster, preprod overlay, compose) and a dedicated container test.
- Global/default body limit unchanged for every other route.
- No ingress-nginx in front (Traefik only, verified in `deploy/k8s/60-ingress.yaml`); no dedicated Ingress added.
- Make-only workflow, no direct Docker commands outside the test script.
- Branch development in repository-local worktree `./tmp/handoff-body-size`.
- Automated tests on `ENV=ci` / local containers, never on `ENV=dev`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/nginx/**`
  - `deploy/overlays/preprod/nginx/**`
  - `ui/nginx/**`
  - `plan/HANDOFF-BRANCH_fix-handoff-body-size.md`
  - `LANE-REPORT.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single nginx change across three mirrored confs, one test cycle.

## UAT Management (in orchestration context)
- No UI surface impacted; no UAT checkpoint. Verification is container-level (nginx + mock upstream).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` via `AGENTS.md` bootstrap and this branch-init skill.
  - [x] Create isolated repository-local worktree `./tmp/handoff-body-size` on `fix/handoff-body-size` from `origin/main`.
  - [x] Confirm no ingress-nginx in front: all Ingresses use `ingressClassName: traefik`; no `proxy-body-size` annotation exists.
  - [x] Confirm command style: `make ... ENV=ci` with `ENV` last.

- [x] **Lot 1 — Dedicated handoff location in all nginx confs**
  - [x] Add exact `location = /api/v1/artifacts/live-host/v1/handoff` with `client_max_body_size 96m`, `proxy_read_timeout 120s`, `proxy_send_timeout 120s`, `proxy_request_buffering off`, same upstream as `/api/`, to `deploy/k8s/nginx/default.conf` (prod).
  - [x] Same block in `deploy/overlays/preprod/nginx/default.conf` (preprod).
  - [x] Same block in `ui/nginx/default.conf` (compose, variable upstream).
  - [x] Lot gate:
    - [x] `bash deploy/k8s/nginx/check-header-parity.sh`
    - [x] `make k8s-validate ENV=ci`

- [x] **Lot 2 — Body-size container test**
  - [x] Add `deploy/k8s/nginx/handoff-body-size.test.sh`: nginx container + mock upstream, 10 MB body accepted on the handoff path, refused (413) on `/api/` and on the sibling `/job` path.
  - [x] Run the test for all three confs.

- [ ] **Lot 3 — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR to `main` (merge commit only, branch preserved).
  - [ ] Verify CI green.
  - [ ] Write `LANE-REPORT.md` (repo root of the fresh clone).
