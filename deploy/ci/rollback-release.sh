#!/usr/bin/env bash
# =============================================================================
# rollback-release.sh — ROLLBACK-ON-FAILED-RELEASE (§1(b), ruling i-infra).
#
# IMAGE-ONLY rollback: reverts the Deployments to their PREVIOUS revision via
# `kubectl rollout undo` (which re-pins the N-1 image the ReplicaSet already
# holds) when a release fails its HEALTH checks. No new RBAC — `rollout undo` is
# a Deployment patch, which the CD ServiceAccount already has.
#
# GUARDS (fail-loud, never claim success on a broken state):
#   G1  — a previous revision MUST exist (rollout history ≥ 2). If not, there is
#         nothing to roll back to → fail-loud + page owner (do NOT pretend OK).
#   G2  — after undo, assert health: `rollout status` Ready AND a served-endpoint
#         check (endpoint answers, and — when the failed sha is known — is NOT
#         still serving it). A broken post-rollback state fail-loud + pages owner.
#   G3  — log the revision/image each Deployment landed on (auditable).
#   B3  — surface LOUD even on SUCCESS: a rollback is an incident, never silent.
#   B5  — ONE SHOT. Any failure here exits non-zero and STOPS (no loop, no
#         re-rollback) — a failed rollback is a human-escalation event.
#
# IMAGE-ONLY / MIGRATION SEAM (links §1a + §1b + §2): rolling the IMAGE back is
# safe ONLY when DB migrations are backward-compatible (expand-contract /
# additive — e.g. the §2 anchor cutover is additive, 0 backfill). If a release
# shipped a BREAKING migration, the previous image may not match the migrated
# schema — the G2 served-check catches that schema/code mismatch and fail-loud,
# and the correct recovery is the OWNER-GATED DB-restore (from the §1a backup),
# NOT this image rollback. This script never restores the DB.
#
# ENV (required): NAMESPACE, PUBLIC_HOST.
# ENV (optional): DEPLOYMENTS="radar-api radar-ui", ROLLBACK_ENV="preprod",
#   FAILED_REF (short sha of the failed release — enables the "not still serving
#   the failed build" assertion + names the incident), ROLLBACK_STATUS_TIMEOUT=180,
#   SERVED_CHECK_TIMEOUT=150, SERVED_POLL_INTERVAL=10.
# =============================================================================
set -euo pipefail

log()  { echo "[rollback] $*"; }
die()  { echo "::error title=Rollback FAILED — page owner::$*"; exit 1; }
loud() { echo "::warning title=RELEASE ROLLED BACK::$*"; }

: "${NAMESPACE:?NAMESPACE required}"
: "${PUBLIC_HOST:?PUBLIC_HOST required (served health-check)}"
DEPLOYMENTS="${DEPLOYMENTS:-radar-api radar-ui}"
ROLLBACK_ENV="${ROLLBACK_ENV:-preprod}"
FAILED_REF="${FAILED_REF:-}"
STATUS_TIMEOUT="${ROLLBACK_STATUS_TIMEOUT:-180}"
SERVED_TIMEOUT="${SERVED_CHECK_TIMEOUT:-150}"
POLL="${SERVED_POLL_INTERVAL:-10}"

log "env=${ROLLBACK_ENV} ns=${NAMESPACE} deployments='${DEPLOYMENTS}' failed_ref=${FAILED_REF:-<manual>}"

# --- G1: a previous revision must exist for EVERY target (pre-flight) --------
# Checked for all before undoing any, so we never half-roll-back a set.
for d in $DEPLOYMENTS; do
  revs="$(kubectl -n "$NAMESPACE" rollout history "deploy/$d" 2>/dev/null | grep -cE '^[0-9]+' || true)"
  log "G1: deploy/$d revisions=${revs:-0}"
  if [ "${revs:-0}" -lt 2 ]; then
    die "G1: deploy/$d has no previous revision (history=${revs:-0}); nothing to roll back to. Manual recovery required."
  fi
done

# --- rollout undo (image-only, N-1 revision) --------------------------------
for d in $DEPLOYMENTS; do
  log "rollout undo deploy/$d …"
  kubectl -n "$NAMESPACE" rollout undo "deploy/$d" || die "rollout undo failed for deploy/$d"
done

# --- G2 (part 1) + G3: each Deployment becomes Ready; log landed image ------
for d in $DEPLOYMENTS; do
  kubectl -n "$NAMESPACE" rollout status "deploy/$d" --timeout="${STATUS_TIMEOUT}s" \
    || die "G2: deploy/$d not Ready ${STATUS_TIMEOUT}s after rollback — cluster in a broken state, page owner"
  img="$(kubectl -n "$NAMESPACE" get "deploy/$d" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  log "G3: deploy/$d rolled back → image=${img:-<unknown>}"
done

# --- G2 (part 2): served health-check on the public endpoint ----------------
# The endpoint must answer healthy AFTER rollback, and — when we know the failed
# sha — must NOT still be serving it. Never claim success on a broken endpoint.
fetch_sha() { curl -s --max-time 10 "$1" | jq -r '.sha // empty' 2>/dev/null || true; }
api_url="https://${PUBLIC_HOST}/health"
ui_url="https://${PUBLIC_HOST}/build.json"
deadline=$(( $(date +%s) + SERVED_TIMEOUT ))
api_sha=""; ui_sha=""
while :; do
  api_sha="$(fetch_sha "$api_url")"
  ui_sha="$(fetch_sha "$ui_url")"
  if [ -n "$api_sha" ] && [ -n "$ui_sha" ]; then
    # Healthy responses on both surfaces. If we know the failed sha, the endpoint
    # must NOT still be serving it (that would mean the rollback did not take).
    if [ -n "$FAILED_REF" ] && [ "$api_sha" = "$FAILED_REF" ]; then
      die "G2: endpoint still serves the FAILED build ${FAILED_REF} after rollback — rollback ineffective, page owner"
    fi
    log "G2 served-check OK — ${PUBLIC_HOST} healthy (api=${api_sha} ui=${ui_sha})"
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    die "G2: ${PUBLIC_HOST} not serving a healthy build ${SERVED_TIMEOUT}s after rollback (api='${api_sha:-<none>}' ui='${ui_sha:-<none>}') — page owner"
  fi
  sleep "$POLL"
done

# --- B3: LOUD surfacing — a rollback is an incident, never silent -----------
loud "release ${FAILED_REF:-<manual>} FAILED in ${ROLLBACK_ENV}/${NAMESPACE} → rolled back ${DEPLOYMENTS// /, } to previous revision (now serving sha ${api_sha}). Investigate the failed release before re-deploying."
log "rollback complete — endpoint healthy on the previous build. B5: one-shot, no retry."
