# Review dossier — PR #841 (daily prod -> preprod restore at 04:00 UTC)

review-author:
  host: claude
  model: claude-opus-5-5
target-ref: ops/bascule-restore-daily — last reviewed head 2cbef583 (round 6, both legs)

status: completed
legs:
  - path: docs/reviews/pr-841/leg-astra.md
    prompt: docs/reviews/pr-841/prompt-astra.md
    model: gpt-6-astra (xhigh), lens runtime interaction of the 04:00 UTC restore with the cluster schedules
    rounds:
      - round 1 @c16289ad: GO-with-nits (ASTRA-841-01..04 non-blocking: delay margin, 06:00 semantics, freshness wording, ignored un-quiesce patch failures) — round1-leg-astra.md
      - round 2 @8f97478c: 01..03 fixed, 04 partial; GO-with-nits (R2-01 signal-killed patch, R2-02 YAML separator) — round2-leg-astra.md
      - round 3 @e88a2f35: all fixed; NO-GO (R3-01 signal lookup read as absent CronJob, blocking; R3-02 annotations) — round3-leg-astra.md
      - round 4 @a77307a6: R3 fixed; NO-GO (R4-01 G2 unreadable current replicas read as 0, inherited, blocking; R4-02..04) — round4-leg-astra.md
      - round 5 @5cef739f: all R4 fixed; GO-with-nits (R5-01 inherited no-SDK fixture not hermetic under a repo-local TMPDIR) — round5-leg-astra.md
      - round 6 @2cbef583: no new finding; GO-with-nits (R5-01 open, non-blocking, inherited) — leg-astra.md
    verdict: GO-with-nits
  - path: docs/reviews/pr-841/leg-sol.md
    prompt: docs/reviews/pr-841/prompt-sol.md
    model: gpt-6.1-sol (xhigh), lens test guard soundness, references and doc accuracy
    rounds:
      - round 1 @c16289ad: NO-GO (SOL-841-01 guard on source regexes, not rendered schedules, blocking; 02..04) — round1-leg-sol.md
      - round 2 @8f97478c: 02..04 fixed, 01 partial; NO-GO (R2-01 raw backup YAML separators, blocking; R2-02, R2-03) — round2-leg-sol.md
      - round 3 @e88a2f35: all fixed; NO-GO (R3-01 signal lookup read as absent CronJob, blocking) — round3-leg-sol.md
      - round 4 @a77307a6: R3 fixed; NO-GO (R4-01 G2 current replicas, inherited, blocking; R4-02..10 non-blocking caller audit) — round4-leg-sol.md
      - round 5 @5cef739f: R4 fixed (R4-07 partial); GO-with-nits (R5-01 S1 cleanup regression, R5-02 force-refresh wording) — round5-leg-sol.md
      - round 6 @2cbef583: R5 fixed; GO — leg-sol.md
    verdict: GO

consensus: GO-with-nits (no blocking finding open)

## Fixes per finding

| Finding | Fix commit |
| --- | --- |
| SOL-841-01, SOL-841-02 | b06ab25b, 9fe2298a |
| ASTRA-841-01/02/03, SOL-841-03/04 | 8f97478c |
| ASTRA-841-04 | d3eb676d |
| SOL-841-R2-01/02, ASTRA-841-R2-02 | 94b62331 |
| ASTRA-841-R2-01, SOL-841-R2-03 | e88a2f35 |
| ASTRA-841-R3-01/02, SOL-841-R3-01 | a77307a6 |
| ASTRA-841-R4-01..04, SOL-841-R4-01..10 | 5cef739f |
| SOL-841-R5-01/02 | 2cbef583 |

## Open (non-blocking)

- ASTRA-841-R5-01 — inherited: the missing-SDK fixture of `restore-mode.selftest.mjs` (lines 445-447) resolves the
  repository `node_modules/@aws-sdk/client-s3` when TMPDIR is inside the repository; CI (TMPDIR outside) passes.
  Follow-up: stub the module loader in that fixture.
