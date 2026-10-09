#!/usr/bin/env bash
# Hermetic tests for the immo-mcp-config branch of reconcile-preprod.sh (#835):
# no cluster. A fake `kubectl` on PATH records every call; `kubectl kustomize`
# is delegated to the real binary so the real preprod render is used.
# Cases: Deployment absent (NotFound), present with the ConfigMap unchanged,
# present with the ConfigMap changed (restart), lookup failure and diff failure
# (both must stop the script before any immo-mcp apply).
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
  *" get deploy radar-immo-mcp "*)
    echo "get radar-immo-mcp" >>"$CALLS"
    case "$MOCK_GET" in
      present) echo deployment.apps/radar-immo-mcp ;;
      absent) case " $* " in *" --ignore-not-found "*) : ;; *) echo 'Error from server (NotFound): deployments.apps "radar-immo-mcp" not found' >&2; exit 1 ;; esac ;;
      *) echo 'Error from server (Forbidden): deployments.apps "radar-immo-mcp" is forbidden' >&2; exit 1 ;;
    esac ;;
  *" diff "*)
    doc="$(cat)"
    names="$(printf '%s\n' "$doc" | grep -E '^  name: ' | sed 's/^  name: //' | sort -u | paste -sd, -)"
    echo "diff $names" >>"$CALLS"
    if [ "$names" = immo-mcp-config ]; then exit "$MOCK_DIFF"; fi
    exit 1 ;;
  *" apply "*)
    names="$(grep -E '^  name: ' | sed 's/^  name: //' | paste -sd, -)"
    echo "apply $names" >>"$CALLS" ;;
  *" rollout restart "*) echo "restart ${*: -1}" >>"$CALLS" ;;
  *) echo "unexpected $*" >>"$CALLS" ;;
esac
FAKE
chmod +x "$T/bin/kubectl"

# run <MOCK_GET> <MOCK_DIFF> -> sets RC and CALLS file
run() {
  CALLS="$T/calls.$1.$2"; : >"$CALLS"
  PATH="$T/bin:$PATH" REAL_KUBECTL="$REAL_KUBECTL" CALLS="$CALLS" MOCK_GET="$1" MOCK_DIFF="$2" \
    NAMESPACE=radar-immobilier-preprod bash "$HERE/reconcile-preprod.sh" >"$T/out" 2>&1
  RC=$?
}
has() { grep -qx -- "$2" "$1"; }

run absent 0
if [ "$RC" -eq 0 ] && ! grep -q immo-mcp-config "$CALLS" && ! grep -q '^restart' "$CALLS" && has "$CALLS" 'apply radar-api'; then
  ok 'Deployment absent: no immo-mcp-config diff/apply, no restart, rest reconciled'
else bad "Deployment absent (rc=$RC): $(paste -sd'|' "$CALLS")"; fi

run present 0
if [ "$RC" -eq 0 ] && has "$CALLS" 'apply immo-mcp-config' && ! grep -q '^restart' "$CALLS"; then
  ok 'present + ConfigMap unchanged: applied, no restart'
else bad "present unchanged (rc=$RC): $(paste -sd'|' "$CALLS")"; fi

run present 1
if [ "$RC" -eq 0 ] && has "$CALLS" 'apply immo-mcp-config' && has "$CALLS" 'restart deploy/radar-immo-mcp' \
  && [ "$(grep -n 'apply immo-mcp-config' "$CALLS" | cut -d: -f1)" -lt "$(grep -n '^restart' "$CALLS" | cut -d: -f1)" ]; then
  ok 'present + ConfigMap changed: applied, then radar-immo-mcp restarted'
else bad "present changed (rc=$RC): $(paste -sd'|' "$CALLS")"; fi

run error 0
if [ "$RC" -ne 0 ] && ! grep -q '^apply' "$CALLS"; then
  ok 'Deployment lookup failure: script stops before any apply'
else bad "lookup failure (rc=$RC): $(paste -sd'|' "$CALLS")"; fi

run present 2
if [ "$RC" -ne 0 ] && ! grep -q 'apply immo-mcp-config' "$CALLS" && ! grep -q '^restart' "$CALLS"; then
  ok 'immo-mcp-config diff failure: stops before its apply'
else bad "diff failure (rc=$RC): $(paste -sd'|' "$CALLS")"; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
