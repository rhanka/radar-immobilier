# Review dossier — PR #825 (graph city key (city_slug, id) + city-key repair, GH #812)

review-author:
  host: claude
  model: claude-opus-5-5
  effort: max
target-ref: fix/graph-city-key@143555c433153153f073dd3582218fb8224e62f1 (diff origin/main...143555c4)

status: completed
round: 2
legs:
  - path: docs/reviews/pr-825/leg-astra.md
    model: gpt-6-astra (xhigh), lens correctness-and-migration
    status: completed
    verdict: NO-GO
  - path: docs/reviews/pr-825/leg-sol.md
    model: gpt-6.1-sol (xhigh), lens reproduction-and-api-ui-regression
    status: completed
    verdict: GO-with-nits
consensus-verdict: NO-GO at 143555c4 (one residual blocker, fixed after the round, see below)

previous-round:
  target-ref: fix/graph-city-key@c5d6809929a69b0ec9fb1269704e521903f6cf39
  legs: [round1-leg-astra.md (NO-GO), round1-leg-sol.md (NO-GO)]
  findings-status-at-143555c4:
    A825-01 (blocking, whole-row equality anchored foreign): fixed (both legs)
    A825-02 / SOL-825-04 (content drift ignored by noop): fixed per Sol; partially fixed per Astra (ref order, null vs absent)
    A825-03 / SOL-825-01 (unreadable requested city, exit 0): fixed (both legs)
    SOL-825-02 (failed report upload, exit 0): fixed (both legs)
    SOL-825-03 (mapper RESET skipped cities without geometry): fixed (both legs)

after-round-2 (not re-reviewed; the owner's brief allows one relaunch):
  - A825-02 residual: fixed at 872ffe2b (exact projected-content comparison sameProjectedContent, array order kept; unit + integration regressions: reordered refs measured, preview unchanged, apply re-aligns refs[0], second preview no-op)
  - SOL-825-05 (non-blocking, storage-binding fixture missed the repair manifest): fixed at 872ffe2b (fixture copies it; untouched fixture asserted to pass; PASS=96)

evidence:
  - repro-red-782d20c9.log + repro-red-782d20c9.spec.ts.txt (reproduction test and its red run on origin/main 782d20c9)
  - raw codex logs (round1-*.log, astra.log, sol.log) kept outside the repository (size, environment output)
  - spec: docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md §14.5; plan: plan/812-BRANCH_fix-graph-city-key.md

observed-deviation: h2a_run unavailable (identity_timeout); legs launched with codex exec directly (seat, no API key).
