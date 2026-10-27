#!/usr/bin/env bash
# Exercise the documented verifier in an ordinary clean checkout, without backup Git.
set -euo pipefail
[[ ${ENV:-} == test-bascule-fix ]]
out=$PWD/tmp/bascule-fix-evidence/astra
revision=$(git --git-dir="$out/backup.git" rev-parse HEAD)
checkout=$(mktemp -d "$out/checkout.XXXXXX")
git clone --no-local --quiet "$out/backup.git" "$checkout"
[[ ! -e $checkout/tmp/bascule-fix-evidence ]]
if ! make --no-print-directory -C "$checkout" -f tools/make/bascule-fix.mk verify ENV="$ENV" > "$out/clean-verify.log" 2>&1; then
  tail -n 40 "$out/clean-verify.log" >&2; exit 1
fi
evidence=$checkout/tmp/bascule-fix-evidence/astra
jq -e --arg head "$revision" '.checkoutHead==$head
  and .workingDiffSha256=="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"' "$evidence/qualified-checkout.json" >/dev/null
bash tools/make/bascule-fix-identity.sh > "$out/current-checkout.json"
jq -e --slurpfile current "$out/current-checkout.json" '.sourceInventorySha256==$current[0].sourceInventorySha256' "$evidence/qualified-checkout.json" >/dev/null
jq -n --arg sha "$revision" --arg checkout "$checkout" --arg evidence "$evidence" \
  '{qualifiedSha:$sha,checkout:$checkout,evidence:$evidence,passed:true}' > "$out/fresh-qualification.json"
cat "$out/clean-verify.log" "$out/fresh-qualification.json"
