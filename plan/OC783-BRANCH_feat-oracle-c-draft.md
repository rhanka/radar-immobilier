# Feature: Draft targeting oracle C from Steve's triage (files only)

## Objective
- [x] Build the measurement frame of a targeting oracle (C) from Steve's 21 Sept 2026 triage: frozen and sealed split, test-set protocol, baseline of today's filters, author sandbox, extension plan, adversarial review (Refs #797, #783).

## Scope / Guardrails
- [x] Files only: no DB, cluster, bucket or prod write; prod access limited to one read-only SELECT on graph_nodes (session forced read-only).
- [x] 0 Python; Node ESM scripts with zero dependencies.
- [x] Seats only for models (codex, agy, claude CLIs); API key env vars removed at spawn.
- [x] Blind set never read nor scored before the final prompt was frozen; scored once.
- [x] No AI attribution in commits or PR.

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
- [x] attention: the repository is public; the frozen sets (Steve per-line codes + prod-read PV excerpts) stay local and out of version control, their commit was refused by the permission layer; owner decision (D6).
- [x] attention: Astra max REJECT, Opus 5.5 max ACCEPT WITH CHANGES; draft re-labelled exploratory pilot; reconciliation in review.md.

## Orchestration Mode (AI-selected)
- [x] Single branch, single PR; two independent reviewers (Astra max, Opus 5.5 max).

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Sources and inputs**
  - [x] Extract Triage labels from the workbook (sha256 checked).
  - [x] Resolve radar records read-only; list excluded lines.
- [x] **Lot 1 — Split before analysis**
  - [x] Stratified 50/50 split by municipality; balance report; sha256 recorded.
- [x] **Lot 2 — Baseline and protocol**
  - [x] Precision / recall of today's B filters on the same lines; earlier prompts discarded (owner decision).
- [x] **Lot 3 — Sealed test set and author sandbox**
  - [x] Test set sealed outside the repo; run guards and audit log; author sandbox prepared; tag schema with derived verdict.
- [x] **Lot 4 — Extension plan, review, French section**
  - [x] Extension plan; Astra max + Opus 5.5 max review (retained scope); dossier section in French.
- [ ] **Lot 5 — C v1 by a new author (not this branch's preparer)**
  - [ ] Prompt from the author sandbox only; single test run by the executor.
  - [x] Lot gate: `node docs/reviews/oracle-c-draft/scripts/selftest.mjs`; CI green.
