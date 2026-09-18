#!/bin/sh
# Runs one oracle-v3 step whose model sits behind llm-mesh (Astra via the Codex seat, Gemini via
# Cloud Code) inside the benchmark container, like `make run-v101-lane`: repository read-only,
# only the oracle-v3 directory writable, keyring copied into a tmpfs, API keys never passed.
#
#   ORACLE_V3_GO=1 [ORACLE_V3_ASTRA_GO=1] tools/refresh-benchmark/run-oracle-v3-mesh.sh <step> [flags...]
#
# Flags are those of oracle-v3-step.mjs (--docs, --concurrency, --chain). Claude-seat steps
# (fable-*) run on the host instead: node tools/refresh-benchmark/oracle-v3-step.mjs <step>.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
OUT="$ROOT/docs/reviews/refresh-benchmark/v101b/oracle-v3"
MAIN_ROOT=$(CDPATH= cd -- "$ROOT/../.." && pwd)
KEYRING_SOURCE=/home/antoinefa/.sentropic/llm-mesh-keyring
OWNER_SCOPE=cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA
MESH_VERSION=0.19.3
step="$1"; shift

case "$step" in
  astra-*|converge-astra|gemini-*|converge-gemini) ;;
  *) echo "run-oracle-v3-mesh: $step is not an llm-mesh step" >&2; exit 2 ;;
esac
test "${ORACLE_V3_GO:-}" = 1 || { echo "ORACLE_V3_GO=1 required (GO i-cond)" >&2; exit 2; }
mkdir -p "$OUT/annotations" "$OUT/corrige"

# Host uid so the deliverables stay editable; tmpfs modes let that uid write in /workspace and /run.
exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --tmpfs /workspace:exec,mode=1777 --tmpfs /run:mode=1777 --tmpfs /tmp:mode=1777 \
  --mount type=bind,source="$MAIN_ROOT",target="$MAIN_ROOT",readonly \
  --mount type=bind,source="$ROOT",target=/src,readonly \
  --mount type=bind,source="$OUT",target=/src/docs/reviews/refresh-benchmark/v101b/oracle-v3 \
  --mount type=bind,source="$KEYRING_SOURCE",target=/keyring-source,readonly \
  -e BENCHMARK_OWNER_SCOPE="$OWNER_SCOPE" \
  -e ORACLE_V3_GO="${ORACLE_V3_GO:-}" -e ORACLE_V3_ASTRA_GO="${ORACLE_V3_ASTRA_GO:-}" \
  -w /src node:22-bookworm-slim sh -c \
  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring \
    && cd /workspace && npm install --silent --ignore-scripts @sentropic/llm-mesh@'"$MESH_VERSION"' >/dev/null \
    && cd /src && exec node tools/refresh-benchmark/oracle-v3-step.mjs "$@"' oracle-v3 "$step" "$@"
