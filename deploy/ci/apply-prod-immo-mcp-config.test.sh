#!/usr/bin/env bash
# Hermetic tests for deploy/ci/apply-prod-immo-mcp-config.sh.
# Uses real `kubectl kustomize` (offline, KUBECONFIG=/dev/null) and a fake
# kubectl wrapper for cluster calls; never touches any live cluster.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT="$SCRIPT_DIR/apply-prod-immo-mcp-config.sh"
REAL_KUBECTL="$(command -v kubectl)"

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/kubectl" <<EOF
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${FAKE_KUBECTL_STATE:?}"
printf '%s\n' "\$*" >> "\$STATE_DIR/calls.log"
if [[ "\${1:-}" == "kustomize" ]]; then
  exec env KUBECONFIG=/dev/null "${REAL_KUBECTL}" "\$@"
fi
if [[ "\$*" == *"config view"* ]]; then
  echo "\${FAKE_SERVER:-https://hlhedx.c1.bhs5.k8s.ovh.net:6443}"
  exit 0
fi
if [[ "\$*" == *"get deploy radar-immo-mcp"* ]]; then
  if [[ "\${FAKE_MCP_PRESENT:-1}" == "1" ]]; then
    echo "deployment.apps/radar-immo-mcp"
  fi
  exit 0
fi
if [[ "\$*" == *"apply -f "* ]]; then
  for arg in "\$@"; do last="\$arg"; done
  cp "\$last" "\$STATE_DIR/applied.yaml"
  echo "configmap/immo-mcp-config configured"
  exit 0
fi
if [[ "\$*" == *"get configmap immo-mcp-config -o json"* ]]; then
  cat "\$STATE_DIR/live-cm.json"
  exit 0
fi
echo "unexpected kubectl call: \$*" >&2
exit 99
EOF
chmod +x "$TMP/bin/kubectl"

write_clean_live_cm() {
  cat > "$1" <<'JSON'
{
  "apiVersion": "v1",
  "kind": "ConfigMap",
  "metadata": {
    "name": "immo-mcp-config",
    "namespace": "radar-immobilier",
    "labels": {
      "app.kubernetes.io/component": "mcp",
      "app.kubernetes.io/name": "radar-immobilier",
      "app.kubernetes.io/part-of": "sentropic"
    }
  },
  "data": {
    "IMMO_MCP_SIGNALS_WRITE_ENABLED": "0"
  }
}
JSON
}

# 1. Happy path: applies ONLY ConfigMap/immo-mcp-config, byte-identical to what
# check-prod-drift.sh renders (so post-apply drift is 0), keeping IMMO_MCP_SIGNALS_WRITE_ENABLED="0".
S1="$TMP/s1"; mkdir -p "$S1"
write_clean_live_cm "$S1/live-cm.json"
env KUBECONFIG=/dev/null "$REAL_KUBECTL" kustomize "$ROOT/deploy/k8s/immo-mcp" > "$S1/drift-all.yaml"
bash "$ROOT/deploy/ci/kfilter.sh" "$S1/drift-all.yaml" ConfigMap immo-mcp-config > "$S1/drift-expected.yaml"

if FAKE_KUBECTL_STATE="$S1" KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" "$ROOT" >"$S1/out.txt" 2>&1 \
  && cmp -s "$S1/applied.yaml" "$S1/drift-expected.yaml" \
  && [[ "$(grep -c '^kind:' "$S1/applied.yaml")" -eq 1 ]] \
  && grep -Eq '^kind:[[:space:]]+ConfigMap$' "$S1/applied.yaml" \
  && grep -Eq 'IMMO_MCP_SIGNALS_WRITE_ENABLED:[[:space:]]+"0"' "$S1/applied.yaml" \
  && ! grep -Eq '^kind:[[:space:]]+(Deployment|Service|Ingress|Secret)$' "$S1/applied.yaml"; then
  ok "applies ONLY ConfigMap/immo-mcp-config, byte-identical to check-prod-drift.sh render with IMMO_MCP_SIGNALS_WRITE_ENABLED=0"
