#!/usr/bin/env bash
# Hermetic tests for tools/make/p0c-apply-hook.sh: no cluster, no network
# beyond loopback. A fake `kubectl` on PATH records every call, enforces the
# exact `kubectl --kubeconfig <file> -n radar-immobilier-preprod` prefix (any
# other namespace, including prod `radar-immobilier`, fails the call), serves
# canned Deployment JSON/YAML, and keeps a tiny state: strategic patches of
# the live Deployments inject `p0c-candidate: live` into the YAML state, merge
# patches of the Services flip a tracked selector state, `set env` updates the
# tracked live revision, and `delete` drops applied candidates. Profile checks
# run against a loopback node stub (one port per binding). Cases: prepare/open/
# close for both phases, B1/B2 regressions, M2 mcp-only drift, the full
# fault-injection matrix (every MOCK_* var exercised, including results
# prepare/close failure paths and missing HTTP bases in live and dry-run),
# kubeconfig/namespace refusals, no defaulted attestations, and dry-run
# executing nothing (traces on stderr only).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../tools/make/p0c-apply-hook.sh"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

T="$(mktemp -d)"
STUB_PID=""
trap 'rm -rf "$T"; kill "$STUB_PID" 2>/dev/null || true' EXIT
mkdir -p "$T/bin"
V1PORT=18091 V2PORT=18092

# --- canned live Deployment YAML (shape of the real manifests) -------------
live_yaml() {
  local name="$1" comp="$2" rev="$3"
  cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  annotations:
    deployment.kubernetes.io/revision: "4"
  creationTimestamp: "2026-10-01T00:00:00Z"
  generation: 4
  labels:
    app.kubernetes.io/component: $comp
    app.kubernetes.io/name: radar-immobilier
  managedFields:
  - apiVersion: apps/v1
    fieldsType: FieldsV1
    fieldsV1:
      f:spec:
        f:template:
          f:spec:
            f:containers: {}
    manager: kubectl
    operation: Update
    time: "2026-10-01T00:00:00Z"
  name: $name
  namespace: radar-immobilier-preprod
  resourceVersion: "12345"
  uid: deadbeef-0000-1111-2222-333344445555
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/component: $comp
      app.kubernetes.io/name: radar-immobilier
  template:
    metadata:
      creationTimestamp: null
      labels:
        app.kubernetes.io/component: $comp
        app.kubernetes.io/name: radar-immobilier
    spec:
      containers:
      - env:
        - name: ARTIFACTS_PROFILE_REVISION
          value: $rev
        - name: POSTGRES_DB
          valueFrom: { secretKeyRef: { key: POSTGRES_DB, name: radar-db-credentials } }
        image: ghcr.io/rhanka/radar-api:latest
        name: app
status:
  availableReplicas: 1
  replicas: 1
EOF
}

