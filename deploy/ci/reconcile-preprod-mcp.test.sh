#!/usr/bin/env bash
# Hermetic tests for the immo-mcp-config branch of reconcile-preprod.sh (#835):
# no cluster. A fake `kubectl` on PATH records every call and keeps a tiny
# state (ConfigMap resourceVersion, pod-template annotation); `kubectl
# kustomize` is delegated to the real binary so the real preprod render is used.
# Cases: Deployment absent (NotFound), annotation current (no roll), annotation
# stale (roll), lookup failure, empty resourceVersion, and a patch failure
# followed by a same-image retry that must still roll (retry-safe).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_KUBECTL="$(command -v kubectl)" || { echo "FAIL: kubectl not found" >&2; exit 1; }
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat >"$T/bin/kubectl" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = kustomize ]; then exec "$REAL_KUBECTL" "$@"; fi
case " $* " in
  *" get deploy radar-immo-mcp --ignore-not-found "*)
    echo "get radar-immo-mcp" >>"$CALLS"
    case "$MOCK_GET" in
      present) echo deployment.apps/radar-immo-mcp ;;
      absent) : ;;
      *) echo 'Error from server (Forbidden): deployments.apps "radar-immo-mcp" is forbidden' >&2; exit 1 ;;
    esac ;;
  *" get configmap immo-mcp-config "*) cat "$STATE/rv" ;;
  *" get deploy radar-immo-mcp "*) cat "$STATE/ann" ;;
  *" diff "*) cat >/dev/null; exit 1 ;;
  *" apply "*)
    names="$(grep -E '^  name: ' | sed 's/^  name: //' | paste -sd, -)"
    echo "apply $names" >>"$CALLS" ;;
  *" patch deploy radar-immo-mcp "*)
    if [ "${MOCK_PATCH_FAIL:-0}" = 1 ]; then echo "patch-failed" >>"$CALLS"; exit 23; fi
    v="$(printf '%s' "${*: -1}" | sed -n 's/.*"sentropic.dev\/immo-mcp-config-rv":"\([^"]*\)".*/\1/p')"
    printf '%s' "$v" >"$STATE/ann"
    echo "patch rv=$v" >>"$CALLS" ;;
  *) echo "unexpected $*" >>"$CALLS" ;;
esac
FAKE
chmod +x "$T/bin/kubectl"
STATE="$T/state"; mkdir -p "$STATE"

# run <case-id> <MOCK_GET> [MOCK_PATCH_FAIL] -> RC, CALLS (state kept in $STATE)
run() {
  CALLS="$T/calls.$1"; : >"$CALLS"
  PATH="$T/bin:$PATH" REAL_KUBECTL="$REAL_KUBECTL" CALLS="$CALLS" STATE="$STATE" MOCK_GET="$2" \
    MOCK_PATCH_FAIL="${3:-0}" NAMESPACE=radar-immobilier-preprod bash "$HERE/reconcile-preprod.sh" >"$T/out.$1" 2>&1
  RC=$?
}
state() { printf '%s' "$1" >"$STATE/rv"; printf '%s' "$2" >"$STATE/ann"; }
has() { grep -qx -- "$2" "$1"; }
calls() { paste -sd'|' "$CALLS"; }

state 100 ''; run absent absent
if [ "$RC" -eq 0 ] && ! grep -q 'immo-mcp-config\|^patch' "$CALLS" && has "$CALLS" 'apply radar-api'; then
  ok 'Deployment absent: no immo-mcp-config apply, no roll, rest reconciled'
else bad "Deployment absent (rc=$RC): $(calls)"; fi

state 100 100; run current present
if [ "$RC" -eq 0 ] && has "$CALLS" 'apply immo-mcp-config' && ! grep -q '^patch' "$CALLS"; then
  ok 'annotation == ConfigMap resourceVersion: applied, no roll'
else bad "annotation current (rc=$RC): $(calls)"; fi

state 101 100; run stale present
if [ "$RC" -eq 0 ] && has "$CALLS" 'patch rv=101' \
  && [ "$(grep -n 'apply immo-mcp-config' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^patch' "$CALLS" | cut -d: -f1)" ]; then
  ok 'annotation stale: applied, then pod template annotated with the new resourceVersion'
else bad "annotation stale (rc=$RC): $(calls)"; fi

state 100 100; run lookup error
if [ "$RC" -ne 0 ] && ! grep -q '^apply' "$CALLS"; then
  ok 'Deployment lookup failure: script stops before any apply'
else bad "lookup failure (rc=$RC): $(calls)"; fi

state '' 100; run norv present
if [ "$RC" -ne 0 ] && ! grep -q '^patch' "$CALLS"; then
  ok 'empty ConfigMap resourceVersion: script stops, no patch'
else bad "empty rv (rc=$RC): $(calls)"; fi

state 102 101; run patchfail present 1
first_rc=$RC
run retry present
if [ "$first_rc" -ne 0 ] && [ "$RC" -eq 0 ] && has "$CALLS" 'patch rv=102'; then
  ok 'patch failure then same-image retry: the retry still rolls the pod'
else bad "patch failure + retry (first rc=$first_rc, retry rc=$RC): $(calls)"; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
