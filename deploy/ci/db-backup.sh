#!/usr/bin/env bash
# =============================================================================
# db-backup.sh — BACKUP-BEFORE-RELEASE (§1(a), spec i-infra, preprod-first).
#
# Takes a logical pg_dump of the live database and uploads it, gzipped, to an
# EXTERNAL S3 bucket (Scaleway Object Storage) BEFORE a release rolls the new
# image. Wired into the CD `deploy-preprod` job ahead of the `set image` step so
# a failed backup ABORTS the release (fail-closed): no un-backed-up roll.
#
# WHY exec, not a runner-side connection: `radar-postgres` is a ClusterIP
# StatefulSet (deploy/k8s/20-postgres-postgis.yaml) with no public route, and
# its credentials live only in the in-cluster secret `radar-db-credentials`,
# injected into the pod env. So the dump runs INSIDE the pod via `kubectl exec`
# (using the pod's own $POSTGRES_USER/$POSTGRES_DB) and streams SQL to this
# runner over the exec channel; the runner compresses and uploads to the
# external bucket. The in-cluster MinIO (`radar-minio`, ClusterIP) is NOT a
# valid backup target — it is unreachable from a GitHub runner AND lives on the
# same cluster it would be backing up (a backup that dies with the cluster is no
# backup). Hence an external SCW bucket, same client (`s5cmd`) the ingest path
# already uses (tools/grounding/worker-grounding.sh).
#
# EXEC CREDENTIAL PREREQ (provisioning, owner/auth + i-infra): the CD deployer
# SA `radar-ci-deployer-preprod` is least-privilege deployments-only and CANNOT
# `pods/exec` as committed (deploy/k8s/11-ci-deployer-preprod-rbac.yaml). This
# script needs a kubeconfig whose SA CAN `create pods/exec` in the target
# namespace — provisioned out-of-band (RBAC delta applied by poc-k8s). This
# script references only the already-configured kubeconfig ($HOME/.kube/config)
# + env; it commits no credential and no bucket value.
#
# FAIL-CLOSED: `set -euo pipefail` + explicit required-var checks + dump
# integrity checks. Any failure of dump / compress / integrity / upload exits
# non-zero so the calling release step (which runs BEFORE `set image`) aborts.
# Retention pruning is the ONLY non-fatal stage (a prune hiccup must not red a
# release whose backup already landed) — it warns instead.
#
# SECRETS: never printed. Only NON-secret identifiers (namespace, pod, bucket,
# object key, endpoint host) are echoed. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# are consumed by s5cmd from the environment and never echoed.
#
# ENV (required unless noted):
#   BACKUP_ENV            env label for the key + retention scope (e.g. preprod)
#   BACKUP_TAG            build id for the key (e.g. short sha or v-tag)
#   NAMESPACE            k8s namespace of the postgres pod
#   BACKUP_S3_BUCKET      external S3 bucket name (no s3:// prefix)
#   BACKUP_S3_ENDPOINT    S3 endpoint URL (e.g. https://s3.fr-par.scw.cloud)
#   AWS_ACCESS_KEY_ID     RW cred for the bucket (consumed by s5cmd)
#   AWS_SECRET_ACCESS_KEY RW cred for the bucket (consumed by s5cmd)
#   POSTGRES_POD          optional, default radar-postgres-0 (StatefulSet pod)
#   POSTGRES_CONTAINER    optional, default postgres
#   BACKUP_S3_REGION      optional, passed to s5cmd if set
#   BACKUP_RETAIN_COUNT   optional, default 14 (newest kept per BACKUP_ENV)
#   BACKUP_PREFIX         optional, default db-backups (key path prefix)
# =============================================================================
set -euo pipefail

log()  { echo "[db-backup] $*"; }
die()  { echo "::error title=db-backup failed::$*"; exit 1; }
warn() { echo "::warning title=db-backup::$*"; }

# --- required config (fail-closed on any missing) ---------------------------
: "${BACKUP_ENV:?BACKUP_ENV required (env label, e.g. preprod)}"
: "${BACKUP_TAG:?BACKUP_TAG required (build id, e.g. short sha)}"
: "${NAMESPACE:?NAMESPACE required (k8s namespace of postgres)}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET required (external S3 bucket)}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT required (S3 endpoint URL)}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required (bucket RW cred)}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required (bucket RW cred)}"

POSTGRES_POD="${POSTGRES_POD:-radar-postgres-0}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres}"
BACKUP_RETAIN_COUNT="${BACKUP_RETAIN_COUNT:-14}"
BACKUP_PREFIX="${BACKUP_PREFIX:-db-backups}"

