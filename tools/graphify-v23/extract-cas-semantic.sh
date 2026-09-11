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
  if [ "${primary##*.}" = "pdf" ]; then
    semantic_input=$(find "$WORK_DIR/.graphify/converted/pdf" -type f -name "${sha}_*.md" -print -quit 2>/dev/null || true)
    [ -n "$semantic_input" ] || { echo "[semantic] $CITY: pdf_text_unavailable_$sha" >&2; exit 1; }
  fi
  wrapper="$WORK_DIR/findings/$sha.wrapper.json"
  success=false
  for attempt in 1 2; do
    current=$(cat "$LLM_COUNTER")
    [ "$current" -lt 500 ] || { echo "[semantic] $CITY: llm_budget_exhausted_before_501" >&2; exit 1; }
    printf '%s\n' "$((current + 1))" > "${LLM_COUNTER}.tmp"
    mv "${LLM_COUNTER}.tmp" "$LLM_COUNTER"
    if {
      cat "$EXTRACTION_PROMPT"
      printf '\nMunicipality: %s\nCAS SHA-256: %s\nCAS key: %s\n\nDOCUMENT:\n' "$CITY" "$sha" "$primary_key"
      cat "$semantic_input"
    } | timeout 240 claude -p --model claude-sonnet-4-6 --autocompact 1m \
        --no-session-persistence --disable-slash-commands --permission-mode dontAsk \
        --disallowedTools Bash Edit Write Read Glob Grep WebFetch WebSearch Agent Task \
        --output-format json --json-schema "$schema" > "$wrapper" 2>> "$LOG"; then
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
