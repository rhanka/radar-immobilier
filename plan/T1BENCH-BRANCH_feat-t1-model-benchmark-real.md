# Feature: Real T1 model benchmark

## Objective

Compare historical Sonnet 4.6 T1 outputs with real Luna and Gemini 3.8 runs on the same five frozen PDFs.

## Scope / Guardrails

- Make-only execution in `tmp/t1-model-benchmark-real`; never use the root checkout for work.
- Use enrolled CLI accounts through llm-mesh only: no simulation and no metered API key.
- Historical Sonnet artifacts are immutable and must not be rerun.
- Freeze corpus, prompts, schemas, metrics, variants, and judge rubric before candidate calls.
- H2A judges run through MCP only. Fable 5 is not independent of Sol in the current catalog.

## Branch Scope Boundaries

- **Allowed**: `tools/refresh-benchmark/**`, `docs/reviews/refresh-benchmark/v4/**`,
  `docs/reviews/refresh-benchmark/v5/**`, `docs/reviews/refresh-benchmark/v6/**`,
  `docs/reviews/refresh-benchmark/v7/**`, `docs/reviews/refresh-benchmark/v8/**`,
  `docs/reviews/refresh-benchmark/v9/**`, `docs/reviews/refresh-benchmark/v10/**`,
  `docs/reviews/refresh-benchmark/v11/**`, `docs/reviews/refresh-benchmark/v12/**`,
  `docs/reviews/refresh-benchmark/{BENCHMARK_T1,DECISION_M1}.md`, this plan.
- **Forbidden**: application/runtime code, `Makefile`, `rules/**`, `.track/**`, sentropic repositories, secrets.

## Plan

- [x] Lot 0 — Read rules/skills; create isolated branch and identify five frozen cases/accounts.
- [x] Lot 1 — Commit the frozen protocol and hermetic runner tests.
- [x] Lot 2 — Record quota/preflight, run five Luna low and five Gemini low cases once (published llm-mesh endpoint correction and quota pending).
- [x] Lot 3 — Score deterministic metrics and freeze an identity-blind judge bundle.
- [x] Lot 4 — Obtain independent Sol xhigh and Astra xhigh judgments through H2A MCP.
- [x] Lot 5 — Report reproducibility, failures, quota visibility, velocity, and model identity evidence.
- [x] Lot 6 — Correct the Gemini endpoint diagnosis and guard it without changing historical receipts.
- [x] Lot 7 — Freeze the T1 integration inputs, adapters, Graphify version, and execution budget.
- [x] Lot 8 — Enforce one shared runner contract and transport-only retry policy for every live variant.
- [x] Lot 9 — Prepare a fail-closed release readiness gate with an empty llm-mesh anchor.
- [x] Lot 10 — Prepare gated package-endpoint preflight and integration-run entry points without live calls.
- [x] Lot 11 — Diagnose the v4 output cap with one isolated Valcourt request.
- [x] Lot 12 — Freeze and execute the compact-citation v6 campaign (stopped on measured saturation).
- [x] Lot 13 — Re-freeze at 65,536 tokens and execute the complete v7 campaign.
- [x] Lot 14 — Compare Gemini 3.8 Flash HIGH with v7 LOW at the same 65,536-token contract.
- [x] Lot 15 — Freeze the exact v7 LOW contract as the v9 replay.
- [x] Lot 16 — Execute five v9 requests without a control and reconcile the measurements.
- [x] Lot 17 — Present the M1 owner decision dossier.
- [x] Lot 18 — Freeze and execute the v10 LOW campaign against extraction contract v6.
- [x] Lot 19 — Freeze and execute the v11 LOW campaign against extraction contract v7.
- [ ] Lot 20 — Execute the owner-ratified comparable Sonnet 4.6 v12 campaign.

## Gates

- `make test-v4 ENV=test-t1-model-benchmark`
- `make check-v4-protocol ENV=test-t1-model-benchmark`
- Selective commits of about 150 changed lines; merge commit only, never rebase/squash.
