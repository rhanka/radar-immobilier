# Feature: Classification pilot L1–L2 — Engram profile, guide G0, convergence passes

## Objective
Lots L1 and L2 of the Steve-aligned classification pilot (plan-pilote-v2 §B-L1, §B-L2): steve-classification profile on Engram 0.21.2 unchanged, guide G0, convergence of the 3 max-effort annotators on the 504 dev items.

## Scope / Guardrails
- Scope limited to `tools/classif/**`, `radar/ontology/steve-classification/**` and this branch file.
- No DB, cluster or S3 write; Engram unchanged (0.21.2); 0 Python; private outputs in `$CLASSIF_HOME`.
- Annotators and optimisers never see the sealed evaluation set; Steve's text stays private (pack in `$CLASSIF_HOME`).
- Long runs under `systemd-run --user --slice=h2a-agents.slice`, 2 concurrent calls per seat, paid calls never repeated.
- In every `make` command, `ENV=<env>` is the last argument. All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `tools/classif/**`
  - `radar/ontology/steve-classification/**`
  - `plan/CLASSIFL1L2-BRANCH_feat-classif-pilot-l1l2.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `docs/spec/reports/reference-c/**`, `docs/spec/reports/classif-eval/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `radar/ontology/ontology-profile.yaml` (not touched)
- **Exception process**:
  - Inherits BRCLASSIF-EX1/EX2/EX3 from feat/classif-pilot-l0 (host Node, Makefile include, node:24 container).

## Feedback Loop
- `attention` Engram 0.21.2 `validate-extraction` does not load registry records (CLI passes the profile only): unknown codes are rejected radar-side with the same rule.
- `attention` Machine crashes: G0 attempts killed twice, Engram deps volume emptied once; resume state and revalidation added, no paid call repeated.
- `attention` Argon seat quota denials: lots re-called after the announced reset (no paid call lost).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one builder, sequential lots.

## UAT Management (in orchestration context)
- No UI surface: no UAT.

## Plan / Todo (lot-based)
- [x] **Lot L1 — Profile and guide**
  - [x] `radar/ontology/steve-classification/` (engram.yaml, profile.yaml, registries) + codebook export checked against the migration.
  - [x] Engram validate → dataprep (504 items) → profile-prompt (`make classif-l1-profile ENV=preprod`).
  - [x] Guide G0 by one isolated Opus 5.5 max session (`make classif-l1-guide ENV=preprod`).
  - [x] L0 open points: agy prompt on stdin, per-effort vibe homes (GLM low, Mistral medium verified).
- [x] **Lot L2 — Convergence passes**
  - [x] Annotation circuit through Engram, passes, convergence, complements, amendment, resumable chain.
  - [x] Pass 1: 3 × 159 calls; stop rule met (α verdict 0.773, α code 0.754, verdict unanimity 84.7 %).
- [x] **Lot L3 — Dev reference (0 LLM call)**
  - [x] `make classif-l3-reference ENV=preprod`: model_consensus reference, dev-core 386 / dev-ambiguous 118, PV acts 105/120, ref-uses-external = 0, hashes of dev and sealed test.
  - [x] Low-Pertinent analysis (5 P / 504) with two options for the L4 dev objective.
  - [x] Fingerprint refusal audit (`make classif-l2-fingerprint-audit ENV=preprod`): bylaw-number list causes 29/30.
  - [ ] Track event before L4 (conductor, single track writer).

- [x] **Gate**
  - [x] `make classif-check ENV=test-classif` + `make classif-test ENV=test-classif` (25/25).
  - [x] Push branch (no PR).
