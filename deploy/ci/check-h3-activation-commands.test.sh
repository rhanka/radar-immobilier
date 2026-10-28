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
if [ "$1" = kustomize ]; then
  if [ -n "${H3_RENDER_SOURCE_MODE:-}" ]; then
    "$H3_REAL_KUBECTL" "$@" | sed -E "s/^(  ARTIFACTS_CONTROL_MODE: ).*/\1$H3_RENDER_SOURCE_MODE/"
    exit 0
  fi
  exec "$H3_REAL_KUBECTL" "$@"
fi
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
  'get ingress')
    [ "${H3_INGRESS_FAILURE:-0}" = 0 ] || exit 7
    [ "${H3_INGRESS_ABSENT:-0}" = 1 ] || echo ingress/radar-artifact-content ;;
  'get configmap') cat "$H3_COMMAND_STATE/mode-$3" ;;
  'get pods')
    if [[ "$*" = *component=api* ]]; then echo pod/api; else echo pod/mcp; fi ;;
  'patch configmap') echo off >"$H3_COMMAND_STATE/mode-$3" ;;
  'patch ingress') [ "${H3_CUTOFF_FAILURE:-0}" = 0 ] || exit 7 ;;
  'rollout restart')
    [ "${H3_RESTART_FAILURE:-}" != "$3" ] || exit 7
    if [ "$3" = deployment/radar-api ]; then component=api; else component=mcp; fi
    echo off >"$H3_COMMAND_STATE/runtime-$component" ;;
  'rollout status') [ "${H3_ROLLOUT_FAILURE:-}" != "$3" ] || exit 7 ;;
  'exec pod/api'|'exec pod/mcp')
    component="${2#pod/}"
    cat "$H3_COMMAND_STATE/runtime-$component" ;;
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
assert_modes() {
  for name in radar-api immo-mcp-config; do
    bash deploy/ci/kfilter.sh "$CASE_ROOT/output/render.yaml" ConfigMap "$name" \
      | grep -Fxq "  ARTIFACTS_CONTROL_MODE: \"$1\""
  done
}
for mode in off general; do
  operator render MODE="$mode" ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/render.log"
  assert_modes "$mode"
  echo "ok: real operator render MODE=$mode produces $mode for API and MCP"
done
H3_RENDER_SOURCE_MODE=general operator render MODE=off ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/render.log"
assert_modes off
echo 'ok: operator renders off for API and MCP from a general source'
if operator render MODE=validation ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
echo 'ok: operator rejects unsupported requested modes'
if H3_RENDER_SOURCE_MODE=validation operator render MODE=general ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
grep -Fq 'must render ARTIFACTS_CONTROL_MODE=general' "$CASE_ROOT/failure.log"
echo 'ok: operator rejects a rendered ConfigMap that differs from the requested mode'
operator render ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/render.log"
assert_modes off
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
rollback_case() {
  : >"$CASE_ROOT/calls"
  for component in api mcp; do echo general >"$CASE_ROOT/runtime-$component"; done
}
assert_closed() {
  grep -Fxq off "$CASE_ROOT/runtime-api"
  grep -Fxq off "$CASE_ROOT/runtime-mcp"
  grep -Fq 'exec pod/api -- printenv ARTIFACTS_CONTROL_MODE' "$CASE_ROOT/calls"
  grep -Fq 'exec pod/mcp -- printenv ARTIFACTS_CONTROL_MODE' "$CASE_ROOT/calls"
}
rollback_case
H3_INGRESS_ABSENT=1 operator rollback >"$CASE_ROOT/rollback.log"
! grep -q '^patch ingress' "$CASE_ROOT/calls"
assert_closed
echo 'ok: absent Ingress still closes and verifies both runtimes'
rollback_case
if H3_ROLLOUT_FAILURE=deployment/radar-api operator rollback >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
assert_closed
awk '/rollout restart deployment\/radar-immo-mcp/{mcp=NR} /rollout status deployment\/radar-api/{if (!mcp || mcp>NR) exit 1}' "$CASE_ROOT/calls"
echo 'ok: API readiness failure still restarts and verifies MCP; failure reported'
for failure in H3_INGRESS_FAILURE H3_CUTOFF_FAILURE; do
  rollback_case
  if (export "$failure=1"; operator rollback) >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
  assert_closed
done
echo 'ok: transport/RBAC or cutoff failure cannot skip runtime closure'
rollback_case
if H3_RESTART_FAILURE=deployment/radar-api operator rollback >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
grep -Fxq general "$CASE_ROOT/runtime-api"
grep -Fxq off "$CASE_ROOT/runtime-mcp"
grep -Fq 'publication remains open or unverified' "$CASE_ROOT/failure.log"
echo 'ok: stale general pod prevents a false rollback success; MCP still closes'
operator render MODE=general ARTIFACT_API_IMAGE="$image" >"$CASE_ROOT/render.log"
cp "$CASE_ROOT/output/render.yaml" "$CASE_ROOT/pinned.yaml"
reject_image() {
  local mutation="$1" reason="$2" target
  cp "$CASE_ROOT/pinned.yaml" "$CASE_ROOT/output/render.yaml"
  sed -i "$mutation" "$CASE_ROOT/output/render.yaml"
  for target in apply-runtime route; do
    : >"$CASE_ROOT/calls"
    if operator "$target" >"$CASE_ROOT/failure.log" 2>&1; then exit 1; fi
    grep -Fq "$reason" "$CASE_ROOT/failure.log"
    [ ! -s "$CASE_ROOT/calls" ]
  done
}
reject_image 's#ghcr.io/rhanka/radar-api@sha256:[a-f0-9]*#ghcr.io/rhanka/radar-api:latest#g' 'operator requires API/MCP/denial image digest pins'
echo 'ok: general apply and route reject mutable images before any cluster call'
other="ghcr.io/rhanka/radar-api@sha256:$(printf 'b%.0s' {1..64})"
reject_image "/^  name: radar-immo-mcp$/,/^---$/{s#$image#$other#;}" 'operator requires matching API/MCP/denial image digests'
echo 'ok: general apply and route reject divergent MCP/API images'
cp "$CASE_ROOT/pinned.yaml" "$CASE_ROOT/output/render.yaml"
operator apply-runtime route >"$CASE_ROOT/apply.log"
echo 'ok: general apply and route accept matching pinned images'
echo 'check-h3-activation-commands tests: 18 passed, 0 failed'
