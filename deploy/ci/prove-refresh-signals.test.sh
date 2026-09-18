#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# The unit test is hermetic: its input is a committed NDJSON graph export.
make test-api SCOPE=src/scripts/prove-refresh-signals.test.ts ENV=test-signals-proof-703
