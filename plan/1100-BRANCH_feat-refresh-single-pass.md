# Feature: Single-pass refresh classification

## Objective
- [x] Deliver extraction and class annotation behind REFRESH_SINGLE_PASS, preserving human decisions.

## Scope / Guardrails
- [x] No merge, no automatic schedule activation, no environment-file reads, no Python, no default kubeconfig.
- [x] Keep existing validator and citation provenance. Default flag is zero.
- [x] Test environment: test-single-pass; API 8894, UI 5394, Maildev 1194, PostgreSQL 5594, S3 9194, Obscura 9294, SMTP 1094.
- [x] Commands through make, ENV last; remove test stacks with down -v.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/src/services/graph/refresh-*, api/src/services/graph/class-annotations*, api/src/services/graph/reannotate*, api/src/scripts/refresh-pv.ts, api/src/scripts/reannotate-signals.ts, api/src/services/facets/scoped-signal-cards.ts, UI classification/card paths, deploy/k8s/refresh-cronjobs/**, deploy/k8s/34-refresh-cronjob.yaml, deploy/k8s/*reannotat*, radar/prompts/**, docs/spec/SPEC_EVOL_REFRESH_SINGLE_PASS.md.
- [x] Forbidden: rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, other branch plans, unrelated code.
- [x] Conditional: Makefile, api/Dockerfile, api/drizzle/**, API classification read paths and UI transport types.

## Feedback Loop
- [x] BR1100-EX1: Makefile change authorized by owner reannotation target; add SKIP_DOTENV to honor no .env reads. Impact: opt-in skip only. Rollback: revert target/conditional.
- [x] BR1100-EX2: additive migration plus journal and Dockerfile runtime entrypoint/assets required for deployment. Rollback: flag zero; keep additive schema.
- [x] BR1100-EX3: imported P0 prompt may exceed atomic line budget; preserve source bytes except product role naming and extraction output contract.
- [x] Design review: provenance peer identified table-level human write fencing; reannotation peer identified distinction between absent and historic manual annotations. Accepted both.
- [x] Legacy refresh contract is v10 on origin/main; preserve current validator rather than downgrading to v9.
- [x] Resume: update the secondary-read UI fixture's annotation port to preserve its no-annotation population checks.

## Orchestration Mode (AI-selected)
- [x] Mono-branch with disjoint paths: refresh wiring, annotation persistence/UI, reannotation runner.

## UAT Management (in orchestration context)
- [x] Root checkout remains untouched. Preprod activation is a separate manual pass, schedules stay suspended.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Confirm clean feat/refresh-single-pass at origin/main b7724bdd9015a4f26319897bf240baaf9ee636ae.
- [x] **Lot 1 — Prompt and extraction**
  - [x] Versioned P0 extension, pinned SHA, strict per-act class validation, flag-zero compatibility, actual model receipts; dedicated single-pass settings default to Astra low.
- [x] **Lot 2 — Annotation persistence and presentation**
  - [x] Additive schema, human precedence, API fields, UI class and badge.
- [x] **Lot 3 — Recent reannotation**
  - [x] Dry-run default, apply, stable identities, failure recovery, report, preprod make target.
- [x] **Lot 4 — Verification and delivery**
  - [x] Typecheck, lint, 150 scoped API tests, 7 PostgreSQL tests, 1,905 UI tests, 55 render checks; stack cleanup uses down -v.
  - [x] Self-inspection, push, PR #1099 to main with design, activation, rollback and risks. Independent h2a review unavailable (recorded in spec). No merge or live activation.
