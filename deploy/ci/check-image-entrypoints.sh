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
# dist/<path relative to outbase>.js (entryNames [dir]/[name]). outdir, outbase and a present
# entryNames must be complete string literals: any other expression fails (mapping unknown).
# Any other build call (packages/immo-mcp) is an independent build and contributes nothing;
# only its outdir must be readable, its entryPoints syntax is not checked.
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

# Stage 2 — esbuild program -> per build( call, one record
#   build|<n>|<outdir>|<outbase>|<entryNames>|<opaque reason>
# where each option is `A|` (absent), `L|<value>` (a complete, escape-free string literal)
# or `X|` (present but anything else: expression, variable, template, shorthand, repeated key),
# followed by `entry|<n>|<source>` records or one `entryerr|<n>|<reason>` record.
# Only TOP-LEVEL properties of the options object are read; a spread or computed key makes
# the call opaque. Comments are stripped outside strings and string bodies are masked, so
# keys, commas and brackets are only found in code. Regex literals are not tokenized.
read -r -d '' PROGRAM_TO_BUILDS <<'AWK'
function fail_parse(msg) { print msg > "/dev/stderr"; err = msg; exit 1 }
function ident(ch) { return ch ~ /[A-Za-z0-9_$]/ }
function blank(ch) { return ch ~ /[ \t\n]/ }
function close_of(open, oc, cc,   k, depth, ch) {
  depth = 0
  for (k = open; k <= length(mask); k++) {
    ch = substr(mask, k, 1)
    if (ch == oc) depth++
    else if (ch == cc) { depth--; if (depth == 0) return k }
  }
  return 0
}
function trim_l(a, b) { while (a <= b && blank(substr(mask, a, 1))) a++; return a }
function trim_r(a, b) { while (b >= a && blank(substr(mask, b, 1))) b--; return b }
# Split mask[a..b] at depth-0 commas into SEG_A[1..n] / SEG_B[1..n] (untrimmed).
function split_top(a, b,   k, depth, ch, n, start) {
  n = 0; depth = 0; start = a
  for (k = a; k <= b; k++) {
    ch = substr(mask, k, 1)
    if (ch == "(" || ch == "{" || ch == "[") depth++
    else if (ch == ")" || ch == "}" || ch == "]") depth--
    else if (ch == "," && depth == 0) { n++; SEG_A[n] = start; SEG_B[n] = k - 1; start = k + 1 }
  }
  n++; SEG_A[n] = start; SEG_B[n] = b
  return n
}
# Value of the escape-free '...' or "..." literal spanning EXACTLY mask[a..b]; sets LIT_OK.
function literal(a, b,   q) {
  LIT_OK = 0; q = substr(mask, a, 1)
  if ((q != "'" && q != "\"") || b <= a || index(substr(mask, a + 1), q) != b - a) return ""
  if (index(substr(code, a + 1, b - a - 1), "\\")) return ""
  LIT_OK = 1; return substr(code, a + 1, b - a - 1)
}
# One top-level property mask[a..b] of the options object of build call n.
function prop(n, a, b,   c, k, key) {
  a = trim_l(a, b); b = trim_r(a, b)
  if (a > b) return
  if (substr(mask, a, 3) == "...") { OPAQUE[n] = "spread in the build options"; return }
  c = substr(mask, a, 1)
  if (c == "[") { OPAQUE[n] = "computed key in the build options"; return }
  if (c == "'" || c == "\"") {
    k = a + index(substr(mask, a + 1), c)
    key = literal(a, k)
    if (!LIT_OK) { OPAQUE[n] = "unparsed property key in the build options"; return }
    k++
  } else {
    k = a; while (k <= b && ident(substr(mask, k, 1))) k++
    key = substr(code, a, k - a)
    if (key == "") { OPAQUE[n] = "unparsed property in the build options"; return }
  }
  k = trim_l(k, b)
  SEEN[n, key]++; VA[n, key] = 0; VB[n, key] = 0
  if (k > b || substr(mask, k, 1) == "(") return          # shorthand or method: no literal value
  if (substr(mask, k, 1) != ":") { OPAQUE[n] = "unparsed property " key " in the build options"; return }
  VA[n, key] = trim_l(k + 1, b); VB[n, key] = b
}
function opt(n, key,   v) {
  if (!SEEN[n, key]) return "A|"
  if (SEEN[n, key] > 1 || !VA[n, key]) return "X|"
  v = literal(VA[n, key], VB[n, key])
  return LIT_OK ? "L|" v : "X|"
}
function entries(n,   a, b, m, i, s, sa, sb, out) {
  if (SEEN[n, "entryPoints"] != 1 || !VA[n, "entryPoints"]) { print "entryerr|" n "|no single entryPoints property with a value"; return }
  a = VA[n, "entryPoints"]; b = VB[n, "entryPoints"]
  if (substr(mask, a, 1) != "[" || close_of(a, "[", "]") != b) { print "entryerr|" n "|entryPoints is not an array literal"; return }
  m = split_top(a + 1, b - 1); out = ""
  for (i = 1; i <= m; i++) {
    sa = trim_l(SEG_A[i], SEG_B[i]); sb = trim_r(sa, SEG_B[i])
    if (sa > sb) { if (i == m) continue; print "entryerr|" n "|empty entryPoints element"; return }
    s = literal(sa, sb)
    if (!LIT_OK) { print "entryerr|" n "|unsupported entryPoints element (only plain string literals)"; return }
    out = out "entry|" n "|" s "\n"
  }
  printf "%s", out
}
{ text = text $0 "\n" }
END {
  n = length(text); i = 1; code = ""; mask = ""
  while (i <= n) {
    c = substr(text, i, 1); d = substr(text, i + 1, 1)
    if (c == "/" && d == "/") { j = index(substr(text, i), "\n"); i += j - 1; continue }
    if (c == "/" && d == "*") {
      j = index(substr(text, i + 2), "*/")
      if (!j) fail_parse("unterminated /* comment in the esbuild program")
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
      if (substr(text, i, 1) != q) fail_parse("unterminated string in the esbuild program")
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
      nbuild++; OPAQUE[nbuild] = ""
      ob = trim_l(open + 1, shut - 1)
      cb = (substr(mask, ob, 1) == "{") ? close_of(ob, "{", "}") : 0
      if (!cb || trim_l(cb + 1, shut - 1) != shut) OPAQUE[nbuild] = "build options are not a single object literal"
      else { m = split_top(ob + 1, cb - 1); for (i = 1; i <= m; i++) prop(nbuild, SEG_A[i], SEG_B[i]) }
      print "build|" nbuild "|" opt(nbuild, "outdir") "|" opt(nbuild, "outbase") "|" opt(nbuild, "entryNames") "|" OPAQUE[nbuild]
      if (OPAQUE[nbuild] == "") entries(nbuild)
    }
    off += p + 5; seg = substr(seg, p + 6)
  }
  if (nbuild == 0) fail_parse("no build( call in the esbuild program")
}
AWK

