#!/usr/bin/env bash
set -euo pipefail
export A4_IMAGE=1 A4_SERVICES=1 CMD='actual runtime image probe'
exec bash tools/make/artefacts-a4-run.sh
