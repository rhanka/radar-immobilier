#!/usr/bin/env bash
set -euo pipefail
latest=$(find tmp/base-preprod-evidence -maxdepth 1 -type d -name '*-verify' | sort | tail -n1)
printf 'Latest quality evidence: %s\n' "$latest"
[[ ! -f $latest/verify.log ]] || tail -n 15 "$latest/verify.log"
[[ ! -f $latest/status ]] || cat "$latest/status"
docker ps --format '{{.Names}}'
df -h .
