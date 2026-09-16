---
status: incomplete
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: 7b8c1999^..3e3b8a58
legs:
  - path: docs/reviews/refresh-benchmark/v101b/review-costs/correctness.md
    status: failed
  - path: docs/reviews/refresh-benchmark/v101b/review-costs/operability.md
    status: failed
observed-failure: Both h2a_run launches were rejected because the benchmark worktree is outside the MCP startup workspace.
---

# Cost calculator consensus review

No consensus verdict. Both blind, author-complementary review launches were rejected at the h2a workspace boundary; the protocol forbids hiding failed legs behind retries.
