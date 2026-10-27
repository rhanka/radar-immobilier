#!/usr/bin/env bash
# Test-only legacy H3 state. Never applied; keep rehearsal mutation coverage
# independent of the general-opening overlay shipped to preprod.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:?disposable fixture directory required}"
mkdir -p "$DEST"
(cd "$ROOT" && cp -r --parents deploy/k8s deploy/overlays/preprod "$DEST")
OVERLAY="$DEST/deploy/overlays/preprod"
cat >"$OVERLAY/patch-artifacts-control.yaml" <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: radar-api
data:
  ARTIFACTS_CONTROL_MODE: "off"
YAML
awk '
  function emit() { if (block ~ /name: ARTIFACTS_S3_(ACCESS_KEY|SECRET_KEY)/) printf "%s", block }
  /^- op:/ { emit(); block = "" }
  { block = block $0 "\n" }
  END { emit() }
' "$OVERLAY/patch-artifacts-api-env.yaml" >"$DEST/api-env.yaml"
mv "$DEST/api-env.yaml" "$OVERLAY/patch-artifacts-api-env.yaml"
sed -i '/^  ARTIFACTS_/d' "$OVERLAY/patch-immo-mcp-config.yaml"
sed -i -e 's/preprod.immo-pages.sent-tech.ca/artifacts-content-unverified.invalid/g' \
  -e 's/radar-artifact-content-preprod-tls/radar-artifact-content-unverified-tls/g' \
  -e 's/name: radar-api$/name: radar-artifact-content-deny/' \
  "$OVERLAY/artifact-content-ingress.yaml"
