# Feature: Restore the 42-row v12 benchmark report
## Objective
- [x] Exclude CP+ xhigh, CP+ low and their Astra replay from v12 by owner decision of 2026-11-13.
## Scope / Guardrails
- [x] Branch docs/benchmark-v12-drop-cp-plus starts at origin/main in tmp/v12-drop-cpplus.
- [x] No model calls, Python, environment-file reads, merge, or commit/PR trailers.
- [x] Make-only execution; ENV=test-v12-drop-cpplus last. No service stack or UAT ports used.
## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: tools/bench-v11/build-v11-report.mjs, tools/bench-v11/charts-v12.mjs, tools/bench-v11/README.md, tools/bench-v11/SHA256SUMS, docs/reports/benchmark-v12-2026-11-13.*, docs/reports/assets/2026-11/benchmark-v12-*.svg, this plan.
- [x] Forbidden Paths: Makefile, docker-compose*.yml, rules/**, agent entry points, other plans, historical reports, raw data, CP+ runners and scores.
- [x] Conditional Paths: none.
## Feedback Loop
- [x] BRV12DROP-EX1: owner requests French text and no trailers; retain all raw evidence and unrelated corrections.
- [x] BRV12DROP-EX2: generated report artifacts may exceed 150 lines per commit; keep complete synchronized outputs. Rollback restores the artifacts and generator from the parent.
- [x] The root Makefile includes .env. Use the standalone report target and a temporary Make target running the repository ESLint command in an isolated container without environment files.
- [x] Owner prohibition on model calls overrides peer-model review. Manually inspect the diff and four rendered charts instead.
## Orchestration Mode (AI-selected)
- [x] Single executor under i-cond. No model calls or delegated work.
## UAT Management (in orchestration context)
- [x] Static report only. Root checkout and running services untouched.
## Plan / Todo (lot-based)
- [x] Lot 0 — Confirm clean branch, origin/main base and PR #1083 reference.
- [x] Lot 1 — Disconnect CP+ scores from report generation and chart labels; document owner decision.
- [x] Lot 2 — Regenerate Markdown, HTML, PDF and four SVGs with BENCH_REPORT=v12; preserve corrected hypothesis A.
- [x] Lot 3 — Verify 42 rows against #1083, absent excluded terms, checksums, chart overlaps and repository lint.
- [x] Validation: 42 identical rows in Markdown/HTML; complete Markdown equals #1083 plus the three hypothesis A wording corrections. Excluded terms absent from Markdown, HTML, extracted PDF text and four SVGs. All 63 checksums pass. No chart label overlaps; rendered charts reviewed.
- [x] Repository ESLint passes in a network-isolated Node 24 container with read-only CI dependencies: zero errors, one unused-disable warning in api/tests/filtrage-golden-parity.spec.ts:64. No repository configuration changed.
- [x] Lot 4 — Prepare synchronized report artifacts and checksums for the final commit; hand off through a PR to main without merging.
