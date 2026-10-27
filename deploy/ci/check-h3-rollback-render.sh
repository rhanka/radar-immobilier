#!/usr/bin/env bash
# H2 API without the activation group; independently pinned H3 denial image.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export H3_RENDER_PHASE=rollback
exec bash "$HERE/check-h3-preprod-render.sh" "$@"
