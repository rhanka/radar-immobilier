#!/usr/bin/env bash
set -euo pipefail
mode=$1
scope=${2:-}
case "$mode" in
  typecheck) npm run typecheck --workspaces --if-present ;;
  lint) npx --no-install eslint . ;;
  test-api) npm run test --workspace=api -- ${scope:-src/services/graph/signal-mcp-db.test.ts src/routes/signal-mcp.test.ts src/services/graph/class-feedback-db.test.ts src/services/graph/class-feedback-migration.test.ts} ;;
  test-mcp)
    npm run test --workspace=packages/immo-mcp -- --exclude '**/*.e2e.test.ts' $scope
    npm run test --workspace=api -- tests/integration/signal-mcp-client.spec.ts ;;
  test-ui) npm run test --workspace=ui -- ${scope:-src/lib/components/maps/SignalMcpNotes.test.ts src/lib/signals/signal-classement.test.ts src/lib/signals/class-annotation-label.test.ts} ;;
  test-ui-e2e) bash tools/make/mcp-signal-write-browser.sh ;;
  verify)
    for gate in typecheck lint test-api test-mcp test-ui; do bash "$0" "$gate"; done ;;
  *) echo "Unknown gate: $mode"; exit 2 ;;
esac
