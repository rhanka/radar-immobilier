#!/usr/bin/env bash
# Run only in the disposable Make container; mutate a separate source tree.
set -euo pipefail
copy=/workspace/astra-copy
mkdir -p "$copy" /workspace/astra-originals
cp -a /workspace/api /workspace/ui "$copy/"
cp /workspace/{package.json,tsconfig.base.json} "$copy/"
ln -s /workspace/node_modules "$copy/node_modules"
ln -s /workspace/packages "$copy/packages"
cd "$copy"
cat > ui/vitest.isolated.config.ts <<'CONFIG'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
identity=/evidence/astra-mutation-identity.log
: > "$identity"
mutate() {
  node --input-type=module - "$@" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, before, after] = process.argv.slice(2);
const source = readFileSync(file, "utf8");
if (source.split(before).length !== 2) throw new Error("Mutation anchor must occur once");
writeFileSync(file, source.replace(before, after));
JS
}
proof() {
  local name=$1 file=$2 before=$3 after=$4 signature=$5 status=0
  shift 5
  cp "$file" "/workspace/astra-originals/$name"
  "$@" > "/evidence/astra-$name-baseline.log" 2>&1
  mutate "$file" "$before" "$after"
  "$@" > "/evidence/astra-$name-failed.log" 2>&1 || status=$?
  test "$status" -eq 1
  grep -q "$signature" "/evidence/astra-$name-failed.log"
  cp "/workspace/astra-originals/$name" "$file"
  cmp "/workspace/astra-originals/$name" "$file"
  cmp "/workspace/$file" "$file"
  "$@" > "/evidence/astra-$name-restored.log" 2>&1
  echo "$name: baseline PASS; mutation exit=1 ($signature); restored PASS; saved cmp=0; source cmp=0" | tee -a "$identity"
}
api_test() { (cd api && ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$@"); }
ui_test() { npm run test --workspace=ui -- --config vitest.isolated.config.ts "$@"; }
annotation=': ReturnType<typeof describe.skipIf>'
for fixture in facets/scope-db-fixture workspaces/db-fixture; do
  proof "build-${fixture%%/*}" "api/src/services/$fixture.ts" "$annotation" '' 'error TS4023' \
    npm run build --workspace=api
done
proof successive-activation api/src/services/facets/activation-bind.ts \
  'isNull(facetEventBindings.eventId)' 'undefined' 'AssertionError' \
  api_test src/services/facets/activation-db.test.ts -t 'activate a second workspace'
proof historical-writer api/src/services/facets/scoped-writer.ts \
  'return recoverScopedHistoricalFacet(db, sub, workspaceId, command);' \
  'throw new FacetError(400, "invalid_facet_command");' 'invalid_facet_command' \
  api_test src/services/facets/scoped-db.test.ts -t 'recover exact pre-6A and 6A'
proof historical-http api/src/routes/scoped-signal-facets.ts \
  'const parsed = schemas[action].safeParse(body);' \
  'const parsed = schemas[action].safeParse(body); if (!parsed.success) return c.json({ error: "invalid_facet_command" }, 400);' \
  'AssertionError' api_test src/routes/scoped-signal-facets-db.test.ts -t 'recover a qualified'
proof viewer-incarnation ui/src/lib/signals/signal-facet-scope.ts \
  'launched.viewerKey === current.viewerKey' 'launched.viewerKey.context === current.viewerKey.context' \
  'AssertionError' ui_test src/lib/signals/signal-facet-scope.test.ts -t 'reconnecting to the same account'
# Compare every original byte in the copied directories after all restorations.
diff -r /workspace/api/src api/src
diff -r /workspace/ui/src ui/src
echo 'all copied API/UI sources restored: diff=0' | tee -a "$identity"
rm -rf "$copy"
