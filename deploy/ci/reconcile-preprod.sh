#!/usr/bin/env bash
# CD manifest reconcile — radar-immobilier-preprod (targeted / option A).
#
# The deploy-preprod job runs this AFTER the fail-closed DB backup and BEFORE
# set-image, so the live preprod state tracks git for the drifted DURABLES and
# the pushed digest stays the final image (set-image last = no flap back).
#
# SCOPE (option A, drift-targeted — see the CD PR): only the resources that
# actually drift AND that the least-privilege preprod deployer SA
# (deploy/k8s/11-ci-deployer-preprod-rbac.yaml) may touch:
#   - ConfigMap radar-ui-nginx-<hash>       (#608: served nginx conf; rolls radar-ui)
#   - ConfigMap radar-api                   (per-env storage buckets: the preprod
#                                            overlay overrides SCRAPE/GRAPH_S3_BUCKET
#                                            -> docs-preprod, read by the refresh
#                                            CronJob AND the api)
#   - Deployment radar-api, radar-ui        (#611: securityContext; pre-flight-present)
#   - CronJob    radar-consistency-snapshot (#611: securityContext)
# EXCLUDED: the Namespace (PSS labels = operator act, cluster-scoped), Services /
# StatefulSets / NetworkPolicies / Ingress (operator-owned, not in the SA Role),
# the env ConfigMap radar-sentropic-auth (avoid overwriting preprod config with
# base content — radar-api is NOW reconciled: the preprod overlay patches its
# per-env storage buckets, so applying it no longer leaks the base PROD buckets),
# and the radar-maildev / radar-obscura Deployments
# (the SA has no `create`, so an absent one would 403). A comprehensive reconcile
# is a documented PR follow-up (grant deployments:create OR patch-existing-only,
# plus an ns-agnostic audit of the env ConfigMaps).
#
# FAIL-CLOSED: the ConfigMap is applied FIRST; if the hash-suffixed
# radar-ui-nginx CM cannot be created (`set -e`), the job exits BEFORE set-image,
# so radar-ui never rolls onto a Deployment referencing an absent ConfigMap.
#
# SSA FIELD OWNERSHIP: this server-side apply (field-manager cd-preprod) takes
# ownership of the fields it sets — requests/limits, securityContext, and the
# Deployment `image`. GIT IS THE SOURCE OF TRUTH for those. The set-image step
# that runs AFTER this reconcile patches `image` to the pushed digest (a
# different manager, hence the --force-conflicts here on the next run); set-image
# runs LAST, so the served image is always the pushed digest while
# requests/limits/securityContext always track git.
set -euo pipefail

: "${NAMESPACE:?NAMESPACE must be set (radar-immobilier-preprod)}"
FM=cd-preprod
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# 1. Guard: the cluster conf (deploy/k8s/nginx/default.conf) and the compose conf
#    (ui/nginx/default.conf) must keep identical security headers — a silent
#    divergence would re-introduce a #608-style served-headers gap.
bash deploy/k8s/nginx/check-header-parity.sh

# 2. Render the preprod overlay. `kubectl apply -k` cannot pass --load-restrictor
#    and the overlay references a parent dir, so render then apply from stdin.
RENDER="$(mktemp)"
trap 'rm -f "$RENDER"' EXIT
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod > "$RENDER"

kf() { python3 deploy/ci/kfilter.py "$@"; }

targeted() {
  kf --name-prefix radar-ui-nginx "$RENDER" ConfigMap
  echo ---
  kf "$RENDER" ConfigMap radar-api
  echo ---
  kf "$RENDER" Deployment radar-api
  echo ---
  kf "$RENDER" Deployment radar-ui
  echo ---
  kf "$RENDER" CronJob radar-consistency-snapshot
}

# 3. Diff (log only — `kubectl diff` exits 1 when diffs exist; never fail here).
echo "::group::kubectl diff (preprod reconcile — targeted)"
targeted | kubectl diff --server-side --field-manager="$FM" -f - || true
echo "::endgroup::"

# 4. ConfigMaps FIRST + fail-closed. radar-ui's Deployment references the hashed
#    radar-ui-nginx name; radar-api carries the per-env storage buckets that the
#    refresh CronJob AND the api read (SCRAPE/GRAPH_S3_BUCKET -> docs-preprod), so
#    a failure to apply it must stop the release before set-image.
kf --name-prefix radar-ui-nginx "$RENDER" ConfigMap \
  | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -
kf "$RENDER" ConfigMap radar-api \
  | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -

# 5. CronJob (#611 securityContext).
kf "$RENDER" CronJob radar-consistency-snapshot \
  | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -

# 6. Deployments radar-api + radar-ui (#611 securityContext; radar-ui rolls via
#    the rewritten CM ref). Present by the job pre-flight → PATCH, never create.
kf "$RENDER" Deployment radar-api \
  | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -
kf "$RENDER" Deployment radar-ui \
  | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -

echo "reconcile OK — preprod durables applied (radar-ui-nginx + radar-api CMs, radar-api/radar-ui Deployments, radar-consistency-snapshot CronJob)."
