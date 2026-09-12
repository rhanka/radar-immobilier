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
  primary="$WORK_DIR/corpus/$(basename "$primary_key")"
  semantic_input="$primary"
  pdf_read=false
  if [ "${primary##*.}" = "pdf" ]; then
    semantic_input="$WORK_DIR/parsed/$CITY/$sha.txt"
    [ -s "$semantic_input" ] || pdf_read=true
  fi

  semantic_inputs=("$semantic_input")
  semantic_bytes=0
  if [ "$pdf_read" = "false" ]; then
    semantic_bytes=$(wc -c < "$semantic_input")
  fi
  if [ "$pdf_read" = "false" ] && [ "$semantic_bytes" -gt 200000 ]; then
    chunk_dir="$WORK_DIR/parsed/$CITY/chunks"
    mkdir -p "$chunk_dir"
    find "$chunk_dir" -maxdepth 1 -type f -name "$sha.*.txt" -delete
    chunk_bytes=120000
    [ "$semantic_bytes" -le 400000 ] || chunk_bytes=30000
    split -C "$chunk_bytes" -d -a 3 --additional-suffix=.txt \
      "$semantic_input" "$chunk_dir/$sha."
    mapfile -t semantic_inputs < <(find "$chunk_dir" -maxdepth 1 -type f \
      -name "$sha.*.txt" -print | sort)
  fi

  chunk_total="${#semantic_inputs[@]}"
  chunk_index=0
  for semantic_input in "${semantic_inputs[@]}"; do
    chunk_index=$((chunk_index + 1))
    finding="$WORK_DIR/findings/$sha.$chunk_index.json"
    cache_valid=false
    if [ -s "$finding" ] && jq -e '.findings | type == "array"' "$finding" >/dev/null 2>&1; then
      if [ "$chunk_total" -eq 1 ] || jq -e --argjson index "$chunk_index" --argjson total "$chunk_total" \
        '._casChunkingVersion == 1 and .chunkIndex == $index and .chunkTotal == $total' \
        "$finding" >/dev/null 2>&1; then
        cache_valid=true
      fi
    fi
    if [ "$cache_valid" = "true" ]; then
      continue
    fi
    wrapper="$WORK_DIR/findings/$sha.$chunk_index.wrapper.json"
    success=false
    current=$(cat "$LLM_COUNTER")
    [ "$((current + 2))" -le 500 ] || { echo "[semantic] $CITY: llm_budget_reservation_exceeds_500" >&2; exit 1; }
    for attempt in 1 2; do
      current=$(cat "$LLM_COUNTER")
      printf '%s\n' "$((current + 1))" > "${LLM_COUNTER}.tmp"
      mv "${LLM_COUNTER}.tmp" "$LLM_COUNTER"
      claude_args=(-p --bare --model claude-sonnet-4-6 --effort low --autocompact 1m
        --no-session-persistence --disable-slash-commands --permission-mode dontAsk
        --output-format json --json-schema "$schema")
      if [ "$pdf_read" = "true" ]; then
        claude_args+=(--allowedTools Read --disallowedTools Bash Edit Write Glob Grep WebFetch WebSearch Agent Task)
      else
        claude_args+=(--disallowedTools Bash Edit Write Read Glob Grep WebFetch WebSearch Agent Task)
      fi
      if {
        cat "$EXTRACTION_PROMPT"
        printf '\nMunicipality: %s\nCAS SHA-256: %s\nCAS key: %s\nChunk: %s/%s\n\n' \
          "$CITY" "$sha" "$primary_key" "$chunk_index" "$chunk_total"
        if [ "$pdf_read" = "true" ]; then
          printf 'DOCUMENT: Use exactly one Read call on this local PDF, then return the structured result: %s\n' "$primary"
        else
          printf 'DOCUMENT CHUNK: Extract only evidence visible in this chunk; do not infer omitted context.\n'
          cat "$semantic_input"
        fi
      } | timeout 240 claude "${claude_args[@]}" > "$wrapper" 2>> "$LOG"; then
        finding_tmp="${finding}.tmp"
        if jq -e '.structured_output' "$wrapper" > "$finding_tmp" 2>/dev/null || \
          jq -er '.result | fromjson' "$wrapper" > "$finding_tmp" 2>/dev/null; then
          if jq -e '.findings | type == "array"' "$finding_tmp" >/dev/null 2>&1; then
            annotated="${finding_tmp}.annotated"
            jq --argjson index "$chunk_index" --argjson total "$chunk_total" \
              '. + {_casChunkingVersion:1,chunkIndex:$index,chunkTotal:$total}' \
              "$finding_tmp" > "$annotated"
            mv "$annotated" "$finding"
            rm -f "$finding_tmp"
            success=true
            break
          fi
        fi
        rm -f "$finding_tmp"
      fi
      echo "[semantic] $CITY: retry $sha chunk $chunk_index after attempt $attempt" >> "$LOG"
    done
    [ "$success" = "true" ] || { echo "[semantic] $CITY: semantic_extraction_failed_${sha}_chunk_$chunk_index" >&2; exit 1; }
  done
done < "$CITY_MANIFEST"
