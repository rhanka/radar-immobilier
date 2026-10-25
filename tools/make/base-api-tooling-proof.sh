#!/usr/bin/env bash
# Daemon-free path guards; real projection execution remains a separate gate.
set -euo pipefail
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
for path in api/src/services/geo/{ogc-pull,populate-geo}{,.test,-source-lock-db.test}.ts \
  api/src/services/exploitation/projection{,.test,-source-lock-db.test}.ts \
  api/src/scripts/base-api-personal-activation.ts docs/spec/BASE_API_ACTIVATION.md; do
  allowed_delivery_path "$path"
  echo "PASS delivery accepts $path"
done
for path in api/src/services/geo/other.ts api/src/services/exploitation/other.ts \
  api/src/services/geo/ogc-pull-extra.ts api/src/scripts/other.ts .env \
  docs/spec/OTHER.md api/src/services/geo/../other.ts; do
  if allowed_delivery_path "$path" 2>/dev/null; then exit 1; fi
  echo "PASS delivery rejects $path"
done
allowed_path radar/ontology/ontology-profile.yaml
for path in radar/ontology/other.yaml radar/ontology/ontology-profile.yaml/../other .env; do
  if allowed_path "$path"; then exit 1; fi
done
mkdir -p tmp/base-api-evidence/tooling
scratch=$(mktemp -d "$PWD/tmp/base-api-evidence/tooling/paths.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
(
  cd "$scratch"
  mkdir outside
  ln -s outside api
  if allowed_delivery_path api/src/services/geo/ogc-pull.ts; then exit 1; fi
  ln -s outside radar
  if allowed_path radar/ontology/ontology-profile.yaml; then exit 1; fi
)
echo 'PASS symlink ancestor rejection'
