#!/usr/bin/env bash
# Run counted, structured semantic extraction for one city's downloaded CAS corpus.
# Usage: extract-cas-semantic.sh <city> <city_manifest> <work_dir> <counter> <schema> <prompt>
set -euo pipefail

CITY="${1:?city required}"
CITY_MANIFEST="${2:?city manifest required}"
WORK_DIR="${3:?work directory required}"
LLM_COUNTER="${4:?LLM counter required}"
FINDINGS_SCHEMA="${5:?findings schema required}"
EXTRACTION_PROMPT="${6:?extraction prompt required}"
LOG="$WORK_DIR/worker.log"
schema=$(jq -c . "$FINDINGS_SCHEMA")

while IFS=$'\t' read -r source_id city sha primary_key sidecar_key; do
  [ "$source_id" = "source_id" ] && continue
  finding="$WORK_DIR/findings/$sha.1.json"
  if [ -s "$finding" ] && jq -e '.findings | type == "array"' "$finding" >/dev/null 2>&1; then
    continue
  fi
  primary="$WORK_DIR/corpus/$(basename "$primary_key")"
  semantic_input="$primary"
  pdf_read=false
  if [ "${primary##*.}" = "pdf" ]; then
    semantic_input="$WORK_DIR/parsed/$CITY/$sha.txt"
    [ -s "$semantic_input" ] || pdf_read=true
  fi
  wrapper="$WORK_DIR/findings/$sha.wrapper.json"
  success=false
  for attempt in 1 2; do
    current=$(cat "$LLM_COUNTER")
    [ "$current" -lt 500 ] || { echo "[semantic] $CITY: llm_budget_exhausted_before_501" >&2; exit 1; }
    printf '%s\n' "$((current + 1))" > "${LLM_COUNTER}.tmp"
    mv "${LLM_COUNTER}.tmp" "$LLM_COUNTER"
    claude_args=(-p --bare --model claude-sonnet-4-6 --autocompact 1m
      --no-session-persistence --disable-slash-commands --permission-mode dontAsk
      --output-format json --json-schema "$schema")
    if [ "$pdf_read" = "true" ]; then
      claude_args+=(--allowedTools Read --disallowedTools Bash Edit Write Glob Grep WebFetch WebSearch Agent Task)
    else
      claude_args+=(--disallowedTools Bash Edit Write Read Glob Grep WebFetch WebSearch Agent Task)
    fi
    if {
      cat "$EXTRACTION_PROMPT"
      printf '\nMunicipality: %s\nCAS SHA-256: %s\nCAS key: %s\n\n' "$CITY" "$sha" "$primary_key"
      if [ "$pdf_read" = "true" ]; then
        printf 'DOCUMENT: Use exactly one Read call on this local PDF, then return the structured result: %s\n' "$primary"
      else
        printf 'DOCUMENT:\n'
        cat "$semantic_input"
      fi
    } | timeout 240 claude "${claude_args[@]}" > "$wrapper" 2>> "$LOG"; then
      finding_tmp="${finding}.tmp"
      if jq -e '.structured_output' "$wrapper" > "$finding_tmp" 2>/dev/null || \
         jq -er '.result | fromjson' "$wrapper" > "$finding_tmp" 2>/dev/null; then
        if jq -e '.findings | type == "array"' "$finding_tmp" >/dev/null 2>&1; then
          mv "$finding_tmp" "$finding"
          success=true
          break
        fi
      fi
      rm -f "$finding_tmp"
    fi
    echo "[semantic] $CITY: retry $sha after attempt $attempt" >> "$LOG"
  done
  [ "$success" = "true" ] || { echo "[semantic] $CITY: semantic_extraction_failed_$sha" >&2; exit 1; }
done < "$CITY_MANIFEST"