# --- fake kubectl (stateful) --------------------------------------------------
cat >"$T/bin/kubectl" <<'FAKE'
#!/usr/bin/env bash
# Strict prefix: every call must be `kubectl --kubeconfig <file> -n preprod`.
[ "${1:-}" = "--kubeconfig" ] || { echo "unexpected prefix: $*" >>"$CALLS"; exit 90; }
[ "${2:-}" = "$EXPECTED_KC" ] || { echo "unexpected kubeconfig: $*" >>"$CALLS"; exit 90; }
[ "${3:-}" = "-n" ] && [ "${4:-}" = "radar-immobilier-preprod" ] || { echo "unexpected namespace: $*" >>"$CALLS"; exit 90; }
shift 4
echo "kubectl $*" >>"$CALLS"
serve_json() { # <deploy> <comp> <yaml> <revfile>: live Deployment as JSON
  DEPLOY="$1" COMP="$2" YAML="$3" REV="$(cat "$4")"
  YAML="$YAML" DEPLOY="$DEPLOY" COMP="$COMP" REV="$REV" node -e '
    const fs = require("node:fs");
    const yaml = fs.readFileSync(process.env.YAML, "utf8");
    const hasLive = /(^|\n)\s*p0c-candidate:\s*live\s*(\n|$)/.test(yaml);
    const labels = { "app.kubernetes.io/name": "radar-immobilier", "app.kubernetes.io/component": process.env.COMP };
    if (hasLive) labels["p0c-candidate"] = "live";
    const obj = {
      apiVersion: "apps/v1", kind: "Deployment",
      metadata: {
        name: process.env.DEPLOY, namespace: "radar-immobilier-preprod",
        annotations: { "deployment.kubernetes.io/revision": "4" },
        labels: { "app.kubernetes.io/name": "radar-immobilier", "app.kubernetes.io/component": process.env.COMP },
        resourceVersion: "12345", uid: "deadbeef-0000-1111-2222-333344445555",
        managedFields: [{ manager: "kubectl", operation: "Update" }],
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { ...labels } },
        template: {
          metadata: { labels: { ...labels } },
          spec: { containers: [{ name: "app", image: "ghcr.io/rhanka/radar-api:latest",
            env: [{ name: "ARTIFACTS_PROFILE_REVISION", value: process.env.REV }] }] },
        },
      },
      status: { availableReplicas: 1, replicas: 1 },
    };
    process.stdout.write(JSON.stringify(obj));
  '
}
label_live_yaml() { # <yaml> <comp>: inject `p0c-candidate: live` once
  grep -q 'p0c-candidate: live' "$1" || \
    sed -i "/^        app.kubernetes.io.component: $2\$/a\\        p0c-candidate: live" "$1"
}
track_selector() { # <statefile>: live adds the label, explicit null removes it
  if [[ " $* " == *'"p0c-candidate":null'* ]]; then printf '%s' 'no-candidate' >"$1";
  elif [[ " $* " == *'"p0c-candidate":"live"'* ]]; then printf '%s' 'live' >"$1"; fi
}
case " $* " in
  " get deploy/radar-immo-mcp -o json ")
    serve_json radar-immo-mcp mcp "$STATE/live-mcp.yaml" "$STATE/live-mcp-rev" ;;
  " get deploy/radar-api -o json ")
    serve_json radar-api api "$STATE/live-api.yaml" "$STATE/live-api-rev" ;;
  " get deploy/radar-immo-mcp -o yaml ")
    cat "$STATE/live-mcp.yaml" ;;
  " get deploy/radar-api -o yaml ")
    cat "$STATE/live-api.yaml" ;;
  " get deploy/radar-api -o jsonpath="*)
    printf '%s' "$(cat "$STATE/live-api-rev")"
    [ "${MOCK_FAIL_READ:-0}" != 1 ] || exit 18 ;;
  " get deploy/radar-immo-mcp -o jsonpath="*)
    printf '%s' "$(cat "$STATE/live-mcp-rev")"
    [ "${MOCK_FAIL_READ:-0}" != 1 ] || exit 18 ;;
  " set env "*)
    [ "${MOCK_SETENV_FAIL:-0}" != 1 ] || exit 7
    printf '%s\n' "$*" >>"$CALLS.env"
    for target in radar-immo-mcp radar-api; do
      case " $* " in
        *" deploy/$target "*)
          if [[ " $* " == *" ARTIFACTS_PROFILE_REVISION="* ]]; then
            printf '%s' "$*" | grep -oE 'ARTIFACTS_PROFILE_REVISION=[^ ]*' | head -1 | cut -d= -f2 | tr -d '\n' >"$STATE/live-$target-rev"
          elif [[ " $* " == *" ARTIFACTS_PROFILE_REVISION-"* ]]; then
            : >"$STATE/live-$target-rev"
          fi ;;
      esac
    done ;;
  " patch deploy/radar-immo-mcp --type strategic "*)
    [ "${MOCK_PATCH_FAIL:-0}" != 1 ] || exit 23
    label_live_yaml "$STATE/live-mcp.yaml" mcp ;;
  " patch deploy/radar-api --type strategic "*)
    [ "${MOCK_PATCH_FAIL:-0}" != 1 ] || exit 23
    label_live_yaml "$STATE/live-api.yaml" api ;;
  " patch svc/radar-immo-mcp --type merge "*)
    [ "${MOCK_PATCH_FAIL:-0}" != 1 ] || exit 23
    track_selector "$STATE/svc-mcp-selector" "$@" ;;
  " patch svc/radar-api --type merge "*)
    [ "${MOCK_PATCH_FAIL:-0}" != 1 ] || exit 23
    track_selector "$STATE/svc-api-selector" "$@" ;;
  " patch "*)
    [ "${MOCK_PATCH_FAIL:-0}" != 1 ] || exit 23 ;;
  " rollout status "*)
    [ "${MOCK_ROLLOUT_FAIL:-0}" != 1 ] || exit 6 ;;
  " apply -f - ")
    doc="$(cat)"
    kind="$(printf '%s\n' "$doc" | sed -nE 's/.*"kind":"([A-Za-z]+)".*/\1/p; s/^kind: ([A-Za-z]+).*/\1/p' | head -1)"
    name="$(printf '%s\n' "$doc" | sed -nE 's/.*"metadata":\{"name":"([^"]+)".*/\1/p; s/^  name: ([^ ]+).*/\1/p' | head -1)"
    [ -n "$kind" ] && [ -n "$name" ] || { echo "bad apply doc" >>"$CALLS"; exit 97; }
    echo "apply $kind/$name" >>"$CALLS"
    printf '%s\n' "$doc" >"$STATE/applied-$name" ;;
  " delete "*)
    [[ " $* " == *" --ignore-not-found "* ]] || { echo "delete without --ignore-not-found" >>"$CALLS"; exit 96; }
    rm -f "$STATE"/applied-*-v2 ;;
  *) echo "unexpected $*" >>"$CALLS"; exit 98 ;;
