# Review dossier — PR #825 (graph city key (city_slug, id) + city-key repair, GH #812)

review-author:
  host: claude
  model: claude-opus-5-5
  effort: max
target-ref: fix/graph-city-key@c4b32d24fcb5a50962940c89a006cf9193456708 (diff 143555c4..c4b32d24 AND origin/main...c4b32d24)

status: completed
round: 3
legs:
  - path: docs/reviews/pr-825/leg-astra.md
    prompt: docs/reviews/pr-825/prompt-astra.md
    model: gpt-6-astra (xhigh), lens residual-fix-and-migration-replay
    status: completed
    verdict: GO-with-nits
  - path: docs/reviews/pr-825/leg-sol.md
    prompt: docs/reviews/pr-825/prompt-sol.md
    model: gpt-6.1-sol (xhigh), lens reproduction-and-api-ui-regression-since-round-2
    status: completed
    verdict: GO
consensus-verdict: GO-with-nits at c4b32d24 (no blocking finding; all round-1 and round-2 findings fixed per both legs)

findings-status-at-c4b32d24 (both legs, explicit, one by one):
  A825-01 (round 1, blocking, whole-row equality anchored foreign): fixed
  A825-02 / SOL-825-04 (round 1, blocking, content drift ignored by noop): fixed
  A825-03 / SOL-825-01 (round 1, blocking, unreadable requested city, exit 0): fixed
  SOL-825-02 (round 1, blocking, failed report upload, exit 0): fixed
  SOL-825-03 (round 1, blocking, mapper RESET skipped cities without geometry): fixed
  A825-02 residual (round 2, blocking, ref order / null / empty containers invisible to drift): fixed at 872ffe2b
    (Sol: the round-2 regression fails against the 143555c4 repair module, "expected +0 to be 1", and passes at c4b32d24;
     Astra: exact comparison converges after real JSONB round trips, second preview no-op)
  SOL-825-05 (round 2, non-blocking, storage-binding fixture missed the repair manifest): fixed (PASS=43, untouched fixture accepted)

new-findings-round-3:
  - ASTRA-825-R3-01 (non-blocking): offline recette comparators scripts/recette/diff-snap.py:26 and dump-parity.py:32
    (pre-existing on main, not touched by the PR) key rows by id alone, so two cities sharing an id collapse in the
    offline comparison. Not a regression of 872ffe2b; does not affect the repair measurement nor the migration.
    Follow-up outside this PR.

migration-0013 (Astra audit):
  - prod-shaped fixture (shared ids, one-endpoint edges, cross-city edges, 0 NULL-city): 0 row and 0 payload lost;
    replay after journal drift passes; postcheck fault injection rolls back data, DDL and journal of all pending migrations (0012+0013).
  - deletion predicates exist by design (Q1/K2, Q4/K4): NULL-city nodes, their edges, edges with no endpoint. Prod facts give 0 such rows;
    for any such row, recoverability from S3 is unknown (the migration does not consult S3). Postcheck catches net row loss, not same-count rewrites.

not-covered (both legs): real S3 read/upload, deployed workflow execution, production repair, browser E2E, production latency.

previous-rounds:
  round 2: target 143555c4, round2-leg-astra.md (NO-GO, A825-02 residual), round2-leg-sol.md (GO-with-nits, SOL-825-05); prompts round2-prompt-*.md
  round 1: target c5d68099, round1-leg-astra.md (NO-GO), round1-leg-sol.md (NO-GO)

evidence:
  - repro-red-782d20c9.log + repro-red-782d20c9.spec.ts.txt (reproduction test and its red run on origin/main 782d20c9)
  - raw codex logs (round1-*.log, round 2 and round 3 astra.log/sol.log) and reviewer scratch (.review-tmp) kept outside the repository (size, environment output)
  - spec: docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md §14.5; plan: plan/812-BRANCH_fix-graph-city-key.md

observed-deviation: h2a_run unavailable; legs launched with codex exec directly (seat, no API key), run.sh unchanged.
