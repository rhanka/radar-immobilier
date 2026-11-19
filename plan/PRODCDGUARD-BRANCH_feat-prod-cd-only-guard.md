# Feature: Production CD-Only Rule and Guard (`feat/prod-cd-only-guard`)

## Objective
Codify the rule prohibiting manual production applies outside declared CD paths in runbooks and agent governance (`docs/runbooks/prod-promotion.md`, `rules/MASTER.md`, `rules/workflow.md`, `AGENTS.md`), and add a tested CI guard (`deploy/ci/check-prod-cd-paths.mjs`) rejecting any production manifest without a declared CD workflow mapping (`deploy/ci/prod-cd-paths.json`).

## Scope / Guardrails
- Scope limited to `plan/PRODCDGUARD-BRANCH_feat-prod-cd-only-guard.md`, `docs/runbooks/prod-promotion.md` (top section), `rules/MASTER.md`, `rules/workflow.md`, `AGENTS.md`, `deploy/ci/prod-cd-paths.json`, `deploy/ci/check-prod-cd-paths.mjs`, `deploy/ci/check-prod-cd-paths.test.mjs`, and `.github/workflows/ci.yml`.
- Zero Python; pure Node 22 built-ins with explicit `node:*` imports for ESLint compliance.
- Work isolated in `./tmp/prod-cd-only-guard`; root checkout untouched.
- No manual production writes; hermetic temp-repo fixture tests only.
- All new text in English; follow `rules/MASTER.md` naming policy.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/PRODCDGUARD-BRANCH_feat-prod-cd-only-guard.md`
  - `docs/runbooks/prod-promotion.md`
  - `deploy/ci/prod-cd-paths.json`
  - `deploy/ci/check-prod-cd-paths.mjs`
  - `deploy/ci/check-prod-cd-paths.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `CLAUDE.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional / Exception-Gated Paths**:
  - `rules/MASTER.md`, `rules/workflow.md`, `AGENTS.md`, `.github/workflows/ci.yml` (require `PRODCDGUARD-EX1`)
- **Exception process**:
  - `PRODCDGUARD-EX1` declared below in `## Feedback Loop`.

## Feedback Loop
- **PRODCDGUARD-EX1 (`clarification` / pre-authorized by brief)**:
  - Scope: `rules/MASTER.md`, `rules/workflow.md`, `AGENTS.md`, `.github/workflows/ci.yml`.
  - Reason: Brief Lot 4 explicitly directs documenting the "no manual production apply outside CD path" rule in `docs/runbooks/prod-promotion.md` and `AGENTS`/`rules`, and wiring the tested CI guard into `.github/workflows/ci.yml`.
  - Impact: Additive governance section + read-only manifest-to-workflow CI check step; zero runtime/cluster behavior change.
  - Rollback strategy: Revert commits touching `rules/`, `AGENTS.md`, and `.github/workflows/ci.yml`.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: Independent Lot 4 branch targeting `main` via its own PR.

## UAT Management (in orchestration context)
- Not applicable (governance documentation and static CI guard + hermetic unit tests only).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `AGENTS.md`, `docs/runbooks/prod-promotion.md`, and inventory all `deploy/` manifests vs `.github/workflows/`.
  - [x] Confirm isolated worktree `./tmp/prod-cd-only-guard` off `origin/main`.
  - [x] Declare `PRODCDGUARD-EX1`.

- [ ] **Lot 1 — Codify no-manual-prod-apply rule**
  - [ ] Add `## No manual production apply outside CD` at top of `docs/runbooks/prod-promotion.md`.
  - [ ] Document rule and mandatory log cross-reference in `rules/MASTER.md`, `rules/workflow.md`, and `AGENTS.md`.

- [ ] **Lot 2 — Prod CD-path registry, CI guard & tests**
  - [ ] Create `deploy/ci/prod-cd-paths.json` mapping prod manifests to workflows (with frozen bootstrap/legacy exemptions).
  - [ ] Implement `deploy/ci/check-prod-cd-paths.mjs` refusing undeclared prod manifests, invalid workflow refs, or stale entries.
  - [ ] Implement `deploy/ci/check-prod-cd-paths.test.mjs`, wire into `.github/workflows/ci.yml`, and run tests locally.

- [ ] **Lot 3 — PR & CI verification**
  - [ ] Push `feat/prod-cd-only-guard` and open PR targeting `main`.
  - [ ] Verify all PR CI checks pass green (no merge).
