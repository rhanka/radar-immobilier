#!/usr/bin/env bash
# Command doubles prove argument transport, never a functional activation.
set -euo pipefail
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
mkdir -p tmp/base-api-evidence/tooling
exec > >(tee tmp/base-api-evidence/tooling/activation-proof.log) 2>&1
scratch=$(mktemp -d "$PWD/tmp/base-api-evidence/tooling/activation.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/api/src/scripts" "$scratch/tmp/base-api-evidence/test-proof/runtime"
mkdir -p "$scratch/tools/make"
cp "$TOOLS/base-api-activation.sh" "$TOOLS/base-api-guards.sh" "$TOOLS/base-api-resources.sh" "$scratch/tools/make/"
printf '// Synthetic command double only\n' > "$scratch/api/src/scripts/base-api-personal-activation.ts"
printf '{}\n' > "$scratch/tmp/base-api-evidence/proof.json"
printf '# Synthetic compose placeholder\n' > "$scratch/tmp/base-api-evidence/test-proof/runtime/compose.yml"
cat > "$scratch/bin/docker" <<'DOUBLE'
#!/usr/bin/env bash
set -euo pipefail
if [[ $1 == ps && $2 == -q ]]; then echo synthetic-postgres;
elif [[ $1 == compose ]]; then printf '%s\0' "$@" > "$DISPATCH_PROOF";
fi
DOUBLE
chmod +x "$scratch/bin/docker"
export PATH="$scratch/bin:$PATH" DISPATCH_PROOF="$scratch/args"
(
  cd "$scratch"
  export ENV=test-proof BASE_API_WORKSPACE=11111111-1111-4111-8111-111111111111
  export BASE_API_ACTOR=synthetic-actor BASE_API_REASON='literal $(shell touch injected) `touch injected` ; spaces'
  export BASE_API_MAINTENANCE_EVIDENCE=tmp/base-api-evidence/proof.json
  tar -cf tmp/base-api-evidence/test-proof/runtime/source.tar api/src/scripts/base-api-personal-activation.ts
  for action in activate resume; do
    make -f "$TOOLS/base-api.mk" "base-api-$action-personal" \
      "BASE_API_WORKSPACE=$BASE_API_WORKSPACE" "BASE_API_ACTOR=$BASE_API_ACTOR" \
      "BASE_API_REASON=$BASE_API_REASON" "BASE_API_MAINTENANCE_EVIDENCE=$BASE_API_MAINTENANCE_EVIDENCE" \
      API_PORT=18911 UI_PORT=15911 MAILDEV_UI_PORT=11911 "ENV=$ENV"
    mapfile -d '' -t args < "$DISPATCH_PROOF"
    count=${#args[@]}
    [[ ${args[count-9]} == "$action" && ${args[count-8]} == --workspace ]]
    [[ ${args[count-7]} == "$BASE_API_WORKSPACE" && ${args[count-6]} == --actor ]]
    [[ ${args[count-5]} == "$BASE_API_ACTOR" && ${args[count-4]} == --reason ]]
    [[ ${args[count-3]} == "$BASE_API_REASON" && ${args[count-2]} == --maintenance-evidence ]]
    [[ ${args[count-1]} == /maintenance-evidence.json && ! -e injected ]]
    echo "PASS $action literal argument transport"
  done
  for variable in BASE_API_WORKSPACE BASE_API_ACTOR BASE_API_REASON BASE_API_MAINTENANCE_EVIDENCE; do
    if (export "$variable="; bash "$TOOLS/base-api-activation.sh" activate) >/dev/null 2>&1; then exit 1; fi
  done
  rm api/src/scripts/base-api-personal-activation.ts
  if bash "$TOOLS/base-api-activation.sh" activate >/dev/null 2>&1; then exit 1; fi
)
mkdir -p "$scratch/tools"
cp "$TOOLS/base-api-verify.sh" "$TOOLS/base-api-guards.sh" "$scratch/tools/"
for packet in b3 b4; do
  if bash "$scratch/tools/base-api-verify.sh" "$packet-mutation-required" \
    SCOPE=src/services/facets/activation.test.ts "ENV=$ENV" > "$scratch/missing-runner.log" 2>&1; then exit 1; fi
  rg -q 'Missing required mutation runner' "$scratch/missing-runner.log"
  echo "PASS $packet mutation requires an actual runner"
done