else
  bad "happy path ($(cat "$S1/out.txt"))"
fi

# 2. Absent radar-immo-mcp Deployment skips cleanly without applying.
S2="$TMP/s2"; mkdir -p "$S2"
if FAKE_KUBECTL_STATE="$S2" FAKE_MCP_PRESENT=0 KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" "$ROOT" >"$S2/out.txt" 2>&1 \
  && [[ ! -f "$S2/applied.yaml" ]] \
  && grep -Fq "skipping ConfigMap/immo-mcp-config apply" "$S2/out.txt"; then
  ok "skips cleanly when Deployment/radar-immo-mcp is absent"
else
  bad "absent deployment skip ($(cat "$S2/out.txt"))"
fi

# 3. Wrong apiserver host fails pre-flight before any get or apply.
S3="$TMP/s3"; mkdir -p "$S3"
if FAKE_KUBECTL_STATE="$S3" FAKE_SERVER="https://wrong.example:6443" KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" "$ROOT" >"$S3/out.txt" 2>&1; then
  bad "wrong apiserver host accepted"
elif [[ ! -f "$S3/applied.yaml" ]] && grep -Fq "Wrong cluster" "$S3/out.txt"; then
  ok "wrong apiserver host fails pre-flight before apply"
else
  bad "wrong host refusal ($(cat "$S3/out.txt"))"
fi

# 4. Non-prod namespace is refused.
S4="$TMP/s4"; mkdir -p "$S4"
if FAKE_KUBECTL_STATE="$S4" NAMESPACE="radar-immobilier-preprod" KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" "$ROOT" >"$S4/out.txt" 2>&1; then
  bad "non-prod namespace accepted"
elif [[ ! -f "$S4/applied.yaml" ]] && grep -Fq "Refusing non-prod namespace" "$S4/out.txt"; then
  ok "non-prod namespace refused before any kubectl call"
else
  bad "non-prod namespace refusal ($(cat "$S4/out.txt"))"
fi

# 5. Mutated base with IMMO_MCP_SIGNALS_WRITE_ENABLED="1" is refused before apply.
S5="$TMP/s5"; mkdir -p "$S5/repo/deploy/k8s" "$S5/repo/deploy/ci"
cp -r "$ROOT/deploy/k8s/immo-mcp" "$S5/repo/deploy/k8s/"
cp "$ROOT/deploy/ci/kfilter.sh" "$ROOT/deploy/ci/kfilter.jq" "$ROOT/deploy/ci/check-prod-drift-summary.mjs" "$S5/repo/deploy/ci/"
sed -i 's/IMMO_MCP_SIGNALS_WRITE_ENABLED: "0"/IMMO_MCP_SIGNALS_WRITE_ENABLED: "1"/' "$S5/repo/deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml"
if FAKE_KUBECTL_STATE="$S5" KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" "$S5/repo" >"$S5/out.txt" 2>&1; then
  bad "IMMO_MCP_SIGNALS_WRITE_ENABLED=1 in base was accepted"
elif [[ ! -f "$S5/applied.yaml" ]] && grep -Fq 'IMMO_MCP_SIGNALS_WRITE_ENABLED: "0"' "$S5/out.txt"; then
  ok "refuses mutated base with IMMO_MCP_SIGNALS_WRITE_ENABLED=1 before apply"
else
  bad "inert flag guard ($(cat "$S5/out.txt"))"
fi

# 6. Post-apply verification fails if live ConfigMap misses required labels or flag.
S6="$TMP/s6"; mkdir -p "$S6"
echo '{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"immo-mcp-config","labels":{}},"data":{}}' > "$S6/live-cm.json"
if FAKE_KUBECTL_STATE="$S6" KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" "$ROOT" >"$S6/out.txt" 2>&1; then
  bad "missing live labels/flag passed post-apply check"
elif grep -Fq "post-apply verification failed" "$S6/out.txt"; then
  ok "post-apply verification fails when live ConfigMap misses labels or flag"
else
  bad "post-apply check ($(cat "$S6/out.txt"))"
fi

echo "apply-prod-immo-mcp-config.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
