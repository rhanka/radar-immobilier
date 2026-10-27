#!/usr/bin/env bash
# Filter a canonical multi-document kustomize render without rewriting YAML.
set -euo pipefail
names=false prefix=''
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --names) names=true; shift ;;
    --name-prefix)
      [ "$#" -ge 2 ] || { echo 'kfilter: missing prefix' >&2; exit 1; }
      prefix="$2"; shift 2 ;;
    *) echo "kfilter: unknown flag $1" >&2; exit 1 ;;
  esac
done
if [ "$#" -lt 2 ]; then
  echo 'kfilter: usage: kfilter.sh [--names] [--name-prefix P] <file> <Kind> [<name>]' >&2
  exit 1
fi
exact=false
if [ "$#" -ge 3 ]; then exact=true; fi
jq -jRs --arg kind "$2" --arg name "${3:-}" --arg prefix "$prefix" \
  --argjson exact "$exact" --argjson names "$names" \
  -f "$(dirname "$0")/kfilter.jq" "$1"
