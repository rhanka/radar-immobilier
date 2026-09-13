#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUPPORT="$ROOT/deploy/k8s/object-storage-inventory-preprod"
JOB="$SUPPORT/job.yaml"
RENDER="$(mktemp "${TMPDIR:-/tmp}/inventory-support.XXXXXX")"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/inventory-job-test.XXXXXX")"
trap 'rm -f "$RENDER"; rm -rf "$TEST_TMP"' EXIT
PASS=0 FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }
check() { if "$@"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi; }

TEST_NAME='renders dedicated inventory support offline'
if kubectl kustomize --load-restrictor LoadRestrictionsNone "$SUPPORT" \
    >"$RENDER" 2>/dev/null &&
  kubectl create --dry-run=client --validate=false -f "$JOB" -o name \
    >/dev/null 2>&1; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='pins inventory to the RAW operation without a write mode'
if grep -Fq '/tool/migrate-object-storage.sh inventory' "$JOB" &&
  ! grep -Eq -- '--execute-copy|put-object|delete-object|reconcile' "$JOB"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='uses only the exact reviewed credential keys'
if [ "$(grep -c 'secretKeyRef:' "$JOB")" = 8 ] &&
  grep -Fq 'key: S3_ACCESS_KEY' "$JOB" &&
  grep -Fq 'key: S3_SECRET_KEY' "$JOB" &&
  grep -Fq 'key: RAW_S3_ACCESS_KEY' "$JOB" &&
  grep -Fq 'key: RAW_S3_SECRET_KEY' "$JOB" &&
  grep -Fq 'key: RAW_S3_ENDPOINT' "$JOB" &&
  grep -Fq 'key: RAW_S3_REGION' "$JOB" &&
  grep -Fq 'key: RAW_S3_BUCKET' "$JOB" &&
  grep -Fq 'key: RAW_S3_FORCE_PATH_STYLE' "$JOB"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='reads all source coordinates from the deployed API ConfigMap'
if [ "$(grep -c 'configMapKeyRef:' "$JOB")" = 4 ] &&
  grep -Fq 'key: S3_ENDPOINT' "$JOB" && grep -Fq 'key: S3_REGION' "$JOB" &&
  grep -Fq 'key: S3_BUCKET' "$JOB" && grep -Fq 'key: S3_FORCE_PATH_STYLE' "$JOB"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='persists resumable evidence on a bounded dedicated claim'
if grep -Fq 'claimName: radar-object-storage-inventory-checkpoint' "$JOB" &&
  grep -Fq 'name: radar-object-storage-inventory-checkpoint' "$RENDER" &&
  grep -Fq 'storage: 1Gi' "$RENDER"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='applies the restricted pod security posture'
if grep -Fq 'automountServiceAccountToken: false' "$JOB" &&
  grep -Fq 'readOnlyRootFilesystem: true' "$JOB" &&
  grep -Fq 'allowPrivilegeEscalation: false' "$JOB" &&
  grep -Fq 'runAsNonRoot: true' "$JOB" && grep -Fq 'drop: ["ALL"]' "$JOB"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='opens a bounded ready-marked evidence collection window'
if grep -Fq 'marker="/evidence/export-ready/${MIGRATION_RUN_ID}"' "$JOB" &&
  grep -Fq 'test -f /evidence/export-ready/${MIGRATION_RUN_ID}' "$JOB" &&
  grep -Fq 'sleep 300' "$JOB"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

TEST_NAME='limits MinIO ingress to the dedicated inventory selector'
if grep -Fq 'name: allow-object-storage-inventory-to-minio' "$RENDER" &&
  grep -Fq 'app.kubernetes.io/component: object-storage-inventory' "$RENDER" &&
  grep -Fq 'port: 9000' "$RENDER"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='uses fence evidence only when its mounted record is non-empty'
if grep -Fq 'if [ -s /fence/fence.txt ]' "$JOB" &&
  grep -Fq 'fence=(--fence-record /fence/fence.txt)' "$JOB" &&
  grep -Fq 'name: radar-object-storage-inventory-fence' "$JOB" &&
  grep -Fq 'optional: true' "$JOB"; then ok "$TEST_NAME"; else bad "$TEST_NAME"; fi

