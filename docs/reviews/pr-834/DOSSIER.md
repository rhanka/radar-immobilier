# Review dossier — PR #834 (signals period presets: last week / last month, default last week; Refs #786)

review-author:
  host: claude
  model: claude-opus-5-5
target-ref: feat/period-presets-week-default@2a9f486a59ce0ffb95895e2f52f2a6c80ece359a (round 2: diff 931166e4..2a9f486a AND origin/main...2a9f486a)

status: completed
round: 2
note: PR #833 (branch fix/period-presets-week-default) was closed and reopened as #834 (evolution branch,
  feat/...). Round-1 target 70df83aa and #834's first commit 931166e4 have the same tree (message only).
legs:
  - path: docs/reviews/pr-834/leg-astra.md
    prompt: docs/reviews/pr-834/prompt-astra.md
    model: gpt-6-astra (xhigh), lens round1-fix-verification-and-url-compat
    status: completed
    verdict: GO
  - path: docs/reviews/pr-834/leg-sol.md
    prompt: docs/reviews/pr-834/prompt-sol.md
    model: gpt-6.1-sol (xhigh), lens round1-fix-verification-and-regression
    status: completed
    verdict: GO-with-nits
consensus-verdict: GO-with-nits at 2a9f486a (no blocking finding; all round-1 findings fixed per both legs)

findings-status-at-2a9f486a (both legs, explicit):
  ASTRA-833-01 (round 1, blocking, legacy subset link with explicit filter.period=6mo rewritten to 7d): fixed
    (Sol: new tests 27 passed / 2 failed against the round-1 reader, 29/29 at HEAD)
  SOL-833-01 (round 1, non-blocking, e2e-qa fixture assumed the six-month default): fixed (browser run unverified)
  SOL-833-02 (round 1, non-blocking, cohort replay window followed the moving default): fixed (pinned to explicit 6mo)

new-findings-round-2:
  - SOL-834-01 (non-blocking): scripts/cohorte-vivier-b/reproduce-cohort.ts imports modules/exports that no longer
    exist (vivier-b-display-filter.ts, filterNodesByEtapeDate); pre-existing on origin/main, not introduced by this PR,
    no effect on product filtering. Follow-up outside this PR (porting it changes the replay's undated-signal semantics).

round-1 (target 70df83aa): round1-leg-astra.md NO-GO (ASTRA-833-01), round1-leg-sol.md GO-with-nits (SOL-833-01/02);
  prompts round1-prompt-*.md. Round 1 also checked: 7d/1mo calendar math across month ends and America/Toronto DST,
  inclusive civil bounds (7d = 8 civil dates, same convention as 3/6/12 months), DS TimeRangePicker 0.35.1 integration,
  API by-city route accepting 7-day / 1-month windows, full UI suite, typecheck, lint.

not-covered: browser execution of ui/e2e-qa scripts, production data, full historical cohort replay.
evidence: raw codex logs and reviewer scratch (.review-tmp) kept outside the repository.
observed-deviation: legs launched with codex exec directly (seat, no API key), each in its own detached worktree
  (run.sh), so the Sol red/green file swap cannot affect the other leg.
