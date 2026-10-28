# Feature: Keep preprod artifacts closed pending activation prerequisites

## Objective
- [ ] Persist both artifact control modes at `off` while content DNS and live acceptance are incomplete.

## Scope / Guardrails
- [x] Use the existing repository-local `tmp/artefacts-activation` worktree.
- [x] Keep production, root UAT, credentials and business data outside this change.
- [x] Run through standalone Make targets; never load the root Makefile or display secrets.
- [x] Keep `ENV` last and use `test-artifacts-activation` for isolated checks.
- [x] Record the owner's authorized fallback in the activation instruction and runbook.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/overlays/preprod/patch-artifacts-control.yaml`
  - `deploy/overlays/preprod/patch-immo-mcp-config.yaml`
  - `deploy/ci/check-h3-general-render.test.sh`
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
- [ ] `attention`: content wildcard DNS remains absent; this change preserves closure and does not claim activation acceptance.

## Orchestration Mode (AI-selected)
- [x] Single branch; two independent read-only review legs on this exact diff.
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
  - [ ] Record deployment, resource names, remaining DNS and acceptance work in the requested report.
