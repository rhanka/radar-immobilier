#!/usr/bin/env bash
#
# Graphify 3.4 — legacy Filter A anti-regression GATE (foundation lot).
#
# Runs the frozen golden tests that pin the pre-3.4 HEAD behaviour of the legacy
# Filter A (z|m|p) at both layers, plus the InputSet contract tests. Exits
# non-zero if ANY golden diverges — a release NO-GO per
#   docs/reports/consensus/graphify-3.4-legacy-filter-a-addendum.md
#
# This gate is fully OFFLINE: no Docker, no S3, no network, no DB. It only needs
# the workspace node_modules installed (npm install at the repo root).
#
# Usage:
#   bash scripts/graphify-legacy-a-gate.sh
#
# CI note: this complements (does not replace) `make lint` / the full suite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "[gate] node_modules missing — run: npm install --ignore-scripts --no-audit --no-fund" >&2
  exit 2
fi

echo "[gate] Graphify 3.4 legacy Filter A — golden anti-regression"

echo "[gate] (1/3) server goldens — computeLegacySubsetCounts / buildLegacyZmpProjection / aggregate parity"
npx vitest run --root api \
  src/services/graph/legacy-filter-a-golden.test.ts

echo "[gate] (2/3) UI goldens — filterNodesBySubset membership+order / URL states"
npx vitest run --root ui \
  src/lib/signals/legacy-filter-a-golden.test.ts

echo "[gate] (3/3) InputSet contract — canonical-json + input-set-contract"
npx vitest run --root api \
  src/services/graph/replay/canonical-json.test.ts \
  src/services/graph/replay/input-set-contract.test.ts

echo "[gate] PASS — legacy Filter A unchanged and InputSet contract valid."
