#!/usr/bin/env bash
# Offline shell/JQ static checks, with no cluster or application runtime.
set -euo pipefail
for file in tools/make/cutover*.sh; do bash -n "$file"; done
sh -n deploy/cutover/shell-wrapper.sh
git diff --check
jq -e . deploy/cutover/config.json >/dev/null
printf '%s\n' '{"items":[]}' | jq -f tools/make/cutover-controllers.jq >/dev/null
jq -n --arg env preprod --argjson d '[{"items":[]}]' --argjson c '[{"items":[]}]' \
  --argjson i '[{"items":[]}]' --argjson cfg '[]' -f tools/make/cutover-snapshot.jq >/dev/null
printf '%s\n' '{"items":[]}' | jq --arg run synthetic --argjson r '[{"jobs":{},"cronjobs":[],"deployments":[]}]' \
  --argjson jobs '[{"items":[]}]' --argjson rs '[{"items":[]}]' \
  -f tools/make/cutover-consumers.jq >/dev/null
printf '%s\n' '{"items":[]}' | jq --argjson r '[{"cronjobs":[]}]' --argjson cfg '[{"cronjobs":[]}]' \
  --argjson jobs '[{"items":[]}]' -f tools/make/cutover-writers.jq >/dev/null
jq -n --arg step ddl --argjson timeout 520 --argjson r '[{"release":{"apiImage":"synthetic"}}]' \
  --rawfile wrapper deploy/cutover/job-wrapper.cjs --rawfile shellWrapper deploy/cutover/shell-wrapper.sh \
  -f tools/make/cutover-sanitize.jq >/dev/null
