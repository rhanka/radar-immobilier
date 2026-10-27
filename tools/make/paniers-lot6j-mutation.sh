#!/usr/bin/env bash
# Mutants run in a disposable copy; baseline and restored tests must pass.
set -euo pipefail
copy=/workspace/6j-copy
mkdir -p "$copy" /workspace/6j-originals
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
api_test() { (cd api && ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$@"); }
proof() {
  local name=$1 file=$2 test_file=$3 test_name=$4 status=0
  shift 4
  cp "$file" "/workspace/6j-originals/$name"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  mutate "$file" "$@"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  cp "/workspace/6j-originals/$name" "$file"
  cmp "/workspace/6j-originals/$name" "$file"
  cmp "/workspace/$file" "$file"
  test "$status" -eq 1
  grep -Eq 'AssertionError|23514' "/evidence/$name-failed.log"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  echo "$name: baseline PASS; mutation exit=1; restored PASS; saved cmp=0; source cmp=0" \
    | tee -a /evidence/mutation-identity.log
}
proof partial-batch api/src/services/facets/lots/lot-batch.ts \
  src/services/facets/lots/lot-batch-db.test.ts 'one version conflicts' \
  'return db.transaction(async (tx) => {' \
  'const { writeLotFacet } = await import("./lot-writer.js");
  const leaked = await writeLotFacet(db, sub, workspaceId, scope, {
    ...batch.items[0]!, contract_version: "lot-facets-v1",
    command_key: globalThis.crypto.randomUUID(), mode: batch.mode,
  });
  batch.items[0]!.expected_head_id = leaked?.id ?? null;
  return db.transaction(async (tx) => {'
proof author-ownership api/src/services/facets/lots/lot-apply.ts \
  src/services/facets/lots/lot-import-ownership-db.test.ts 'existing author' \
  'id, scope, ownerId: plan.ownerId, actorId,' \
  'id, scope, ownerId: provenance?.sourceAuthor ?? plan.ownerId, actorId,'
proof common-discard api/src/services/facets/lots/lot-authorize.ts \
  src/services/facets/lots/lot-rights-db.test.ts 'common archive and restoration' \
  'case "discard":
      if (scope === "workspace" && !rights.moderateArchive)' \
  'case "discard":
      if (false && scope === "workspace" && !rights.moderateArchive)'
proof duplicate-source api/src/services/facets/lots/lot-importer.ts \
  src/services/facets/lots/lot-importer-db.test.ts 'every source line exactly once' \
  '}).onConflictDoNothing().returning();' \
  '}).onConflictDoNothing().returning();
      if (inserted.length === 0) {
        const [stored] = await tx.select().from(lotSourceRows).where(and(
          eq(lotSourceRows.workspaceId, input.workspaceId), eq(lotSourceRows.sourceId, row.sourceId)));
        await tx.insert(lotSourceRows).values({ ...stored!, sourceId: `${row.sourceId}-${runId}` });
      }'
proof enabled-importer api/src/services/facets/lots/lot-importer.ts \
  src/services/facets/lots/lot-importer-db.test.ts 'disabled by default' \
  'options.enabled !== true' 'options.enabled === false'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
echo 'all copied API/SQL sources restored: diff=0' | tee -a /evidence/mutation-identity.log
rm -rf "$copy"