esac
FAKE
chmod +x "$T/bin/kubectl"
for interpreter in python python3; do
cat >"$T/bin/$interpreter" <<'SHIM'
#!/usr/bin/env bash
echo "${0##*/} $*" >>"$CALLS"
exit 127
SHIM
chmod +x "$T/bin/$interpreter"
done

# --- loopback profile stub (node, one binding per port) -----------------------
cat >"$T/stub.mjs" <<'STUB'
import http from "node:http";
const bindings = {
  [process.env.V1PORT]: { rev: process.env.V1REV, env: Number(process.env.V1ENV) },
  [process.env.V2PORT]: { rev: process.env.V2REV, env: Number(process.env.V2ENV) },
};
for (const [port, b] of Object.entries(bindings)) {
  http.createServer((req, res) => {
    if (req.url === "/profile") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ profileRevisionId: b.rev, requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: b.env }));
    } else { res.writeHead(404); res.end(); }
  }).listen(Number(port), "127.0.0.1");
}
STUB
wait_stub() {
  for _ in $(seq 1 50); do
    node -e 'fetch("http://127.0.0.1:'"$V1PORT"'/profile").then(()=>process.exit(0)).catch(()=>process.exit(1))' \
      && return 0
    sleep 0.1
  done
  return 1
}
start_stub() { # <v1rev> <v1env> <v2rev> <v2env>
  kill "$STUB_PID" 2>/dev/null || true
  V1PORT="$V1PORT" V2PORT="$V2PORT" V1REV="$1" V1ENV="$2" V2REV="$3" V2ENV="$4" \
    node "$T/stub.mjs" &
  STUB_PID=$!
  wait_stub || { echo "stub did not start" >&2; exit 1; }
}
start_stub immo-artifacts.cas.v2 1 immo-artifacts.v2 2

STATE="$T/state"; mkdir -p "$STATE"
KCFILE="$T/kubeconfig"; : >"$KCFILE"

# run <id> <phase> <step> [extra hook env assignments...] -> RC, CALLS
run() {
  local id="$1" phase="$2" step="$3"; shift 3
  CALLS="$T/calls.$id"; : >"$CALLS"; : >"$CALLS.env"
  # shellcheck disable=SC2086
  PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
    P0C_KUBECONFIG="$KCFILE" P0C_DRY_RUN="${P0C_DRY_RUN:-0}" \
    P0C_V1_HTTP_BASE="http://127.0.0.1:$V1PORT" P0C_V2_HTTP_BASE="http://127.0.0.1:$V2PORT" \
    MOCK_ROLLOUT_FAIL="${MOCK_ROLLOUT_FAIL:-0}" MOCK_SETENV_FAIL="${MOCK_SETENV_FAIL:-0}" \
    MOCK_PATCH_FAIL="${MOCK_PATCH_FAIL:-0}" MOCK_FAIL_READ="${MOCK_FAIL_READ:-0}" \
    env "$@" bash "$HOOK" "$phase" "$step" >"$T/out.$id" 2>&1
  RC=$?
}
calls() { paste -sd'|' "$1"; }
has() { grep -qx -- "$2" "$1"; }

