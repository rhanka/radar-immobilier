#!/usr/bin/env bash
# Owner policy (#851, #810): deploy sources and jobs must contain no Python files.
set -euo pipefail
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
files="$(find "$root" \( -type f -o -type l \) -name '*.py' -print)"
if [ -n "$files" ]; then
  printf 'Python files are forbidden under deploy/:\n%s\n' "$files" >&2
  exit 1
fi
echo 'deploy Python guard: ok'
