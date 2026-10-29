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
        html) [[ $type == text/html* ]] && return 0;;
        build) [[ $type == application/json* ]] && jq -e --slurpfile r "$WORK/record.json" '.sha==$r[0].release.uiServedSha' "$WORK/body" >/dev/null 2>&1 && return 0;;
        health) [[ $type == application/json* ]] && jq -e --slurpfile r "$WORK/record.json" '.db.ok==true and .objectStore.ok==true and .sha==$r[0].release.apiServedSha' "$WORK/body" >/dev/null 2>&1 && return 0;;
        bearer) grep -qi '^www-authenticate: *Bearer ' "$WORK/headers" && return 0;;
        metadata) [[ $type == application/json* ]] && jq -e --arg url "$URL/mcp" '.resource==$url' "$WORK/body" >/dev/null 2>&1 && return 0;;
        auth) return 0;;
      esac
      fail "Smoke identity/content mismatch: $path"
    fi
    case $code in 000|429|5??) sleep 1;; *) fail "Smoke authentication/status mismatch: $path ($code)";; esac
  done
}
smoke_pass() {
  local ui=$1 mcp=$2 deadline=${3:-$((SECONDS+60))}
  http_check "$ui" / 200 html "$deadline"
  http_check "$ui" /build.json 200 build "$deadline"
  http_check "$ui" /health 200 health "$deadline"
  http_check "$ui" /api/v1/workspaces 401 auth "$deadline"
  http_check "$mcp" /mcp 401 bearer "$deadline"
  http_check "$mcp" /.well-known/oauth-protected-resource/mcp 200 metadata "$deadline"
  local phase=private
  [[ $ui != "$URL" ]] || phase=public
  jq --arg phase "$phase" '.http[$phase]=[
    {path:"/",status:200},{path:"/build.json",status:200},{path:"/health",status:200},
    {path:"/api/v1/workspaces",status:401},{path:"/mcp",status:401},
    {path:"/.well-known/oauth-protected-resource/mcp",status:200}]' "$WORK/record.json" > "$WORK/next.json"
  mv "$WORK/next.json" "$WORK/record.json"; record_save
}
private_smoke() {
  local deadline=$((SECONDS+60)) ui mcp
  start_forward radar-ui :8080 "$WORK/ui-forward"
  start_forward radar-immo-mcp :8848 "$WORK/mcp-forward"
  until grep -q 'Forwarding from 127.0.0.1:' "$WORK/ui-forward" && grep -q 'Forwarding from 127.0.0.1:' "$WORK/mcp-forward"; do
    ((SECONDS<deadline)) || fail 'Private forwarding unavailable'
    sleep 1
  done
  ui=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/ui-forward" | head -1)
  mcp=$(sed -nE 's/.*127.0.0.1:([0-9]+) ->.*/\1/p' "$WORK/mcp-forward" | head -1)
  smoke_pass "http://127.0.0.1:$ui" "http://127.0.0.1:$mcp" "$deadline"
  stop_forwards
}
start_forward() {
  local parent=$$ start
  start=$(awk '{print $22}' "/proc/$parent/stat")
  (
    command kubectl --request-timeout=0 -n "$NS" port-forward --address=127.0.0.1 "service/$1" "$2" > "$3" 2>&1 &
    child=$!
    trap 'kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true' EXIT
    trap 'exit 143' TERM INT
    # A killed controller cannot run an EXIT trap: the supervisor still closes its forward.
    while kill -0 "$child" 2>/dev/null && [[ -r /proc/$parent/stat ]] \
      && [[ $(awk '{print $22}' "/proc/$parent/stat") == "$start" ]]; do command sleep 1; done
  ) &
  FORWARDS="${FORWARDS:-} $!"
}
maintenance_probe() {
  local row host path code
  code=$(curl -q -sS --max-time 3 -o /dev/null -w '%{http_code}' "$URL/" 2>/dev/null) || return 1
  [[ $code == 404 || $code == 503 ]] || return 1
  while read -r row; do
    host=$(jq -r '.host' <<< "$row"); path=$(jq -r '.path' <<< "$row")
    [[ -n $host && $host != null ]] || return 1
    code=$(curl -q -sS --max-time 3 -o /dev/null -w '%{http_code}' "https://$host$path" 2>/dev/null) || return 1
    [[ $code == 404 || $code == 503 ]] || return 1
  done < <(jq -c '.ingresses[].spec.rules[]|.host as $h|.http.paths[]|{host:$h,path:(.path//"/")}' "$WORK/record.json")
}
