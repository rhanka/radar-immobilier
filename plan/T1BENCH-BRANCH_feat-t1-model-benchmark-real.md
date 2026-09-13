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

- **Allowed**: `tools/refresh-benchmark/**`, `docs/reviews/refresh-benchmark/v4/**`, this plan.
- **Forbidden**: application/runtime code, `Makefile`, `rules/**`, `.track/**`, sentropic repositories, secrets.

## Plan

- [x] Lot 0 — Read rules/skills; create isolated branch and identify five frozen cases/accounts.
- [ ] Lot 1 — Commit the frozen protocol and hermetic runner tests.
- [ ] Lot 2 — Record quota/preflight, run five Luna low and five Gemini low cases once.
- [ ] Lot 3 — Score deterministic metrics and freeze an identity-blind judge bundle.
- [ ] Lot 4 — Obtain independent Sol xhigh and Astra xhigh judgments through H2A MCP.
- [ ] Lot 5 — Report reproducibility, failures, quota visibility, velocity, and model identity evidence.

## Gates

- `make test-v4 ENV=test-t1-model-benchmark`
- `make check-v4-protocol ENV=test-t1-model-benchmark`
- Selective commits of about 150 changed lines; merge commit only, never rebase/squash.
