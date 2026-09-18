#!/usr/bin/env bash
# Owner-only entry point. Secret payload travels only through an anonymous pipe.
set +x
set -euo pipefail
[[ ${PRA_PROVISION_GO:-} == 1 ]] || { echo 'Require PRA_PROVISION_GO=1' >&2; exit 2; }
case ${BACKUP_ENV:-} in
  preprod) namespace=radar-immobilier-preprod ;;
  production)
    [[ ${PRA_PRODUCTION_GO:-} == 1 ]] || { echo 'Require PRA_PRODUCTION_GO=1' >&2; exit 2; }
    namespace=radar-immobilier ;;
  *) echo 'Require BACKUP_ENV=preprod or production' >&2; exit 2 ;;
esac
for name in OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY OVH_PROJECT_ID \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY KUBECONFIG; do
  [[ -n ${!name:-} ]] || { echo "Require environment variable $name" >&2; exit 2; }
done
image=${1:?Backup image required}
[[ $image =~ ^[a-zA-Z0-9./:@_-]+$ ]] || exit 2
if ! docker image inspect "$image" >/dev/null 2>&1; then
  make --no-print-directory -f deploy/ci/backup-pra.mk backup-build BACKUP_IMAGE="$image" ENV=test-backup-pra
fi
# Read-only preflight against the owner's explicit kubeconfig, before OVH writes.
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
[[ $server == "${PRA_EXPECTED_SERVER:-https://hlhedx.c1.bhs5.k8s.ovh.net}" ]] || {
  echo 'Unexpected Kubernetes API server' >&2; exit 2;
}
kubectl get namespace "$namespace" -o name >/dev/null
for verb in get create patch; do
  kubectl auth can-i "$verb" secrets -n "$namespace" --quiet || exit 2
done
# Do not tee this pipe, use shell tracing, or expose API/kubectl error bodies.
# OVH can recover an existing credential after an interrupted apply; no rotation.
if docker run --rm --log-driver=none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --network bridge \
  -e PRA_PROVISION_GO -e PRA_PRODUCTION_GO -e BACKUP_ENV \
  -e OVH_APPLICATION_KEY -e OVH_APPLICATION_SECRET -e OVH_CONSUMER_KEY -e OVH_PROJECT_ID -e OVH_ENDPOINT \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  -v "$PWD/deploy/ci/backup-provision.py:/provision.py:ro" \
  --entrypoint python3 "$image" /provision.py |
  kubectl apply --server-side --field-manager=radar-pra-provision -f - >/dev/null 2>/dev/null; then
  echo "Provisioning verified; three S3 Secrets applied in $namespace. Schedules unchanged."
else
  echo 'Provisioning or Secret apply failed; no success asserted. Correct the cause and rerun; credentials are reusable.' >&2
  exit 1
fi
