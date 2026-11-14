# Feature: Human feedback on AI classification

## Objective
- [x] Deliver D1–D7: durable provenance, atomic human feedback and evaluation export.

## Scope / Guardrails
- [x] PR #1104 retargeted to main; merge origin/main into feat/class-feedback only.
- [x] No environment-file reads, Python, default kubeconfig or commit trailers.
- [x] Test stack test-class-feedback: API 8895, UI 5395, Maildev 1195, PostgreSQL 5595, S3 9195, Obscura 9295, SMTP 1095. ENV last; down -v after use.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/drizzle/0047*, api/drizzle/meta/_journal.json, api/src/services/graph/class-annotations*, api/src/services/graph/class-feedback*, api/src/routes/class-feedback*, api/src/app.ts, api/src/services/facets/scoped-signal-cards.ts, UI signal classification/card files, UI e2e feedback files, docs/spec/SPEC_EVOL_CLASS_FEEDBACK.md, this plan.
- [x] Forbidden: rules/**, entrypoint instructions, other branch plans, unrelated code, deployment.
- [x] Conditional: existing annotation tests and transport fixtures when additive dates require updated assertions.

## Feedback Loop
- [x] CLASSFEEDBACK-EX5: update the purge regression for main's stored-annotation-only contract. Assert redacted provenance before purge, no fabricated annotation after purge, retained stored manual annotation, and unchanged private heads/history. Rollback: revert this test-only change.
- [x] PR #1104 main synchronization: retain stored-annotation-only projection from 8e4b8e2ba, v2 ambiguity and 0046 before 0047. Preserve feedback dates and both UI provenance tests. Do not edit 0045 or 0046.
- [x] Root cause of facets-refresh: manual facet history fabricated a public classAnnotation without a stored annotation. Keep main's guard and byte-equality regressions unchanged; do not relax the API contract. This supersedes the fixture-alignment proposal below.
- [x] PR #1104 replay correction: guard 0047 columns, tables, index, functions, triggers and archive constraint. Backfill only missing creation dates and history snapshots. Regression removes the journal row after an annotation update and asserts unchanged creation dates and history.
- [x] Replay verification: migrate-idempotence (2), artifacts-migrations (6), feedback migration (2) and UI feedback/annotation labels (11) pass. Initial expanded API run: 40 assertions pass; feedback afterAll exceeds 20 s and facets-refresh expects a response without the redacted manual classAnnotation. Owner: i-cond; acceptance: align that fixture with the public privacy projection and rerun facets-refresh. No production code or timeout changed for these observations.
- [x] PR #1104 correction: reserve feedback migration 0047, idx 46, timestamp 1793000000017 after v2's 0046 (idx 45, timestamp 1793000000016). No 0046 snapshot exists: this repository uses hand-authored migrations after snapshots 0000/0001.
- [x] Add PostgreSQL migration regressions for fresh installation, incremental upgrade preserving the previous AI annotation, and idempotent replay; assert v2's 0046 precedes 0047 when present.
- [x] Reproduce all five stale/concurrent head cases on PostgreSQL (5 failed, 8 passed before correction). Compare both selection and archive heads, including null, under the workspace lock before any transition; retain exact AI timestamp/class checks and the shared feedback/reclassification transaction.
- [x] Correction gates: typecheck (zero errors, eight Svelte warnings), lint (zero errors, one warning), 26 scoped API tests with LOT_MIGRATION_DB_TEST=1, and three real-stack feedback E2E tests pass. Disposable PostgreSQL disables fsync only for test speed. Test stacks removed with down -v; no environment files read.
- [x] Local-only integration merge 809ce68c3 combines v2 32bf89a3d with feedback 0a77245eb. Resolve journal/annotation/label conflicts by retaining both features. All 26 scoped tests pass there, including fresh installation and upgrade from v2 0046 to feedback 0047 with existing annotation retention and replay. Temporary worktree unregistered; test branch not pushed. Logs retained in tmp/feedback-{quality,api,v2-tests,e2e}.log. No PR merge or history rewrite.
- [x] D1–D7 accepted from i-cond. Shared classification capabilities remain those of the existing writers: personal selections and moderator workspace archives.
- [x] Two independent design reviews: private feedback badges must stay scoped; reuse InTx writers, never client compensation; validate stale AI provenance under lock.

## Plan / Todo (lot-based)
- [x] Lot 1 — Additive migration, append-only history and feedback.
- [x] Lot 2 — Atomic authorized feedback API and scoped evaluation export.
- [x] CLASSFEEDBACK-EX1: scoped-projection-revisions.ts carries private human badges with the coherent snapshot. Revert this enrichment to roll back.
- [x] CLASSFEEDBACK-EX2: trusted InTx writer option accepts a positive AI archive without fabricating a catalog reason. Public manual commands still require their reason. Revert option and caller together.
- [x] CLASSFEEDBACK-EX3: annotate the existing real-stack synthetic seed for true feedback clicks; retain the same signal population. Revert seed additions to roll back.
- [x] Rebased on purge guard 80249515b from feat/refresh-single-pass. The audit-retention test uses an explicit run filter.
- [x] CLASSFEEDBACK-EX4: schema.ts and scoped-transition.ts add a deferred feedback link on manual events. SQL archive constraints now accept a linked AI validation without an invented catalog reason. The FK requires that feedback to commit in the same transaction. Rollback: revert caller and keep additive columns.
- [x] Review selection failure recorded in docs/spec/reviews/CLASS_FEEDBACK_REVIEW.md: exact author metadata and h2a_run tool unavailable; no code-review consensus claimed.
- [x] PostgreSQL I/O diagnosis: pg_stat_activity showed DataFileImmediateSync; fsync disabled only in disposable test-class-feedback to remove filesystem stalls. No timeout was increased. All 25 scoped API tests pass with one worker.
- [x] Lot 3 — DS feedback controls, required reclassification and dated private badge.
- [x] Lot 4 — Typecheck and lint pass; 29 scoped API tests, 1,914 UI tests and 12 real-stack E2E tests pass. Exact timestamp and live refresh snapshot regressions are covered. Test stacks use down -v.
- [x] Lot 5 — Design peer findings reconciled; code-review selection failure recorded; refreshed base checked; PR #1104 published toward feat/refresh-single-pass. No merge. Both test projects removed with down -v.
