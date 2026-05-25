# Chore: Fair-benchmark absolute rule

## Objective
Promote the user's absolute principle — **no cheating vs the human** in
agent-vs-human comparisons — to a global rule in `rules/MASTER.md`.

## Scope / Guardrails
- This branch is explicitly allowed to touch `rules/MASTER.md` (its purpose).
- Make-only workflow; root reserved for UAT (`ENV=dev`, fixed ports).
- Develops in `./tmp/chore-fair-benchmark-rule`.
- All rules text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `rules/MASTER.md`, `plan/FAIRBENCH-BRANCH_chore-fair-benchmark-rule.md`, `PLAN.md`.
- **Forbidden Paths**: everything else (`Makefile`, `docker-compose*.yml`, other `rules/*`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, `api/**`, `ui/**`, `packages/**`, other `plan/*`).
- **Exception**: `FAIRBENCH-EX1` (acknowledge) — touching `rules/MASTER.md` is the purpose of this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — one rule addition.

## Plan / Todo
- [x] **Lot 1 — Add the absolute rule**
  - [x] Add "Fair Benchmarking — No Cheating vs Human (ABSOLUTE)" to `rules/MASTER.md`.
  - [x] Reference `docs/spec/SPEC_EVOL_DEMO_FINDINGS.md`.
  - [x] Lot gate: `git diff --check`.
- [ ] **Lot 2 — Merge & close**
  - [ ] Push; PR; CI green (full 40-char SHA).
  - [ ] Merge commit only; preserve branch.
  - [ ] Move this file to `plan/done/`.
</content>
