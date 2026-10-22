#!/usr/bin/env bash
# Discrimination runs only on a disposable source copy inside the test container.
set -euo pipefail
copy=/workspace/6i-copy
mkdir -p "$copy" /workspace/6i-originals
cp -a /workspace/api "$copy/"
cp /workspace/{package.json,tsconfig.base.json} "$copy/"
ln -s /workspace/node_modules "$copy/node_modules"
ln -s /workspace/packages "$copy/packages"
cd "$copy"
identity=/evidence/mutation-identity.log
touch "$identity"
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
  local name=$1 file=$2 test_file=$3 test_name=$4 signature=$5 status=0
  shift 5
  if [[ -f "/evidence/$name.pass" ]]; then
    sha256sum -c "/evidence/$name.pass"
    cmp "/workspace/$file" "$file"
    echo "$name: reusing validated discrimination"
    return
  fi
  cp "$file" "/workspace/6i-originals/$name"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  mutate "$file" "$@"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  cp "/workspace/6i-originals/$name" "$file"
  cmp "/workspace/6i-originals/$name" "$file"
  cmp "/workspace/$file" "$file"
  test "$status" -eq 1
  grep -q "$signature" "/evidence/$name-failed.log"
  api_test "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  echo "$name: baseline PASS; mutation exit=1 ($signature); restored PASS; saved cmp=0; source cmp=0" | tee -a "$identity"
  sha256sum "$file" > "/evidence/$name.pass"
}
proof moderator api/src/services/facets/workspace-writer.ts \
  src/services/facets/workspace-archive-db.test.ts 'refuse contributors' 'AssertionError' \
  'if (!access.moderateArchive)' 'if (false && !access.moderateArchive)'
proof personal-restore api/src/services/facets/workspace-reader.ts \
  src/services/facets/workspace-archive-db.test.ts 'both restore directions' 'AssertionError' \
  'return personal?.state === "active" || workspace?.state === "active";' \
  'return personal?.state === "active";'
proof stale-head api/src/services/facets/workspace-writer.ts \
  src/services/facets/workspace-archive-db.test.ts 'stale workspace heads' 'expected facet_head_conflict' \
  'if ((stream.headEventId ?? null) !== command.expectedHeadId)' \
  'if (false && (stream.headEventId ?? null) !== command.expectedHeadId)'
proof private-state api/src/services/facets/workspace-reader.ts \
  src/services/facets/workspace-union-db.test.ts 'viewer-private' 'AssertionError' \
  'or(eq(facetStreams.scope, "workspace"), and(eq(facetStreams.scope, "personal"),
          eq(facetStreams.ownerId, accountId)))' 'undefined' \
  'else if (row.event.ownerId === accountId)' 'else if (row.event.scope === "personal")'
# Historical SQL is changed only in this copy, never in the delivered migration.
# Disable the deferred authority as a faulty cutover would; the inserts must
# then be accepted, making the rejection test fail after the old index is gone.
proof duplicate-terminal api/drizzle/0018_facet_scope_bindings.sql \
  src/services/facets/workspace-head-enforcement-db.test.ts 'second null-basket terminal' 'AssertionError' \
  'PERFORM id FROM facet_streams WHERE id = p_stream FOR UPDATE;' \
  'RETURN; PERFORM id FROM facet_streams WHERE id = p_stream FOR UPDATE;'
proof unresolved-history api/src/services/facets/workspace-discarded.ts \
  src/services/facets/workspace-union-db.test.ts 'late-admitted account' 'promise resolved' \
  'if (unresolved) throw new ScopeError(503, "personal_history_unresolved");' \
  'if (false && unresolved) throw new ScopeError(503, "personal_history_unresolved");'
proof cross-family-lock api/src/services/facets/workspace-writer.ts \
  src/services/facets/workspace-receipts-db.test.ts 'concurrent same-key commands' 'idempotency_key_conflict' \
  '["scoped-command", actorId, key]' '["workspace-archive-command", actorId, key]'
proof missing-reason api/src/routes/scoped-workspace-archive.ts \
  src/routes/scoped-workspace-archive-db.test.ts 'moderator' 'expected 400 to be 422' \
  'reasonCode: reasonCode.optional()' 'reasonCode: reasonCode'
proof workspace-first-restore api/src/services/facets/workspace-reader.ts \
  src/services/facets/workspace-archive-db.test.ts 'workspace archive restores first' 'expected false to be true' \
  'return personal?.state === "active" || workspace?.state === "active";' \
  'return workspace?.state === "active";'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
echo 'all copied API/SQL sources restored: diff=0' | tee -a "$identity"
rm -rf "$copy"
