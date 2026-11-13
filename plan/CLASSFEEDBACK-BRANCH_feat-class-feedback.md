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
- [ ] Lot 1 — Additive migration, append-only history and feedback.
- [ ] Lot 2 — Atomic authorized feedback API and scoped evaluation export.
- [ ] Lot 3 — DS feedback controls, required reclassification and dated private badge.
- [ ] Lot 4 — Unit, PostgreSQL and click E2E coverage; typecheck, lint, test-api, test-ui.
- [ ] Lot 5 — Peer review, fresh base check, push and stacked PR.
