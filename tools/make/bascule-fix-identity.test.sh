#!/usr/bin/env bash
set -euo pipefail
root=$PWD
fixture=$(mktemp -d "$root/tmp/qualification-tests.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/tools/make"
cp tools/make/bascule-fix.mk tools/make/bascule-fix-identity.sh "$fixture/tools/make/"
unset GIT_DIR GIT_WORK_TREE
git init -q "$fixture"
make -C "$fixture" -f "$root/tools/make/bascule-fix.mk" --eval='fixture-commit:; @git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -qm "test(base): fixture identity"' fixture-commit ENV=test-bascule-fix
expected=$(git -C "$fixture" rev-parse HEAD)
make --no-print-directory -C "$fixture" -f tools/make/bascule-fix.mk qualification-identity ENV=test-bascule-fix > "$fixture/first.json"
jq -e --arg head "$expected" '.checkoutHead==$head' "$fixture/first.json" >/dev/null
# A stale private delivery repo must not influence qualification.
mkdir -p "$fixture/tmp/bascule-fix-evidence"
git init --bare -q "$fixture/tmp/bascule-fix-evidence/backup.git"
GIT_DIR="$root/.git" GIT_WORK_TREE="$root" make --no-print-directory -C "$fixture" -f tools/make/bascule-fix.mk qualification-identity ENV=test-bascule-fix > "$fixture/second.json"
cmp "$fixture/first.json" "$fixture/second.json"
printf '# changed\n' >> "$fixture/tools/make/bascule-fix.mk"
make --no-print-directory -C "$fixture" -f tools/make/bascule-fix.mk qualification-identity ENV=test-bascule-fix > "$fixture/dirty.json"
jq -e --slurpfile before "$fixture/first.json" '.checkoutHead==$before[0].checkoutHead and .sourceInventorySha256!=$before[0].sourceInventorySha256' "$fixture/dirty.json" >/dev/null
echo 'PASS qualification in a fresh checkout, ignoring private/inherited Git, detecting changed sources (3 cases)'