setup_live() { # <rev>: live Deployments serve <rev>
  live_yaml radar-immo-mcp mcp "$1" >"$STATE/live-mcp.yaml"
  live_yaml radar-api api "$1" >"$STATE/live-api.yaml"
  printf '%s' "$1" >"$STATE/live-api-rev"
  printf '%s' "$1" >"$STATE/live-mcp-rev"
  printf '%s' 'no-candidate' >"$STATE/svc-mcp-selector"
  printf '%s' 'no-candidate' >"$STATE/svc-api-selector"
  rm -f "$STATE"/applied-*
}

# --- inputs -------------------------------------------------------------------
setup_live immo-artifacts.cas.v2
run inputs-prepare inputs prepare
if [ "$RC" -eq 0 ] \
  && grep -q 'set env deploy/radar-immo-mcp deploy/radar-api ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2' "$CALLS" \
  && grep -q 'set env deploy/radar-immo-mcp deploy/radar-api ARTIFACTS_INPUTS_QUALIFIED- ARTIFACTS_RESULTS_QUALIFIED-' "$CALLS" \
  && grep -q 'rollout status deploy/radar-immo-mcp deploy/radar-api --timeout=300s' "$CALLS" \
  && ! grep -q 'delete\|apply\|patch\|unexpected' "$CALLS" \
  && ! grep -q 'QUALIFIED=' "$CALLS.env"; then
  ok 'inputs prepare: stages cas.v2 on live, unsets attestations, waits for rollout'
else bad "inputs prepare (rc=$RC): $(calls "$CALLS")"; fi

run inputs-open inputs open
if [ "$RC" -eq 0 ] && grep -q 'profile ok.*immo-artifacts.cas.v2' "$T/out.inputs-open"; then
  ok 'inputs open: verifies the live cas.v2 profile'
else bad "inputs open (rc=$RC): $(cat "$T/out.inputs-open")"; fi

start_stub immo-artifacts.v2 2 immo-artifacts.v2 2
P0C_V1_HTTP_BASE="http://127.0.0.1:$V1PORT" P0C_KUBECONFIG="$KCFILE" \
  PATH="$T/bin:$PATH" CALLS="$T/calls.inputs-open-bad" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  bash "$HOOK" inputs open >"$T/out.inputs-open-bad" 2>&1
if [ "$?" -ne 0 ]; then
  ok 'inputs open: refuses a wrong served revision'
else bad "inputs open accepted a wrong revision"; fi
start_stub immo-artifacts.cas.v2 1 immo-artifacts.v2 2

run inputs-close inputs close
if [ "$RC" -eq 0 ] \
  && grep -q 'ARTIFACTS_PROFILE_REVISION- ARTIFACTS_INPUTS_QUALIFIED- ARTIFACTS_RESULTS_QUALIFIED-' "$CALLS" \
  && grep -q 'rollout status' "$CALLS" \
  && ! grep -q 'delete\|apply\|patch\|unexpected' "$CALLS"; then
  ok 'inputs close: unsets the revision (back to p0b default), waits, touches nothing else'
else bad "inputs close (rc=$RC): $(calls "$CALLS")"; fi

# inputs close failure is reported, not swallowed
MOCK_ROLLOUT_FAIL=1 run inputs-close-fail inputs close; MOCK_ROLLOUT_FAIL=0
if [ "$RC" -ne 0 ]; then
  ok 'inputs close: failed rollout exits nonzero'
else bad "inputs close swallowed a rollout failure"; fi

# inputs prepare failure is reported, not swallowed
MOCK_SETENV_FAIL=1 run inputs-prepare-setenv-fail inputs prepare; MOCK_SETENV_FAIL=0
if [ "$RC" -ne 0 ]; then
  ok 'inputs prepare: failed set env exits nonzero'
else bad "inputs prepare swallowed a set env failure"; fi

