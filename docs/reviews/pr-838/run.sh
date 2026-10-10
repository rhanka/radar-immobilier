#!/usr/bin/env bash
# Launch ONE blind review leg with codex exec (seats only, no API key), in the
# foreground (no `&`): run it once per leg, one after the other.
#   bash docs/reviews/pr-838/run.sh astra   # gpt-6-astra
#   bash docs/reviews/pr-838/run.sh sol     # gpt-6.1-sol
# Round 1 ran in this worktree. From round 2 on, each leg runs in its own
# detached worktree at TARGET (default: HEAD) with only ITS files copied in, so
# it cannot read the other leg of the round.
set -u
W="$(cd "$(dirname "$0")/../../.." && pwd)"; D="$W/docs/reviews/pr-838"; cd "$W"
LEG="${1:?leg: astra|sol}"; T="${TARGET:-$(git rev-parse HEAD)}"
case "$LEG" in astra) MODEL=gpt-6-astra ;; sol) MODEL=gpt-6.1-sol ;; *) echo "unknown leg $LEG" >&2; exit 2 ;; esac
R="$W/../review-838-$LEG"
git worktree add --detach "$R" "$T" >/dev/null 2>&1 || git -C "$R" checkout -q --detach "$T"
mkdir -p "$R/docs/reviews/pr-838"
cp "$D/prompt-$LEG.md" "$D/leg-$LEG.md" "$D"/round*-"$LEG".md "$R/docs/reviews/pr-838/"
env -u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u ANTHROPIC_API_KEY \
  codex exec -m "$MODEL" -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral \
  -C "$R" - < "$D/prompt-$LEG.md" > "$D/$LEG.log" 2>&1
echo "exit=$? $LEG ${ROUND:-round2}" >> "$D/status.txt"
cp "$R/docs/reviews/pr-838/leg-$LEG.md" "$D/leg-$LEG.md"
