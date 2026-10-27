#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
accept() {
  bash "$HERE/check-no-python.sh" "$T/deploy" >"$T/out" 2>&1
  grep -qx 'deploy Python guard: ok' "$T/out"
  ok "$1"
}
reject() {
  if bash "$HERE/check-no-python.sh" "$T/deploy" >"$T/out" 2>&1; then
    echo "FAIL: accepted $1" >&2; exit 1
  fi
  grep -Fq "$2" "$T/out"
  ok "rejects $1"
}
mkdir -p "$T/deploy/nested"
touch "$T/deploy/nested/job.sh"
accept 'deploy sources without Python'
touch "$T/deploy/nested/new job.py"
reject 'a nested untracked Python file' 'new job.py'
rm "$T/deploy/nested/new job.py"
ln -s job.sh "$T/deploy/nested/link.py"
reject 'a Python-named link to a shell file' 'link.py'
rm "$T/deploy/nested/link.py"
for extension in PY pY PyW PYI PyC PYO PYD PyZ PYZW WHL EGG; do
  touch "$T/deploy/job.$extension"
  reject "Python extension .$extension" "job.$extension"
  rm "$T/deploy/job.$extension"
done
mkdir -p "$T/deploy/cache.py" "$T/deploy/cache.PYW" "$T/tools/nested"
touch "$T/deploy/README.py.md" "$T/deploy/notes.PYW.txt" "$T/tools/nested/job.sh"
accept 'documentation and ordinary directories named cache.py/cache.PYW'
ln -s nested/job.sh "$T/deploy/run"
accept 'an extensionless link to a shell file'
rm "$T/deploy/run"
ln -s ../tools "$T/deploy/vendor"
accept 'a benign linked directory outside deploy'
touch "$T/tools/nested/job.py"
reject 'Python within a linked directory' 'vendor/nested/job.py'
rm "$T/tools/nested/job.py"
touch "$T/tools/job.PYW"
ln -s ../tools/job.PYW "$T/deploy/run"
reject 'an extensionless link to Python' 'job.PYW'
rm "$T/deploy/run"
ln -s job.PYW "$T/tools/alias"
ln -s ../tools/alias "$T/deploy/run"
reject 'a chain of extensionless links to Python' 'job.PYW'
rm "$T/deploy/run" "$T/tools/alias" "$T/tools/job.PYW"
ln -s . "$T/deploy/cycle"
reject 'a linked-directory cycle' 'cannot traverse'
rm "$T/deploy/cycle"
ln -s absent "$T/deploy/dangling"
reject 'an unresolvable link' 'cannot resolve'
rm "$T/deploy/dangling"
mkdir "$T/bin"
printf '#!/usr/bin/env bash\nexit 17\n' >"$T/bin/find"
chmod +x "$T/bin/find"
PATH="$T/bin:$PATH" reject 'a failed filesystem traversal' 'cannot traverse'
echo "PASS=$PASS FAIL=0"
