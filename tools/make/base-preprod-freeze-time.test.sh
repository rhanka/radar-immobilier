#!/usr/bin/env bash
set -euo pipefail
mkdir -p tmp/vehicle-evidence/r2
case_dir=$(mktemp -d "$PWD/tmp/vehicle-evidence/r2/freeze.XXXXXX")
trap 'rm -rf "$case_dir"' EXIT
source tools/make/base-preprod-common.sh
source tools/make/base-preprod-actions.sh
INPUT=$case_dir/input.json
jq -n '{maintenance:{reopenBy:(now+60|todateiso8601),changeFreeze:{reference:"fixture",noPushOrMerge:true,
 startsAt:(now-60|todateiso8601),endsAt:(now+120|todateiso8601)}}}' > "$case_dir/base.json"
case ${1:?fractions, invalid ou recovery} in
fractions)
 jq 'walk(if type=="string" and endswith("Z") then sub("Z$";".125Z") else . end)' "$case_dir/base.json" > "$INPUT"
 action=preflight; require_change_freeze;;
invalid)
 for stamp_value in '"date-invalide"' null 123 '[]' '"2026-10-28T00:00:00+00:00"';do
  for field in maintenance.changeFreeze.startsAt maintenance.changeFreeze.endsAt maintenance.reopenBy;do
   jq --arg field "$field" --argjson value "$stamp_value" 'setpath($field|split(".");$value)' "$case_dir/base.json" > "$INPUT"
   if (action=preflight;require_change_freeze) >"$case_dir/error.log" 2>&1;then exit 1;fi
   rg -qF "$field" "$case_dir/error.log" || { cat "$case_dir/error.log" >&2;exit 1; }
  done
 done;;
recovery)
 jq '.maintenance.reopenBy=(now-1|todateiso8601)' "$case_dir/base.json" > "$INPUT"
 action=reclose-api; require_change_freeze
 for action in activate reopen-api close;do
  if (require_change_freeze) >"$case_dir/error.log" 2>&1;then echo "Avancement tardif accepté : $action" >&2;exit 1;fi
 done
 jq '.maintenance.changeFreeze.endsAt=(now-1|todateiso8601)' "$INPUT" >"$case_dir/expired.json"
 INPUT=$case_dir/expired.json; action=reclose-api
 if (require_change_freeze) >"$case_dir/error.log" 2>&1;then echo 'Récupération après expiration du gel acceptée' >&2;exit 1;fi;;
*) exit 2;;
esac
printf 'PASS gel %s\n' "$1"
