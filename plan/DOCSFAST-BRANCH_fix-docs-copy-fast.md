# Feature: Fast pinned document restoration

## Objective
- [x] Apply the approved `conception-docs-fast.clean.md`: candidate-only version resolution, 16 destination shards, concurrency 48, unchanged integrity verdicts.

## Scope / Guardrails
- [x] Worktree `tmp/docs-copy-fast`, branch `fix/docs-copy-fast`, base `e2e3f0a0054d31b647160fcba137b08086d697e0`.
- [x] Make-only container execution; zero Python, no environment-file reads, no preprod/prod actions.
- [x] Test stack `ENV=test-cutover` publishes no ports; controller tests use an empty HOME; finish with `down -v`.
- [x] English repository text, French owner communication, commits without attribution trailers; no PR creation.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `deploy/ci/bascule-preprod/{backup-restore.cjs,backup.selftest.mjs,docs-restore-backup-job.tmpl.yaml}`, `tools/make/cutover-render.sh`, this plan.
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, other branch plans.
- [x] Conditional Paths: none; keep CI and backup writes unchanged.
- [x] Ignored `tmp/docs-copy-fast.mk` provides offline verification targets without including the root Makefile or any environment file.

## Feedback Loop
- [x] Root-cause evidence: global backup version listing, two sequential destination listings, and 36,282 copies with concurrency 8; approved design supplies the replacement algorithm.
- [x] No new design decisions; operational timing remains an estimate until an owner-authorized live run.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation; conductor owns PR and live operations.

## UAT Management (in orchestration context)
- [x] No UI change or UAT required; active preprod cutover remains untouched.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules and approved design; confirm clean branch and exact base.
- [x] Lot 1 — Shard destination listing with sequential fallback in restore and recon.
- [ ] Lot 2 — Classify without per-object calls; verify only candidates before copying.
  - [x] Pure classification and hashed destination size anomalies; remove global version listing.
  - [ ] Candidate verification pool with per-key unpinned resolution and run-wide HEAD fallback.
- [ ] Lot 3 — Apply concurrency/retry bounds and receipt counters; update render documentation.
- [ ] Lot 4 — Preserve existing assertions; add simulated volume, resume and integrity regressions.
- [ ] Lot 5 — Replay backup/bascule selftests, CI controller pattern with empty HOME, lint, typecheck; remove test volumes.
- [ ] Lot 6 — Review exact diff, commit atomically, push branch without force; no PR.
