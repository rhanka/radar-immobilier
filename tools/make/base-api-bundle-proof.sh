#!/usr/bin/env bash
# Synthetic delivery guards only; these bundles are never qualified B3/B4.
set -euo pipefail
TOOLS=$(cd -- "$(dirname -- "$0")" && pwd)
source "$TOOLS/base-api-guards.sh"
require_env
root=$PWD
mkdir -p tmp/base-api-evidence/tooling
exec > >(tee tmp/base-api-evidence/tooling/bundle-proof.log) 2>&1
scratch=$(mktemp -d "$PWD/tmp/base-api-evidence/tooling/bundles.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
git init -q "$scratch"
git -C "$scratch" fetch -q --no-tags "$root" 4fc755e9f69daae2c32286dd3cf0069c5798ecd0
cd "$scratch"
git config user.name 'Synthetic tooling proof'
git config user.email 'synthetic@example.invalid'
git switch -q -c feat/base-api-decouplee-b2 d033bc18bf9b9537c5c7a69311ebe44b0b545517
printf 'Synthetic bundle payload\n' > docs/spec/SPEC_EVOL_BASE_API.md
git add -- docs/spec/SPEC_EVOL_BASE_API.md
# Keep this disposable proof commit independent of the repository's hooks.
git -c core.hooksPath=/dev/null commit -q -m 'test(base): create synthetic bundle payload'
reject() {
  if bash "$TOOLS/base-api-deliver.sh" bundle "$@" "ENV=$ENV" > /dev/null 2>&1; then
    echo 'Bundle guard unexpectedly accepted input' >&2; exit 1
  fi
}
for packet in B3 B4; do
  if [[ $packet == B3 ]]; then
    start=d033bc18bf9b9537c5c7a69311ebe44b0b545517
    branch=feat/base-api-decouplee-b2
  else
    start=4fc755e9f69daae2c32286dd3cf0069c5798ecd0
    branch=feat/base-api-decouplee-b1
    git switch -q -c "$branch" "$start"
    printf 'Synthetic B4 payload\n' > docs/spec/SPEC_EVOL_BASE_API.md
    git add -- docs/spec/SPEC_EVOL_BASE_API.md
    git -c core.hooksPath=/dev/null commit -q -m 'test(base): create synthetic activation payload'
  fi
  out=tmp/base-api-evidence/$packet/base-api-${packet,,}.bundle
  reject "OUT=$out" "START=fd39c6168404b250c243222abe1fbba24d5480b0"
  reject "OUT=tmp/base-api-evidence/$packet/wrong.bundle" "START=$start"
  git switch -q -c "feat/base-api-decouplee-wrong-${packet,,}"
  reject "OUT=$out" "START=$start"
  git switch -q "$branch"
  mkdir -p "${out%/*}"
  ln -s "$scratch" "$out"
  reject "OUT=$out" "START=$start"
  rm "$out"
  mv "${out%/*}" "${out%/*}-real"
  ln -s "$scratch" "${out%/*}"
  reject "OUT=$out" "START=$start"
  rm "${out%/*}"
  mv "${out%/*}-real" "${out%/*}"
  bash "$TOOLS/base-api-deliver.sh" bundle "OUT=$out" "START=$start" "ENV=$ENV"
  echo "PASS $packet branch/path/prerequisite/symlink guards and isolated reconstruction"
done
