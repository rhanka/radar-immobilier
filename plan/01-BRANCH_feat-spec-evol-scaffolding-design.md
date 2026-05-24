# Feature: Spec EVOL scaffolding — formalize design docs and fix BR-00 plan format

## Objective
Formalize the scaffolding specs (`SPEC_INTENT_SCAFFOLDING.md`, `SPEC_EVOL_SCAFFOLDING.md`) inside a dedicated branch (they currently sit on `main` from the bootstrap commit) and convert the archived BR-00 plan file from `###` sub-headings to the strict checkbox-only format mandated by `plan/BRANCH_TEMPLATE.md`.

## Scope / Guardrails
- Docs-only branch. No application code, no infra change, no rules change.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/feat-spec-evol-scaffolding-design/`.
- Branch environment mapping: `ENV=feat-spec-evol-scaffolding-design`, `API_PORT=8802`, `UI_PORT=5302`, `MAILDEV_UI_PORT=1102`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `docs/spec/SPEC_INTENT_SCAFFOLDING.md`
  - `docs/spec/SPEC_EVOL_SCAFFOLDING.md`
  - `plan/01-BRANCH_feat-spec-evol-scaffolding-design.md`
  - `plan/done/00-BRANCH_chore-scaffolding-base.md`
  - `PLAN.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `.claude/**`, `.gemini/**`, `.codex/**`
  - `api/**`, `ui/**`, `packages/**`, `e2e/**`
  - `plan/00-BRANCH_*.md` … `plan/12-BRANCH_*.md` (other branches)
  - `.github/workflows/**`
- **Conditional Paths**: none expected.
- **Exception process**: declare `BR01-EXn` in `## Feedback Loop` if needed. None expected.

## Feedback Loop
_None at branch start. Populate as issues arise._

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single delivery, docs only.
- [ ] **Multi-branch**
- Rationale: docs-only branch with disjoint files; no parallel work justified.

## UAT Management
- Not applicable (no UI surface).

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md` and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm worktree `tmp/feat-spec-evol-scaffolding-design/` is the working location.
  - [ ] Confirm `ENV=feat-spec-evol-scaffolding-design`, `API_PORT=8802`, `UI_PORT=5302`, `MAILDEV_UI_PORT=1102` and absence of collision with active branches in `PLAN.md`.
  - [ ] Confirm scope and guardrails above.

- [x] **Lot 1 — Reformat BR-00 archived plan file to template-strict**
  - [x] Rewrite `plan/done/00-BRANCH_chore-scaffolding-base.md` so that:
    - [x] Section `## Plan / Todo (lot-based)` uses `- [x] **Lot N — Title**` headers (no `### Lot N`).
    - [x] Every sub-step is a checkbox `[x]` (all lots are completed).
    - [x] No `###` sub-headings remain inside `## Plan / Todo`.
    - [x] `## Feedback Loop` and `## Open questions` sections preserved as-is.
  - [x] Diff review: -95 / +68 lines, zero `### Lot` markers, 9 checkbox lots — content semantically preserved.
  - [x] Lot gate:
    - [x] `make typecheck ENV=feat-spec-evol-scaffolding-design` (placeholder, passes vacuously).
    - [x] `make lint ENV=feat-spec-evol-scaffolding-design` (placeholder).
    - [x] No `make test` needed (docs-only).

- [x] **Lot 2 — Spec cross-references and status frontmatter polish**
  - [x] In `docs/spec/SPEC_INTENT_SCAFFOLDING.md`: confirmed status header — frozen by convention, no edit needed.
  - [x] In `docs/spec/SPEC_EVOL_SCAFFOLDING.md`: corrected successor reference (BR-09 → BR-12), updated author to commit identity, added "Status updates" log section, rewrote §16 as roadmap with merged/in-progress markers.
  - [x] No structural rewrite — these specs remain stable; this lot is light polish only.

- [ ] **Lot 3 — PLAN.md status update**
  - [ ] §1 Current state: BR-01 active execution.
  - [ ] §3 Branch catalog: confirm BR-01 entry accurate (description, allowed paths, dependencies).
  - [ ] §5 Scheduling: confirm BR-02 / BR-03 / BR-05 are the next parallel candidates after BR-01.

- [ ] **Lot 4 — Push, PR, merge**
  - [ ] `git push -u origin feat/spec-evol-scaffolding-design`.
  - [ ] `gh pr create` with body referencing the lots.
  - [ ] CI green (compose validation + placeholders).
  - [ ] `gh pr merge --merge` (no squash, no rebase merge).
  - [ ] Local main pulled.
  - [ ] Move `plan/01-BRANCH_feat-spec-evol-scaffolding-design.md` to `plan/done/`.

## Open questions
_None._
