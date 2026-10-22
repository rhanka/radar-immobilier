#!/usr/bin/env bash
# Versioned discrimination on disposable container copies; never edit the checkout.
set -euo pipefail
mkdir -p /workspace/6l2-copy /workspace/6l2-originals
cp -a /workspace/api /workspace/ui /workspace/6l2-copy/
cp /workspace/{package.json,tsconfig.base.json} /workspace/6l2-copy/
ln -s /workspace/node_modules /workspace/6l2-copy/node_modules
ln -s /workspace/packages /workspace/6l2-copy/packages
cd /workspace/6l2-copy
cat > ui/vitest.isolated.config.ts <<'CONFIG'
import config from "./vitest.config.js";
export default { ...config, envDir: false, test: { ...config.test, fileParallelism: false, maxWorkers: 2 } };
CONFIG
mutate() {
  node --input-type=module - "$@" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, before, after] = process.argv.slice(2);
const source = readFileSync(file, "utf8");
if (source.split(before).length !== 2) throw new Error("Mutation anchor must occur once");
writeFileSync(file, source.replace(before, after));
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
  cp "$file" "/workspace/6l2-originals/$name"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-baseline.log" 2>&1
  grep -Eq 'Tests[[:space:]]+1 passed' "/evidence/$name-baseline.log"
  mutate "$file" "$@"
  cp "$file" "/evidence/$name-mutated.ts"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-failed.log" 2>&1 || status=$?
  cp "/workspace/6l2-originals/$name" "$file"
  cmp "/workspace/6l2-originals/$name" "$file"
  cmp "/workspace/$file" "$file"
  test "$status" -eq 1
  grep -Eq 'Tests[[:space:]]+1 failed' "/evidence/$name-failed.log"
  grep -q AssertionError "/evidence/$name-failed.log"
  test_case "$suite" "$test_file" -t "$test_name" > "/evidence/$name-restored.log" 2>&1
  grep -Eq 'Tests[[:space:]]+1 passed' "/evidence/$name-restored.log"
  echo "$name: baseline PASS; mutation exit=1 (AssertionError); restored PASS; saved cmp=0; source cmp=0" \
    | tee -a /evidence/mutation-identity.log
  sha256sum "$file" > "/evidence/$name.sha256"
}
route=api/src/routes/scoped-projection-events.ts
cycles=src/routes/scoped-projection-events-cycle-db.test.ts
lifecycle=src/routes/scoped-projection-events-lifecycle.test.ts
observer=ui/src/lib/signals/signal-projection-invalidation-observer.ts
races=src/lib/signals/signal-projection-invalidation-races.test.ts
proof unauthorized "$route" api "$cycles" 'authorize each cycle before emitting' \
  'current = await poll();' 'current = { ...scope, token: "unauthorized-change" };'
proof private api/src/services/facets/projection-invalidation.ts api "$cycles" 'emit no private change' \
  'if (lastEmittedToken === currentToken) return { kind: "steady" };' '/* private silence bypass */'
proof idle-revocation "$route" api "$cycles" 'close an idle stream' \
  'send(invalidationSseFrame("closed", { reason: end.reason }));
                close();' \
  'send(invalidationSseFrame("closed", { reason: end.reason }));'
proof incompatible "$route" api src/routes/scoped-projection-events-db.test.ts \
  'resynchronize on restart and on incompatible cursors' \
  'send(invalidationSseFrame("resync",' \
  'send(invalidationSseFrame(reason === "cursor_incompatible" ? "invalidated" : "resync",'
proof early-ack "$observer" ui "$races" 'retry failed reloads without another server event' \
  '    } catch (error) {' '    } catch (error) {
      state.ackedToken = streamEvent?.token ?? null;'
proof expired "$route" api "$cycles" 'close expired browser credentials' \
  'session.exp! * 1000 <= now()' 'false'
proof overlap "$route" api "$lifecycle" 'serialize slow cycles' \
  'timer = setTimeout(() => { void tickOnce(); }, watchIntervalMs);
        c.req.raw.signal' \
  'timer = setInterval(() => { void tickOnce(); }, watchIntervalMs);
        c.req.raw.signal'
proof pending-revocation "$observer" ui "$races" 'prevent pending refetch acknowledgment after revocation' \
  '    if (disposed) return;
    const current = deps.live();
    if (noteInvalidationReconciled(state, current, snapshot, operation)) deps.rebuild(snapshot);' \
  '    state.ackedToken = snapshot.token;
    deps.rebuild(snapshot);'
proof retry "$observer" ui "$races" 'retry failed reloads without another server event' \
  'pendingRetry = schedule(() => { void wake({ kind: "resync" }); }, PROJECTION_RECONNECT_DELAY_MS);' \
  '/* failed fetch never retried */'
proof reconnect-denied "$observer" ui "$races" 'clear denied reconnects when EventSource' \
  '    void wake({ kind: "resync" });' '    /* reconnect never rechecks authorization */'
proof final-credential "$route" api "$lifecycle" 'recheck expiration immediately before emitting' \
  'try { requireCredential(); } catch {' 'try { /* final credential guard bypass */ } catch {'
diff -r /workspace/api/src api/src
diff -r /workspace/api/drizzle api/drizzle
diff -r /workspace/ui/src ui/src
echo 'all copied API/SQL/UI sources restored: diff=0' | tee -a /evidence/mutation-identity.log
