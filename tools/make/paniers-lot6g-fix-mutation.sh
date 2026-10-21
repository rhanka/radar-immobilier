#!/usr/bin/env bash
# Runs inside the isolated container; production sources are never mutated.
set -euo pipefail
cd /workspace/api
source_dir=src/services/workspaces
mutant_dir=src/services/workspaces-astra-mutant
copies=/workspace/astra-copies
cp -a "$source_dir" "$mutant_dir"
mkdir -p "$copies"
cp "$source_dir"/{mutations,capabilities,membership-command,policy}.ts "$copies/"
route=src/routes/workspaces-astra-mutant.ts
cp src/routes/workspaces.ts "$route"
node --input-type=module - "$route" "$mutant_dir/routes-db.test.ts" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, "utf8");
  writeFileSync(file, source.replaceAll("../services/workspaces/", "../services/workspaces-astra-mutant/")
    .replace("../../routes/workspaces.js", "../../routes/workspaces-astra-mutant.js"));
}
JS
vitest=(../node_modules/.bin/vitest run --config vitest.isolated.config.ts)
identity=/evidence/astra-mutation-identity.log
: > "$identity"
"${vitest[@]}" "$mutant_dir/routes-db.test.ts" > /evidence/astra-copy-baseline.log 2>&1
echo 'copied HTTP route baseline: PASS' | tee -a "$identity"
mutate() {
  node --input-type=module - "$mutant_dir/$1" "$2" "$3" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, before, after] = process.argv.slice(2);
const source = readFileSync(file, "utf8");
if (!source.includes(before)) throw new Error("Mutation anchor missing");
writeFileSync(file, source.replaceAll(before, after));
JS
}
proof() {
  local name=$1 file=$2 test_file=$3 pattern=$4 status=0
  "${vitest[@]}" "$mutant_dir/$test_file" -t "$pattern" \
    > "/evidence/astra-$name-failed.log" 2>&1 || status=$?
  test "$status" -eq 1
  grep -q AssertionError "/evidence/astra-$name-failed.log"
  echo "$name: copied mutation assertion failure exit=$status" | tee -a "$identity"
  cp "$copies/$file" "$mutant_dir/$file"
  cmp "$copies/$file" "$mutant_dir/$file"
  cmp "$source_dir/$file" "$mutant_dir/$file"
  echo "$name: restored copy cmp=0; production cmp=0" | tee -a "$identity"
  "${vitest[@]}" "$mutant_dir/$test_file" -t "$pattern" \
    > "/evidence/astra-$name-restored.log" 2>&1
}

mutate mutations.ts '["workspace", canonicalWorkspaceId(workspaceId)]' '["workspace", workspaceId]'
proof canonical-lock mutations.ts store-db.test.ts 'queue an uppercase'

mutate capabilities.ts 'eq(workspaceMemberships.revision, current.revision)' 'undefined'
proof sql-capability capabilities.ts store-db.test.ts 'SQL revision during capability'
mutate mutations.ts 'eq(workspaceMemberships.revision, row.revision)' 'undefined'
proof sql-reactivation mutations.ts store-db.test.ts 'SQL revision during reactivation'
mutate mutations.ts 'eq(workspaceMemberships.revision, current.revision)' 'undefined'
proof sql-revocation mutations.ts store-db.test.ts 'SQL revision during revocation'

# Recreate the original unconditional add before applying capability deltas.
mutate membership-command.ts 'let record = current;' 'let { record } = await addMembership(tx, command);'
proof revoked-withdrawal membership-command.ts routes-db.test.ts 'without reactivating'
mutate membership-command.ts 'let record = current;' 'let { record } = await addMembership(tx, command);'
proof suspended-withdrawal membership-command.ts routes-db.test.ts 'on a suspended account'

mutate policy.ts 'if (expectedRevision === undefined' \
  'if (expectedRevision === null || expectedRevision === undefined'
proof stale-creation policy.ts commands-db.test.ts 'explicit-absence creation'
mutate policy.ts 'if (expectedRevision === undefined' \
  'if (expectedRevision === null || expectedRevision === undefined'
proof stale-creation-http policy.ts routes-db.test.ts 'concurrent explicit-absence creation'

cp "$source_dir/routes-db.test.ts" "$mutant_dir/routes-db.test.ts"
diff -r "$source_dir" "$mutant_dir"
echo 'all copied workspace sources restored: diff=0; production unchanged' | tee -a "$identity"
rm -rf "$mutant_dir" "$route"
