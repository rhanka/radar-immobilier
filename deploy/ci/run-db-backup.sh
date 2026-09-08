#!/usr/bin/env bash
# =============================================================================
# run-db-backup.sh — BACKUP-BEFORE-RELEASE runner (§1(a), ruling i-infra B′).
#
# Renders deploy/ci/db-backup-job.tmpl.yaml, applies it, and POLLS the Job to
# completion FAIL-CLOSED: Job success → exit 0 (release may proceed); Job
# failure or timeout → exit 1 (release ABORTS). The DB dump runs IN-CLUSTER as a
# network client (pg_dump -h radar-postgres) inside the Job — this runner never
# touches the DB and needs NO pods/exec; the CI ServiceAccount needs only
# `batch/jobs`. Retention prune runs here (runner-side, S3-ONLY: it lists/deletes
# old objects, never reaches the cluster or DB) and is the only NON-fatal stage.
#
# SECRETS: never printed. The Job reads DB + S3 creds from in-cluster secrets
# (secretKeyRef); this runner reads only the S3 creds it needs for retention
# (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) from env and never echoes them.
#
# ENV (required): BACKUP_ENV, BACKUP_TAG, NAMESPACE, BACKUP_S3_BUCKET,
#   BACKUP_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
# ENV (optional, defaults): DUMP_IMAGE=postgis/postgis:16-3.4,
#   UPLOAD_IMAGE=peakcom/s5cmd:v2.2.2, PGHOST=radar-postgres,
#   DB_SECRET=radar-db-credentials, S3_SECRET=radar-backup-s3-credentials,
#   BACKUP_S3_REGION="", BACKUP_RETAIN_COUNT=14, BACKUP_PREFIX=db-backups,
#   TTL_SECONDS=3600, BACKUP_WAIT_TIMEOUT=900, BACKUP_POLL_INTERVAL=10,
#   TEMPLATE=<dir>/db-backup-job.tmpl.yaml.
# =============================================================================
set -euo pipefail

log()  { echo "[db-backup] $*"; }
die()  { echo "::error title=db-backup failed::$*"; exit 1; }
warn() { echo "::warning title=db-backup::$*"; }

: "${BACKUP_ENV:?BACKUP_ENV required}"
: "${BACKUP_TAG:?BACKUP_TAG required}"
: "${NAMESPACE:?NAMESPACE required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required (retention)}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required (retention)}"

export DUMP_IMAGE="${DUMP_IMAGE:-postgis/postgis:16-3.4}"
export UPLOAD_IMAGE="${UPLOAD_IMAGE:-peakcom/s5cmd:v2.2.2}"
export PGHOST="${PGHOST:-radar-postgres}"
export DB_SECRET="${DB_SECRET:-radar-db-credentials}"
export S3_SECRET="${S3_SECRET:-radar-backup-s3-credentials}"
export BACKUP_S3_REGION="${BACKUP_S3_REGION:-}"
export TTL_SECONDS="${TTL_SECONDS:-3600}"
BACKUP_RETAIN_COUNT="${BACKUP_RETAIN_COUNT:-14}"
BACKUP_PREFIX="${BACKUP_PREFIX:-db-backups}"
WAIT_TIMEOUT="${BACKUP_WAIT_TIMEOUT:-900}"
POLL_INTERVAL="${BACKUP_POLL_INTERVAL:-10}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${TEMPLATE:-${HERE}/db-backup-job.tmpl.yaml}"
[ -f "$TEMPLATE" ] || die "template not found: ${TEMPLATE}"

# Overridable only to make the retention/exclusion path deterministic under test
# (a fixed current-key timestamp); unset in every real run, so the default holds.
TS_KEY="${TS_KEY:-$(date -u +%Y%m%dT%H%M%SZ)}"
TS_NAME="${TS_NAME:-$(date -u +%Y%m%d%H%M%S)}"
export KEY="${BACKUP_PREFIX}/${BACKUP_ENV}-${BACKUP_TAG}-${TS_KEY}.sql.gz"
export BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT NAMESPACE
# k8s object names are RFC1123: lowercase alnum + '-', <=63 chars.
raw_name="db-backup-${BACKUP_ENV}-${BACKUP_TAG}-${TS_NAME}"
JOB_NAME="$(printf '%s' "$raw_name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | cut -c1-63 | sed 's/-*$//')"
export JOB_NAME

RENDER="$(mktemp)"
cleanup() {
  kubectl -n "$NAMESPACE" delete job "$JOB_NAME" --ignore-not-found >/dev/null 2>&1 || true
  rm -f "$RENDER"
}
trap cleanup EXIT

EP_HOST="${BACKUP_S3_ENDPOINT#*://}"; EP_HOST="${EP_HOST%%/*}"
log "env=${BACKUP_ENV} ns=${NAMESPACE} job=${JOB_NAME} → s3://${BACKUP_S3_BUCKET}/${KEY} (endpoint ${EP_HOST})"

