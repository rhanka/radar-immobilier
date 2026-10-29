#!/usr/bin/env bash
stop_forwards() {
  local pid
  for pid in ${FORWARDS:-}; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  FORWARDS=
}
http_check() {
  local base=$1 path=$2 expected=$3 kind=$4 deadline=$5 result code type remaining
  while :; do
    remaining=$((deadline-SECONDS)); ((remaining>0)) || fail "Smoke deadline: $path"
    result=$(curl -q -sS --max-time "$remaining" --connect-timeout 3 -D "$WORK/headers" -o "$WORK/body" \
      -H "Host: ${URL#https://}" -w '%{http_code} %{content_type}' "$base$path" 2>/dev/null) || result='000 transport'
    code=${result%% *}; type=${result#* }
    if [[ $code == "$expected" ]]; then
      case $kind in
