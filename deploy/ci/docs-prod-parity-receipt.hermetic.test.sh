#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
filter="$root/deploy/ci/docs-parity-receipt.jq"
digest="$(printf 'a%.0s' {1..64})"
receipt="$(jq -n --arg digest "$digest" '
  {schemaVersion:1,expected:59017,processed:59017,matching:59017,copied:0,failed:0,
   prunedExtra:0,logicalBytes:12534514457,elapsedSeconds:120,opsPerSecond:491.8,
   logicalMiBPerSecond:99.6,etaSeconds:0,canonicalDigest:$digest,
   sourceVerifiedObjects:59017,sourceVerifiedBytes:12534514457,sourceManifestDigest:$digest,
   targetVerifiedObjects:59017,targetVerifiedBytes:12534514457,
   sourceExact:true,targetExactParity:true,exactParity:true,complete:true,
   conditionalWriteProofDigest:("b" * 64),destinationIdentityFingerprint:("c" * 64),
   sourceObservedAt:((now-120)|todateiso8601),targetObservedAt:((now-60)|todateiso8601),
   completedAt:((now-30)|todateiso8601)}')"
accept() { jq -e --arg digest "$digest" -f "$filter" <<<"$1" >/dev/null; }
reject() { ! accept "$1"; }

accept "$receipt"
accept "$(jq '.sourceObservedAt |= sub("Z$"; ".123Z") |
  .targetObservedAt |= sub("Z$"; ".456Z") | .completedAt |= sub("Z$"; ".789Z")' <<<"$receipt")"
reject "$(jq '(now-60 | todateiso8601 | sub("Z$"; "")) as $second |
  .sourceObservedAt=($second+".900Z") | .targetObservedAt=($second+".100Z") |
  .completedAt=($second+".200Z")' <<<"$receipt")"
accept "$(jq '.sourceObservedAt=((now-172798)|todateiso8601|sub("Z$"; ".500Z"))' <<<"$receipt")"
reject "$(jq '.sourceObservedAt=((now-172802)|todateiso8601|sub("Z$"; ".500Z"))' <<<"$receipt")"
reject "$(jq '.sourceObservedAt=((now-172980)|todateiso8601) |
  .targetObservedAt=((now-172920)|todateiso8601) | .completedAt=((now-172830)|todateiso8601)' <<<"$receipt")"
reject "$(jq '.targetObservedAt=((.sourceObservedAt|fromdateiso8601)-1|todateiso8601)' <<<"$receipt")"
reject "$(jq '.completedAt=((now+60)|todateiso8601)' <<<"$receipt")"
reject "$(jq '.conditionalWriteProofDigest="short"' <<<"$receipt")"
reject "$(jq '.destinationIdentityFingerprint="short"' <<<"$receipt")"
reject "$(jq 'del(.schemaVersion)' <<<"$receipt")"
reject "$(jq '.matching=59016' <<<"$receipt")"
reject "$(jq '.copied=1 | .prunedExtra=1' <<<"$receipt")"
reject "$(jq '.canonicalDigest=("d"*64) | .sourceManifestDigest=("d"*64)' <<<"$receipt")"
[ "$(grep -h 'docs-parity-receipt.jq' "$root/Makefile" "$root/deploy/ci/object-storage-prod.mk" | wc -l)" -eq 4 ]
echo 'PROD DOCS parity receipt gate: PASS'
