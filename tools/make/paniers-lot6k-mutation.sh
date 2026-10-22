#!/usr/bin/env bash
# Versioned discrimination: copied sources, failing mutant, restoration, cmp.
set -euo pipefail
copy=/workspace/6k-copy
mkdir -p "$copy" /workspace/6k-originals
cp -a /workspace/api /workspace/ui "$copy/"
cp /workspace/{package.json,tsconfig.base.json} "$copy/"
ln -s /workspace/node_modules "$copy/node_modules"
ln -s /workspace/packages "$copy/packages"
cd "$copy"
cat > ui/vitest.isolated.config.ts <<'CONFIG'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
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
test_case() {
  local suite=$1; shift
  (cd "$suite" && ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$@") \
    2>&1 | sed -E 's/\x1B\[[0-9;]*m//g'
}
proof() {
  local name=$1 file=$2 suite=$3 test_file=$4 test_name=$5 status=0
  shift 5
  cp "$file" "/workspace/6k-originals/$name"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  grep -Eq 'Tests[[:space:]]+1 passed' "/evidence/$name-baseline.log"
  mutate "$file" "$@"
  cp "$file" "/evidence/$name-mutated.source"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  cp "/workspace/6k-originals/$name" "$file"
  cmp "/workspace/6k-originals/$name" "$file"
  cmp "/workspace/$file" "$file"
  test "$status" -eq 1
  grep -Eq 'Tests[[:space:]]+1 failed' "/evidence/$name-failed.log"
  grep -Eq 'AssertionError|TestingLibraryElementError' "/evidence/$name-failed.log"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  grep -Eq 'Tests[[:space:]]+1 passed' "/evidence/$name-restored.log"
  echo "$name: baseline PASS; mutation exit=1; restored PASS; saved cmp=0; source cmp=0" \
    | tee -a /evidence/mutation-identity.log
}
proof conflict-without-d5 api/src/services/facets/lots/lot-cutover-gate.ts api \
  src/services/facets/lots/lot-cutover-d5-run-db.test.ts 'refuse activation while a conflicted target' \
  'if (gate.unavailable.length > 0) {' 'if (false && gate.unavailable.length > 0) {'
proof legacy-fallback api/src/services/facets/lots/lot-reader.ts api \
  src/services/facets/lots/lot-cutover-run-db.test.ts 'complete nine stages' \
  'import { and, eq, isNull }' 'import { and, eq, isNull, sql }' \
  'pipeline: heads.find((head) => head.facet === "pipeline") ?? null,' \
  'pipeline: ((await tx.execute(sql`SELECT id FROM prospect_marks LIMIT 1`)).rows[0] as never) ?? heads.find((head) => head.facet === "pipeline") ?? null,'
proof dual-write api/drizzle/0022_facet_lot_cutover.sql api \
  src/services/facets/lots/lot-cutover-run-db.test.ts 'complete nine stages' \
  'IF fenced OR EXISTS (SELECT 1 FROM lot_cutover_state WHERE maintenance_barrier OR destination_open) THEN' \
  'IF false THEN'
proof reopened-reader api/src/services/facets/lots/lot-legacy-fence.ts api \
  src/routes/scoped-lot-cutover-activate-db.test.ts 'evaluate, activate, and retire' \
  'if (list.some((row) => row.destinationOpen === true)) return "open";' \
  'if (list.some((row) => row.destinationOpen === true)) return "none";'
proof ui-before-activation ui/src/lib/components/maps/LotFichePanel.svelte ui \
  src/lib/components/maps/LotCutover.ui.test.ts 'preserve LotFichePanel DOM' \
  'Pipeline : non marqué' 'Pipeline : unavailable'
proof sum-is-population ui/src/lib/maps/lot-facet-counters.ts ui \
  src/lib/maps/lot-facet-counters.test.ts 'count one lot in every active facet' \
  '  return counters;' \
  '  counters.total = counters.selected + counters.sollicite + counters.lettreEnvoyee + counters.enVente + counters.archived;
  return counters;'
proof native-guard api/src/services/facets/lots/lot-cutover-target.ts api \
  src/services/facets/lots/lot-cutover-target-blocked-db.test.ts 'late-qualified native history' \
  'const candidates = [destCutoverKeyFor(target, mode), nativeCanonicalCutoverKeyFor(target)];' \
  'const candidates = [destCutoverKeyFor(target, mode)];'
proof denormalized-city api/src/services/facets/lots/lot-city.ts api \
  src/services/facets/lots/lot-cutover-target-identities-db.test.ts 'exclude a denormalized pending history' \
  'if (isCutoverBlockedTarget(blocked, target, mode)) continue;' \
  'if (false) continue;'
proof sources-fence api/drizzle/0023_facet_lot_versions_fence.sql api \
  src/services/facets/lots/lot-cutover-sources-fence-db.test.ts 'fence source writes' \
  'WHERE maintenance_barrier AND NOT destination_open' \
  'WHERE false'
proof unknown-fence api/src/services/facets/lots/lot-legacy-fence.ts api \
  src/routes/lot-cutover-stream.test.ts 'open connection when the fence read fails' \
  '  } catch {
    return "unknown";' \
  '  } catch {
    return "barrier";'
proof unknown-retires api/src/routes/chat.ts api \
  src/routes/lot-cutover-stream.test.ts 'open connection when the fence read fails' \
  'if (fence === "open" || fence === "barrier") retireLegacyMarkDelivery();' \
  'if (fence !== "none") retireLegacyMarkDelivery();'
proof open-retires api/src/routes/chat.ts api \
  src/routes/lot-cutover-stream.test.ts 'retire preloaded replica buffers when durable state is open' \
  'if (fence === "open" || fence === "barrier") retireLegacyMarkDelivery();' \
  'if (false) retireLegacyMarkDelivery();'
proof retirement-closes api/src/routes/chat.ts api \
  src/routes/lot-cutover-stream.test.ts 'discard queued frames' \
  'controller.error(new Error("legacy_mark_delivery_retired"));' \
  'controller.close();'
proof late-read-loss api/src/routes/chat.ts api \
  src/routes/lot-cutover-stream.test.ts 'open connection when the fence read fails' \
  'unsubscribe = subscribe(deliver);' \
  'unsubscribe = subscribe((frame) => {
          if (frame.streamId === "prospect-marks" && fence === "unknown" && db) {
            void legacyMarksFence(db).then((current) => {
              if (current === "none") deliver(frame);
            });
          } else deliver(frame);
        });'
proof confirmed-reopens api/src/services/chat/stream-bus.ts api \
  src/routes/lot-cutover-stream.test.ts 'keep a confirmed cutover closed' \
  '  subscribers.add(subscriber);' \
  '  retiredTypes.clear();
  subscribers.add(subscriber);'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
diff -r /workspace/ui/src ui/src
echo 'all copied API/SQL/UI sources restored: diff=0' | tee -a /evidence/mutation-identity.log
