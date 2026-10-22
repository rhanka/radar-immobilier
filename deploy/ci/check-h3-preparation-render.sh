#!/usr/bin/env bash
# Reviewed activation values and routing, with control still off. Offline only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export H3_RENDER_PHASE=preparation
exec bash "$HERE/check-h3-preprod-render.sh" "$@"
