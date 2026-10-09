#!/usr/bin/env bash
# check-image-entrypoints.sh — every `node dist/<path>.js` (or `node api/dist/<path>.js`)
# that a deploy manifest or a workflow runs against the radar-api image must be an
# esbuild entrypoint of api/Dockerfile. esbuild only emits the files listed in its
# `entryPoints`; a script that is not listed is ABSENT from the image and the Job dies
# with MODULE_NOT_FOUND (GH #812: graph-city-key-repair, run 37872994587).
#
# Entrypoints: the ACTIVE entries of the API build only. The esbuild program is rebuilt
# from the `printf '%s\n' "<line>"...` RUN of api/Dockerfile (Dockerfile `#` comment lines
# dropped, as Docker does), JS `//` and `/* */` comments are stripped outside strings, and
# the build call whose `outdir` is 'api/dist' is selected: its `entryPoints` map to
# dist/<path relative to outbase>.js (entryNames [dir]/[name]). Any other build call
# (packages/immo-mcp) is an independent build and contributes nothing.
#
# Scanned: deploy/**/*.y*ml and .github/workflows/*.y*ml, full-line comments ignored.
# Out of scope: packages/immo-mcp/dist (second esbuild call) and apps/*/dist (other images);
# a reference must be a whole path token starting with `dist/` or `api/dist/`.
# Known limits: trailing comments, image identity and paths built from variables are not
# parsed (see PR #832 follow-up).
#
# Usage: bash deploy/ci/check-image-entrypoints.sh [repo-root]
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DOCKERFILE="$ROOT/api/Dockerfile"
API_OUTDIR="api/dist"
FAIL=0
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }
die() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$DOCKERFILE" ] || die "$DOCKERFILE not found"

