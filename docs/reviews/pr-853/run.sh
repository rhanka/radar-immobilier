#!/usr/bin/env bash
# Launch the two blind review legs with codex exec (seats only, no API key), in parallel.
ROUND="${1:?round}"; W="$(cd "$(dirname "$0")/../../.." && pwd)"; D="$W/docs/reviews/pr-853"; cd "$W"
UNSET="-u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY -u ANTHROPIC_API_KEY"
( env $UNSET codex exec -m gpt-6-astra -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C "$W" - < "$D/round${ROUND}-prompt-astra.md" > "$D/round${ROUND}-astra.log" 2>&1; echo "exit=$? astra" >> "$D/round${ROUND}-status.txt" ) &
( env $UNSET codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write --skip-git-repo-check --ephemeral -C "$W" - < "$D/round${ROUND}-prompt-sol.md" > "$D/round${ROUND}-sol.log" 2>&1; echo "exit=$? sol" >> "$D/round${ROUND}-status.txt" ) &
wait; echo done >> "$D/round${ROUND}-status.txt"
