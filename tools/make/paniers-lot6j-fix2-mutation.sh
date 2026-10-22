#!/usr/bin/env bash
# Second-pass review regressions run only on a disposable API copy.
set -euo pipefail
copy=/workspace/6j-fix2-copy
saved=/workspace/6j-fix2-originals
mkdir -p "$copy" "$saved"
cp -a /workspace/api "$copy/"
cp /workspace/{package.json,tsconfig.base.json} "$copy/"
ln -s /workspace/node_modules "$copy/node_modules"
ln -s /workspace/packages "$copy/packages"
cd "$copy"
mutate() {
  node --input-type=module - "$@" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, ...changes] = process.argv.slice(2);
let source = readFileSync(file, "utf8");
for (let i = 0; i < changes.length; i += 2) {
  const [before, after] = changes.slice(i, i + 2);
  if (source.split(before).length !== 2) throw new Error("Mutation anchor must occur once");
  source = source.replace(before, after);
}
writeFileSync(file, source);
JS
}
api_test() {
  local scopes=()
  read -r -a scopes <<< "$1"
  shift
  (cd api && ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "${scopes[@]}" "$@")
}
proof() {
  local name=$1 file=$2 test_file=$3 test_name=$4 status=0
  shift 4
  cp "$file" "$saved/$name"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  mutate "$file" "$@"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  cp "$saved/$name" "$file"
  cmp "$saved/$name" "$file"
  cmp "/workspace/$file" "$file"
  test "$status" -eq 1
  grep -q 'AssertionError' "/evidence/$name-failed.log"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  echo "$name: baseline PASS; mutation exit=1; restored PASS; saved cmp=0; source cmp=0" \
    | tee -a /evidence/mutation-identity.log
}
lots=api/src/services/facets/lots
proof incomplete-composite-noop "$lots/lot-apply.ts" \
  'src/services/facets/lots/lot-command-result-db.test.ts src/routes/scoped-lot-facets-db.test.ts' \
  'composite discard changes nothing|full results and exact replays' \
  'heads: [...(mainCurrent ? [mainCurrent] : []),
        ...orderedRemovals.flatMap((removal) => (removal.current ? [removal.current] : []))] };' \
  'heads: mainCurrent ? [mainCurrent] : [] };'
proof renewed-unchanged-archive "$lots/lot-apply.ts" \
  src/services/facets/lots/lot-command-result-db.test.ts \
  'unchanged archive head when only a deselection changes' \
  'if (mainNeedsWrite) {' 'if (true) {'
proof page-dependent-destination "$lots/lot-history.ts" \
  src/services/facets/lots/lot-source-navigation-db.test.ts \
  'mixed source chain ambiguous on every page size' \
  'const destination = singleDestinationTarget(chain.map((row) => row.destination));' \
  '// Mutant resolves the destination from the page below.' \
  'const page = rows.slice(0, limit);' \
  'const page = rows.slice(0, limit);
    const destination = singleDestinationTarget(page.map((row) => row.destination));'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
echo 'three second-pass proofs; all copied API/SQL sources restored: diff=0' \
  | tee -a /evidence/mutation-identity.log
rm -rf "$copy"