# --- results ------------------------------------------------------------------
setup_live immo-artifacts.cas.v2
run results-prepare results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true
MCP_APP="$STATE/applied-radar-immo-mcp-v2"
API_APP="$STATE/applied-radar-api-v2"
if [ "$RC" -eq 0 ] \
  && grep -q 'patch deploy/radar-immo-mcp --type strategic' "$CALLS" \
  && grep -q 'patch deploy/radar-api --type strategic' "$CALLS" \
  && grep -q 'patch svc/radar-immo-mcp --type merge' "$CALLS" \
  && grep -q 'patch svc/radar-api --type merge' "$CALLS" \
  && grep -q 'p0c-candidate.*live' "$CALLS" \
  && has "$CALLS" 'apply Service/radar-immo-mcp-v2' \
  && has "$CALLS" 'apply Service/radar-api-v2' \
  && has "$CALLS" 'apply Deployment/radar-immo-mcp-v2' \
  && has "$CALLS" 'apply Deployment/radar-api-v2' \
  && grep -q 'set env deploy/radar-api-v2 ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2 ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true' "$CALLS" \
  && grep -q 'set env deploy/radar-immo-mcp-v2 ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2 ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true RADAR_API_BASE_URL=http://radar-api-v2:3000' "$CALLS" \
  && ! grep -q 'set env deploy/radar-immo-mcp ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2' "$CALLS" \
  && ! grep -q 'set env deploy/radar-api ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2' "$CALLS"; then
  ok 'results prepare: live labeled/isolated, candidates created+staged, live revision untouched'
else bad "results prepare (rc=$RC): $(calls "$CALLS")"; fi

# candidate content: exactly one v2 label (selector+template), no live label,
# renamed, component-preserving, server-field-free. Fails on the old awk clone,
# which kept the inherited `p0c-candidate: live` line next to the added v2.
if [ -f "$MCP_APP" ] && [ -f "$API_APP" ] \
  && grep -q '"name":"radar-immo-mcp-v2"' "$MCP_APP" \
  && grep -q '"name":"radar-api-v2"' "$API_APP" \
  && [ "$(grep -o '"p0c-candidate":"v2"' "$MCP_APP" | wc -l)" -eq 2 ] \
  && [ "$(grep -o '"p0c-candidate":"v2"' "$API_APP" | wc -l)" -eq 2 ] \
  && ! grep -q 'p0c-candidate[^"]*"live"\|p0c-candidate: live' "$MCP_APP" \
  && ! grep -q 'p0c-candidate[^"]*"live"\|p0c-candidate: live' "$API_APP" \
  && grep -q '"app.kubernetes.io/component":"mcp"' "$MCP_APP" \
  && grep -q '"app.kubernetes.io/component":"api"' "$API_APP" \
  && ! grep -q 'resourceVersion\|managedFields\|last-applied-configuration\|"status"' "$MCP_APP" \
  && ! grep -q 'resourceVersion\|managedFields\|last-applied-configuration\|"status"' "$API_APP"; then
  ok 'results prepare: candidates carry exactly one v2 label, no live label, server fields stripped'
else bad 'results prepare: candidate manifest content wrong (B1)'; fi

# B1 rerun: prepare is idempotent, re-running after the live labeling still
# converges to a single v2 label per candidate.
run results-prepare-rerun results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true
if [ "$RC" -eq 0 ] \
  && [ "$(grep -o '"p0c-candidate":"v2"' "$STATE/applied-radar-immo-mcp-v2" | wc -l)" -eq 2 ] \
  && [ "$(grep -o '"p0c-candidate":"v2"' "$STATE/applied-radar-api-v2" | wc -l)" -eq 2 ] \
  && ! grep -q '"p0c-candidate":"live"' "$STATE/applied-radar-immo-mcp-v2" \
  && ! grep -q '"p0c-candidate":"live"' "$STATE/applied-radar-api-v2"; then
  ok 'results prepare: re-run converges (B1 idempotent, no duplicated label)'
else bad "results prepare re-run (rc=$RC) duplicated the candidate label"; fi

# attestations are never defaulted: absent caller env means explicit unset on
# candidates (fail-closed), never an inherited true.
setup_live immo-artifacts.cas.v2
run results-prepare-noatt results prepare
if [ "$RC" -eq 0 ] && ! grep -q 'QUALIFIED=' "$CALLS" \
  && grep -q 'ARTIFACTS_INPUTS_QUALIFIED-' "$CALLS" \
  && grep -q 'ARTIFACTS_RESULTS_QUALIFIED-' "$CALLS"; then
  ok 'results prepare: no caller attestations means explicit unset (fail-closed)'
else bad "results prepare defaulted attestations (rc=$RC): $(calls "$CALLS")"; fi

# results prepare failure paths: any fault aborts nonzero.
MOCK_PATCH_FAIL=1 run results-prepare-patch-fail results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true; MOCK_PATCH_FAIL=0
if [ "$RC" -ne 0 ]; then
  ok 'results prepare: failed patch exits nonzero'
