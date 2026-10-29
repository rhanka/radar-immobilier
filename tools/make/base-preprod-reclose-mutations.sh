#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-* ]]
out=tmp/vehicle-evidence/r2/reclose-mutations
mkdir -p "$out"
original=$(sha256sum tools/make/base-preprod-reclose.sh tools/make/base-preprod-reclose.jq)
BASE_PREPROD_REHEARSAL=1 bash tools/make/base-preprod-operator.test.sh >"$out/baseline.log" 2>&1
for mutant in reclose-scale reclose-snapshot reclose-version;do
 if BASE_PREPROD_REHEARSAL=1 BASE_PREPROD_MUTANT=$mutant bash tools/make/base-preprod-operator.test.sh >"$out/$mutant.log" 2>&1;then
  echo "SURVIVED $mutant" >&2;exit 1
 fi
 case $mutant in
  reclose-scale) expected='Consumer deployment can restart';;
  reclose-snapshot) expected='reclose-api a accepté une divergence';;
  reclose-version) expected='concurrence resourceVersion ignorée';;
 esac
 rg -qF "$expected" "$out/$mutant.log" || { tail -n 20 "$out/$mutant.log" >&2;exit 1; }
 printf 'KILLED %s\n' "$mutant"
done
BASE_PREPROD_REHEARSAL=1 bash tools/make/base-preprod-operator.test.sh >"$out/restored.log" 2>&1
[[ $(sha256sum tools/make/base-preprod-reclose.sh tools/make/base-preprod-reclose.jq) == "$original" ]]
printf 'PASS trois mutations reclose-api ; baseline et restauration vertes, sources inchangées\n'
