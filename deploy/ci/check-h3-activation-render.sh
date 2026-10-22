#!/usr/bin/env bash
# Offline operator gate. Filled activation values only; no apply or live secret.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export H3_RENDER_PHASE=activation
exec bash "$HERE/check-h3-preprod-render.sh" "$@"
