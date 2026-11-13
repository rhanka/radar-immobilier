# Feature: Measured CP+ low precision cascade
## Objective
- [x] Measure Muse Spark 1.3 low against the existing Astra medium replay, with the frozen CP filter and oracle 676.
## Scope / Guardrails
- [x] Owner-designated worktree; branch docs/benchmark-b-cp-plus-low starts from docs/benchmark-b-cp-plus while PR #1085 is open.
- [x] No environment-file reads, Python, Gemini, AGY, merge, or commit/PR trailers. Make-only execution.
- [x] One runner per output directory, concurrency eight, STOP_WEEKLY_PCT=100. Seat quota triggers waiting and retry, never a refusal.
## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: tools/bench-v11/**, docs/reports/benchmark-v12-2026-11-13.*, docs/reports/assets/2026-11/benchmark-v12-*, this plan.
- [x] Forbidden Paths: Makefile, docker-compose*.yml, rules/**, agent entry points, other plans, historical reports, Focus, decisions, xhigh arm data.
- [x] Conditional Paths: none. Preserve the 42 historical rows byte for byte.
## Feedback Loop
- [x] BRCPL-EX1: owner explicitly selects this worktree, French report additions, and commits without trailers.
- [x] BRCPL-EX2: generated score and report artifacts may exceed the atomic-line guideline to preserve complete evidence; rollback removes the low artifacts and regenerates v12.
- [x] Initial launch stopped before any reviewer call because Muse usage returned allowance=null (server_sent_no_usage). STOP_WEEKLY_PCT=100 now disables the quota guard, including unavailable counters. Default threshold behavior stays unchanged.
- [x] Completed: 100 valid reviews, no duplicate or quota event, maximum concurrency eight. Strict TP 335 / FP 389 / FN 341; 852 acts judged and 134 removed. API equivalent 0.491892352 USD/doc; seat missing source.
- [x] Surface: no tool calls; 103 model responses (three documents with a second response after reminders); 47 loaded skills. Three supported excerpts were not found and retained under the unchanged CP rules. No exclusion.
- [x] Weekly quota before missing source; first call receipt 85%, final receipt and post-run usage 86%. No new Astra call.
## Orchestration Mode (AI-selected)
- [x] Single executor. Reuse all Astra outputs; separate low output directory and lock. No application change.
## UAT Management (in orchestration context)
- [x] Static dossier only. No UAT deployment.
## Plan / Todo (lot-based)
- [x] Lot 0 — Confirm upstream PR state and parameterize runner/scorer with xhigh defaults.
- [x] Lot 1 — Complete 100 low reviews; audit CLI surface and score strict oracle 676.
- [x] Lot 2 — Add the measured row, regenerate v12 Markdown/HTML/PDF, four SVGs and SHA256SUMS. Verify 42 historical rows byte for byte, all Astra/xhigh input hashes, zero chart-label overlaps, syntax and diff checks. Focus untouched.
- [ ] Lot 3 — Commit selectively, push, open PR to main. Do not merge.
