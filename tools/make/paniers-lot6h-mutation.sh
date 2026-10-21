#!/usr/bin/env bash
# Container-only copies; production bytes are compared after each restored run.
set -euo pipefail
cp -a /workspace/api /workspace/mutation-api
cd /workspace/mutation-api
mkdir -p /workspace/mutation-originals
vitest=(../node_modules/.bin/vitest run --config vitest.isolated.config.ts)
: > /evidence/mutation-identity.log
mutate() {
  node --input-type=module - "$@" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, before, after] = process.argv.slice(2);
const value = readFileSync(file, "utf8");
if (!value.includes(before)) throw new Error("Missing mutation anchor");
writeFileSync(file, value.replace(before, after));
JS
}
proof() {
  local name=$1 file=$2 before=$3 after=$4 test_file=$5 test_name=$6 status=0
  cp "$file" "/workspace/mutation-originals/$name"
  mutate "$file" "$before" "$after"
  "${vitest[@]}" "$test_file" -t "$test_name" > "/evidence/mutation-$name.log" 2>&1 || status=$?
  test "$status" -eq 1
  grep -q AssertionError "/evidence/mutation-$name.log"
  cp "/workspace/mutation-originals/$name" "$file"
  cmp "/workspace/mutation-originals/$name" "$file"
  cmp "/workspace/api/$file" "$file"
  "${vitest[@]}" "$test_file" -t "$test_name" > "/evidence/mutation-$name-restored.log" 2>&1
  echo "$name: assertion failure exit=1; restored PASS; copy cmp=0; production cmp=0" | tee -a /evidence/mutation-identity.log
}
proof uniqueness drizzle/0018_facet_scope_bindings.sql \
  '(workspace_id, scope, owner_id, target_type, city_slug, node_type, node_id, facet, basket)' \
  '(id, workspace_id, scope, owner_id, target_type, city_slug, node_type, node_id, facet, basket)' \
  src/services/facets/registry-db.test.ts 'enforce stream uniqueness'
proof activation src/services/facets/activation-run.ts \
  'if (!safety) throw new ScopeError(503, "activation_delivery_safety_required");' \
  'if (false) throw new ScopeError(503, "activation_delivery_safety_required");' \
  src/services/facets/activation-db.test.ts 'keep activation closed'
proof epoch src/services/facets/scope.ts \
  'if (epoch !== SCOPED_EPOCH)' 'if (false)' \
  src/services/facets/scope.test.ts 'keeps scoped reads unavailable'
proof attachment src/services/facets/attachment.ts \
  'if (existing)' 'if (false && existing)' \
  src/services/facets/attachment-db.test.ts 'replay attachment'
proof conversion drizzle/0018_facet_scope_bindings.sql \
  "RAISE EXCEPTION 'facet stream identity mismatch';" 'NULL;' \
  src/services/facets/registry-db.test.ts 'reject personal to workspace conversion'
rm -rf /workspace/mutation-api
