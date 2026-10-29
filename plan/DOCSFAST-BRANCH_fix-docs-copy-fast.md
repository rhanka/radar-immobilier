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
- [x] Attention: independent consensus review remains conductor-owned; exact author model/effort metadata are unavailable for harness selection. Local review recorded in ignored `tmp/docs-copy-fast-review.md`; no consensus claimed.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation; conductor owns PR and live operations.

## UAT Management (in orchestration context)
- [x] No UI change or UAT required; active preprod cutover remains untouched.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules and approved design; confirm clean branch and exact base.
- [x] Lot 1 — Shard destination listing with sequential fallback in restore and recon.
- [x] Lot 2 — Classify without per-object calls; verify only candidates before copying.
  - [x] Pure classification and hashed destination size anomalies; remove global version listing.
  - [x] Candidate verification pool with per-key unpinned resolution and run-wide HEAD fallback.
- [x] Lot 3 — Apply concurrency/retry bounds and receipt counters; update render documentation.
- [x] Lot 4 — Preserve existing assertions; add simulated volume, resume and integrity regressions.
  - [x] Existing 165 restoration assertions pass unchanged; fake S3 supports StartAfter, per-key versions and call counters.
  - [x] Volume: 2 GET, 864 destination pages, 36,182 HEAD, 100 per-key version lists, 36,282 copies; zero global version lists or per-object calls on 231,401 up-to-date entries. Resume, missing pin and size drift pass; restoration suite 179/179.
  - [x] Shard fallback, copy retry/error counters, prefix-neighbor isolation and shared 403 capability probe pass; restoration suite 188/188.
- [x] Lot 5 — Replay backup/bascule selftests, CI controller pattern with empty HOME, lint, typecheck; remove test volumes.
  - [x] Backup 265/265; restoration 188/188; inter-tenant bascule 92/92; CI controller pattern 11/11 with initially empty HOME.
  - [x] Python guard and its 23 checks pass; lint and all workspace typechecks pass (zero errors, seven Svelte CSS warnings).
  - [x] `make -f deploy/cutover/operator.mk down ENV=test-cutover` removed both module volumes and the test network with `down -v --remove-orphans`.
- [x] Lot 6 — Review exact scoped diff and prepare atomic, attribution-free commits for the owner-authorized `git push -u origin fix/docs-copy-fast`; no PR.
- [x] Review correction 1 — Page per-key versions with both S3 markers, reject stalled or excessive pagination, retain exact-key versions only; >1,000-version and paginated-neighbor regressions reproduced the failure and pass after the fix.
- [x] Review correction 2 — Match unpinned versions by ETag, tolerate valid size drift with the existing hashed anomaly receipt and reconciliation size; reproduce the failure, verify restoration, and retain refusal before copies for differing ETags.
