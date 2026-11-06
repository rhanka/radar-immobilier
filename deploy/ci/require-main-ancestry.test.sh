#!/usr/bin/env bash
# Hermetic test of require-main-ancestry.sh on a throwaway local origin:
# a tag on main passes, a tag on an artifact commit is refused, main passes,
# any other branch ref is refused. Needs bash + git only.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
script="$here/require-main-ancestry.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
g() { command git -c init.defaultBranch=main "$@"; }
g init -q "$tmp/seed"
g -C "$tmp/seed" commit -q --allow-empty -m a
g -C "$tmp/seed" commit -q --allow-empty -m b
on_main=$(g -C "$tmp/seed" rev-parse HEAD)
g -C "$tmp/seed" tag v1.0.0
g -C "$tmp/seed" checkout -q -b artifact/p/0123abcd/demo-0123abcd
g -C "$tmp/seed" commit -q --allow-empty -m artifact
off_main=$(g -C "$tmp/seed" rev-parse HEAD)
g -C "$tmp/seed" tag v9.9.9
g -C "$tmp/seed" checkout -q main
g clone -q --bare "$tmp/seed" "$tmp/origin.git"
pass=0 fail=0
ok() { echo "  ok   $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL $1"; fail=$((fail + 1)); }
run() { # <ref> <sha> <checkout-ref>
  rm -rf "$tmp/work"
  g clone -q --depth 1 --branch "$3" "file://$tmp/origin.git" "$tmp/work" 2>/dev/null
  (cd "$tmp/work" && GITHUB_REF=$1 GITHUB_SHA=$2 bash "$script" >/dev/null 2>&1)
}
run refs/tags/v1.0.0 "$on_main" v1.0.0 && ok 'tag on main history passes (shallow checkout)' || bad 'tag on main refused'
run refs/tags/v9.9.9 "$off_main" v9.9.9 && bad 'tag on an artifact commit passed' || ok 'tag on an artifact commit is refused'
run refs/heads/main "$on_main" main && ok 'main passes' || bad 'main refused'
run refs/heads/artifact/p/0123abcd/demo-0123abcd "$off_main" artifact/p/0123abcd/demo-0123abcd \
  && bad 'artifact branch ref passed' || ok 'artifact branch ref is refused'
echo "[require-main-ancestry.test] pass=$pass fail=$fail"
[[ $fail -eq 0 ]]
