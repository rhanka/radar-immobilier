#!/usr/bin/env bash
# Audit only the owner-requested 509e664d -> migration-order delivery.
set -euo pipefail
BASE=509e664d422cba43bd9d27f9488afe6ad7eba9b9
ROOT=$(pwd -P)
[[ $ENV == test-api-paniers-pwa && $API_PORT == 18933 && $UI_PORT == 15933 && $MAILDEV_UI_PORT == 11933 ]]
[[ $(git branch --show-current) == feat/api-paniers-pwa ]]
git diff --quiet
git diff --cached --quiet
[[ -z $(git ls-files --others --exclude-standard --exclude=RAPPORT-SOL-PWA.md --exclude=RAPPORT-MUSE-PWA.md) ]]
git merge-base --is-ancestor "$BASE" HEAD
evidence=$(cat tmp/pwa-evidence/latest-sequence)
[[ $(cat "$evidence/mode.txt") == sequence && $(cat "$evidence/status") == 0 && -f $evidence/result ]]
[[ $(cat "$evidence/sequence-static-result") == 'PASS migration and static gates' ]]
sha256sum --check --quiet "$evidence/files.sha256"
jq -e '.success and .numFailedTests == 0 and .numPendingTests == 0 and .numPassedTests > 0' "$evidence/scoped-tests.json" >/dev/null
source tools/make/base-api-guards.sh
SCOPE=$(git ls-files --cached --others --exclude-standard -- 'api/src/artifacts/write-*.test.ts' \
  'api/tests/integration/pw-write-authority*.spec.ts' api/tests/integration/pw-write-createapp.spec.ts \
  'api/src/services/facets/pw-write-*.test.ts' | sed 's#^api/##')
assert_tests_ran "$evidence/scoped-tests.tsv"
case $(cat "$evidence/ci-requested.txt") in
  1) jq -e '.success and .numFailedTests == 0 and .numPassedTests > 0' "$evidence/ci-tests.json" >/dev/null;;
  0) [[ ! -f $evidence/ci-tests.json ]];;
  *) exit 2;;
esac
count=$(jq '.entries | length' api/drizzle/meta/_journal.json)
grep -Fx "CT8 PASS fresh + rerun: $count hashes exactly once" "$evidence/ct8.log" >/dev/null
grep -Fx "CT8 PASS upgrade + rerun: $count hashes exactly once" "$evidence/ct8.log" >/dev/null
mapfile -t merges < <(git rev-list --first-parent --merges "$BASE..HEAD")
[[ ${#merges[@]} == 1 ]]
merge=${merges[0]}
[[ $(git rev-parse "$merge^1") == "$BASE" ]]
main=$(git rev-parse "$merge^2")
[[ $main == $(cat tmp/pwa-evidence/migration-order/main.txt) ]]
for file in api/drizzle/0025_artifacts_actor_quotas.sql api/drizzle/0026_artifacts_reader_tickets.sql; do
  [[ $(git rev-parse "HEAD:$file") == $(git rev-parse "$main:$file") ]]
done
git diff --exit-code "$main" HEAD -- .track
diff -u <(git show "$main:api/drizzle/meta/_journal.json" | jq -S .) \
  <(jq -S '.entries |= .[:-1]' api/drizzle/meta/_journal.json)
jq -e '.entries as $e | $e[-1].tag == "0027_pw_write_persistence" and $e[-1].idx == ($e|length)-1 and $e[-1].when > ([$e[:-1][].when]|max)' api/drizzle/meta/_journal.json >/dev/null
[[ ! -e api/drizzle/0025_pw_write_persistence.sql ]]
[[ $(git rev-parse HEAD:api/drizzle/0027_pw_write_persistence.sql) == \
   $(git rev-parse "$BASE:api/drizzle/0025_pw_write_persistence.sql") ]]
for commit in $(git rev-list --reverse --first-parent "$BASE..HEAD"); do
  subject=$(git show -s --format=%s "$commit")
  [[ $(git show -s --format=%B "$commit") == "$subject" && ${#subject} -le 72 ]]
  [[ $subject =~ ^(feat|fix|test|docs|chore)\(pw-a\):\  ]]
  if [[ $commit != "$merge" ]]; then
    git show --format= --numstat "$commit" | awk '{n+=$1+$2; f++} END {exit !(n<=150 && f<=15)}'
  fi
done
head=$(git rev-parse HEAD)
tree=$(git rev-parse 'HEAD^{tree}')
out=$ROOT/tmp/pwa-evidence/api-paniers-pwa-migration-0027.bundle
git bundle create "$out" "$BASE..HEAD"
git bundle verify "$out"
audit=$(mktemp -d "$ROOT/tmp/pwa-evidence/sequence-audit.XXXXXX")
audit_git() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "$audit" "$@"; }
audit_git init --bare -q
audit_git fetch --no-tags --no-write-fetch-head "$ROOT/tmp/pwa-evidence/rescue.git" "$BASE:refs/heads/base"
if audit_git cat-file -e "$head^{commit}" 2>/dev/null; then echo 'Payload present before import' >&2; exit 2; fi
audit_git bundle verify "$out"
audit_git fetch --no-tags --no-write-fetch-head "$out" HEAD:refs/heads/payload
audit_git symbolic-ref HEAD refs/heads/payload
[[ $(audit_git rev-parse HEAD) == "$head" && $(audit_git rev-parse 'HEAD^{tree}') == "$tree" ]]
audit_git merge-base --is-ancestor "$BASE" payload
audit_git merge-base --is-ancestor "$main" payload
audit_git fsck --full --no-reflogs
sha256sum "$out" | tee tmp/pwa-evidence/bundle-sequence.sha256
printf 'BASE=%s\nHEAD=%s\nTREE=%s\nMAIN=%s\nMERGE=%s\nAUDIT=%s\nEVIDENCE=%s\n' \
  "$BASE" "$head" "$tree" "$main" "$merge" "$audit" "$evidence" | tee tmp/pwa-evidence/delivery-sequence.txt
