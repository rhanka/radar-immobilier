#!/usr/bin/env bash
# Production CD reconcile for ConfigMap/immo-mcp-config in radar-immobilier.
#
# Renders deploy/k8s/immo-mcp with the exact same pipeline as
# deploy/ci/check-prod-drift.sh (kubectl kustomize + kfilter.sh), validates the
# single ConfigMap document (including IMMO_MCP_SIGNALS_WRITE_ENABLED == "0"
# and standard app.kubernetes.io/* labels), applies ONLY ConfigMap/immo-mcp-config
# while Deployment/radar-immo-mcp exists, and verifies the live ConfigMap.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
NAMESPACE="${NAMESPACE:-radar-immobilier}"
KUBECTL="${KUBECTL:-kubectl}"

[[ "$NAMESPACE" == "radar-immobilier" ]] \
  || { echo "::error::Refusing non-prod namespace '${NAMESPACE}'" >&2; exit 1; }

DEFAULT_HOST='hlhedx.c1.bhs5.k8s.ovh.net'
expected="${EXPECTED_KUBE_APISERVER_HOST_PROD:-${EXPECTED_KUBE_APISERVER_HOST:-$DEFAULT_HOST}}"
server="$("$KUBECTL" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
host="${server#*://}"; host="${host%%/*}"; host="${host%%:*}"
if [ "$host" != "$expected" ]; then
  echo "::error title=Wrong cluster — immo-mcp-config apply refused::apiserver host '${host:-<none>}' != '${expected}'." >&2
  exit 1
fi

tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/prod-immo-mcp-cm.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

"$KUBECTL" kustomize "$ROOT/deploy/k8s/immo-mcp" > "$tmp/immo-mcp-all.yaml"
bash "$ROOT/deploy/ci/kfilter.sh" "$tmp/immo-mcp-all.yaml" ConfigMap immo-mcp-config > "$tmp/immo-mcp-config.yaml"

node "$SCRIPT_DIR/check-prod-drift-summary.mjs" validate-render ConfigMap immo-mcp-config "$tmp/immo-mcp-config.yaml" >/dev/null

# Fail-closed guard: base prod immo-mcp-config must stay inert (signal writes "0")
# and carry the three standard app.kubernetes.io labels expected by check-prod-drift.sh.
node -e '
  const fs = require("fs");
  const text = fs.readFileSync(process.argv[1], "utf8");
  const checks = [
    ["IMMO_MCP_SIGNALS_WRITE_ENABLED: \"0\"", /^\s+IMMO_MCP_SIGNALS_WRITE_ENABLED:\s*"0"\s*$/m],
    ["label app.kubernetes.io/component: mcp", /^\s+app\.kubernetes\.io\/component:\s*mcp\s*$/m],
    ["label app.kubernetes.io/name: radar-immobilier", /^\s+app\.kubernetes\.io\/name:\s*radar-immobilier\s*$/m],
    ["label app.kubernetes.io/part-of: sentropic", /^\s+app\.kubernetes\.io\/part-of:\s*sentropic\s*$/m],
  ];
  for (const [desc, re] of checks) {
    if (!re.test(text)) {
      process.stderr.write("apply-prod-immo-mcp-config: rendered ConfigMap missing " + desc + "\n");
      process.exit(1);
    }
  }
' "$tmp/immo-mcp-config.yaml"

mcp_deploy="$("$KUBECTL" -n "$NAMESPACE" get deploy radar-immo-mcp --ignore-not-found -o name)"
if [ -z "$mcp_deploy" ]; then
  echo "radar-immo-mcp Deployment absent in ${NAMESPACE} — skipping ConfigMap/immo-mcp-config apply"
  exit 0
fi

"$KUBECTL" -n "$NAMESPACE" apply -f "$tmp/immo-mcp-config.yaml"

live_json="$("$KUBECTL" -n "$NAMESPACE" get configmap immo-mcp-config -o json)"
printf '%s' "$live_json" | jq -e '
  .data.IMMO_MCP_SIGNALS_WRITE_ENABLED == "0"
  and .metadata.labels["app.kubernetes.io/component"] == "mcp"
  and .metadata.labels["app.kubernetes.io/name"] == "radar-immobilier"
  and .metadata.labels["app.kubernetes.io/part-of"] == "sentropic"
' >/dev/null || {
  echo "::error title=immo-mcp-config post-apply verification failed::live ConfigMap/immo-mcp-config missing IMMO_MCP_SIGNALS_WRITE_ENABLED=0 or app.kubernetes.io/* labels" >&2
  exit 1
}

echo "immo-mcp-config applied and verified in ${NAMESPACE} (IMMO_MCP_SIGNALS_WRITE_ENABLED=0, app.kubernetes.io/* labels present)"
