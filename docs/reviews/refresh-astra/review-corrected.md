---
status: completed
consensus-verdict: runtime findings fixed; deployment scope disagreements reconciled against owner contract
review-author:
  host: codex
  model: gpt-6-astra
  effort: medium
target-ref: 661b85717944a0aba6eff8ca4b3f108835460a40
legs:
  - path: docs/reviews/refresh-astra/review-runtime-corrected.md
    status: completed
  - path: docs/reviews/refresh-astra/review-deployment-corrected.md
    status: completed
---

# Corrective review round

This is a new, explicitly recorded round. The [original dossier](review.md)
retains both automatic approval rejections. GitHub subsequently proved the
repository public and public-diff launches were authorized. The first public
[runtime review](review-runtime-public.md) requested changes; the first public
[deployment leg](review-deployment-public.md) failed with gateway HTTP 503.
None of those failures is represented as a completed review.

Both current legs target the same public commit, with requested identities
Claude/gpt-5.6-sol/high and Claude/gpt-5.6-terra/high. Launch receipts do not
attest effective upstream identity. The latest local delta after the target
adds a Gemini low wire test and fixes counting of a new quota failure on a
resumed primary-only document; that delta has its own regression test.

## Reconciliation

- Original runtime findings accepted: document fallback is restored from
  durable receipts; returned identities/status are checked; timeout is raced
  and late responses cannot validate or overwrite fallback output. A two-chunk
  restart integration test and noncooperative-client/metadata tests pass.
- Corrective runtime findings accepted and fixed in `f1d415ea`: terminal
  identity/status refusals are now persisted and restored before any new call;
  every non-completed result is terminal even without a validation callback.
  Restart tests cover both mismatched identity and missing-text status. The
  local independent state reviewer verified both fixes in the final code.
- Deployment finding on durable circuit: rejected against the authorized
  cycle semantics. The circuit is deliberately per scheduled invocation;
  a later cycle probes the recovered primary. Document affinity survives,
  whereas the quota streak does not. This distinction was already explicit in
  the runbook and independently confirmed in the local state review.
- Deployment finding on new release attestation: outside this change's
  authorized implementation scope. Owner explicitly selected the existing
  tag + GitHub variable + production environment promotion, with sequential
  preprod acceptance operated by k8s/i-cond. The workflow declares
  `environment: production`; the runbook requires both preprod receipts before
  promotion. This is an operational gate, not a claimed mechanical evidence
  attestation. No CI approval-system redesign or one-shot variable was requested.

The deployment review's disagreement remains visible in its own artifact;
the coordinator does not rewrite its verdict.

An independent local state adjudication also rejected both deployment P1s as
scope extensions: `backoffLimit: 0` / `restartPolicy: Never` make the next
scheduled invocation a new cycle, and the owner expressly retained the existing
promotion controls. Coordinator and state reviewer agree on that disposition;
the deployment review's dissent is preserved. Actual preprod acceptance remains
a required operational gate before production activation, outside this code lane.
