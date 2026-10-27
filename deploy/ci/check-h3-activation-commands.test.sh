#!/usr/bin/env bash
# Operator recipes against a recording kubectl double; no cluster access.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CASE_ROOT="$(mktemp -d "$ROOT/tmp/h3-commands.XXXXXX")"
trap 'rm -rf "$CASE_ROOT"' EXIT
export H3_COMMAND_STATE="$CASE_ROOT" H3_REAL_KUBECTL="$(command -v kubectl)"
export KUBECONFIG="$CASE_ROOT/nonexistent-config"
cat >"$CASE_ROOT/kubectl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = kustomize ]; then exec "$H3_REAL_KUBECTL" "$@"; fi
[ "$1" = -n ] && [ "$2" = radar-immobilier-preprod ] || exit 90
shift 2
printf '%s\n' "$*" >>"$H3_COMMAND_STATE/calls"
case "$1 $2" in
  'get secret')
    [ "${H3_METADATA_FAILURE:-0}" = 0 ] || exit 7
    if [ -f "$H3_COMMAND_STATE/secret-$3" ]; then echo "secret/$3"; fi ;;
  'create secret')
    name="$4"
    for arg in "$@"; do
      case "$arg" in --from-file=*)
        file="${arg#*=}"; file="${file#*=}"
        [ "$(stat -c %a "$file")" = 600 ]
        grep -Eq '^[a-f0-9]{64}$' "$file"
        printf '%s\n' "$file" >>"$H3_COMMAND_STATE/keypaths" ;;
      esac
    done
    touch "$H3_COMMAND_STATE/secret-$name"
    echo "secret/$name created" ;;
  'apply --server-side'|'apply -f') cat >/dev/null ;;
  'rollout restart'|'rollout status'|'patch configmap'|'patch ingress') ;;
  *) echo "unexpected fake invocation: $*" >&2; exit 91 ;;
esac
SH
chmod +x "$CASE_ROOT/kubectl"
OPERATOR=deploy/overlays/preprod/artifacts-activation.mk
operator() { make --no-print-directory -f "$OPERATOR" "$@" OUT="$CASE_ROOT/output" KUBECTL="$CASE_ROOT/kubectl" ENV=preprod; }
operator cursor-secret reader-secrets >"$CASE_ROOT/secrets.log"
[ "$(grep -c '^create secret' "$CASE_ROOT/calls")" = 2 ]
while read -r path; do [ ! -e "$path" ]; done <"$CASE_ROOT/keypaths"
! grep -Eq '[a-f0-9]{64}' "$CASE_ROOT/secrets.log"
echo 'ok: private random signing keys created by file, removed and never printed'
operator cursor-secret reader-secrets >>"$CASE_ROOT/secrets.log"
[ "$(grep -c '^create secret' "$CASE_ROOT/calls")" = 2 ]
echo 'ok: persistent signing Secrets retained without regeneration'
if H3_METADATA_FAILURE=1 operator cursor-secret >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
[ "$(grep -c '^create secret' "$CASE_ROOT/calls")" = 2 ]
echo 'ok: metadata failure stops secret creation'
image="ghcr.io/rhanka/radar-api@sha256:$(printf 'a%.0s' {1..64})"
operator render OUT="$CASE_ROOT/output" ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/render.log"
grep -Fq 'ARTIFACTS_CONTROL_MODE: "off"' "$CASE_ROOT/output/render.yaml"
if operator render ARTIFACT_API_IMAGE=ghcr.io/rhanka/radar-api:latest >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
echo 'ok: reviewed image digest required; first render keeps publication off'
operator apply-runtime route >"$CASE_ROOT/apply.log"
grep -Fq 'rollout restart deployment/radar-immo-mcp' "$CASE_ROOT/calls"
grep -Fq 'rollout status deployment/radar-api' "$CASE_ROOT/calls"
echo 'ok: operator applies MCP Deployment and rolls API/MCP through readiness'
operator rollback >"$CASE_ROOT/rollback.log"
grep -Fq 'patch configmap radar-api --type merge -p {"data":{"ARTIFACTS_CONTROL_MODE":"off"}}' "$CASE_ROOT/calls"
grep -Fq 'patch configmap immo-mcp-config --type merge -p {"data":{"ARTIFACTS_CONTROL_MODE":"off"}}' "$CASE_ROOT/calls"
grep -Fq '"value":"radar-artifact-content-deny"' "$CASE_ROOT/calls"
echo 'ok: rollback closes both modes and cuts content routes to denial'
echo 'check-h3-activation-commands tests: 6 passed, 0 failed'
