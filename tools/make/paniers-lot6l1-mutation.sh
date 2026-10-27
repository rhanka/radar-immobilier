#!/usr/bin/env bash
# Discrimination changes disposable container copies only.
set -euo pipefail
copy=/workspace/6l1-copy
mkdir -p "$copy" /workspace/6l1-originals
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
  local suite=$1
  shift
  # Normalize ANSI output so the evidence checks count executed tests.
  (cd "$suite" && ../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$@") \
    2>&1 | sed -E 's/\x1B\[[0-9;]*m//g'
}
proof() {
  local name=$1 file=$2 suite=$3 test_file=$4 test_name=$5 status=0
  shift 5
  cp "$file" "/workspace/6l1-originals/$name"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  grep -Eq 'Tests[[:space:]]+1 passed' "/evidence/$name-baseline.log"
  mutate "$file" "$@"
  cp "$file" "/evidence/$name-mutated.ts"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  cp "/workspace/6l1-originals/$name" "$file"
  cmp "/workspace/6l1-originals/$name" "$file"
  cmp "/workspace/$file" "$file"
  test "$status" -eq 1
  grep -Eq 'Tests[[:space:]]+1 failed' "/evidence/$name-failed.log"
  grep -q AssertionError "/evidence/$name-failed.log"
  if [[ "$name" == early-ack ]]; then
    grep -q 'expected false to be true' "/evidence/$name-failed.log"
    grep -q 'shouldReconcile(state, "token-a")' "/evidence/$name-failed.log"
  fi
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  grep -Eq 'Tests[[:space:]]+1 passed' "/evidence/$name-restored.log"
  echo "$name: baseline PASS; mutation exit=1 (AssertionError); restored PASS; saved cmp=0; source cmp=0" \
    | tee -a /evidence/mutation-identity.log
  sha256sum "$file" > "/evidence/$name.sha256"
}
proof unauthorized api/src/services/facets/projection-revisions.ts api \
  src/services/facets/projection-revisions-db.test.ts 'refuse revisions to unauthorized' \
  'await resolveWorkspaceAccess(tx, workspaceId, sub);' '/* authorization bypass in disposable copy */' \
  'eq(workspaceMemberships.accountId, accountId)' 'undefined'
proof cross-scope api/src/services/facets/projection-revisions.ts api \
  src/services/facets/projection-races-db.test.ts 'isolate cities and workspaces' \
  'eq(personalProjectionRevisions.workspaceId, workspaceId)' 'undefined' \
  'eq(workspaceProjectionRevisions.workspaceId, workspaceId)' 'undefined'
proof superseded ui/src/lib/signals/signal-projection-revision.ts ui \
  src/lib/signals/signal-projection-lifecycle.test.ts 'ignore superseded requests' \
  'if (operation !== state.operation) return false;' '/* superseded response applied */'
proof missing-bump api/src/services/facets/scoped-writer.ts api \
  src/services/facets/projection-revisions-db.test.ts 'isolate personal revisions across members' \
  'await bumpPersonalRevision(tx, workspaceId, accountId, command.target.citySlug);' 'await Promise.resolve(0);'
# Acknowledge inside an awaited helper, before refresh resumes its guards.
# B then supersedes A and fails, leaving A acknowledged but never displayed.
proof early-ack ui/src/lib/signals/signal-projection-revision.ts ui \
  src/lib/signals/signal-projection-revision.test.ts 'keeps the displayed revision retryable' \
  '    const snapshot = await fetch();' \
  '    const reconciled = await reconcileProjection(state, live, fetch, operation);
    if (!reconciled) return;
    const snapshot = state.snapshot!;'
# Move the live/disposal checks into the awaited helper. The queued
# transition then lands after validation but before rebuild resumes.
late_guard=$(sed -n '/^  const refresh = async () => {/,/^  };$/p' \
  ui/src/lib/signals/signal-projection-revision.ts)
early_guard=$(cat <<'GUARD'
  const refresh = async () => {
    const operation = beginProjectionRead(state);
    const reconciled = await (async () => {
      const snapshot = await fetch();
      if (disposed) return false;
      const current = live();
      if (!isLiveScopedContext(state.launched, current)) return false;
      if (state.launched.citySlug !== current.citySlug || state.launched.mode !== current.mode) return false;
      if (state.operation !== operation) return false;
      return noteProjectionSuccess(state, current, snapshot, operation);
    })();
    if (reconciled) rebuild(state.snapshot!);
  };
GUARD
)
proof disposal ui/src/lib/signals/signal-projection-revision.ts ui \
  src/lib/signals/signal-projection-revision.test.ts 'never rebuilds after disposal queued during validation' \
  "$late_guard" "$early_guard"
proof account-switch ui/src/lib/signals/signal-projection-revision.ts ui \
  src/lib/signals/signal-projection-revision.test.ts 'never rebuilds after account switch queued during validation' \
  "$late_guard" "$early_guard"
proof review-fingerprint api/src/routes/scoped-projection-revisions.ts api \
  src/routes/scoped-projection-revisions-db.test.ts 'serve displayed fingerprints usable for 6B commands' \
  'facetFingerprint: targetFingerprint(node)' '/* displayed fingerprint omitted */'
proof review-later-migration api/src/services/facets/projection-migration-db.test.ts api \
  src/services/facets/projection-migration-db.test.ts 'when a later migration follows it' \
  '      expect(targeted).toMatchObject({ hash, created_at: String(entry.when) });' \
  '      expect(before.rows.at(-1)).toMatchObject({ hash, created_at: String(entry.when) });'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
diff -r /workspace/ui/src ui/src
echo 'all copied API/SQL/UI sources restored: diff=0' | tee -a /evidence/mutation-identity.log
