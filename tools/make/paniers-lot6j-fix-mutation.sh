#!/usr/bin/env bash
# Seven review regressions: copied source, failing mutant, restored bytes.
set -euo pipefail
copy=/workspace/6j-fix-copy
saved=/workspace/6j-fix-originals
mkdir -p "$copy" "$saved"
cp -a /workspace/api "$copy/"
cp /workspace/{package.json,tsconfig.base.json} "$copy/"
ln -s /workspace/node_modules "$copy/node_modules"
ln -s /workspace/packages "$copy/packages"
cd "$copy"
mutate() {
  node --input-type=module - "$@" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, before, after] = process.argv.slice(2);
const source = readFileSync(file, "utf8");
if (source.split(before).length !== 2) throw new Error("Mutation anchor must occur once");
writeFileSync(file, source.replace(before, after));
JS
}
api_test() { (cd api && ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$@"); }
proof() {
  local name=$1 test_file=$2 test_name=$3 status=0 file before after
  shift 3
  local files=()
  api_test "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  while [[ $# -gt 0 ]]; do
    file=$1 before=$2 after=$3
    shift 3
    mkdir -p "$saved/$(dirname "$file")"
    cp "$file" "$saved/$file"
    files+=("$file")
    mutate "$file" "$before" "$after"
  done
  api_test "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  for file in "${files[@]}"; do
    cp "$saved/$file" "$file"
    cmp "$saved/$file" "$file"
    cmp "/workspace/$file" "$file"
  done
  test "$status" -eq 1
  grep -q 'AssertionError' "/evidence/$name-failed.log"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  echo "$name: baseline PASS; mutation exit=1; restored PASS; saved cmp=0; source cmp=0" \
    | tee -a /evidence/mutation-identity.log
}
lots=api/src/services/facets/lots
proof import-rights src/services/facets/lots/lot-importer-rights-db.test.ts \
  'market projection|selection projection|pipeline projection|before replaying' \
  "$lots/lot-importer.ts" \
  'await assertImportRights(tx, input.workspaceId, input.actorSub, ordered, mappingQualified);' \
  '// Mutant bypasses distinct D4 rights before writes and replay.'
proof complete-result src/services/facets/lots/lot-command-result-db.test.ts \
  'composite discard' "$lots/lot-writer.ts" \
  'heads: outcome.heads.map((event) => lotEventResponse(event)),' 'heads: [],'
proof unknown-observation src/services/facets/lots/lot-importer-db.test.ts \
  'historical unknown observation' "$lots/lot-reader.ts" \
  'if (event.importRunId !== null && event.reasonCode === LOT_IMPORT_UNKNOWN_REASON) return null;' \
  '// Mutant treats the import verification as a historical observation.'
proof source-navigation src/services/facets/lots/lot-source-navigation-db.test.ts \
  'projection to its source chain' "$lots/lot-project.ts" \
  'sourceChainId: row.chainId,' 'sourceChainId: null,'
proof duplicate-expectations src/services/facets/lots/lot-duplicate-deselect-db.test.ts \
  'stale-first' "$lots/lot-transition.ts" \
  'if (new Set(baskets).size !== baskets.length)' \
  'if (false && new Set(baskets).size !== baskets.length)'
proof unchanged-price src/services/facets/lots/lot-price-noop-db.test.ts \
  'prices spelled differently|no-ops inside batches' "$lots/lot-plan.ts" \
  'askingPrice: normalizeAskingPrice(mutation.asking_price),' 'askingPrice: mutation.asking_price,' \
  "$lots/lot-apply.ts" \
  '&& normalizePrice(event.askingPrice) === normalizePrice(desired.askingPrice)' \
  '&& (event.askingPrice ?? null) === desired.askingPrice'
proof missing-reason-http src/routes/scoped-lot-facets-db.test.ts \
  '422 for a missing discard reason' api/src/routes/scoped-lot-facets-common.ts \
  'reasonCode: lotReasonCode.optional(),' 'reasonCode: lotReasonCode,'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
echo 'seven review proofs; all copied API/SQL sources restored: diff=0' \
  | tee -a /evidence/mutation-identity.log
rm -rf "$copy"
