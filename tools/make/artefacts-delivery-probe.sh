#!/usr/bin/env bash
# Operator-only, fixed preprod endpoints; credentials are never printed.
set -euo pipefail
umask 077
: "${OP_AUTH_HEADER_FILE:?Protected file containing the human Authorization header}"
: "${OP_EVIDENCE_DIR:?Private directory for non-token probe evidence}"
: "${OP_CITY:?Known preprod city slug}"
: "${OP_WORKSPACE:?Authorized test workspace UUID}"
[[ $OP_CITY =~ ^[a-z0-9]+(-+[a-z0-9]+)*$ && $OP_WORKSPACE =~ ^[a-fA-F0-9-]{36}$ ]]
mkdir -p "$OP_EVIDENCE_DIR"
url=https://preprod.immo.sent-tech.ca/mcp
status=$(curl -sS -o "$OP_EVIDENCE_DIR/no-token.json" -w '%{http_code}' "$url")
[[ $status == 401 ]]
status=$(curl -sS -o "$OP_EVIDENCE_DIR/api-no-token.json" -w '%{http_code}' \
  "https://preprod.immo.sent-tech.ca/api/v1/mcp/facets/signals/search?city=$OP_CITY")
[[ $status == 401 ]]
auth=(--header "@$OP_AUTH_HEADER_FILE" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
curl -fsS "${auth[@]}" -D "$OP_EVIDENCE_DIR/initialize.headers" -o "$OP_EVIDENCE_DIR/initialize.json" \
  "$url" --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"delivery-probe","version":"1"}}}'
session=$(awk 'tolower($1)=="mcp-session-id:" {gsub("\r", "", $2); print $2}' "$OP_EVIDENCE_DIR/initialize.headers")
[[ -n $session ]]
auth+=(-H "mcp-session-id: $session" -H 'MCP-Protocol-Version: 2025-03-26')
trap 'curl -fsS "${auth[@]}" -X DELETE "$url" >/dev/null 2>&1 || true' EXIT
curl -fsS "${auth[@]}" -o /dev/null "$url" \
  --data '{"jsonrpc":"2.0","method":"notifications/initialized"}'
jq -n --arg city "$OP_CITY" \
  '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"search_signals",arguments:{city:$city}}}' \
  > "$OP_EVIDENCE_DIR/request.json"
curl -fsS "${auth[@]}" "$url" --data-binary "@$OP_EVIDENCE_DIR/request.json" \
  -o "$OP_EVIDENCE_DIR/search.json"
if [[ -n ${OP_EXPECTED_ERROR:-} ]]; then
  jq -e --arg error "$OP_EXPECTED_ERROR" \
    '.result.isError == true and ((.result.content[0].text | fromjson) |
      .error == $error and (has("signals") | not))' \
    "$OP_EVIDENCE_DIR/search.json" >/dev/null
else
  : "${OP_EXPECTED_SIGNAL:?Known signal ID required to prove real data}"
  : "${OP_API_AUTH_HEADER_FILE:?Protected delegated API header for the same human subject}"
  jq -e --arg id "$OP_EXPECTED_SIGNAL" --arg city "$OP_CITY" \
    '.result.isError != true and ((.result.content[0].text | fromjson) |
      .city == $city and (.signals | type) == "array" and
      .count == (.signals | length) and any(.signals[]; .id == $id))' \
    "$OP_EVIDENCE_DIR/search.json" >/dev/null
  # Workspace selection belongs to the facade, not the public MCP projection.
  curl -fsS --header "@$OP_API_AUTH_HEADER_FILE" -H 'accept: application/json' \
    "https://preprod.immo.sent-tech.ca/api/v1/mcp/facets/signals/search?city=$OP_CITY&limit=20" \
    -o "$OP_EVIDENCE_DIR/api-search.json"
  jq -se --arg city "$OP_CITY" --arg workspace "$OP_WORKSPACE" \
    '(.[0].result.content[0].text | fromjson) as $mcp | .[1] |
      .ok == true and .workspaceId == $workspace and .citySlug == $city and
      .signals == $mcp.signals' \
    "$OP_EVIDENCE_DIR/search.json" "$OP_EVIDENCE_DIR/api-search.json" >/dev/null
fi
echo 'PASS: preprod MCP search expectation and both unauthenticated 401 responses'
