#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

SERVED="ghcr.io/rhanka/radar-api@sha256:$(printf 'b%.0s' {1..64})"
OLD_DIGEST="ghcr.io/rhanka/radar-api@sha256:$(printf 'a%.0s' {1..64})"
BACKUP_PINNED="ghcr.io/rhanka/radar-api@sha256:cb2ab4ec8bde643d0b7d0799b7c737f007f1ba7dd2f54392221275e042c22ac8"

cat > "$TMP/bin/make" <<'MAKE_EOF'
#!/usr/bin/env bash
set -euo pipefail
img=""; out=""
for a in "$@"; do
  case "$a" in
    IMAGE_REF=*) img="${a#IMAGE_REF=}" ;;
    RENDER_OUT=*) out="${a#RENDER_OUT=}" ;;
  esac
done
cat > "$out" <<YAML
apiVersion: batch/v1
kind: CronJob
metadata:
  name: radar-refresh-pv
  namespace: radar-immobilier
spec:
  suspend: false
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: refresh-pv
              image: "${img}"
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: radar-refresh-pending-watchdog
  namespace: radar-immobilier
spec:
  suspend: false
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: refresh-pending-watchdog
              image: "${img}"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: radar-refresh-keyring
  namespace: radar-immobilier
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
YAML
MAKE_EOF

cat > "$TMP/bin/kubectl" <<'KUBECTL_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_CALLS"
while [[ "${1:-}" == -n || "${1:-}" == "--kubeconfig" ]]; do shift 2; done
case "${1:-}" in
  config) printf '%s\n' "${FAKE_APISERVER}" ;;
  create)
    cat <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: radar-backup-daily-script
  namespace: radar-immobilier
data:
  backup-daily.cjs: "stub"
YAML
    ;;
  label) cat ;;
  kustomize)
    cat <<'YAML'
apiVersion: v1
kind: ConfigMap
metadata:
  name: immo-mcp-config
  namespace: radar-immobilier
  labels:
    app.kubernetes.io/component: mcp
data:
  IMMO_MCP_SIGNALS_WRITE_ENABLED: "0"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: radar-immo-mcp
  namespace: radar-immobilier
spec: {}
YAML
    ;;
  auth) printf '%s\n' "${FAKE_CAN_I_SECRETS:-no}" ;;
  diff)
    f="${*: -1}"
    if [[ -n "${FAKE_DIFF_TARGET:-}" && "$f" == *"/${FAKE_DIFF_TARGET}.yaml" ]]; then
      if [[ -n "${FAKE_DIFF_ERR:-}" ]]; then printf '%s\n' "$FAKE_DIFF_ERR" >&2; fi
      if [[ -n "${FAKE_DIFF_FILE:-}" && -s "$FAKE_DIFF_FILE" ]]; then cat "$FAKE_DIFF_FILE"; fi
      exit "${FAKE_DIFF_RC:-1}"
    fi
    ;;
  get)
    kind="${2:-}"; name="${3:-}"
    if [[ "$kind" == "secret" ]]; then
      [[ "$*" == *"-o name"* ]] || { echo "FORBIDDEN secret read format: $*" >&2; exit 99; }
      [[ "$name" != "${FAKE_MISSING_SECRET:-}" ]] || exit 1
      printf 'secret/%s\n' "$name"; exit 0
    fi
    if [[ "$kind" == "deploy" && "$name" == "radar-api" ]]; then
      printf '{"spec":{"template":{"spec":{"containers":[{"name":"api","image":"%s"}]}}}}\n' "${FAKE_SERVED}"
      exit 0
    fi
    if [[ "$kind" == "cronjob" ]]; then
      img="${FAKE_BACKUP_PINNED}"
      if [[ "$name" == "radar-refresh-pv" ]]; then img="${FAKE_REFRESH_PV}"; fi
      if [[ "$name" == "radar-refresh-pending-watchdog" ]]; then img="${FAKE_SERVED}"; fi
      printf '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"main","image":"%s"}]}}}}}}\n' "$img"
      exit 0
    fi
    ;;
