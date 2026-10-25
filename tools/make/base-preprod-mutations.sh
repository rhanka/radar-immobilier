#!/usr/bin/env bash
set -euo pipefail
out=tmp/base-preprod-evidence/pr920-mutations
mkdir -p "$out"
bash tools/make/base-preprod-operator.test.sh > "$out/baseline.log" 2>&1
for mutant in init-binding sql-table-lock sql-row-update image-proof live-digest q2-restart failed-receipt init-receipt; do
  if BASE_PREPROD_MUTANT=$mutant bash tools/make/base-preprod-operator.test.sh > "$out/$mutant.log" 2>&1; then
    echo "SURVIVED $mutant" >&2; exit 1
  fi
  case $mutant in
    init-binding|sql-*) expected='Unexpected success: render-job';;
    image-proof) expected='Unexpected success: render-job';;
    live-digest) expected='Foreign running digest accepted';;
    q2-restart) expected='Unsafe reopening: new-generation';;
    failed-receipt) expected='Failed Job receipt was not retained';;
    init-receipt) expected='Foreign initialization receipt accepted';;
  esac
  rg -qF "$expected" "$out/$mutant.log" || { cat "$out/$mutant.log" >&2; exit 1; }
  printf 'KILLED %s\n' "$mutant"
done
bash tools/make/base-preprod-operator.test.sh > "$out/restored.log" 2>&1
echo 'PASS eight operator mutations; baseline/restored exit 0, each mutant exit nonzero for its expected assertion'
