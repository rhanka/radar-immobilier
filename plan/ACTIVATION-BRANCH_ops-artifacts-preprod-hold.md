# Feature: Keep preprod artifacts closed pending activation prerequisites

## Objective
- [ ] Persist both artifact control modes at `off` until S3 verification and live acceptance are complete.

## Scope / Guardrails
- [x] Use the existing repository-local `tmp/artefacts-activation` worktree.
- [x] Keep production, root UAT, credentials and business data outside this change.
- [x] Run through standalone Make targets; never load the root Makefile or display secrets.
- [x] Keep `ENV` last and use `test-artifacts-activation` for isolated checks.
- [x] Record the owner's authorized fallback in the activation instruction and runbook.
- [x] PR #937 correction is offline only: no cluster access, push or `.env` reads; do not interfere with the DB switch through 11:45 UTC.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/overlays/preprod/patch-artifacts-control.yaml`
  - `deploy/overlays/preprod/patch-immo-mcp-config.yaml`
  - `deploy/ci/check-h3-general-render.test.sh`
  - `deploy/overlays/preprod/artifacts-activation.mk`
  - `deploy/ci/check-h3-activation-commands.test.sh`
  - `docs/runbooks/ARTIFACTS_PREPROD_ACTIVATION.md`
  - `plan/ACTIVATION-BRANCH_ops-artifacts-preprod-hold.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other `plan/NN-BRANCH_*.md` files
  - `deploy/k8s/**`, `.github/workflows/**`, `api/**`, `packages/**`, `ui/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - No additional paths authorized.
- **Exception process**:
  - Record rationale, impact and rollback before expanding scope.

## Feedback Loop
- [x] `ACTIVATION-EX1`: normalize the synthetic general-mode test fixture after checking the real off render; otherwise its general-to-invalid mutations become no-ops. Impact limited to the existing hermetic gate test; rollback restores its prior fixture setup.
- [x] `ACTIVATION-EX2` (owner request, PR #937 reviews): extend scope to the standalone operator Makefile, its existing CI command test and the runbook to restore off/general rendering and document resumption from Git off. Impact is offline rendering and documentation only; rollback reverts these changes while preserving both Git patches at off. Update the ignored local activation report alongside delivery.
- [x] Both wildcard DNS records now resolve to `51.79.100.177` (A, DNS only); Certificate `radar-artifact-content-preprod-tls` is Ready, as supplied by the owner/reviews. No live recheck in this task.
- [ ] `attention`: S3 checks and two-account acceptance remain outstanding; keep both Git modes off and do not claim activation acceptance.

## Orchestration Mode (AI-selected)
- [x] Single branch; supplied read-only reviews A/B cover baseline `656c043904ae7e0df95b11a7c85c0265522aae62`. Corrective changes receive local verification only in this task.
- [x] No delegated application, cluster writes or test stack startup.

## UAT Management (in orchestration context)
- [x] No UI behavior changes; no root UAT changes required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read project rules and runbook; inventory the preprod state.
  - [x] Confirm bascule morning final receipt: preprod open, CD active at 07:37:20 UTC.
  - [x] Preserve `PREPROD_CD_ENABLED=true`; never route CD directly to production.
- [ ] **Lot 1 — Durable closure**
  - [x] Set both preprod control mode patches to `off` without changing coordinates.
  - [x] Verify the paired off render and operator rollback contracts in isolation (25 render checks and 13 operator checks).
  - [ ] Obtain two eligible independent review legs and reconcile findings.
- [ ] **Lot 2 — Delivery and evidence**
  - [ ] Selectively stage and commit this plan with the two patch files.
  - [ ] Push and open a PR, require green CI, merge with a merge commit and preserve the branch.
  - [ ] Verify the deployed off modes, then persist the S3 credentials without opening publication.
  - [ ] Record deployment, resource names and remaining S3/acceptance work in the requested report.
- [x] **Lot 3 — PR #937 operator-render correction (offline only)**
  - [x] Render the requested off/general mode for both API and MCP, regardless of the Git off/general baseline, and explicitly verify both values.
  - [x] Exercise the real operator render command for both modes and negative cases through the existing CI suite: 25 H3 render checks and 18 operator checks pass with `make -f deploy/overlays/preprod/artifacts-activation.mk test-render ENV=test-artifacts-activation`.
  - [x] Document resumption from Git off; update DNS/TLS evidence and the local report without accessing the cluster.
  - [x] Commit without trailers, verify `pr937-fix.bundle` with ref `refs/heads/ops/artifacts-preprod-hold` and prerequisite `656c043904ae7e0df95b11a7c85c0265522aae62`, and deliver without pushing; `git bundle verify` passes.
