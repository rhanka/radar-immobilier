# Review dossier — PR #824 (residential tri-state in the Signals filter)

review-author:
  host: claude
  model: claude-opus-5-5
  effort: max
target-ref: fix/signal-filters-residential-unknown@1877c840bf1ecf783394d62a6ffa71765a5de02c (diff origin/main...1877c840bf1ecf783394d62a6ffa71765a5de02c)

status: completed
round: 1
legs:
  - path: docs/reviews/pr-824/leg-astra.md
    status: completed
    verdict: GO-with-nits
  - path: docs/reviews/pr-824/leg-sol.md
    status: completed
    verdict: GO-with-nits
consensus-verdict: GO-with-nits

findings-status-at-06ac9fb8:
  astra F1 (non-blocking, S3 audit counted repeated node ids): fixed — rowsFromCanonicalGraph applies mergeNodeRows; regression test added.
  astra F2 / sol F1 (non-blocking, stale comment on RESIDENTIAL_ELIGIBLE_INSTRUMENTS): fixed.
  re-verification after fixes: make typecheck exit 0, make lint exit 0, make test exit 0 (api 2132 passed / 6 skipped, ui 1639 / 10 todo, radar-domain 292, radar-sources 1293, radar-scoring 57, immo-mcp 64).

noted-by-sol (behavioural, for the owner): with Précoce checked, r only removes unknown individual authorisations whose display exclusion lets them through (e.g. a PIIA with nb_unites_max); the early-stage widening intentionally supersedes the BPCS discriminator for autre/ppcmoi/plan_urbanisme.

observed-deviation: h2a_run unavailable (identity_timeout); legs launched with codex exec directly (seat, no API key).
