#!/usr/bin/env bash
set -euo pipefail
latest=$(find tmp/base-preprod-evidence -maxdepth 1 -type d -name '*-verify' | sort | tail -n1)
printf 'Latest quality evidence: %s\n' "$latest"
[[ ! -f $latest/verify.log ]] || tail -n 15 "$latest/verify.log"
[[ ! -f $latest/status ]] || cat "$latest/status"
image=$(find tmp/base-preprod-evidence -maxdepth 1 -type d -name '*-build-image' | sort | tail -n1)
printf 'Latest image evidence: %s\n' "$image"
[[ ! -f $image/build.log ]] || tail -n 8 "$image/build.log"
[[ ! -f $image/status ]] || cat "$image/status"
docker ps --format '{{.Names}}'
df -h .