else bad "results prepare swallowed a patch failure"; fi

MOCK_SETENV_FAIL=1 run results-prepare-setenv-fail results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true; MOCK_SETENV_FAIL=0
if [ "$RC" -ne 0 ]; then
  ok 'results prepare: failed set env exits nonzero'
else bad "results prepare swallowed a set env failure"; fi

MOCK_ROLLOUT_FAIL=1 run results-prepare-rollout-fail results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true; MOCK_ROLLOUT_FAIL=0
if [ "$RC" -ne 0 ]; then
  ok 'results prepare: failed rollout exits nonzero'
else bad "results prepare swallowed a rollout failure"; fi

run results-open results open
if [ "$RC" -eq 0 ] \
  && grep -q 'profile ok: http://127.0.0.1:'$V2PORT' serves immo-artifacts.v2' "$T/out.results-open" \
  && grep -q 'profile ok: http://127.0.0.1:'$V1PORT' serves immo-artifacts.cas.v2' "$T/out.results-open"; then
  ok 'results open: verifies v2 candidate and preserved v1 binding'
else bad "results open (rc=$RC): $(cat "$T/out.results-open")"; fi

# a drifted v1 (what an in-place results switch would serve) fails open
start_stub immo-artifacts.v2 2 immo-artifacts.v2 2
P0C_V1_HTTP_BASE="http://127.0.0.1:$V1PORT" P0C_V2_HTTP_BASE="http://127.0.0.1:$V2PORT" \
  P0C_KUBECONFIG="$KCFILE" PATH="$T/bin:$PATH" CALLS="$T/calls.results-open-bad" \
  STATE="$STATE" EXPECTED_KC="$KCFILE" \
  bash "$HOOK" results open >"$T/out.results-open-bad" 2>&1
if [ "$?" -ne 0 ]; then
  ok 'results open: refuses when the v1 binding no longer serves cas.v2'
else bad "results open accepted a drifted v1 binding"; fi
start_stub immo-artifacts.cas.v2 1 immo-artifacts.v2 2

# M3: a missing HTTP base aborts instead of verifying an empty value,
# including in dry-run mode.
CALLS="$T/calls.results-open-nobase"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="$KCFILE" P0C_V1_HTTP_BASE="http://127.0.0.1:$V1PORT" \
  env -u P0C_V2_HTTP_BASE bash "$HOOK" results open >"$T/out.results-open-nobase" 2>&1
if [ "$?" -ne 0 ] && grep -q 'P0C_V2_HTTP_BASE' "$T/out.results-open-nobase"; then
  ok 'results open: missing P0C_V2_HTTP_BASE aborts (no silent empty value)'
else bad "results open accepted a missing v2 base"; fi

CALLS="$T/calls.inputs-open-nobase"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="$KCFILE" \
  env -u P0C_V1_HTTP_BASE bash "$HOOK" inputs open >"$T/out.inputs-open-nobase" 2>&1
if [ "$?" -ne 0 ] && grep -q 'P0C_V1_HTTP_BASE' "$T/out.inputs-open-nobase"; then
  ok 'inputs open: missing P0C_V1_HTTP_BASE aborts (no silent empty value)'
else bad "inputs open accepted a missing v1 base"; fi

CALLS="$T/calls.results-open-nobase-dry"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="$KCFILE" P0C_DRY_RUN=1 P0C_V1_HTTP_BASE="http://127.0.0.1:$V1PORT" \
  env -u P0C_V2_HTTP_BASE bash "$HOOK" results open >"$T/out.results-open-nobase-dry" 2>&1
if [ "$?" -ne 0 ]; then
  ok 'results open: missing base aborts even in dry-run mode'
else bad "dry-run results open accepted a missing base"; fi