program="$(awk "$DOCKERFILE_TO_PROGRAM" "$DOCKERFILE")" || die "cannot rebuild the esbuild program from api/Dockerfile"
builds="$(printf '%s\n' "$program" | awk "$PROGRAM_TO_BUILDS")" || die "cannot parse the esbuild program of api/Dockerfile"

# Every build call must have a known output tree; only the api/dist one is then checked further.
API="the '$API_OUTDIR' esbuild build call of api/Dockerfile"
API_BUILD="" OUTBASE_STATE="" OUTBASE="" NAMES_STATE="" NAMES=""
while IFS='|' read -r kind idx od_state od ob_state ob en_state en opaque; do
  [ "$kind" = build ] || continue
  [ -z "$opaque" ] || die "esbuild build call $idx of api/Dockerfile: $opaque (output tree unknown)"
  [ "$od_state" != X ] || die "esbuild build call $idx of api/Dockerfile: outdir is not a plain string literal (output tree unknown)"
  [ "$od_state" = L ] && [ "$od" = "$API_OUTDIR" ] || continue
  [ -z "$API_BUILD" ] || die "more than one esbuild build call has outdir '$API_OUTDIR' in api/Dockerfile"
  API_BUILD="$idx" OUTBASE_STATE="$ob_state" OUTBASE="$ob" NAMES_STATE="$en_state" NAMES="$en"
done <<<"$builds"
[ -n "$API_BUILD" ] || die "no esbuild build call with outdir '$API_OUTDIR' in api/Dockerfile"
case "$OUTBASE_STATE" in
  A) die "$API has no outbase: emitted paths are unknown" ;;
  X) die "$API: outbase is not a plain string literal (emitted paths unknown)" ;;
esac
case "$NAMES_STATE" in
  X) die "$API: entryNames is not a plain string literal (emitted paths unknown)" ;;
  L) [ "$NAMES" = '[dir]/[name]' ] || die "$API uses entryNames '$NAMES' (only [dir]/[name] is mapped)" ;;
esac   # A: esbuild default [dir]/[name]
ENTRY_ERROR="$(awk -F'|' -v k="$API_BUILD" '$1 == "entryerr" && $2 == k { print $3 }' <<<"$builds")"
[ -z "$ENTRY_ERROR" ] || die "$API: $ENTRY_ERROR"

mapfile -t ENTRY_SOURCES < <(awk -F'|' -v k="$API_BUILD" '$1 == "entry" && $2 == k { print $3 }' <<<"$builds" | sort -u)
[ "${#ENTRY_SOURCES[@]}" -gt 0 ] || die "$API lists no entrypoint"
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
