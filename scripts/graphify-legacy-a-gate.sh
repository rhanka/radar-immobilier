#!/usr/bin/env bash
#
# Graphify 3.4 — legacy Filter A anti-regression GATE (foundation lot).
#
# Runs the frozen golden tests that pin the pre-3.4 HEAD behaviour of the legacy
# Filter A (z|m|p) at both layers (server authority + UI DISPLAY path), plus the
# InputSet contract tests. Exits non-zero if ANY golden diverges — a release
# NO-GO per docs/reports/consensus/graphify-3.4-legacy-filter-a-addendum.md
#
# Make-only / Docker-first: this gate delegates to the OFFICIAL `make test-api`
# and `make test-ui` targets (scoped). It NEVER calls host `npx` / node_modules
# directly — same execution path as CI, no drift.
#
# Usage:
#   ENV=test-<slug> bash scripts/graphify-legacy-a-gate.sh
#   (ENV defaults to test-graphify34foundation; pass ENV as usual for isolation)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV="${ENV:-test-graphify34foundation}"

echo "[gate] Graphify 3.4 legacy Filter A — golden anti-regression (ENV=$ENV)"

# Server goldens (computeLegacySubsetCounts / buildLegacyZmpProjection / aggregate
# parity) + the InputSet contract (canonical-json + input-set-contract), all via
# the API test target. Multiple space-separated paths become vitest file filters.
echo "[gate] (1/2) server goldens + InputSet contract — via 'make test-api'"
make test-api \
  SCOPE="src/services/graph/legacy-filter-a-golden.test.ts src/services/graph/replay/canonical-json.test.ts src/services/graph/replay/input-set-contract.test.ts" \
  ENV="$ENV"

# UI DISPLAY-path goldens (projectNodesForVivierKey / projectLegacyVivierA +
# URL-state normalization) via the UI test target.
echo "[gate] (2/2) UI display-path goldens — via 'make test-ui'"
make test-ui \
  SCOPE="src/lib/signals/legacy-filter-a-golden.test.ts" \
  ENV="$ENV"

echo "[gate] PASS — legacy Filter A unchanged and InputSet contract valid."
