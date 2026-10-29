#!/usr/bin/env bash
set -euo pipefail
mkdir -p tmp/vehicle-evidence
result=$(mktemp "$PWD/tmp/vehicle-evidence/context.XXXXXX")
trap 'rm -f "$result"' EXIT
source tools/make/base-preprod-common.sh
source tools/make/base-preprod-maintenance.sh
gh(){ echo 'APPEL RÉEL INTERDIT DANS CETTE FIXTURE' >&2; exit 1; }
if (unset repo job k; assert_cd_frozen) > "$result" 2>&1;then
  echo 'ÉCHEC : helper sans contexte accepté' >&2;exit 1
fi
if ! rg -q 'operator.mk verify-closed' "$result";then
  cat "$result" >&2
  echo 'ÉCHEC : rollback sans entrée initialisée native' >&2;exit 1
fi
if rg -q 'unbound variable|APPEL RÉEL INTERDIT' "$result";then cat "$result" >&2;exit 1;fi
printf 'PASS rollback : contexte absent refusé avant gh\n'
