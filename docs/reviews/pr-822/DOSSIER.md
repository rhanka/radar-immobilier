# Review dossier — PR #822 (sealed reference set C)

review-author:
  host: claude
  model: claude-opus-5-5
  effort: max
target-ref: feat/reference-c-sealed@c8c87912ab03e9885e88a3601081ca7b2df844f2 (diff origin/main...c8c87912ab03e9885e88a3601081ca7b2df844f2)

status: completed
round: 2
legs:
  - path: docs/reviews/pr-822/leg-astra.md
    status: completed
    verdict: GO-with-nits
  - path: docs/reviews/pr-822/leg-sol.md
    status: completed
    verdict: GO-with-nits
consensus-verdict: GO-with-nits

previous-round:
  target-ref: feat/reference-c-sealed@b9bbaee3ce9514d273408a58060b484e52638e0c
  legs: [docs/reviews/pr-822/round1-leg-astra.md (NO-GO), docs/reviews/pr-822/round1-leg-sol.md (GO-with-nits)]
  findings-status-at-c8c87912:
    F1 (blocking, exclusive output / private dir): fixed (both legs)
    F2 (non-blocking, cwd-bound .env lookup): partially fixed (both legs) — cwd and GIT_DIR/GIT_WORK_TREE cases fixed
    F3 (non-blocking, empty input exits 0): fixed (both legs)

open-nits (non-blocking, not addressed in this round):
  - astra S1: external common git dir (git init --separate-git-dir) makes dirname(--git-common-dir) select a .env outside the checkout (scripts/reference-seal.mjs:40); predates c8c87912.
  - sol N1: inherited GIT_CEILING_DIRECTORIES makes the git subprocess fail, .env fallback exits 1 (scripts/reference-seal.mjs:34); REFERENCE_C_KEY in env bypasses it.

observed-deviation: h2a_run refused with identity_pending/identity_failed (2026-10-05); legs launched with codex exec directly (seat, no API key).
