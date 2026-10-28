#!/usr/bin/env bash
# Independent closure steps: never leave MCP running because API/routing failed.
set -euo pipefail
kubectl="${1:-kubectl}"
k() { "$kubectl" -n radar-immobilier-preprod "$@"; }
status=0
failed() { echo "FAIL: rollback $*" >&2; status=1; }
for name in radar-api immo-mcp-config; do
  k patch configmap "$name" --type merge -p '{"data":{"ARTIFACTS_CONTROL_MODE":"off"}}' || failed "ConfigMap/$name closure"
done
if ingress="$(k get ingress radar-artifact-content --ignore-not-found -o name)"; then
  if [ -n "$ingress" ]; then
    k patch ingress radar-artifact-content --type json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"radar-artifact-content-deny"},{"op":"replace","path":"/spec/rules/1/http/paths/0/backend/service/name","value":"radar-artifact-content-deny"}]' || failed 'Ingress cutoff'
  else
    echo 'Rollback: content Ingress absent; no route to cut'
  fi
else
  failed 'Ingress lookup (absence not established)'
fi
# Request BOTH restarts before waiting for either rollout.
for name in radar-api radar-immo-mcp; do
  k rollout restart "deployment/$name" || failed "Deployment/$name restart"
done
for name in radar-api radar-immo-mcp; do
  k rollout status "deployment/$name" --timeout=180s || failed "Deployment/$name readiness"
done
for name in radar-api immo-mcp-config; do
  if mode="$(k get configmap "$name" -o 'jsonpath={.data.ARTIFACTS_CONTROL_MODE}')" && [ "$mode" = off ]; then :
  else failed "ConfigMap/$name effective mode"; fi
done
# Check every selected pod, including an old replica left by a failed rollout.
for component in api mcp; do
  if pods="$(k get pods -l "app.kubernetes.io/name=radar-immobilier,app.kubernetes.io/component=$component" -o name)" && [ -n "$pods" ]; then
    while IFS= read -r pod; do
      if mode="$(k exec "$pod" -- printenv ARTIFACTS_CONTROL_MODE)" && [ "$mode" = off ]; then
        echo "Rollback: $pod publication mode verified off"
      else failed "$pod publication remains open or unverified"; fi
    done <<<"$pods"
  else failed "$component pods missing or unreadable"; fi
done
[ "$status" -eq 0 ] || exit 1
echo 'Rollback: API/MCP publication closed; verify external content refusal'
