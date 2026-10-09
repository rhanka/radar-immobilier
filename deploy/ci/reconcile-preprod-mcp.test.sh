#!/usr/bin/env bash
# Hermetic tests for the immo-mcp-config branch of reconcile-preprod.sh (#835):
# no cluster. A fake `kubectl` on PATH records every call and keeps a tiny
# state (ConfigMap resourceVersion, pod-template annotation); `kubectl
# kustomize` is delegated to the real binary so the real preprod render is used.
# Cases: Deployment absent (NotFound), annotation current (no roll), ConfigMap
# changed by the apply (roll, then a settled re-run does not), annotation
# missing on an existing Deployment, lookup failure, empty resourceVersion, and
# a patch failure followed by a same-image retry that must still roll; the
# applied document content and failing version reads are checked too.
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
# Strict fake: exact arguments for the immo-mcp reads, any unknown call fails.
if [ "${1:-}" = kustomize ]; then exec "$REAL_KUBECTL" "$@"; fi
RV_PATH='jsonpath={.metadata.resourceVersion}'
ANN_PATH='jsonpath={.spec.template.metadata.annotations.sentropic\.dev/immo-mcp-config-rv}'
case " $* " in
  *" get deploy radar-immo-mcp --ignore-not-found -o name ")
    echo "get radar-immo-mcp" >>"$CALLS"
    case "$MOCK_GET" in
      present) echo deployment.apps/radar-immo-mcp ;;
      absent) : ;;
      *) echo 'Error from server (Forbidden): deployments.apps "radar-immo-mcp" is forbidden' >&2; exit 1 ;;
    esac ;;
  " -n radar-immobilier-preprod get configmap immo-mcp-config -o $RV_PATH ")
    echo "read rv" >>"$CALLS"; cat "$STATE/rv"
    # A failing read may still print: the caller must not swallow the status.
    if [ "${MOCK_FAIL_READ:-}" = rv ]; then exit 18; fi ;;
  " -n radar-immobilier-preprod get deploy radar-immo-mcp -o $ANN_PATH ")
    echo "read ann" >>"$CALLS"; cat "$STATE/ann"
    if [ "${MOCK_FAIL_READ:-}" = ann ]; then exit 19; fi ;;
  *" diff "*) cat >/dev/null; exit 1 ;;
  " apply --server-side --field-manager=cd-preprod --force-conflicts -f - ")
    # Exact persisting apply only (no dry-run, no namespace override, manifest
    # from stdin); the immo-mcp-config document is kept for content checks.
    doc="$(cat)"
    names="$(printf '%s\n' "$doc" | grep -E '^  name: ' | sed 's/^  name: //' | paste -sd, -)"
    echo "apply $names" >>"$CALLS"
    if [ "$names" = immo-mcp-config ]; then
      printf '%s\n' "$doc" >"$STATE/applied-mcp"
      # A changed immo-mcp-config bumps its resourceVersion, like the API server.
      if [ "${MOCK_APPLY_CHANGES:-0}" = 1 ]; then
        printf '%s' "$(( $(cat "$STATE/rv") + 1 ))" >"$STATE/rv"
      fi
    fi ;;
  " -n radar-immobilier-preprod patch deploy radar-immo-mcp --type merge -p "*)
    if [ "${MOCK_PATCH_FAIL:-0}" = 1 ]; then echo "patch-failed" >>"$CALLS"; exit 23; fi
    v="$(printf '%s' "${*: -1}" | sed -n 's/^{"spec":{"template":{"metadata":{"annotations":{"sentropic.dev\/immo-mcp-config-rv":"\([^"]*\)"}}}}}$/\1/p')"
    [ -n "$v" ] || { echo "bad patch ${*: -1}" >>"$CALLS"; exit 97; }
    printf '%s' "$v" >"$STATE/ann"
    echo "patch rv=$v" >>"$CALLS" ;;
  *) echo "unexpected $*" >>"$CALLS"; exit 98 ;;
esac
FAKE
chmod +x "$T/bin/kubectl"
# python3 shim: records every call. The immo-mcp branch must not use Python
# (owner rule: no Python in repos/jobs); pre-existing kfilter.py calls for the
# other objects are delegated to the real interpreter, untouched here.
REAL_PYTHON3="$(command -v python3 || true)"
cat >"$T/bin/python3" <<'SHIM'
#!/usr/bin/env bash
echo "python3 $*" >>"$CALLS"
[ -n "$REAL_PYTHON3" ] || { echo "python3 not installed" >&2; exit 127; }
exec "$REAL_PYTHON3" "$@"
SHIM
chmod +x "$T/bin/python3"
STATE="$T/state"; mkdir -p "$STATE"

# run <case-id> <MOCK_GET> [MOCK_PATCH_FAIL] [MOCK_APPLY_CHANGES] [MOCK_FAIL_READ] -> RC, CALLS
# (state kept in $STATE across runs, so multi-run cases share it)
run() {
  CALLS="$T/calls.$1"; : >"$CALLS"
  PATH="$T/bin:$PATH" REAL_KUBECTL="$REAL_KUBECTL" REAL_PYTHON3="$REAL_PYTHON3" CALLS="$CALLS" STATE="$STATE" MOCK_GET="$2" \
    MOCK_PATCH_FAIL="${3:-0}" MOCK_APPLY_CHANGES="${4:-0}" MOCK_FAIL_READ="${5:-}" \
    NAMESPACE=radar-immobilier-preprod \
    bash "$HERE/reconcile-preprod.sh" >"$T/out.$1" 2>&1
  RC=$?
}
state() { printf '%s' "$1" >"$STATE/rv"; printf '%s' "$2" >"$STATE/ann"; }
has() { grep -qx -- "$2" "$1"; }
calls() { paste -sd'|' "$CALLS"; }
# No call outside the expected protocol (the fake exits non-zero on those too),
# and no Python call touching immo-mcp-config.
clean() { ! grep -q '^unexpected\|^bad patch\|^python3 .*immo-mcp-config' "$CALLS"; }
line() { grep -n -- "$2" "$1" | head -1 | cut -d: -f1; }

