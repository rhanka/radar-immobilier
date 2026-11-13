---
status: selection-failed
target-ref: eaeab3243
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: Exact author model and effort are unavailable; no h2a_run MCP tool is exposed in this session.
---

# Feedback review record

No harness code-review consensus is claimed. The author cannot select two eligible complementary h2a legs from this session. This records the limit without substituting a claimed verdict.

Two independent design reviews covered concurrency and UI/privacy before implementation. Accepted findings: retain private scoped badges, use existing InTx writers, preserve workspace archive capabilities, reject stale AI provenance and take the facet table lock before the annotation row lock.

Self-inspection and PostgreSQL tests found the positive archive SQL constraint. Migration 0046 now adds a deferred feedback FK to the manual event. This preserves the catalog requirement for ordinary archives while allowing a positive AI validation with its original reason.

Verification covers immutable audit rows, command replay, stale versions, workspace rights, rollback after event insertion, shared archive validation and audit retention after a filtered AI purge. This evidence is separate from independent code-review consensus.