# results close: candidates deleted, live routing restored, live env kept
setup_live immo-artifacts.cas.v2
run results-close results close
if [ "$RC" -eq 0 ] \
  && grep -q 'delete deploy/radar-immo-mcp-v2 deploy/radar-api-v2 svc/radar-immo-mcp-v2 svc/radar-api-v2 --ignore-not-found' "$CALLS" \
  && grep -q 'patch svc/radar-immo-mcp --type merge -p {"spec":{"selector":{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"mcp","p0c-candidate":null}}}' "$CALLS" \
  && grep -q 'patch svc/radar-api --type merge -p {"spec":{"selector":{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"api","p0c-candidate":null}}}' "$CALLS" \
  && ! grep -q 'set env deploy/radar-immo-mcp deploy/radar-api' "$CALLS" \
  && grep -q 'rollout status deploy/radar-immo-mcp deploy/radar-api' "$CALLS" \
  && grep -q 'profile ok.*cas.v2' "$T/out.results-close" \
  && [ "$(cat "$STATE/svc-mcp-selector")" = "no-candidate" ] \
  && [ "$(cat "$STATE/svc-api-selector")" = "no-candidate" ]; then
  ok 'results close: deletes candidates, restores live routing (null patch), keeps live cas.v2'
else bad "results close (rc=$RC): $(calls "$CALLS")"; fi

# B2 regression: after prepare then close, no service selector keeps the label.
setup_live immo-artifacts.cas.v2
run results-prepare-b2 results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true
if [ "$(cat "$STATE/svc-mcp-selector")" = "live" ] && [ "$(cat "$STATE/svc-api-selector")" = "live" ]; then
  ok 'results prepare: live services select labeled pods only'
else bad "prepare did not isolate live services"; fi
run results-close-b2 results close
if [ "$RC" -eq 0 ] \
  && [ "$(cat "$STATE/svc-mcp-selector")" = "no-candidate" ] \
  && [ "$(cat "$STATE/svc-api-selector")" = "no-candidate" ]; then
  ok 'results close: live service selectors no longer carry p0c-candidate (B2)'
else bad "results close left p0c-candidate on a live service (rc=$RC)"; fi

# results close re-asserts the live revision when it drifted (both bindings)
printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-mcp-rev"
run results-close-drift results close
if [ "$RC" -eq 0 ] \
  && grep -q 'set env deploy/radar-immo-mcp deploy/radar-api ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2' "$CALLS"; then
  ok 'results close: restores live cas.v2 when it drifted'
else bad "results close drift (rc=$RC): $(calls "$CALLS")"; fi
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-mcp-rev"

# M2 regression: mcp-only drift still re-asserts (the old check read api only).
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-mcp-rev"
run results-close-mcp-drift results close
if [ "$RC" -eq 0 ] \
  && grep -q 'set env deploy/radar-immo-mcp deploy/radar-api ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2' "$CALLS"; then
  ok 'results close: restores live cas.v2 on mcp-only drift (M2)'
else bad "results close mcp drift (rc=$RC): $(calls "$CALLS")"; fi
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-mcp-rev"

# results close never unsets the live revision and never touches policy data
if ! grep -q 'ARTIFACTS_PROFILE_REVISION-' "$T/calls.results-close" \
  && ! grep -q 'host_policy\|receipt\|exec' "$T/calls.results-close"; then
  ok 'results close: never unsets live env, never touches policy or receipts'
else bad 'results close touched live env or policy'; fi

# results close failure paths: every step is still attempted, exit is nonzero.
printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-mcp-rev"
MOCK_SETENV_FAIL=1 run results-close-setenv-fail results close; MOCK_SETENV_FAIL=0
if [ "$RC" -ne 0 ] \
  && grep -q 'delete deploy/radar-immo-mcp-v2' "$CALLS" \
  && grep -q 'p0c-candidate.:null' "$CALLS" \
  && grep -q 'rollout status' "$CALLS"; then
  ok 'results close: failed set env exits nonzero after attempting every step'
else bad "results close swallowed a set env failure (rc=$RC)"; fi
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-mcp-rev"

MOCK_PATCH_FAIL=1 run results-close-patch-fail results close; MOCK_PATCH_FAIL=0
if [ "$RC" -ne 0 ] && grep -q 'delete deploy/radar-immo-mcp-v2' "$CALLS" \
  && grep -q 'rollout status' "$CALLS"; then
  ok 'results close: failed patch exits nonzero after attempting every step'
else bad "results close swallowed a patch failure (rc=$RC)"; fi

printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.p0b.v1" >"$STATE/live-mcp-rev"
MOCK_FAIL_READ=1 run results-close-read-fail results close; MOCK_FAIL_READ=0
if [ "$RC" -ne 0 ] && grep -q 'delete deploy/radar-immo-mcp-v2' "$CALLS" \
  && grep -q 'set env deploy/radar-immo-mcp deploy/radar-api' "$CALLS" \
  && grep -q 'rollout status' "$CALLS"; then
  ok 'results close: failed drift read exits nonzero after attempting every step'
