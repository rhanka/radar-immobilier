#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle="$root/docs/architecture/evidence/scw-final-sweep-prod-vz8kd"
receipt="$root/docs/architecture/evidence/scw-final-sweep-prod-final-parity-receipt-2026-09-14.json"
filter="$root/deploy/ci/docs-parity-receipt.jq"
official_digest="52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425"
official_receipt_sha="80d3b196af3ccf8403cfca91c6d2a7ceaae3e16b43ac004e309fba47a369c9b3"
diff_filter='type == "object" and keys == ["extra", "missing", "sizeConflicts"] and
  (.missing | type) == "array" and (.missing | length) == 0 and
  (.extra | type) == "array" and (.extra | length) == 0 and
  (.sizeConflicts | type) == "array" and (.sizeConflicts | length) == 0'
conflict_filter='type == "array" and length == 0'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$bundle" && sha256sum --strict -c SHA256SUMS)
test "$(sha256sum "$receipt" | cut -d' ' -f1)" = "$official_receipt_sha"

check_receipt_hash() {
  local file="$1" proof="$2" expected="$3" actual recorded
  actual="$(sha256sum "$bundle/$file" | cut -d' ' -f1)"
  recorded="$(jq -r ".proofs.$proof.sha256" "$receipt")"
  test "$actual" = "$expected"
  test "$actual" = "$recorded"
  test "$file" = "$(jq -r ".proofs.$proof.file" "$receipt")"
}

check_receipt_hash source-final-diff.json sourceFinalDiff \
  bbeb344f7fc0506291966c970f4efb23cf3395e2fb9d8fc2b6e8294dca9b9915
check_receipt_hash target-attribute-conflicts.json targetAttributeConflicts \
  37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570
check_receipt_hash target-final-diff.json targetFinalDiff \
  bbeb344f7fc0506291966c970f4efb23cf3395e2fb9d8fc2b6e8294dca9b9915
check_receipt_hash summary.json summary \
  0e23deaa2d7982794f33673fecf0776f25b64a22e70be6cd42d4789122d92ca6

jq -e "$diff_filter" "$bundle/source-final-diff.json" >/dev/null
jq -e "$conflict_filter" "$bundle/target-attribute-conflicts.json" >/dev/null
jq -e "$diff_filter" "$bundle/target-final-diff.json" >/dev/null
! jq -e "$diff_filter" <<<'{}' >/dev/null
! jq -e "$diff_filter" <<<'{"missing":null,"extra":[],"sizeConflicts":[]}' >/dev/null
! jq -e "$conflict_filter" <<<'{}' >/dev/null
jq -e --slurpfile summary "$bundle/summary.json" '
  (.proofs.summary | del(.file, .sha256)) == $summary[0]' "$receipt" >/dev/null
jq -e --arg path "scw-final-sweep-prod-vz8kd" '
  .environment == "prod" and
  .cluster.server == "https://hlhedx.c1.bhs5.k8s.ovh.net" and
  .cluster.namespace == "radar-immobilier" and
  .job.name == "radar-object-storage-copy-docs-prod-vz8kd" and
  .job.uid == "07d568ee-ba1c-4934-9e99-755e940e106a" and
  .job.podUid == "f62d9f2d-ba4e-4854-97e8-483d91bdd6e7" and
  .proofs.sourceFinalDiff.missing == 0 and
  .proofs.sourceFinalDiff.extra == 0 and
  .proofs.sourceFinalDiff.sizeConflicts == 0 and
  .proofs.targetAttributeConflicts.conflicts == 0 and
  .proofs.targetFinalDiff.missing == 0 and
  .proofs.targetFinalDiff.extra == 0 and
  .proofs.targetFinalDiff.sizeConflicts == 0 and
  .capture.committedProofBundle == $path' "$receipt" >/dev/null

reference_now="$(jq -r '.completedAt | sub("\\.[0-9]+Z$"; "Z") |
  fromdateiso8601 + 1' "$bundle/summary.json")"
printf 'def now: %s;\n' "$reference_now" >"$work/historical-receipt.jq"
sed -n '1,$p' "$filter" >>"$work/historical-receipt.jq"
jq -e --arg digest "$official_digest" -f "$work/historical-receipt.jq" \
  "$bundle/summary.json" >/dev/null

echo 'PROD DOCS committed final proof bundle: PASS'
