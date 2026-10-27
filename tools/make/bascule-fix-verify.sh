#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-bascule-fix ]]
out=$PWD/tmp/bascule-fix-evidence/astra
mkdir -p "$out"
bash tools/make/bascule-fix-identity.sh > "$out/qualified-checkout.json"
date -u +%FT%TZ > "$out/verified-at.txt"
for target in check test-qualification test-operator test-workflow render; do
  if make --no-print-directory -f tools/make/bascule-fix.mk "$target" ENV="$ENV" > "$out/$target.log" 2>&1; then
    printf 'PASSED %s\n' "$target"
    tail -n 3 "$out/$target.log"
  else
    printf 'FAILED %s\n' "$target" >&2
    tail -n 30 "$out/$target.log" >&2
    exit 1
  fi
done
if command -v actionlint >/dev/null; then
  actionlint .github/workflows/build-push-images.yml > "$out/actionlint.log" 2>&1
  echo 'PASSED actionlint'
else
  echo 'SKIPPED actionlint: binary unavailable' | tee "$out/actionlint.log"
fi
sha256sum "$out/"*.log "$out/preprod.yaml" "$out/prod.yaml" > "$out/verification.sha256"