else bad "results close swallowed a drift-read failure (rc=$RC)"; fi
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-api-rev"
printf '%s' "immo-artifacts.cas.v2" >"$STATE/live-mcp-rev"

MOCK_ROLLOUT_FAIL=1 run results-close-rollout-fail results close; MOCK_ROLLOUT_FAIL=0
if [ "$RC" -ne 0 ]; then
  ok 'results close: failed rollout exits nonzero'
else bad "results close swallowed a rollout failure"; fi

# --- refusals -----------------------------------------------------------------
CALLS="$T/calls.no-kc"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="" bash "$HOOK" inputs prepare >"$T/out.no-kc" 2>&1
if [ "$?" -ne 0 ] && [ ! -s "$CALLS" ]; then
  ok 'refuses a missing P0C_KUBECONFIG without calling kubectl'
else bad 'missing P0C_KUBECONFIG was accepted or kubectl ran'; fi

CALLS="$T/calls.def-kc"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG=~/.kube/config bash "$HOOK" inputs prepare >"$T/out.def-kc" 2>&1
if [ "$?" -ne 0 ] && [ ! -s "$CALLS" ]; then
  ok 'refuses ~/.kube/config without calling kubectl'
else bad '~/.kube/config was accepted or kubectl ran'; fi

CALLS="$T/calls.prod-ns"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="$KCFILE" P0C_NAMESPACE=radar-immobilier \
  bash "$HOOK" inputs prepare >"$T/out.prod-ns" 2>&1
if [ "$?" -ne 0 ] && [ ! -s "$CALLS" ]; then
  ok 'refuses the prod namespace without calling kubectl'
else bad 'prod namespace was accepted or kubectl ran'; fi

CALLS="$T/calls.bad-arg"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="$KCFILE" bash "$HOOK" inputs reopen >"$T/out.bad-arg" 2>&1
if [ "$?" -ne 0 ]; then
  ok 'refuses an unknown step'
else bad 'unknown step was accepted'; fi

# --- dry run ------------------------------------------------------------------
P0C_DRY_RUN=1 run results-prepare-dry results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true; P0C_DRY_RUN=0
if [ "$RC" -eq 0 ] && [ ! -s "$CALLS" ] && grep -q '^+ kubectl' "$T/out.results-prepare-dry"; then
  ok 'dry run: prints kubectl commands, executes none'
else bad "dry run (rc=$RC): calls=$(calls "$CALLS")"; fi

# dry-run traces go to stderr only, so stdout stays machine-clean.
setup_live immo-artifacts.cas.v2
CALLS="$T/calls.dry-streams"; : >"$CALLS"
PATH="$T/bin:$PATH" CALLS="$CALLS" STATE="$STATE" EXPECTED_KC="$KCFILE" \
  P0C_KUBECONFIG="$KCFILE" P0C_DRY_RUN=1 \
  P0C_V1_HTTP_BASE="http://127.0.0.1:$V1PORT" P0C_V2_HTTP_BASE="http://127.0.0.1:$V2PORT" \
  bash "$HOOK" results prepare ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true \
  >"$T/out.dry.stdout" 2>"$T/out.dry.stderr"
if [ "$?" -eq 0 ] && [ ! -s "$CALLS" ] \
  && grep -q '^+ kubectl' "$T/out.dry.stderr" \
  && ! grep -q '^+ ' "$T/out.dry.stdout"; then
  ok 'dry run: traces on stderr, stdout clean, kubectl untouched'
else bad "dry run streams wrong (stdout=$(cat "$T/out.dry.stdout"))"; fi

# --- global invariants ----------------------------------------------------------
if ! grep -h . "$T"/calls.* | grep -q 'python'; then
  ok 'no python invoked on any path'
else bad 'python was invoked'; fi

if ! grep -h . "$T"/calls.* | grep -q -- '-n radar-immobilier '; then
  ok 'no call ever targeted the prod namespace'
else bad 'a call targeted the prod namespace'; fi

if ! grep -q 'QUALIFIED=true' "$HOOK"; then
  ok 'hook never defaults attestations to true'
else bad 'hook defaults an attestation'; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
