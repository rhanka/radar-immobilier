#!/usr/bin/env bash
# Offline rendering is default. Only the authorized k8s lane uses other verbs.
set -euo pipefail
action=${1:?} environment=${2:?} image=${3:?}
[[ "$image" =~ ^[a-zA-Z0-9./:@_-]+$ && "$image" != *PIN-BEFORE* ]] || exit 2
out=tmp/backup-pra-render
mkdir -p "$out"
render() {
  local env=$1
  kubectl kustomize --load-restrictor LoadRestrictionsNone "deploy/k8s/backup-$env" |
    sed "s|ghcr.io/rhanka/radar-backup:PIN-BEFORE-APPLY|$image|g" > "$out/$env.yaml"
}
proof_json() {
  docker run --rm --network none --read-only -e CYCLE_ID -e REFERENCE_TIME \
    -v "$PWD:/repo:ro" --entrypoint python3 "$image" /repo/deploy/ci/backup-pra-render.py "$@"
}
if [[ "$environment" == both ]]; then render preprod; render prod
elif [[ "$environment" == preprod || "$environment" == prod ]]; then render "$environment"
else echo 'ENV must be preprod, prod or both' >&2; exit 2; fi
if [[ "$action" == render ]]; then
  echo "Offline branch manifests: $out/$environment.yaml (both = preprod.yaml + prod.yaml)"
  exit 0
fi
[[ "${PRA_CLUSTER_GO:-}" == 1 && -n "${KUBECONFIG:-}" ]] || { echo 'Require PRA_CLUSTER_GO=1 and KUBECONFIG' >&2; exit 2; }
[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || { echo 'Cluster execution requires an immutable image digest' >&2; exit 2; }
expected_server=${PRA_EXPECTED_SERVER:-https://hlhedx.c1.bhs5.k8s.ovh.net}
actual_server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
[[ "$actual_server" == "$expected_server" ]] || { echo 'Unexpected Kubernetes API server' >&2; exit 2; }
if [[ "$environment" == prod || "$environment" == both ]]; then
  [[ "${PRA_PRODUCTION_GO:-}" == 1 ]] || { echo 'Production requires owner PRA_PRODUCTION_GO=1' >&2; exit 2; }
fi
namespace=radar-immobilier-preprod
[[ "$environment" != prod ]] || namespace=radar-immobilier
case "$action" in
  activate)
    [[ "$environment" == both ]] || { echo 'Activation is paired: ENV=both required' >&2; exit 2; }
    # Validate both before applying either. Kubernetes does not offer a
    # cross-namespace atomic transaction; evidence must record both outcomes.
    kubectl apply --dry-run=server -f "$out/preprod.yaml" -f "$out/prod.yaml"
    kubectl apply -f "$out/preprod.yaml" -f "$out/prod.yaml"
    kubectl -n radar-immobilier-preprod get cronjob radar-db-backup radar-backup-freshness
    kubectl -n radar-immobilier get cronjob radar-db-backup radar-backup-freshness
    ;;
  proof)
    [[ "$environment" == preprod ]] || { echo 'Proof only allowed in preprod' >&2; exit 2; }
    # Install only settings/network. Durable schedules start together at merge.
    proof_json support > "$out/proof-support.json"
    kubectl -n "$namespace" apply --dry-run=server -f "$out/proof-support.json"
    kubectl -n "$namespace" apply -f "$out/proof-support.json"
    suffix="$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
    job="radar-pra-backup-$suffix"
    restore="radar-pra-restore-$suffix"
    proof_json backup "$job" > "$out/$job.json.template"
    kubectl -n "$namespace" create -f "$out/$job.json.template"
    kubectl -n "$namespace" wait --for=condition=complete "job/$job" --timeout=3700s
    kubectl -n "$namespace" logs "job/$job" -c report > "$out/$job.json"
    object=$(jq -er '.object' "$out/$job.json")
    [[ "$object" =~ ^postgres/preprod/sets/[A-Za-z0-9-]+$ ]] || exit 2
    proof_json restore "$restore" "$image" "$object" > "$out/$restore.json.template"
    kubectl -n "$namespace" create -f "$out/$restore.json.template"
    kubectl -n "$namespace" wait --for=condition=complete "job/$restore" --timeout=3700s
    kubectl -n "$namespace" logs "job/$restore" -c report > "$out/$restore.json"
    jq -e --arg object "$object" '.object == $object and .tables > 0 and .jobUid != "local-test"' "$out/$restore.json"
    kubectl -n "$namespace" get jobs "$job" "$restore" -o json > "$out/jobs-$suffix.json"
    kubectl -n "$namespace" delete jobs "$job" "$restore" --wait=true
    test -z "$(kubectl -n "$namespace" get pods -l "batch.kubernetes.io/job-name=$restore" -o name)"
    echo "Proof receipts: $out/$job.json $out/$restore.json $out/jobs-$suffix.json"
    ;;
  *) exit 2 ;;
esac
