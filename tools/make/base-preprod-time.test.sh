#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
mkdir -p tmp/vehicle-evidence
case_dir=$(mktemp -d "$root/tmp/vehicle-evidence/time.XXXXXX")
trap 'rm -rf "$case_dir"' EXIT
source tools/make/base-preprod-common.sh
source tools/make/base-preprod-maintenance.sh
OUTPUT=$case_dir/output
mkdir "$OUTPUT"
INPUT=$case_dir/input.json
PROOFS=$case_dir/proof.json
fixture_image=ghcr.io/fixture/api@sha256:$(printf 'a%.0s' {1..64})
jq -n --arg image "$fixture_image" '{binding:{releaseId:"fixture"},image:$image}' > "$INPUT"
fixture_kubectl() {
  case "$*" in
    'get deployment radar-api '*metadata.uid*) printf 'deployment\t2\t2\t1\n';;
    'get deployment radar-api '*restartedAt*) printf '2026-10-28T12:34:29-04:00';;
    'get pods -l '*) printf 'pod\t%s\ttemplate\tcontainerd://instance\t0\t2026-10-28T16:34:38+00:00\tcontainerd://%s\ttrue\n' "$fixture_image" "${fixture_image##*@}";;
    *) echo 'Commande imprévue dans la fixture UTC' >&2; return 1;;
  esac
}
k=(fixture_kubectl)
case ${1:?identity ou rejection} in
identity)
  api_identity
  jq -e '.restartedAt=="2026-10-28T16:34:29Z" and .startedAt=="2026-10-28T16:34:38Z"' "$OUTPUT/api-instance.json" >/dev/null || {
    echo 'ÉCHEC : identité native non normalisée en UTC Z' >&2
    exit 1
  };;
rejection)
  jq -n '{restart:{instance:{restartedAt:"2026-10-28T12:34:29-04:00"}}}' > "$PROOFS"
  if (qualification_receipt) > "$case_dir/result.log" 2>&1;then
    echo 'ÉCHEC : preuve avec décalage acceptée' >&2; exit 1
  fi
  rg -q 'UTC.*restart.instance.restartedAt|restart.instance.restartedAt.*UTC' "$case_dir/result.log" || {
    cat "$case_dir/result.log" >&2
    echo 'ÉCHEC : refus silencieux sans champ UTC explicite' >&2; exit 1
  };;
*) exit 2;;
esac
printf 'PASS UTC %s\n' "$1"