state 100 ''; run absent absent
if [ "$RC" -eq 0 ] && clean && ! grep -q 'immo-mcp-config\|^patch\|^read' "$CALLS" && has "$CALLS" 'apply radar-api'; then
  ok 'Deployment absent: no immo-mcp-config apply, no roll, rest reconciled'
else bad "Deployment absent (rc=$RC): $(calls)"; fi

state 100 100; run current present
if [ "$RC" -eq 0 ] && clean && has "$CALLS" 'apply immo-mcp-config' && ! grep -q '^patch' "$CALLS"; then
  ok 'unchanged ConfigMap, annotation current: applied, no roll'
else bad "annotation current (rc=$RC): $(calls)"; fi

# The apply itself changes the ConfigMap (100 -> 101): the version must be read
# AFTER the apply, or the roll is missed.
state 100 100; run changed present 0 1
if [ "$RC" -eq 0 ] && clean && has "$CALLS" 'patch rv=101' \
  && [ "$(line "$CALLS" 'apply immo-mcp-config')" -lt "$(line "$CALLS" '^read rv')" ] \
  && [ "$(line "$CALLS" '^read rv')" -lt "$(line "$CALLS" '^patch')" ]; then
  ok 'ConfigMap changed by the apply: version read after it, pod template annotated'
else bad "changed by apply (rc=$RC): $(calls)"; fi
run settled present
if [ "$RC" -eq 0 ] && clean && ! grep -q '^patch' "$CALLS"; then
  ok 'settled re-run after a roll: no further patch'
else bad "settled re-run (rc=$RC): $(calls)"; fi

# Existing Deployment that never carried the annotation (first run after merge).
state 100 ''; run first present
if [ "$RC" -eq 0 ] && clean && has "$CALLS" 'patch rv=100'; then
  ok 'present Deployment without the annotation: pod template annotated'
else bad "missing annotation (rc=$RC): $(calls)"; fi

# What was applied is the WHOLE guarded preprod document (byte-compared with the
# immo-mcp-config document of an independent render; POSIX awk split on ---),
# plus the env-specific values named explicitly.
A="$STATE/applied-mcp"
"$REAL_KUBECTL" kustomize --load-restrictor LoadRestrictionsNone "$HERE/../overlays/preprod" \
  | awk '/^---$/ { if (keep) printf "%s", doc; doc = ""; keep = 0; k = 0; next }
         { doc = doc $0 "\n" }
         /^kind: ConfigMap$/ { k = 1 }
         /^  name: immo-mcp-config$/ { if (k) keep = 1 }
         END { if (keep) printf "%s", doc }' >"$T/expected-mcp"
if [ -s "$T/expected-mcp" ] && [ -f "$A" ] && cmp -s "$T/expected-mcp" "$A" \
  && has "$A" '  namespace: radar-immobilier-preprod' \
  && has "$A" '  IMMO_MCP_OAUTH_ISSUER: https://preprod.auth.sent-tech.ca' \
  && has "$A" '  IMMO_MCP_OAUTH_RESOURCE: https://preprod.immo.sent-tech.ca/mcp' \
  && has "$A" '  RADAR_PUBLIC_BASE_URL: https://preprod.immo.sent-tech.ca' \
  && has "$A" '  RADAR_API_BASE_URL: http://radar-api:3000' \
  && has "$A" '  IMMO_MCP_OAUTH_SCOPES_SUPPORTED: immo:read immo:search immo:documents:read'; then
  ok 'applied immo-mcp-config = the full rendered preprod document'
else bad "applied immo-mcp-config differs from the render: $(diff "$T/expected-mcp" "$A" 2>&1 | paste -sd'|' -)"; fi

# A failing version read (even after printing a value) stops the release.
for r in rv ann; do
  state 101 100; run "readfail-$r" present 0 0 "$r"
  if [ "$RC" -ne 0 ] && clean && ! grep -q '^patch\|^apply radar-consistency-snapshot' "$CALLS"; then
    ok "failed $r read: script stops before the patch and the later applies"
  else bad "failed $r read (rc=$RC): $(calls)"; fi
done

state 100 100; run lookup error
if [ "$RC" -ne 0 ] && ! grep -q '^apply' "$CALLS"; then
  ok 'Deployment lookup failure: script stops before any apply'
else bad "lookup failure (rc=$RC): $(calls)"; fi

state '' 100; run norv present
if [ "$RC" -ne 0 ] && clean && ! grep -q '^patch' "$CALLS"; then
  ok 'empty ConfigMap resourceVersion: script stops, no patch'
else bad "empty rv (rc=$RC): $(calls)"; fi

state 101 101; run patchfail present 1 1
first_rc=$RC
run retry present
if [ "$first_rc" -ne 0 ] && [ "$RC" -eq 0 ] && clean && has "$CALLS" 'patch rv=102'; then
  ok 'patch failure then same-image retry: the retry still rolls the pod'
else bad "patch failure + retry (first rc=$first_rc, retry rc=$RC): $(calls)"; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
