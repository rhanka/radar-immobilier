#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
subject="$root/deploy/ci/copy-canonical-docs.sh"
node_subject="$root/deploy/ci/copy-canonical-docs.mjs"
test_tmp="$(mktemp -d /tmp/canonical-docs-test.XXXXXX)"
trap 'rm -rf "$test_tmp"' EXIT
mkdir -p "$test_tmp/bin" "$test_tmp/report"
: >"$test_tmp/manifest.jsonl"
digest="$(sha256sum "$test_tmp/manifest.jsonl" | awk '{print $1}')"
cat >"$test_tmp/bin/aws" <<'AWS'
#!/usr/bin/env bash
touch "${AWS_CALLED:?}"
exit 99
AWS
chmod +x "$test_tmp/bin/aws"

if PATH="$test_tmp/bin:$PATH" AWS_CALLED="$test_tmp/aws-called" \
  CANONICAL_MANIFEST="$test_tmp/manifest.jsonl" CANONICAL_DIGEST="$digest" \
  REPORT_DIR="$test_tmp/report" CONDITIONAL_WRITE_PROOF="$test_tmp/proof.json" \
  SOURCE_ENDPOINT=https://source.invalid SOURCE_REGION=fr-par SOURCE_BUCKET=source \
  DESTINATION_ENDPOINT=https://destination.invalid DESTINATION_REGION=bhs \
  DESTINATION_BUCKET=destination MIGRATION_SOURCE_ACCESS_KEY_ID=source-id \
  MIGRATION_SOURCE_SECRET_ACCESS_KEY=source-secret \
  MIGRATION_DESTINATION_ACCESS_KEY_ID=destination-id \
  MIGRATION_DESTINATION_SECRET_ACCESS_KEY=destination-secret \
  bash "$subject" >"$test_tmp/stdout" 2>"$test_tmp/stderr"; then
  echo 'FAIL: invalid corpus passed the preflight' >&2
  exit 1
fi
grep -F 'canonical PROD corpus contract differs' "$test_tmp/stderr" >/dev/null
[ ! -e "$test_tmp/aws-called" ] || {
  echo 'FAIL: storage was contacted before corpus validation' >&2
  exit 1
}
grep -F -- "--if-none-match '*'" "$subject" >/dev/null
grep -F -- '--argjson size "$size"' "$subject" >/dev/null
! grep -Eq 'delete-object|delete-bucket|rm-object' "$subject"
grep -F '"$batch" -eq 32' "$subject" >/dev/null
grep -F 'IfNoneMatch: "*"' "$node_subject" >/dev/null
grep -F 'concurrency > 128' "$node_subject" >/dev/null
grep -F 'destination-conflict' "$node_subject" >/dev/null
grep -F 'diff.extra.length === 1 && allowSingleProofPrune' "$node_subject" >/dev/null
grep -F 'new DeleteObjectCommand' "$node_subject" >/dev/null
grep -F 'IfMatch: extra.etag' "$node_subject" >/dev/null
! grep -F 'DeleteBucket' "$node_subject"
echo 'canonical docs copy hermetic test: PASS'
