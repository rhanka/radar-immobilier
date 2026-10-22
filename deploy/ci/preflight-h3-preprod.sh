#!/usr/bin/env bash
# H3 preprod operator preflight (861c unit 14). Read-only: renders the preprod
# overlay, runs the render gate and the auth-isolation gate, then (with
# --live and KUBECONFIG set) probes live preprod metadata WITHOUT writes.
# Any mutating flag is refused: rendering never applies resources. Canary
# writes and activation itself are manual operator steps, documented in
# docs/operator/h3-preprod-activation.md — never automated here.
#
# Usage:
#   preflight-h3-preprod.sh                 # offline checks only
#   KUBECONFIG=<path> preflight-h3-preprod.sh --live # read-only metadata
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NAMESPACE="radar-immobilier-preprod"
LIVE=0
for arg in "$@"; do
  case "$arg" in
    --apply|--write|--yes|--force)
      echo "FAIL: $arg refused: preflight never applies (see docs/operator/h3-preprod-activation.md)" >&2
      exit 1
      ;;
    --live) LIVE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "FAIL: unknown argument $arg" >&2; exit 1 ;;
  esac
done

bash "$HERE/check-h3-preprod-render.sh" "$ROOT"
bash "$HERE/check-preprod-auth-isolation.sh" "$ROOT" >/dev/null
echo "preflight: offline render gates passed (activation stays disabled)"

if [ "$LIVE" -eq 0 ]; then
  echo "preflight: offline only (--live required for cluster probes)"
  exit 0
fi
: "${KUBECONFIG:?explicit KUBECONFIG required with --live}"
command -v kubectl >/dev/null 2>&1 || { echo "FAIL: kubectl not found" >&2; exit 1; }
kubectl -n "$NAMESPACE" get namespace "$NAMESPACE" >/dev/null 2>&1 || {
  echo "FAIL: namespace $NAMESPACE unreachable with KUBECONFIG=$KUBECONFIG" >&2
  exit 1
}
echo "--- live activation state (must stay off) ---"
mode="$(kubectl -n "$NAMESPACE" get configmap radar-api -o jsonpath='{.data.ARTIFACTS_CONTROL_MODE}')"
echo "live ARTIFACTS_CONTROL_MODE: ${mode:-<absent>}"
if [ -n "$mode" ] && [ "$mode" != "off" ]; then
  echo "FAIL: live control mode is $mode (expected off or absent)" >&2
  exit 1
fi
echo "--- live denial image (must match the reviewed digest) ---"
image="$(kubectl -n "$NAMESPACE" get deploy radar-artifact-content-deny --ignore-not-found -o jsonpath='{.spec.template.spec.containers[0].image}')"
echo "${image:-<denial Deployment absent>}"
if [ -n "$image" ]; then
  : "${H3_EXPECTED_API_IMAGE:?reviewed digest required for live image verification}"
  [[ "$H3_EXPECTED_API_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'FAIL: expected image must be digest pinned' >&2; exit 1; }
  api_image="$(kubectl -n "$NAMESPACE" get deploy radar-api -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [ "$image" = "$H3_EXPECTED_API_IMAGE" ] && [ "$api_image" = "$image" ] || {
    echo 'FAIL: live API/denial images differ from reviewed digest' >&2; exit 1;
  }
fi
echo ""
echo "--- artifact Secret (expected absent while disabled) ---"
# Metadata lookup only; never retrieve Secret data.
secret="$(kubectl -n "$NAMESPACE" get secret radar-artifacts-preprod --ignore-not-found -o name)"
echo "Secret metadata: ${secret:-absent}"
echo "preflight: live probes read-only, nothing applied"
