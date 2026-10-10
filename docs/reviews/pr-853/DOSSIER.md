# Review dossier — PR #853 (projection declared changes, GH #817 D7 brigham)

review-author:
  host: claude
  model: claude-opus-5-5
target-ref: feat/projection-intended-removals@3fcdcec0deabc5042b416ca4d3da086b8b0abd0f

status: completed
rounds: 4 (blind per round, codex exec seats, xhigh, no API key; run.sh)
legs:
  - model: gpt-6.1-sol, lens guard-correctness-and-bypass
    round1 (6b8e2c49): NO-GO — SOL-853-01 blocking
    round2 (2815df82): GO
    round3 (4c2e5847): GO-with-nits — SOL-853-R3-01 non-blocking
    round4 (3fcdcec0): GO
  - model: gpt-6-astra, lens operational-path-input-validation-runbook
    round1 (6b8e2c49): GO-with-nits — ASTRA-853-01/02/03 non-blocking
    round2 (2815df82): GO-with-nits — ASTRA-853-R2-01 non-blocking
    round3 (4c2e5847): GO
    round4: not run (delta 4c2e5847..3fcdcec0 is test-only)
consensus-verdict: GO (Sol GO at 3fcdcec0, Astra GO at 4c2e5847 + test-only delta)

findings:
  SOL-853-01 (blocking): declared mode accepted baselineExcludeIds → undeclared kept-node loss committed. Fixed cfea77fa (throws before the lock; DB test (j)).
  ASTRA-853-01: locale-dependent shell validation, multi-line cities. Fixed (LC_ALL=C, single-line, tests).
  ASTRA-853-02: repair preview called read-only (writes the S3 diagnostic report). Fixed (spec wording).
  ASTRA-853-03: before-rows logging order, no pre-apply capture, incomplete restore. Fixed (spec §17.2, step 3b, restore text).
  ASTRA-853-R2-01: termination summary bounded in characters. Fixed (UTF-8 byte bound, projection-termination.ts).
  SOL-853-R3-01: fallback test did not reach the fallback. Fixed (test).
unverified / not covered (all legs): deployed execution, current remote graph state, rehearsed restore.
