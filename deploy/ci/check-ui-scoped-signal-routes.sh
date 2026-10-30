#!/usr/bin/env bash
# 6H regression gate: the UI never references a retired unscoped signal
# reader. Every signal read or command goes through
# /api/v1/workspaces/:workspaceId/signal-facets/... . Unit tests that assert
# a refusal of the legacy paths are exempt (*.test.ts).
set -euo pipefail
root="${1:-$(cd "$(dirname "$0")/../.." && pwd)/ui/src}"
if [ ! -d "$root" ]; then
  echo "scoped signal routes guard: missing $root" >&2
  exit 1
fi
hits="$(grep -rnE --include='*.ts' --include='*.svelte' --include='*.js' \
  '/api/graph-signals/|/api/v1/signal-facets/' "$root" | grep -vE '\.test\.ts:' || true)"
if [ -n "$hits" ]; then
  printf 'Retired unscoped signal route referenced in the UI:\n%s\n' "$hits" >&2
  exit 1
fi
echo 'scoped signal routes guard: ok'
