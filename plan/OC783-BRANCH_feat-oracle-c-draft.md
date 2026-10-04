# Feature: Draft targeting oracle C from Steve's triage (files only)

## Objective
- [ ] Build a draft targeting oracle (C) from Steve's 21 Sept 2026 triage, with a frozen optim/blind split, a first C prompt iterated on optim only, a three-model low-effort alignment measure, an extension plan and an adversarial review (Refs #797, #783).

## Scope / Guardrails
- [ ] Files only: no DB, cluster, bucket or prod write; prod access limited to one read-only SELECT on graph_nodes (session forced read-only).
- [ ] 0 Python; Node ESM scripts with zero dependencies.
- [ ] Seats only for models (codex, agy, claude CLIs); every API key env var unset at spawn.
- [ ] Blind set never read nor scored before the final prompt is frozen; scored once.
- [ ] No AI attribution in commits or PR.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/reviews/oracle-c-draft/**`
  - `plan/OC783-BRANCH_feat-oracle-c-draft.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans; the decision dossier (`docs/spec/reports/dossier-retours-steve/**`)
- **Conditional Paths**:
  - `.github/workflows/**`

## Feedback Loop
- [ ] attention: the repository is public; frozen sets carry Steve's per-line codes and verbatim public PV excerpts (D6 still open).

## Orchestration Mode (AI-selected)
- [x] Single branch, single PR; two independent reviewers (Astra max, Opus 5.5 max).

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Sources and inputs**
  - [ ] Extract Triage labels from the workbook (sha256 checked).
  - [ ] Resolve radar records read-only; list excluded lines.
- [ ] **Lot 1 — Split before analysis**
  - [ ] Stratified 50/50 split by municipality; balance report; freeze sha256.
- [ ] **Lot 2 — Prompt C on optim**
  - [ ] Prompt v1, runs with three models, metrics, iterations on optim only.
- [ ] **Lot 3 — Final blind measure**
  - [ ] Freeze final prompt; single blind run per model; results.
- [ ] **Lot 4 — Extension plan, review, French section**
  - [ ] Extension plan; Astra max + Opus 5.5 max review; reconciliation; dossier section in French.
  - [ ] Lot gate: `node docs/reviews/oracle-c-draft/scripts/selftest.mjs`; CI green.
