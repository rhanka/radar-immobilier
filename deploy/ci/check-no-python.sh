#!/usr/bin/env bash
# Owner policy (#851, #810): deploy sources and jobs must contain no Python files.
set -euo pipefail
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
listing="$(mktemp)"
trap 'rm -f "$listing"' EXIT
# Follow directory links; materialize first so loops and traversal errors fail.
if ! find -L "$root" \( -type f -o -type l \) -print0 >"$listing"; then
  echo 'deploy Python guard: cannot traverse deploy paths' >&2
  exit 1
fi
bad=0
while IFS= read -r -d '' path; do
  if ! target="$(realpath -e -- "$path")"; then
    printf 'deploy Python guard: cannot resolve %s\n' "$path" >&2; exit 1
  fi
  # Check both the exposed name and the final target, including link chains.
  for candidate in "$path" "$target"; do
    case "${candidate,,}" in
      *.py|*.pyw|*.pyi|*.pyc|*.pyo|*.pyd|*.pyz|*.pyzw|*.whl|*.egg)
        printf 'Python file forbidden under deploy/: %s (target: %s)\n' "$path" "$target" >&2
        bad=1; break ;;
    esac
  done
done <"$listing"
if [ "$bad" -ne 0 ]; then exit 1; fi
echo 'deploy Python guard: ok'