# s5cmd flags: endpoint always; region only if provided.
S5_ARGS=(--endpoint-url "$BACKUP_S3_ENDPOINT")
[ -n "${BACKUP_S3_REGION:-}" ] && export AWS_REGION="$BACKUP_S3_REGION"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="${BACKUP_PREFIX}/${BACKUP_ENV}-${BACKUP_TAG}-${TS}.sql.gz"
DEST="s3://${BACKUP_S3_BUCKET}/${KEY}"

# Endpoint host only (never the full URL with any embedded userinfo) for logs.
EP_HOST="${BACKUP_S3_ENDPOINT#*://}"; EP_HOST="${EP_HOST%%/*}"
log "env=${BACKUP_ENV} ns=${NAMESPACE} pod=${POSTGRES_POD} → ${DEST} (endpoint ${EP_HOST})"

# --- workspace (always cleaned) ---------------------------------------------
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
DUMP="${WORK}/backup.sql.gz"

# --- 1. dump (inside the pod) + compress (on the runner) --------------------
# pg_dump runs in the pod with the pod's own credentials; plain-SQL, portable
# restore (--no-owner --no-privileges). `set -o pipefail` makes a pg_dump /
# kubectl-exec failure fail the whole pipeline (fail-closed) — no partial upload
# because the upload is a separate, later step gated on the checks below.
log "dumping via kubectl exec (pg_dump | gzip) …"
kubectl -n "$NAMESPACE" exec "$POSTGRES_POD" -c "$POSTGRES_CONTAINER" -- \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  | gzip -c > "$DUMP" \
  || die "pg_dump/exec pipeline failed (no upload attempted)"

# --- 2. integrity gates (fail-closed) ---------------------------------------
[ -s "$DUMP" ] || die "dump is empty (0 bytes) — refusing to upload"
gzip -t "$DUMP" 2>/dev/null || die "dump failed gzip integrity check — refusing to upload"
# Confirm we actually captured a pg_dump, not an error/notice mis-streamed to
# stdout. `|| true` keeps SIGPIPE from head out of `set -e`; the case does the
# real assertion.
HEAD="$(gzip -dc "$DUMP" 2>/dev/null | head -n 8 || true)"
case "$HEAD" in
  *"PostgreSQL database dump"*) : ;;
  *) die "dump does not look like a pg_dump (missing header) — refusing to upload" ;;
esac
SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
log "dump OK — ${SIZE} bytes compressed, integrity + header verified"

# --- 3. upload (fail-closed) ------------------------------------------------
log "uploading → ${DEST}"
s5cmd "${S5_ARGS[@]}" cp "$DUMP" "$DEST" || die "upload failed → ${DEST}"
log "backup uploaded: ${DEST}"

# --- 4. retention prune (NON-fatal — backup already landed) -----------------
# Keep the newest BACKUP_RETAIN_COUNT objects for THIS env. Keys embed a
# lexically-sortable UTC timestamp, so a plain sort is chronological. Any prune
# failure only warns: it must never red a release whose backup succeeded.
prune() {
  local listing keep=$BACKUP_RETAIN_COUNT
  listing="$(s5cmd "${S5_ARGS[@]}" ls "s3://${BACKUP_S3_BUCKET}/${BACKUP_PREFIX}/${BACKUP_ENV}-" 2>/dev/null)" || return 1
  # last whitespace field = object key/name; sort asc (oldest first).
  local names
  names="$(printf '%s\n' "$listing" | awk 'NF{print $NF}' | sort)"
  local total
  total="$(printf '%s\n' "$names" | grep -c . || true)"
  [ "$total" -le "$keep" ] && { log "retention: ${total} ≤ ${keep}, nothing to prune"; return 0; }
  local drop=$(( total - keep ))
  log "retention: ${total} backups, keeping ${keep}, pruning ${drop} oldest"
  printf '%s\n' "$names" | head -n "$drop" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    # `name` is the object name as listed; rebuild the full s3 URL under prefix.
    local obj="${name##*/}"
    s5cmd "${S5_ARGS[@]}" rm "s3://${BACKUP_S3_BUCKET}/${BACKUP_PREFIX}/${obj}" \
      && log "pruned ${obj}" || warn "prune failed for ${obj}"
  done
}
prune || warn "retention prune step failed (backup itself is safe): ${DEST}"

log "done — release may proceed (backup: ${DEST})"
