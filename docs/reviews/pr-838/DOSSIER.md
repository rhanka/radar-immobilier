# Review dossier — PR #838 (on-the-hour staggered refresh hours + pending-pod watchdog)

review-author:
  host: claude
  model: claude-opus-5-5
target-ref: fix/refresh-hours — last reviewed heads: Astra b2f3c5f2 (round 3), Sol a963502d (round 2); last code commit 41185c25

status: completed
legs:
  - path: docs/reviews/pr-838/leg-astra.md
    prompt: docs/reviews/pr-838/prompt-astra.md
    model: gpt-6-astra (xhigh), lens schedules, references and render guards
    rounds:
      - round 1 @7fa9e468: NO-GO (ASTRA-838-01 selector label accepted outside the pod template; ASTRA-838-02 deadline below the 60 s script floor accepted) + 2 non-blocking — round1-leg-astra.md
      - round 2 @d1bc29bf (after the owner correction "every schedule on the hour"): all round-1 findings fixed; NO-GO on ASTRA-838-R2-01 (preprod watchdog not quiesced by the bascule, G2 refusal) + 2 non-blocking — round2-leg-astra.md
      - round 3 @b2f3c5f2: all round-2 findings fixed; GO-with-nits (ASTRA-838-R3-01 non-blocking) — leg-astra.md
    verdict: GO-with-nits
  - path: docs/reviews/pr-838/leg-sol.md
    prompt: docs/reviews/pr-838/prompt-sol.md
    model: gpt-6.1-sol (xhigh), lens watchdog runtime semantics and RBAC
    rounds:
      - round 1 @dd8df2eb: NO-GO (SOL-838-01 a pod turning Running between LIST and DELETE could still be deleted, uid-only precondition) + 3 non-blocking — round1-leg-sol.md
      - round 2 @a963502d: all round-1 findings fixed or partial (wording); GO-with-nits (SOL-838-R2-01, R2-02 non-blocking) — leg-sol.md
    verdict: GO-with-nits

consensus: GO-with-nits (no blocking finding open)

## Fixes per finding

| Finding | Fix commit |
| --- | --- |
| ASTRA-838-01, -02, -03, -04 | dd8df2eb (pod-template label scope, 60 s floor, strict cron grammar, real daily starts) |
| SOL-838-01, -02, -03, -04 | 8526387e: uid + resourceVersion preconditions, explicit delete outcome (deletionRequested / skipped), nominal-timing wording, Role verbs list/delete |
| Owner correction (preprod `0 0,6,12,18`) | bb786799 + d1bc29bf: divergence n°4 = hour list; minute and pass count shared |
| ASTRA-838-R2-01 | a963502d: `QUIESCE_CRONJOBS` (+ radar-refresh-pending-watchdog) in `.github/workflows/bascule-preprod.yml` job `bascule`, checked by verify-renders |
| ASTRA-838-R2-02, -R2-03 | a963502d: repeated hours refused, minute 0 required |
| SOL-838-R2-01, -R2-02 | b2f3c5f2: FailureTarget/Failed + scheduler-release wording; strict `deadline + period >= gap` refusal |
| ASTRA-838-R3-01 | 41185c25: quiesce list pinned to the `bascule` job env, single occurrence, 2 mutations (NOT re-reviewed by the legs; covered by verify-renders.test.sh, 28/28, and CI) |

## Process notes

- Commands: `env -u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u ANTHROPIC_API_KEY codex exec -m <model> -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C <worktree> - < prompt`, one leg at a time, no `&` (`run.sh`).
- Round 1 ran in the branch worktree, where the Sol leg could see the completed round-1 Astra file (blindness: partial for that leg). From round 2 on each leg ran in its own detached worktree (`tmp/review-838-<leg>`) with only its own files.
- Raw codex logs (`*.log`, 0.6–1.5 MB each) are kept out of the commit (local only).
- Local npm install hit `ETIMEDOUT` during the round-2 window; typecheck and lint are proven by the CI Quality gates job on each pushed head.
