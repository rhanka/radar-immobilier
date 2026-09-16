#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RESULTS="$ROOT/docs/reviews/refresh-benchmark/v101b"
OUTPUT="$RESULTS/health.md"
LOCK="$RESULTS/health-monitor.lock"
ARMS="gemini-low gemini-medium gemini-high luna-low luna-medium luna-high luna-xhigh
gpt41 sonnet46-cloud-off sonnet46-cloud-low sonnet46-cloud-high
sonnet5-off sonnet5-low sonnet5-high opus5-off opus5-low opus5-high
sol-low sol-medium sol-high sol-xhigh astra-low astra-medium astra-high astra-xhigh
mistral-small4"

mkdir "$LOCK" 2>/dev/null || exit 0
printf '%s\n' "$$" > "$RESULTS/health-monitor.pid"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT TERM INT

is_codex() {
  case "$1" in luna-*|sol-*|astra-*) return 0 ;; *) return 1 ;; esac
}

receipt_stats() {
  directory="$1"
  set -- "$directory"/*.receipt.json
  if test ! -e "$1"; then
    printf '%s\n' '{"processed":0,"accepted":0,"transport":0,"json":0,"profile":0,"provenance":0,"budget":0,"lastAt":null}'
    return
  fi
  jq -s '
    (group_by(.documentId) | map(max_by(.attemptNumber))) as $receipts |
    ($receipts | map(select(.status == "completed"
      and .validation.accepted != true
      and .validation.layers.json.valid == true
      and ((.validation.layers.v9.error // "")
        | test("ungrounded|provenance|PDF excerpt"; "i"))))) as $provenance |
    {processed:($receipts | length),
     accepted:($receipts | map(select(.validation.accepted == true)) | length),
     transport:($receipts | map(select(.status == "failed"
       and (.error.httpStatus // 0) != 429
       and (.error.category // "") != "request-budget")) | length),
     json:($receipts | map(select(.status == "completed"
       and .validation.layers.json.valid != true)) | length),
     profile:($receipts | map(select(.status == "completed"
       and .validation.accepted != true
       and .validation.layers.json.valid == true
       and (((.validation.layers.v9.error // "")
         | test("ungrounded|provenance|PDF excerpt"; "i")) | not))) | length),
     provenance:($provenance | length),
     budget:($receipts | map(select(.cap.classification == "out-of-cap"
       or (.error.category // "") == "request-budget")) | length),
     lastAt:($receipts | map(.latency.completedAt // empty) | max // null)}' "$@"
}

rate_limits() {
  file="$1" arm="$2"
  if test -f "$file"; then jq -s --arg arm "$arm" 'map(select(.arm == $arm)) | length' "$file"
  else printf '0\n'; fi
}

render() {
  temporary="$OUTPUT.$$"
  now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  now_epoch=$(date +%s)
  closed=0 alerts=0 rows=""
  for arm in $ARMS; do
    if is_codex "$arm"; then
      run_root="$RESULTS/codex-replay"
      status_file="$RESULTS/codex-replay/status.json"
      limits_file="$RESULTS/codex-replay/limits/codex.jsonl"
    else
      run_root="$RESULTS"
      status_file="$RESULTS/status.json"
      case "$arm" in
        gemini-*|sonnet46-cloud-*) lane=cloud ;;
        sonnet5-*|opus5-*) lane=anthropic ;;
        gpt41) lane=openai ;;
        *) lane=mistral ;;
      esac
      limits_file="$RESULTS/limits/$lane.jsonl"
    fi
    state=$(jq -r --arg arm "$arm" '.arms[$arm].state // "queued"' "$status_file")
    stats=$(receipt_stats "$run_root/campaign/$arm")
    processed=$(printf '%s\n' "$stats" | jq -r '.processed')
    accepted=$(printf '%s\n' "$stats" | jq -r '.accepted')
    transport=$(printf '%s\n' "$stats" | jq -r '.transport')
    json=$(printf '%s\n' "$stats" | jq -r '.json')
    profile=$(printf '%s\n' "$stats" | jq -r '.profile')
    provenance=$(printf '%s\n' "$stats" | jq -r '.provenance')
    budget=$(printf '%s\n' "$stats" | jq -r '.budget')
    last_at=$(printf '%s\n' "$stats" | jq -r '.lastAt // "N-A"')
    limited=$(rate_limits "$limits_file" "$arm")
    if test "$last_at" = "N-A"; then age="N-A"; age_seconds=999999999
    else
      last_epoch=$(date -d "$last_at" +%s)
      age_seconds=$((now_epoch - last_epoch))
      age="${age_seconds}s"
    fi
    alert=""
    if test "$processed" -ge 100 || test "$state" = "completed"; then closed=$((closed + 1))
    elif test "$age_seconds" -gt 1200; then alert="STALE>20m"; alerts=$((alerts + 1))
    fi
    rows="${rows}| $arm | $state | $processed/100 | $accepted | $transport | $limited | $json | $profile | $provenance | $budget | $last_at | $age | $alert |
"
  done
  {
    printf '# v101b campaign health\n\n'
    printf 'Updated: `%s` · arms closed: `%s/26` · alerts: `%s`\n\n' "$now_iso" "$closed" "$alerts"
    printf '| Arm | State | Processed | Accepted | Transport | 429 | JSON | Profile | Provenance | Budget | Last receipt | Age | Alert |\n'
    printf '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|\n'
    printf '%s' "$rows"
    printf '\nCounts use the latest terminal receipt per document. The 429 column counts suspension events.\n'
  } > "$temporary"
  mv "$temporary" "$OUTPUT"
  test "$closed" -lt 26
}

while render; do sleep 900; done
