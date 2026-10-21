#!/usr/bin/env bash
# Container-only copied-source mutations; every failure must be an assertion.
set -euo pipefail
cd /workspace/api
source_dir=src/services/workspaces
mutant_dir=src/services/workspaces-mutant
cp -a "$source_dir" "$mutant_dir"
mkdir -p /workspace/mutation-copies
vitest=(../node_modules/.bin/vitest run --config vitest.isolated.config.ts)
expect_failure() {
  local name=$1 status=0
  shift
  "${vitest[@]}" "$@" > "/evidence/mutation-$name.log" 2>&1 || status=$?
  test "$status" -eq 1
  grep -q AssertionError "/evidence/mutation-$name.log"
  echo "$name: assertion failure exit=$status" | tee -a /evidence/mutation-identity.log
}
restore_source() {
  local file=$1 name=$2
  cp "/workspace/mutation-copies/$file" "$mutant_dir/$file"
  cmp "/workspace/mutation-copies/$file" "$mutant_dir/$file"
  cmp "$source_dir/$file" "$mutant_dir/$file"
  echo "$name: restored copy cmp=0; production cmp=0" | tee -a /evidence/mutation-identity.log
}
mutate() {
  node --input-type=module - "$@" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, before, after] = process.argv.slice(2);
const original = readFileSync(file, "utf8");
if (!original.includes(before)) throw new Error("Mutation anchor missing");
writeFileSync(file, original.replace(before, after));
JS
}
: > /evidence/mutation-identity.log
cp "$mutant_dir/mutations.ts" /workspace/mutation-copies/mutations.ts
mutate "$mutant_dir/mutations.ts" \
  'if (membership?.status !== "active" || !membership.manageMembers)' 'if (false)'
expect_failure capability "$mutant_dir/store-db.test.ts" -t 'reject moderator'
restore_source mutations.ts capability
"${vitest[@]}" "$mutant_dir/store-db.test.ts" -t 'reject moderator' > /evidence/mutation-capability-restored.log 2>&1

cp drizzle/0017_workspace_memberships.sql /workspace/mutation-copies/audit.sql
cp /workspace/mutation-copies/audit.sql /workspace/mutation-copies/audit-mutant.sql
mutate /workspace/mutation-copies/audit-mutant.sql \
  "RAISE EXCEPTION 'workspace membership events are append-only';" 'RETURN OLD;'
apply_sql() {
  node --input-type=module - "$1" <<'JS'
import pg from "pg";
import { readFileSync } from "node:fs";
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
try { await pool.query(readFileSync(process.argv[2], "utf8")); } finally { await pool.end(); }
JS
}
apply_sql /workspace/mutation-copies/audit-mutant.sql
expect_failure audit "$mutant_dir/migration-db.test.ts" -t 'reject audit'
cp /workspace/mutation-copies/audit.sql /workspace/mutation-copies/audit-mutant.sql
cmp /workspace/mutation-copies/audit.sql /workspace/mutation-copies/audit-mutant.sql
cmp drizzle/0017_workspace_memberships.sql /workspace/mutation-copies/audit-mutant.sql
apply_sql /workspace/mutation-copies/audit-mutant.sql
echo 'audit: restored copy cmp=0; production cmp=0' | tee -a /evidence/mutation-identity.log
"${vitest[@]}" "$mutant_dir/migration-db.test.ts" -t 'reject audit' > /evidence/mutation-audit-restored.log 2>&1

cp "$mutant_dir/init-store.ts" /workspace/mutation-copies/init-store.ts
mutate "$mutant_dir/init-store.ts" \
  'if (row && row.status === "active") return false;' 'if (false) return false;'
expect_failure initialization "$mutant_dir/store-db.test.ts" -t 'initialize explicit'
restore_source init-store.ts initialization
"${vitest[@]}" "$mutant_dir/store-db.test.ts" -t 'initialize explicit' > /evidence/mutation-initialization-restored.log 2>&1
rm -rf "$mutant_dir"
