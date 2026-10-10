#!/usr/bin/env bash
# Launch the two blind review legs with codex exec (seats only, no API key), in parallel.
# Each leg runs in its own detached worktree at the target commit (the Sol leg swaps
# files temporarily for its red/green reproduction), with this dossier copied in.
W="$(cd "$(dirname "$0")/../../.." && pwd)"; D="$W/docs/reviews/pr-834"; cd "$W"
L="${REVIEW_LOG_DIR:-$D}"; T="${TARGET:-$(git rev-parse HEAD)}"
UNSET="-u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u ANTHROPIC_API_KEY"
leg() { # name model
  local R="$W/../review2-834-$1"
  git worktree add --detach "$R" "$T" >/dev/null 2>&1 || true
  mkdir -p "$R/docs/reviews/pr-834" && cp "$D"/prompt-*.md "$D"/round1-*.md "$D/leg-$1.md" "$R/docs/reviews/pr-834/"
  env $UNSET codex exec -m "$2" -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C "$R" - < "$D/prompt-$1.md" > "$L/$1.log" 2>&1
  echo "exit=$? $1" >> "$L/status.txt"; cp "$R/docs/reviews/pr-834/leg-$1.md" "$D/leg-$1.md"
}
leg astra gpt-6-astra & leg sol gpt-6.1-sol & wait; echo done >> "$L/status.txt"