TEST_NAME='rolling rebind maps all six RAW settings to the dedicated Secret'
if [ "$(grep -c 'name: radar-raw-s3-credentials' "$SUPPORT/raw-api-rebind-patch.yaml")" = 6 ] &&
  [ "$(grep -c 'key: RAW_S3_' "$SUPPORT/raw-api-rebind-patch.yaml")" = 6 ] &&
  ! grep -Fq 'value:' "$SUPPORT/raw-api-rebind-patch.yaml"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='live binding verifier accepts the exact six-key mapping'
if jq -n '["ACCESS_KEY","BUCKET","ENDPOINT","FORCE_PATH_STYLE","REGION","SECRET_KEY"] |
    {spec:{template:{spec:{containers:[{name:"api",env:map({name:("S3_" + .),
      valueFrom:{secretKeyRef:{name:"radar-raw-s3-credentials",key:("RAW_S3_" + .)}}})}]}}}}' |
  jq -e -f "$ROOT/deploy/ci/raw-api-ovh-binding.jq" >/dev/null; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='fence follows a settled rolling rebind without scaling workloads'
if grep -Fq 'patch deployment/radar-api --type=strategic' "$ROOT/Makefile" &&
  grep -Fq 'minioRawWriters=0' "$ROOT/Makefile" &&
  ! grep -A80 '^object-storage-raw-preprod-rebind:' "$ROOT/Makefile" | grep -Eq 'scale|cronjob|statefulset'; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

cat >"$TEST_TMP/kubectl" <<'KUBECTL'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_KUBECTL_LOG"
if [ "${1:-}" = kustomize ]; then
  printf 'apiVersion: v1\nkind: ConfigMap\n'
elif [ "${1:-}" = create ] && [[ " $* " == *' --dry-run=client '* ]]; then
  printf 'job.batch/radar-object-storage-inventory-raw-test\n'
elif [ "${1:-}" = create ]; then
  printf 'job.batch/radar-object-storage-inventory-raw-test created\n'
fi
KUBECTL
chmod +x "$TEST_TMP/kubectl"
: >"$TEST_TMP/kubeconfig"; : >"$TEST_TMP/kubectl.log"

TEST_NAME='start target refuses absent explicit confirmation before kubectl'
if ! FAKE_KUBECTL_LOG="$TEST_TMP/kubectl.log" make --no-print-directory -C "$ROOT" \
    object-storage-inventory-preprod-start KUBECTL="$TEST_TMP/kubectl" \
    KUBECONFIG="$TEST_TMP/kubeconfig" ENV=preprod >/dev/null 2>&1 &&
  [ ! -s "$TEST_TMP/kubectl.log" ]; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

: >"$TEST_TMP/kubectl.log"
TEST_NAME='confirmed start applies support then creates one new Job without delete'
if FAKE_KUBECTL_LOG="$TEST_TMP/kubectl.log" make --no-print-directory -C "$ROOT" \
    object-storage-inventory-preprod-start KUBECTL="$TEST_TMP/kubectl" \
    KUBECONFIG="$TEST_TMP/kubeconfig" OBJECT_STORAGE_INVENTORY_CONFIRM=1 \
    ENV=preprod >/dev/null 2>&1 &&
  grep -Fq 'apply -f ' "$TEST_TMP/kubectl.log" &&
  grep -Fq 'create -f deploy/k8s/object-storage-inventory-preprod/job.yaml' \
    "$TEST_TMP/kubectl.log" && ! grep -Fq 'delete' "$TEST_TMP/kubectl.log"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

TEST_NAME='evidence fetch is independent of tar and restricts remote paths'
if ! grep -Fq '] cp ' "$ROOT/Makefile" &&
  grep -Fq 'raw-checkpoint/*|reports/*|export-ready/*' "$ROOT/Makefile" &&
  grep -Fq 'find /evidence -type f -print' "$ROOT/Makefile"; then
  ok "$TEST_NAME"
else bad "$TEST_NAME"; fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
