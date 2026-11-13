# Feature: Human feedback on AI classification

## Objective
- [ ] Deliver D1–D7: durable provenance, atomic human feedback and evaluation export.

## Scope / Guardrails
- [x] Stacked on feat/refresh-single-pass; PR targets that branch; no merge.
- [x] No environment-file reads, Python, default kubeconfig or commit trailers.
- [x] Test stack test-class-feedback: API 8895, UI 5395, Maildev 1195, PostgreSQL 5595, S3 9195, Obscura 9295, SMTP 1095. ENV last; down -v after use.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/drizzle/0046*, api/drizzle/meta/_journal.json, api/src/services/graph/class-annotations*, api/src/services/graph/class-feedback*, api/src/routes/class-feedback*, api/src/app.ts, api/src/services/facets/scoped-signal-cards.ts, UI signal classification/card files, UI e2e feedback files, docs/spec/SPEC_EVOL_CLASS_FEEDBACK.md, this plan.
- [x] Forbidden: rules/**, entrypoint instructions, other branch plans, unrelated code, deployment.
- [x] Conditional: existing annotation tests and transport fixtures when additive dates require updated assertions.

## Feedback Loop
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
- [ ] Lot 4 — Unit, PostgreSQL and click E2E coverage; typecheck, lint, test-api, test-ui.
- [ ] Lot 5 — Peer review, fresh base check, push and stacked PR.
