#!/usr/bin/env bash
# Execute only within the common guarded disposable campaign.
set -euo pipefail
exec node ../tools/make/base-api-b4-mutation.mjs "$1"
