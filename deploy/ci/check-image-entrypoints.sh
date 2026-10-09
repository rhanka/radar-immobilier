#!/usr/bin/env bash
# check-image-entrypoints.sh — every `node dist/<path>.js` (or `node api/dist/<path>.js`)
# that a deploy manifest or a workflow runs against the radar-api image must be an
# esbuild entrypoint of api/Dockerfile. esbuild only emits the files listed in its
# `entryPoints`; a script that is not listed is ABSENT from the image and the Job dies
# with MODULE_NOT_FOUND (GH #812: graph-city-key-repair, run 37872994587).
#
# Scanned: deploy/**/*.y*ml and .github/workflows/*.y*ml, full-line comments ignored.
# Out of scope: packages/immo-mcp/dist (second esbuild call) and apps/*/dist (other images);
# the regex never matches them because `dist/` there follows a path character.
#
# Usage: bash deploy/ci/check-image-entrypoints.sh [repo-root]
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DOCKERFILE="$ROOT/api/Dockerfile"
FAIL=0
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

[ -f "$DOCKERFILE" ] || { echo "FAIL: $DOCKERFILE not found" >&2; exit 1; }

# esbuild entrypoints of the api build: 'api/src/<path>.ts' -> dist/<path>.js
mapfile -t ENTRY_SOURCES < <(grep -oE "'api/src/[A-Za-z0-9_./-]+\.ts'" "$DOCKERFILE" | tr -d "'" | sort -u)
[ "${#ENTRY_SOURCES[@]}" -gt 0 ] || { echo "FAIL: no 'api/src/*.ts' entrypoint found in api/Dockerfile" >&2; exit 1; }
declare -A EMITTED=()
for src in "${ENTRY_SOURCES[@]}"; do
  [ -f "$ROOT/$src" ] || fail "api/Dockerfile entrypoint $src does not exist"
  rel="${src#api/src/}"
  EMITTED["dist/${rel%.ts}.js"]=1
done

mapfile -t SCANNED < <(cd "$ROOT" && find deploy .github/workflows -type f \( -name '*.yaml' -o -name '*.yml' \) 2>/dev/null | sort)
REFS=0
for file in "${SCANNED[@]}"; do
  # Non-comment lines naming dist/; `api/` prefix folded (workingDir /workspace vs /workspace/api).
  # The leading class rejects other dist trees (packages/immo-mcp/dist, apps/*/dist); the
  # trailing class rejects longer extensions (dist/build.json is a UI static file, not a script).
  while IFS= read -r hit; do
    line="${hit%%:*}"
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      ref="$(grep -oE '(api/)?dist/[A-Za-z0-9_./-]+\.js' <<<"$ref" | head -n1)"
      ref="${ref#api/}"
      REFS=$((REFS + 1))
      [ -n "${EMITTED[$ref]:-}" ] && continue
      src="api/src/${ref#dist/}"; src="${src%.js}.ts"
      if [ -f "$ROOT/$src" ]; then
        fail "$file:$line runs $ref but $src is not an esbuild entrypoint in api/Dockerfile"
      else
        fail "$file:$line runs $ref but no source $src exists"
      fi
    done < <(grep -oE '(^|[^A-Za-z0-9_./-])(api/)?dist/[A-Za-z0-9_./-]+\.js([^A-Za-z0-9_]|$)' <<<"${hit#*:}")
  done < <(grep -nvE '^[[:space:]]*#' "$ROOT/$file" | grep -E '^[0-9]+:.*dist/')
done

if [ "$FAIL" -ne 0 ]; then
  echo "image entrypoint check: $FAIL failure(s)" >&2
  exit 1
fi
echo "image entrypoint check: ok ($REFS reference(s) in ${#SCANNED[@]} file(s), ${#ENTRY_SOURCES[@]} entrypoint(s))"