esac
KUBECTL_EOF
chmod +x "$TMP/bin/make" "$TMP/bin/kubectl"

cat > "$TMP/immo.diff" <<'DIFF_EOF'
--- live/ConfigMap/immo-mcp-config
+++ merged/ConfigMap/immo-mcp-config
@@ -1,6 +1,10 @@
 metadata:
+  labels:
+    app.kubernetes.io/component: mcp
   name: immo-mcp-config
 data:
+  IMMO_MCP_SIGNALS_WRITE_ENABLED: "0"
   NODE_OPTIONS: --dns-result-order=ipv4first
DIFF_EOF

run_case() {
  : > "$TMP/calls"
  PATH="$TMP/bin:$PATH" FAKE_CALLS="$TMP/calls" FAKE_APISERVER="https://hlhedx.c1.bhs5.k8s.ovh.net" \
    FAKE_SERVED="$SERVED" FAKE_REFRESH_PV="$SERVED" FAKE_BACKUP_PINNED="$BACKUP_PINNED" \
    "$@" bash "$ROOT/deploy/ci/check-prod-drift.sh" "$ROOT" > "$TMP/out" 2>&1
}

run_case env FAKE_CAN_I_SECRETS=no
grep -Fq "PASS prod-drift-check: 8/8" "$TMP/out"
grep -Fq "secrets:get=no — Secret existence check skipped" "$TMP/out"
! grep -Eq '\b(apply|patch|replace|delete)\b|get secret' "$TMP/calls"
echo "ok: clean 8/8 check without secrets:get passes and stays read-only"

! run_case env FAKE_DIFF_TARGET=immo-mcp-config FAKE_DIFF_FILE="$TMP/immo.diff" FAKE_DIFF_RC=1
grep -Fq "DRIFT (ConfigMap/immo-mcp-config, metadata.labels" "$TMP/out"
grep -Fq "DRIFT (ConfigMap/immo-mcp-config, data.IMMO_MCP_SIGNALS_WRITE_ENABLED)" "$TMP/out"
echo "ok: ConfigMap drift reports clear (object, field) summary"

! run_case env FAKE_REFRESH_PV="$OLD_DIGEST"
grep -Fq "DRIFT (CronJob/radar-refresh-pv," "$TMP/out"
echo "ok: stale refresh CronJob image digest fails loudly"

! run_case env FAKE_CAN_I_SECRETS=yes FAKE_MISSING_SECRET=immo-mcp-signal-writer
grep -Fq "DRIFT (Secret/immo-mcp-signal-writer, metadata.name)" "$TMP/out"
echo "ok: conditional secrets:get=yes checks -o name existence only and flags missing Secret"

! run_case env FAKE_DIFF_TARGET=immo-mcp-config FAKE_DIFF_RC=2 FAKE_DIFF_ERR="Forbidden"
grep -Fq "DRIFT (ConfigMap/immo-mcp-config, kubectl-diff-error)" "$TMP/out"
echo "ok: kubectl diff rc=2 surfaces error loudly"

! run_case env FAKE_APISERVER="https://wrong.example.invalid"
grep -Fq "Wrong cluster" "$TMP/out"
! grep -q 'diff\|get ' "$TMP/calls"
echo "ok: wrong apiserver host fails pre-flight before any get or diff"

printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: bad\n' > "$TMP/secret.yaml"
! node "$ROOT/deploy/ci/check-prod-drift-summary.mjs" validate-render Secret bad "$TMP/secret.yaml" >/dev/null 2>&1
printf 'apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: cj\nspec:\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n            - name: c\n              image: ghcr.io/rhanka/radar-api:latest\n' > "$TMP/latest.yaml"
! node "$ROOT/deploy/ci/check-prod-drift-summary.mjs" validate-render CronJob cj "$TMP/latest.yaml" >/dev/null 2>&1
echo "ok: validate-render refuses Secret and :latest image tag"
