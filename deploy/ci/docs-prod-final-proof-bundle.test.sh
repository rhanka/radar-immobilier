#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle="$root/docs/architecture/evidence/scw-final-sweep-prod-vz8kd"
receipt="$root/docs/architecture/evidence/scw-final-sweep-prod-final-parity-receipt-2026-09-14.json"
filter="$root/deploy/ci/docs-parity-receipt.jq"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$bundle" && sha256sum --strict -c SHA256SUMS)

check_receipt_hash() {
  local file="$1" proof="$2" actual recorded
  actual="$(sha256sum "$bundle/$file" | cut -d' ' -f1)"
  recorded="$(jq -r ".proofs.$proof.sha256" "$receipt")"
  test "$actual" = "$recorded"
  test "$file" = "$(jq -r ".proofs.$proof.file" "$receipt")"
}

check_receipt_hash source-final-diff.json sourceFinalDiff
check_receipt_hash target-attribute-conflicts.json targetAttributeConflicts
check_receipt_hash target-final-diff.json targetFinalDiff
check_receipt_hash summary.json summary

jq -e '(.missing | length) == 0 and (.extra | length) == 0 and
  (.sizeConflicts | length) == 0' "$bundle/source-final-diff.json" >/dev/null
jq -e 'length == 0' "$bundle/target-attribute-conflicts.json" >/dev/null
jq -e '(.missing | length) == 0 and (.extra | length) == 0 and
  (.sizeConflicts | length) == 0' "$bundle/target-final-diff.json" >/dev/null
jq -e --slurpfile summary "$bundle/summary.json" '
  (.proofs.summary | del(.file, .sha256)) == $summary[0]' "$receipt" >/dev/null
jq -e --arg path "scw-final-sweep-prod-vz8kd" '
  .capture.committedProofBundle == $path' "$receipt" >/dev/null

reference_now="$(jq -r '.completedAt | sub("\\.[0-9]+Z$"; "Z") |
  fromdateiso8601 + 1' "$bundle/summary.json")"
printf 'def now: %s;\n' "$reference_now" >"$work/historical-receipt.jq"
sed -n '1,$p' "$filter" >>"$work/historical-receipt.jq"
digest="$(jq -r '.canonicalDigest' "$bundle/summary.json")"
jq -e --arg digest "$digest" -f "$work/historical-receipt.jq" \
  "$bundle/summary.json" >/dev/null

echo 'PROD DOCS committed final proof bundle: PASS'