# --- render + apply (fail-closed) -------------------------------------------
envsubst '${JOB_NAME} ${NAMESPACE} ${TTL_SECONDS} ${DUMP_IMAGE} ${PGHOST} ${DB_SECRET} ${UPLOAD_IMAGE} ${BACKUP_S3_ENDPOINT} ${BACKUP_S3_BUCKET} ${KEY} ${S3_SECRET} ${BACKUP_S3_REGION}' \
  < "$TEMPLATE" > "$RENDER"
kubectl -n "$NAMESPACE" apply -f "$RENDER" || die "kubectl apply failed for job ${JOB_NAME}"

# --- poll to completion, fail-closed ----------------------------------------
# Poll .status.succeeded / .status.failed rather than `kubectl wait
# --for=condition=complete` alone, so a FAILED job aborts immediately instead of
# blocking until the timeout. Any of: job failed, timeout, unreadable status →
# non-zero exit → the calling release step aborts before it rolls the image.
deadline=$(( $(date +%s) + WAIT_TIMEOUT ))
job_logs() {
  # best-effort: needs pods/log, which the least-privilege batch/jobs-only SA
  # does NOT have — so this is expected to no-op there (logs visible owner-side).
  kubectl -n "$NAMESPACE" logs "job/${JOB_NAME}" --all-containers=true --tail=50 2>/dev/null \
    || echo "(job logs unavailable — batch/jobs-only RBAC has no pods/log)"
}
while :; do
  succeeded="$(kubectl -n "$NAMESPACE" get job "$JOB_NAME" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
  failed="$(kubectl -n "$NAMESPACE" get job "$JOB_NAME" -o jsonpath='{.status.failed}' 2>/dev/null || true)"
  if [ "${succeeded:-0}" != "" ] && [ "${succeeded:-0}" -ge 1 ] 2>/dev/null; then
    log "backup job completed OK"
    break
  fi
  if [ "${failed:-0}" != "" ] && [ "${failed:-0}" -ge 1 ] 2>/dev/null; then
    job_logs
    die "backup job FAILED (no upload guarantee) — release aborted"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    job_logs
    die "backup job did not complete within ${WAIT_TIMEOUT}s — release aborted"
  fi
  sleep "$POLL_INTERVAL"
done

log "backup uploaded: s3://${BACKUP_S3_BUCKET}/${KEY}"

# --- retention prune (runner-side, S3-only, NON-fatal) ----------------------
prune() {
  local listing
  listing="$(s5cmd --endpoint-url "$BACKUP_S3_ENDPOINT" ls "s3://${BACKUP_S3_BUCKET}/${BACKUP_PREFIX}/${BACKUP_ENV}-" 2>/dev/null)" || return 1
  local cur candidates total drop
  cur="${KEY##*/}"   # the backup we just created — it must NEVER be pruned.
  # Build the prune CANDIDATE list = every OTHER backup, ordered CHRONOLOGICALLY by
  # the S3 object date/time — the first two columns of `s5cmd ls`
  # (`YYYY/MM/DD HH:MM:SS`, whose lexical order IS chronological) — NOT by object
  # name: a name sort of <env>-<sha>-<ts> is dominated by the random <sha>, so it
  # is not time-ordered and could rank a fresh low-sha backup among the "oldest".
  # Three guards:
  #   - the current key is excluded UP FRONT (not filtered after selection), so it
  #     is never a deletion candidate under any clock skew AND the keep-count math
  #     is exact (no off-by-one) — the current backup is always additionally kept;
  #   - only lines whose first two fields are a real date+time are taken (a
  #     non-date line is skipped, never counted, never pruned — we never delete an
  #     object we cannot time-order);
  #   - `LC_ALL=C sort` for a stable, locale-independent byte order.
  candidates="$(printf '%s\n' "$listing" \
    | awk 'NF>=3 && $1 ~ /^[0-9]{4}\/[0-9]{2}\/[0-9]{2}$/ && $2 ~ /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/ {print $1" "$2"\t"$NF}' \
    | { grep -vF -- "$cur" || :; } \
    | LC_ALL=C sort \
    | cut -f2-)"
  total="$(printf '%s\n' "$candidates" | grep -c . || true)"
  [ "$total" -le "$BACKUP_RETAIN_COUNT" ] && { log "retention: ${total} prior backups ≤ ${BACKUP_RETAIN_COUNT}, nothing to prune"; return 0; }
  drop=$(( total - BACKUP_RETAIN_COUNT ))
  log "retention: ${total} prior backups, keeping ${BACKUP_RETAIN_COUNT} newest, pruning ${drop} oldest (current backup always kept)"
  printf '%s\n' "$candidates" | head -n "$drop" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    local obj="${name##*/}"
    s5cmd --endpoint-url "$BACKUP_S3_ENDPOINT" rm "s3://${BACKUP_S3_BUCKET}/${BACKUP_PREFIX}/${obj}" \
      && log "pruned ${obj}" || warn "prune failed for ${obj}"
  done
}
prune || warn "retention prune failed (backup itself is safe)"

log "done — release may proceed"
