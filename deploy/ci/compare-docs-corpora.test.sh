#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/docs-corpora-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
hash_a="$(printf 'a%.0s' {1..64})"
hash_b="$(printf 'b%.0s' {1..64})"
hash_c="$(printf 'c%.0s' {1..64})"
hash_d="$(printf 'd%.0s' {1..64})"
hash_e="$(printf 'e%.0s' {1..64})"
hash_f="$(printf 'f%.0s' {1..64})"

jq -cn --arg h "$hash_a" '{key:"root-a",size:1,sha256:$h,etag:"pa"}' >"$tmp/prod.jsonl"
jq -cn --arg h "$hash_b" '{key:"baseline-shaset-1/a",size:2,sha256:$h,etag:"pb"}' >>"$tmp/prod.jsonl"
jq -cn --arg h "$hash_d" '{key:"raw/same",size:4,sha256:$h,etag:"pd"}' >>"$tmp/prod.jsonl"
jq -cn --arg h "$hash_e" '{key:"parsed/conflict",size:5,sha256:$h,etag:"pe"}' >>"$tmp/prod.jsonl"

jq -cn --arg h "$hash_b" '{key:"baseline-shaset-1/a",size:2,sha256:$h,etag:"qb"}' >"$tmp/preprod.jsonl"
jq -cn --arg h "$hash_d" '{key:"raw/same",size:4,sha256:$h,etag:"qd"}' >>"$tmp/preprod.jsonl"
jq -cn --arg h "$hash_f" '{key:"parsed/conflict",size:6,sha256:$h,etag:"qf"}' >>"$tmp/preprod.jsonl"
jq -cn --arg h "$hash_c" '{key:"graph/extra",size:7,sha256:$h,etag:"qc"}' >>"$tmp/preprod.jsonl"

PROD_MANIFEST="$tmp/prod.jsonl" PREPROD_MANIFEST="$tmp/preprod.jsonl" \
  OUTPUT_DIR="$tmp/out" bash "$ROOT/deploy/ci/compare-docs-corpora.sh" >/dev/null
jq -e '.canonical == "prod-scw-docs-pocs" and
  .comparison == {prodObjects:4,prodBytes:12,preprodObjects:4,preprodBytes:19} and
  .counts == {conflicting:1,"preprod-only":1,"prod-only":1,reusable:2} and
  (.objects | map(.key)) == ["baseline-shaset-1/a","graph/extra",
    "parsed/conflict","raw/same","root-a"] and
  (.objects[] | select(.key == "parsed/conflict") |
    .prod == {size:5,sha256:"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",etag:"pe"}) and
  (.aggregates.prodOnly == [{category:"root",objects:1,bytes:1}]) and
  (.aggregates.preprodOnly == [{category:"graph",objects:1,bytes:7}])' \
  "$tmp/out/corpus-diff.json" >/dev/null
[ "$(wc -l <"$tmp/out/preprod-reusable.jsonl")" -eq 2 ]
[ "$(wc -l <"$tmp/out/prod-required.jsonl")" -eq 2 ]
cmp "$tmp/prod.jsonl" "$tmp/out/canonical-prod-manifest.jsonl"
(cd "$tmp/out" && sha256sum -c SHA256SUMS >/dev/null)
echo 'PASS=1 FAIL=0'