# Stage 1 — api/Dockerfile -> the esbuild program, one JS line per printf argument.
read -r -d '' DOCKERFILE_TO_PROGRAM <<'AWK'
function word_error(msg) { print msg > "/dev/stderr"; err = msg; exit 1 }
function emit_program(   i, n, c, d, j, w, nword) {
  i = index(inst, "printf") + 6; n = length(inst); nword = 0
  while (i <= n) {
    c = substr(inst, i, 1)
    if (c == " " || c == "\t") { i++; continue }
    if (c == ">" || c == "|" || c == "&" || c == ";") break
    w = ""
    while (i <= n) {
      c = substr(inst, i, 1)
      if (c == " " || c == "\t" || c == ">" || c == "|" || c == "&" || c == ";") break
      if (c == "'") {
        j = index(substr(inst, i + 1), "'")
        if (!j) word_error("unterminated single quote in the esbuild printf")
        w = w substr(inst, i + 1, j - 1); i += j + 1; continue
      }
      if (c == "\"") {
        i++
        while (i <= n) {
          c = substr(inst, i, 1)
          if (c == "\\" && i < n) {
            d = substr(inst, i + 1, 1)
            if (d == "\"" || d == "\\" || d == "$" || d == "`") { w = w d; i += 2; continue }
          }
          if (c == "\"") break
          w = w c; i++
        }
        if (i > n) word_error("unterminated double quote in the esbuild printf")
        i++; continue
      }
      if (c == "\\" && i < n) { w = w substr(inst, i + 1, 1); i += 2; continue }
      w = w c; i++
    }
    nword++
    if (nword == 1) { if (w != "%s\\n") word_error("esbuild printf format is not '%s\\n'"); continue }
    print w
  }
  if (nword < 2) word_error("esbuild printf has no program line")
}
function flush() {
  if (inst != "" && index(inst, "esbuild.mjs") && index(inst, "printf")) { found++; emit_program() }
  inst = ""
}
{
  line = $0; sub(/\r$/, "", line)
  if (line ~ /^[ \t]*#/) next              # comment line: Docker drops it, even inside a continuation
  if (cont && line ~ /^[ \t]*$/) next      # empty continuation line: ignored by Docker
  if (line ~ /\\[ \t]*$/) { sub(/\\[ \t]*$/, "", line); inst = inst line; cont = 1; next }
  inst = inst line; cont = 0; flush()
}
END {
  if (err != "") exit 1
  flush()
  if (err != "") exit 1
  if (found != 1) { print "expected exactly one RUN writing esbuild.mjs with printf, found " found + 0 > "/dev/stderr"; exit 1 }
}
AWK

# Stage 2 — esbuild program -> one `build|<n>|<outdir>|<outbase>|<entryNames>` record per
# build( call and one `entry|<n>|<source>` record per string of its entryPoints array.
# Comments are stripped outside strings; string bodies are masked so keys, brackets and
# parentheses are only found in code. Regex literals are not tokenized.
read -r -d '' PROGRAM_TO_BUILDS <<'AWK'
function fail_parse(msg) { print msg > "/dev/stderr"; err = msg; exit 1 }
function ident(ch) { return ch ~ /[A-Za-z0-9_$]/ }
function close_of(open, oc, cc,   k, depth, ch) {
  depth = 0
  for (k = open; k <= length(mask); k++) {
    ch = substr(mask, k, 1)
    if (ch == oc) depth++
    else if (ch == cc) { depth--; if (depth == 0) return k }
  }
  return 0
}
# Position just after `<key>:` in mask[from..to], or 0.
function key_value(key, from, to,   seg, p, off, k, ch) {
  seg = substr(mask, from, to - from + 1); off = 0
  while ((p = index(seg, key)) > 0) {
    k = from + off + p - 1
    if (!ident(substr(mask, k - 1, 1)) && !ident(substr(mask, k + length(key), 1))) {
      k += length(key)
      while (substr(mask, k, 1) ~ /[ \t\n]/) k++
      if (substr(mask, k, 1) == ":") { k++; while (substr(mask, k, 1) ~ /[ \t\n]/) k++; return k }
    }
    off += p + length(key) - 1; seg = substr(seg, p + length(key))
  }
  return 0
}
function string_at(k,   q, e) {
  q = substr(mask, k, 1)
  if (q != "'" && q != "\"") return ""
  e = index(substr(mask, k + 1), q)
  return substr(code, k + 1, e - 1)
}
{ text = text $0 "\n" }
END {
  if (err != "") exit 1
  n = length(text); i = 1; code = ""; mask = ""
  while (i <= n) {
    c = substr(text, i, 1); d = substr(text, i + 1, 1)
    if (c == "/" && d == "/") { j = index(substr(text, i), "\n"); i += j - 1; continue }
    if (c == "/" && d == "*") {
      j = index(substr(text, i + 2), "*/")
      if (!j) { print "unterminated /* comment in the esbuild program" > "/dev/stderr"; exit 1 }
      i += j + 3; code = code " "; mask = mask " "; continue
    }
    if (c == "'" || c == "\"" || c == "`") {
      q = c; code = code c; mask = mask c; i++
      while (i <= n) {
        c = substr(text, i, 1)
        if (c == "\\") { code = code substr(text, i, 2); mask = mask "__"; i += 2; continue }
        if (c == q) break
        if (c == "\n" && q != "`") break
        code = code c; mask = mask "_"; i++
      }
      if (substr(text, i, 1) != q) { print "unterminated string in the esbuild program" > "/dev/stderr"; exit 1 }
      code = code q; mask = mask q; i++; continue
    }
    code = code c; mask = mask c; i++
  }
  nbuild = 0; seg = mask; off = 0
  while ((p = index(seg, "build(")) > 0) {
    k = off + p
    if (!ident(substr(mask, k - 1, 1))) {
      open = k + 5; shut = close_of(open, "(", ")")
      if (!shut) fail_parse("unbalanced build( call in the esbuild program")
      nbuild++
      outdir = ""; outbase = ""; names = ""
      v = key_value("outdir", open, shut); if (v) outdir = string_at(v)
      v = key_value("outbase", open, shut); if (v) outbase = string_at(v)
      v = key_value("entryNames", open, shut); if (v) names = string_at(v)
      print "build|" nbuild "|" outdir "|" outbase "|" names
      v = key_value("entryPoints", open, shut)
      if (!v || substr(mask, v, 1) != "[") fail_parse("build call " nbuild " has no entryPoints array literal")
      e = close_of(v, "[", "]")
      for (k2 = v + 1; k2 < e; k2++) {
        ch = substr(mask, k2, 1)
        if (ch ~ /[ \t\n,]/) continue
        if (ch != "'" && ch != "\"") fail_parse("unsupported entryPoints element in build call " nbuild " (only plain string literals)")
        s = string_at(k2)
        print "entry|" nbuild "|" s
        k2 += length(s) + 1
        while (substr(mask, k2 + 1, 1) ~ /[ \t\n]/) k2++
        nx = substr(mask, k2 + 1, 1)
        if (nx != "," && k2 + 1 != e) fail_parse("unsupported entryPoints element in build call " nbuild " (only plain string literals)")
      }
    }
    off += p + 5; seg = substr(seg, p + 6)
  }
  if (nbuild == 0) fail_parse("no build( call in the esbuild program")
}
AWK

program="$(awk "$DOCKERFILE_TO_PROGRAM" "$DOCKERFILE")" || die "cannot rebuild the esbuild program from api/Dockerfile"
builds="$(printf '%s\n' "$program" | awk "$PROGRAM_TO_BUILDS")" || die "cannot parse the esbuild program of api/Dockerfile"

API_BUILD="" OUTBASE="" NAMES=""
while IFS='|' read -r kind idx outdir outbase names; do
  [ "$kind" = build ] && [ "$outdir" = "$API_OUTDIR" ] || continue
  [ -z "$API_BUILD" ] || die "more than one esbuild build call has outdir '$API_OUTDIR' in api/Dockerfile"
  API_BUILD="$idx" OUTBASE="$outbase" NAMES="$names"
done <<<"$builds"
[ -n "$API_BUILD" ] || die "no esbuild build call with outdir '$API_OUTDIR' in api/Dockerfile"
[ -n "$OUTBASE" ] || die "the '$API_OUTDIR' esbuild build call has no outbase: emitted paths are unknown"
[ -z "$NAMES" ] || [ "$NAMES" = '[dir]/[name]' ] || die "the '$API_OUTDIR' esbuild build call uses entryNames '$NAMES' (only [dir]/[name] is mapped)"

mapfile -t ENTRY_SOURCES < <(while IFS='|' read -r kind idx src _; do
  [ "$kind" = entry ] && [ "$idx" = "$API_BUILD" ] && printf '%s\n' "$src"
done <<<"$builds" | sort -u)
[ "${#ENTRY_SOURCES[@]}" -gt 0 ] || die "the '$API_OUTDIR' esbuild build call of api/Dockerfile lists no entrypoint"
declare -A EMITTED=()
for src in "${ENTRY_SOURCES[@]}"; do
  case "$src" in
    "$OUTBASE"/*.ts) ;;
    "$OUTBASE"/*) fail "api/Dockerfile entrypoint $src is not a .ts source"; continue ;;
    *) fail "api/Dockerfile entrypoint $src is outside outbase $OUTBASE"; continue ;;
  esac
  [ -f "$ROOT/$src" ] || fail "api/Dockerfile entrypoint $src does not exist"
  rel="${src#"$OUTBASE"/}"
  EMITTED["${API_OUTDIR#api/}/${rel%.ts}.js"]=1
done

for dir in deploy .github/workflows; do
  [ -d "$ROOT/$dir" ] || die "scan directory $dir not found under $ROOT"
done
listing="$(cd "$ROOT" && find deploy .github/workflows -type f \( -name '*.yaml' -o -name '*.yml' \) | sort)" \
  || die "cannot enumerate the YAML files under deploy/ and .github/workflows/"
[ -n "$listing" ] || die "no YAML file under deploy/ or .github/workflows/ (empty scan)"
mapfile -t SCANNED <<<"$listing"
REFS=0
for file in "${SCANNED[@]}"; do
  [ -r "$ROOT/$file" ] || { fail "cannot read $file"; continue; }
  # Non-comment lines naming dist/; `api/` prefix folded (workingDir /workspace vs /workspace/api).
  # Each line is split into whole path tokens, so neighbouring references never share a
  # boundary; a token must START with dist/ or api/dist/ (packages/immo-mcp/dist, apps/*/dist
  # are other trees) and END with .js (dist/build.json is a UI static file, not a script).
  while IFS= read -r hit; do
    line="${hit%%:*}"
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      ref="${ref#api/}"
      REFS=$((REFS + 1))
      [ -n "${EMITTED[$ref]:-}" ] && continue
      src="$OUTBASE/${ref#"${API_OUTDIR#api/}"/}"; src="${src%.js}.ts"
      if [ -f "$ROOT/$src" ]; then
        fail "$file:$line runs $ref but $src is not an esbuild entrypoint in api/Dockerfile"
      else
        fail "$file:$line runs $ref but no source $src exists"
      fi
    done < <(grep -oE '[A-Za-z0-9_./-]+' <<<"${hit#*:}" | grep -E '^(api/)?dist/[A-Za-z0-9_./-]+\.js$')
  done < <(grep -nvE '^[[:space:]]*#' "$ROOT/$file" | grep -E '^[0-9]+:.*dist/')
done
[ "$REFS" -gt 0 ] || fail "no dist/<path>.js reference found in ${#SCANNED[@]} file(s) (vacuous scan)"

if [ "$FAIL" -ne 0 ]; then
  echo "image entrypoint check: $FAIL failure(s)" >&2
  exit 1
fi
echo "image entrypoint check: ok ($REFS reference(s) in ${#SCANNED[@]} file(s), ${#ENTRY_SOURCES[@]} entrypoint(s))"
