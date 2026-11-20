# Docs: Production Manual Operations Log (`docs/manual-operations-log`)

## Objective
Create an append-only English operator log (`docs/operator/manual-operations-log.md`) recording every out-of-band production mutation with mandatory metadata and return-to-CD plan, pre-fill the 2026-11-18 manual actions (without secrets), and codify the logging requirement in the runbooks.

## Scope / Guardrails
- Scope limited to `plan/MANUALLOG-BRANCH_docs-manual-operations-log.md`, `docs/operator/manual-operations-log.md`, `docs/operator/mcp-signal-write-runbook.md`, and `docs/runbooks/prod-promotion.md` (§ Manual operations log before § Manual migration).
- Zero secrets, credentials, tokens, or connection URIs written in documentation or commits.
- Work isolated in `./tmp/manual-operations-log`; root checkout untouched.
- All new text in English; follow `rules/MASTER.md` naming policy (roles only, no personal first names).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/MANUALLOG-BRANCH_docs-manual-operations-log.md`
  - `docs/operator/manual-operations-log.md`
  - `docs/operator/mcp-signal-write-runbook.md`
  - `docs/runbooks/prod-promotion.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Exception process**:
  - None needed (documentation and branch plan only).

## Feedback Loop
- None required.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: Independent documentation lot targeting `main` via its own PR.

## UAT Management (in orchestration context)
- Not applicable (documentation only).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `docs/runbooks/prod-promotion.md`, `docs/operator/mcp-signal-write-runbook.md`, and `prod-snapshot/`.
  - [x] Confirm isolated worktree `./tmp/manual-operations-log` off `origin/main`.

- [x] **Lot 1 — Manual operations log & 2026-11-18 backfill**
  - [x] Create `docs/operator/manual-operations-log.md` defining the required fields (who, when UTC, what, command, diff summary, owner GO ref, planned CD return) and recording the four 2026-11-18 manual production operations with zero secret values.

- [x] **Lot 2 — Runbook rules**
  - [x] Add `## Manual operations log` to `docs/runbooks/prod-promotion.md` before `## Manual migration (break-glass only)`.
  - [x] Add logging requirement to `docs/operator/mcp-signal-write-runbook.md`.

- [ ] **Lot 3 — PR & CI verification**
  - [ ] Push `docs/manual-operations-log` and open PR targeting `main`.
  - [ ] Verify all PR CI checks pass green (no merge).
