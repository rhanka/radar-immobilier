#!/usr/bin/env bash
# Launch one blind review leg with codex exec (seat only, no API key), in the foreground.
# Usage: run.sh astra|sol
set -u
leg="$1"; W="$(cd "$(dirname "$0")/../../.." && pwd)"; D="$W/docs/reviews/pr-837"; cd "$W"
case "$leg" in astra) m=gpt-6-astra ;; sol) m=gpt-6.1-sol ;; *) echo "usage: $0 astra|sol" >&2; exit 2 ;; esac
env -u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u ANTHROPIC_API_KEY \
  codex exec -m "$m" -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C "$W" - \
  < "$D/prompt-$leg.md" > "$D/$leg.log" 2>&1
echo "exit=$? $leg" >> "$D/status.txt"
