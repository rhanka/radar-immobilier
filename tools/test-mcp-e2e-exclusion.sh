#!/bin/bash
# Execute both ordinary recipes against real Vitest canaries, then remove each
# exclusion in a copy and require that the previously excluded suite fails.
set -euo pipefail
root=$PWD
mkdir -p tmp
fixture=$(mktemp -d "$root/tmp/h4-e2e-canary.XXXXXX")
project="${ENV}-canary"
cleanup() {
  make --no-print-directory -f "$root/tools/h4-mcp.mk" down \
    API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT" ENV="$project"
}
trap cleanup EXIT
mkdir -p "$fixture/packages/immo-mcp/src" "$fixture/tools"
cp package-lock.json docker-compose.test.yml "$fixture/"
cp packages/immo-mcp/package.json "$fixture/packages/immo-mcp/"
printf '%s\n' '{"name":"radar-immobilier-workspace","version":"0.0.0","private":true,"type":"module","workspaces":["packages/immo-mcp"]}' > "$fixture/package.json"
printf '%s\n' 'import { it, expect } from "vitest";' 'it("runs the ordinary suite", () => expect(true).toBe(true));' > "$fixture/packages/immo-mcp/src/ordinary.test.ts"
printf '%s\n' 'import { it } from "vitest";' 'it("detects service E2E selection", () => { throw new Error("H4_E2E_EXCLUSION_CANARY"); });' > "$fixture/packages/immo-mcp/src/probe.e2e.test.ts"
for spec in artifact-host.mk:test-mcp immo-mcp-test.mk:test-immo-mcp; do
  runner=${spec%:*}
  target=${spec#*:}
  cp "$root/tools/$runner" "$fixture/tools/$runner"
  # Only the synthetic standalone compose is needed for these two fixture files.
  args=(-C "$fixture" --no-print-directory -f "tools/$runner" "$target"
    COMPOSE_FILES=-f\ docker-compose.test.yml
    API_PORT="$API_PORT" UI_PORT="$UI_PORT" MAILDEV_UI_PORT="$MAILDEV_UI_PORT")
  if ! make "${args[@]}" ENV="$project" > "$fixture/$runner.normal.log" 2>&1; then
    cat "$fixture/$runner.normal.log"; exit 1
  fi
  grep -Eq '1 passed' "$fixture/$runner.normal.log"
  if grep -Fq H4_E2E_EXCLUSION_CANARY "$fixture/$runner.normal.log"; then exit 1; fi
  echo "[test-e2e-exclusion] PASS: $runner:$target excludes the failing E2E suite"
  sed "s/ --exclude '[^']*\.e2e\.test\.ts'//" "$root/tools/$runner" > "$fixture/tools/$runner"
  if cmp -s "$root/tools/$runner" "$fixture/tools/$runner"; then
    echo '[test-e2e-exclusion] FAIL: inverse did not change the recipe'; exit 1
  fi
  if make "${args[@]}" ENV="$project" > "$fixture/$runner.inverse.log" 2>&1; then
    echo '[test-e2e-exclusion] FAIL: inverse accepted the E2E canary'; exit 1
  fi
  grep -Fq H4_E2E_EXCLUSION_CANARY "$fixture/$runner.inverse.log"
  grep -Fq probe.e2e.test.ts "$fixture/$runner.inverse.log"
  cp "$root/tools/$runner" "$fixture/tools/$runner"
  cmp "$root/tools/$runner" "$fixture/tools/$runner"
  echo "[test-e2e-exclusion] PASS: $runner:$target inverse fails on the E2E canary; restored cmp=0"
done
echo "[test-e2e-exclusion] logs: $fixture"
