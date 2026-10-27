#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/deploy/nested"
touch "$T/deploy/nested/job.sh"
bash "$HERE/check-no-python.sh" "$T/deploy" >/dev/null
echo 'ok: accepts deploy sources without Python'
touch "$T/deploy/nested/new job.py"
if bash "$HERE/check-no-python.sh" "$T/deploy" >"$T/out" 2>&1; then
  echo 'FAIL: accepted a nested Python file' >&2; exit 1
fi
grep -Fq 'new job.py' "$T/out"
echo 'ok: rejects a nested Python file, including untracked files'
rm "$T/deploy/nested/new job.py"
ln -s job.sh "$T/deploy/nested/link.py"
if bash "$HERE/check-no-python.sh" "$T/deploy" >"$T/out" 2>&1; then
  echo 'FAIL: accepted a Python symlink' >&2; exit 1
fi
grep -Fq link.py "$T/out"
echo 'ok: rejects Python symlinks'
echo 'PASS=3 FAIL=0'
