#!/usr/bin/env bash
set -euo pipefail
mkdir -p tmp/vehicle-evidence
fixture=$(mktemp -d "$PWD/tmp/vehicle-evidence/paths.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
source tools/make/base-preprod-common.sh
source tools/make/base-preprod-maintenance.sh
INPUT=$fixture/input.json
OUTPUT=$fixture
printf '{"apiIngress":"fixture-app"}\n' > "$INPUT"
record_patch(){ [[ $1 == patch && $2 == ingress && $3 == fixture-app ]]; }
k=(record_patch)
api_routes
jq -n --slurpfile ingress "$OUTPUT/api-route-patch.json" --slurpfile probe deploy/base-preprod/public-checks.json '
  [$ingress[0].spec.rules[].http.paths[]|select(.backend.service.name=="radar-api" and .pathType=="Prefix")|.path] as $prefixes |
  [$probe[0][]|.path|split("?")[0] as $path |
    select(any($prefixes[]; . as $prefix | $path==$prefix or ($path|startswith($prefix+"/")))|not)|$path]' > "$fixture/uncovered.json"
if ! jq -e 'length==0' "$fixture/uncovered.json" >/dev/null;then
  echo 'ÉCHEC : chemins publics de sonde hors du profil API rouvert' >&2
  jq -r '.[]' "$fixture/uncovered.json" >&2
  exit 1
fi
jq -e '[.spec.rules[].http.paths[].path]==["/health","/api/v1/auth","/api/v1/workspaces"]' "$OUTPUT/api-route-patch.json" >/dev/null
printf 'PASS chemins : chaque contrôle public couvert, profil API inchangé\n'
