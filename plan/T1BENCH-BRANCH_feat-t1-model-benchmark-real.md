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
  `docs/reviews/refresh-benchmark/v101/**`,
  `docs/reviews/refresh-benchmark/{BENCHMARK_T1,DECISION_M1}.md`, this plan.
- **Forbidden**: application/runtime code, `Makefile`, `rules/**`, `.track/**`, sentropic repositories, secrets.
- **Conditional**: conductor delivery `.remote/BENCH_MULTI_DESIGN.md`, explicitly requested by the owner.

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
- [x] Lot 21 — Freeze the v101 multi-model phase-1 design without running a campaign.
  - [x] Measure live catalogs and one 64-token ping per addressable model-effort arm.
  - [x] Freeze the 100-document corpus, v9 contract fingerprints, and common intended output cap.
  - [x] Measure strict and C-prime readings offline on the same v100 receipts.
  - [x] Specify provider lanes, retry/idempotence, costs, timing, blind judges, and launch gates.
  - [x] Gate: `make -C tools/refresh-benchmark check-v101-tools ENV=test-t1-model-benchmark`.
  - [x] Gate: zero secret signature under `docs/reviews/refresh-benchmark/v101`.
- [x] Lot 22 — Execute the owner-ratified v101 phase-2 campaign.
  - [x] Implement immutable per-attempt receipts, transport-only retry, 429 suspension, and offline scoring.
  - [x] Pass the two-document runner gate and Gemini MEDIUM/HIGH requalification.
  - [x] Exclude Codex after the 32-token cap probe demonstrated that llm-mesh 0.19.2 does not transmit the cap.
  - [x] Record judge preflight as 1/2 without repeating either generation request.
  - [x] Prepare four runnable provider lanes after the Codex exclusion and atomic global status updates.
  - [x] Launch the detached campaign and verify one receipt from each started provider lane after three minutes.

## Gates

- `make test-v4 ENV=test-t1-model-benchmark`
- `make check-v4-protocol ENV=test-t1-model-benchmark`
- Selective commits of about 150 changed lines; merge commit only, never rebase/squash.

## Feedback Loop

- `T1BENCH-EX1` — owner-requested delivery outside the worktree at
  `.lanes/conductor/.remote/BENCH_MULTI_DESIGN.md`; impact is one review-only Markdown file;
  rollback is deletion of that generated delivery. No repository source is affected.
- `deferred` — the phase-2 consensus review is incomplete: both Claude launches were refused by the
  private-repository workspace boundary. No workaround was attempted and no local Codex opinion is
  counted as consensus. The owner subsequently instructed the conductor to launch phase 2 without a
  further owner question; the failed review evidence remains recorded under `v101/review/`.
- `T1BENCH-EX2` — the execution harness reaped Unix descendants during three preliminary detached
  launch attempts while Docker continued independently. Thirteen uncertain intentions were stopped
  and closed as immutable `operator-interrupted` terminal failures with unknown request counts and no
  retry. The final launch is held by a user-systemd parent around the required secret subshell and
  `setsid`/`nohup`; campaign artifacts remain ignored and uncommitted while the run is active.
