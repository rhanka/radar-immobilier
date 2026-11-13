#!/usr/bin/env bash
set -euo pipefail
mode=$1
scope=${2:-}
case "$mode" in
  typecheck) npm run typecheck --workspaces --if-present ;;
  lint) npx --no-install eslint packages/immo-mcp/src/signal-*.ts packages/immo-mcp/src/class-reasons.ts api/src/services/graph/signal-mcp*.ts api/src/routes/signal-mcp*.ts ;;
  test-api) npm run test --workspace=api -- ${scope:-src/services/graph/signal-mcp-db.test.ts src/routes/signal-mcp.test.ts} ;;
  test-mcp) npm run test --workspace=packages/immo-mcp -- ${scope:-src/signal-tools.test.ts} ;;
  test-ui) npm run test --workspace=ui -- ${scope:-src/lib/components/maps/SignalMcpNotes.test.ts} ;;
  verify)
    for gate in typecheck lint test-api test-mcp test-ui; do bash "$0" "$gate"; done ;;
  *) echo "Unknown gate: $mode"; exit 2 ;;
esac
