#!/usr/bin/env bash
# Launch the two blind review legs with codex exec (seats only), in parallel.
W="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"; D="$W/.reviews/pr-157"; cd "$W"
UNSET="-u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u ANTHROPIC_API_KEY"
( env $UNSET codex exec -m gpt-6-astra -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C "$W" - < "$D/prompt-astra.md" > "$D/astra.log" 2>&1; echo "exit=$? astra" >> "$D/status.txt" ) &
( env $UNSET codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C "$W" - < "$D/prompt-sol.md" > "$D/sol.log" 2>&1; echo "exit=$? sol" >> "$D/status.txt" ) &
wait; echo done >> "$D/status.txt"
