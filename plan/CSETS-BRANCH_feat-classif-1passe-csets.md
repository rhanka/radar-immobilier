# Feature: Single-pass prompt on the C study sets

## Objective
- [ ] Measure classification-only mode B on both C halves, prompts v1 and v2, Astra low.

## Scope / Guardrails
- [x] Dedicated worktree and branch `feat/classif-1passe-csets` confirmed.
- [x] No Python, production writes, merges or commit trailers.
- [x] Owner 13/11 authorizes make to load the root environment file; never display its contents or key.
- [x] Standalone Make entry point; native orchestration follows BRCLASSIF-EX1.
- [x] Private artifacts only in `~/.local/share/radar-classif/1passe-csets`.
- [x] Source C files and refresh-single-pass code are read-only.
- [x] No stack, ports or UAT; environment `test-csets`.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `tools/classif/csets/**`, `tools/classif/csets.mk`, `docs/spec/reports/classif-csets/**`, this plan.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans, other lanes and their private outputs.
- [x] Conditional Paths: none.

## Feedback Loop
- [x] Owner 13/11 authorizes blind execution via make; no plaintext-label bypass.
- [x] Owner 13/11 authorizes publication of measurement code and aggregates; no blind per-unit data.
- [x] Owner keeps detection B unchanged; complete-pass mode A is abandoned.
- [x] Published v2 found at commit `6c7cc36c0165253c11e89f41edfe67108dbbd0f9`; hash pinned separately from v1.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, no integration or merge.

## UAT Management (in orchestration context)
- [x] Offline experiment only; no application behavior changes.

## Plan / Todo (lot-based)
- [x] Lot 0: identify series 7, reference D used by C, immutable prompt and production composition.
- [x] Lot 1: freeze protocol, capture prompts, execute tuning modes with quota guard.
- [ ] Lot 2: execute blind modes through sealed executor; publish aggregates only.
- [ ] Lot 3: verify metrics, publish report, push and open draft PR.
- [x] Tuning aggregates, matrices, baseline comparison and five-line production verdict committed locally.
- [x] Four synthetic metric/pairing tests and syntax checks pass; 242/242 native validations and exact request comparisons pass.
- [x] Pairing regression corrected offline: native stages are flat, as in bench-v11; no model rerun.
- [x] Add classification-only report generation, aggregate invariants and sealed blind-cache verification.
