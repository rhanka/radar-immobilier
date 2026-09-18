#!/usr/bin/env bash
# Render a read-only proof table from an NDJSON graph_nodes export.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "usage: $0 <export.ndjson> <id,...> [origin] [output.md]" >&2
  exit 64
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
input="$1"
output="${4:-}"
staged="$ROOT/api/src/scripts/fixtures/.prove-refresh-signals-input.ndjson"
request="$ROOT/api/src/scripts/fixtures/.prove-refresh-signals-request.json"
rendered="$ROOT/api/src/scripts/fixtures/.prove-refresh-signals-output.md"
cleanup() { rm -f "$staged" "$request" "$rendered"; }
trap cleanup EXIT
# The isolated test container mounts the repository but not arbitrary host
# paths. Stage a read-only copy, then remove all transient files on every exit.
cp "$input" "$staged"
printf '{"input":%s,"ids":%s,"origin":%s,"output":%s}\n' \
  '"/workspace/api/src/scripts/fixtures/.prove-refresh-signals-input.ndjson"' \
  "$(printf %s "$2" | jq -Rs .)" \
  "$(printf %s "${3:-https://preprod.immo.sent-tech.ca}" | jq -Rs .)" \
  '"/workspace/api/src/scripts/fixtures/.prove-refresh-signals-output.md"' >"$request"
make test-api SCOPE=src/scripts/prove-refresh-signals.test.ts ENV="${ENV:-test-signals-proof-703}"
cat "$rendered"
if [ -n "$output" ]; then cp "$rendered" "$output"; fi
