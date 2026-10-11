#!/usr/bin/env bash
# projection-declared-args — run-job.yaml inputs of a `projection` with DECLARED CHANGES
# (GH #817, spec docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md §17) → the flags of
# api/src/scripts/project-graph-from-s3.ts, printed on stdout.
#
# Inputs (environment, set by run-job.yaml from workflow_dispatch inputs):
#   DECLARATIONS    recovery_cities input reused for job=projection:
#                   "remove=<id>,<id>,… lose=<id>:<key>,…" (clauses in any order, each at
#                   most once, at least one). Empty ⇒ no flag at all: the projection is
#                   exactly the one it was before this option existed.
#   PROJECT_CITIES  project_cities input: exactly ONE lowercase slug when DECLARATIONS is set.
#   MODE            recovery_mode input: preview (default; adds --preview, rolled back) or apply.
#
# Output: "--remove=… --lose=… [--preview]". Every value is restricted to
# [A-Za-z0-9._:,=-] and spaces, so it is safe in the manifest's sed rendering (delimiter
# '#') and in its `sh -c` command line. On refusal: message on stderr, exit 1, no output.
set -euo pipefail
# ASCII ranges and byte order whatever the runner locale (review ASTRA-853-01): under a
# UTF-8 locale `[A-Za-z]` matches accented letters, which the TypeScript parser refuses.
export LC_ALL=C

ID_RE='[A-Za-z0-9][A-Za-z0-9._-]{0,127}'
KEY_RE='[A-Za-z0-9_]{1,64}'
MAX_REMOVALS=64
MAX_LOSSES=16
MAX_LENGTH=4096

die() { echo "projection declarations refused: $*" >&2; exit 1; }

decl="${DECLARATIONS:-}"
if [ -z "${decl//[[:space:]]/}" ]; then exit 0; fi
case "${decl}" in *$'\n'*|*$'\r'*) die "declarations must be a single line" ;; esac
[ "${#decl}" -le "${MAX_LENGTH}" ] || die "declarations are ${#decl} characters, at most ${MAX_LENGTH}"

case "${MODE:-}" in
  preview|apply) ;;
  *) die "recovery_mode must be preview or apply (got '${MODE:-}')" ;;
esac

case "${PROJECT_CITIES:-}" in *$'\n'*|*$'\r'*) die "project_cities must be a single line" ;; esac
read -r -a cities <<<"${PROJECT_CITIES:-}"
[ "${#cities[@]}" -eq 1 ] || die "declared changes need exactly one city in project_cities (got ${#cities[@]})"
[[ "${cities[0]}" =~ ^[a-z0-9]+(-{1,2}[a-z0-9]+)*$ ]] || die "invalid city slug '${cities[0]}'"

removals="" losses="" seen_remove="" seen_lose=""
read -r -a clauses <<<"${decl}"
for clause in "${clauses[@]}"; do
  case "${clause}" in
    remove=*)
      [ -z "${seen_remove}" ] || die "clause remove= given more than once"
      seen_remove=1
      removals="${clause#remove=}"
      [[ "${removals}" =~ ^${ID_RE}(,${ID_RE})*$ ]] || die "invalid remove list (expected remove=<id>,<id>,… with ids [A-Za-z0-9._-])"
      ;;
    lose=*)
      [ -z "${seen_lose}" ] || die "clause lose= given more than once"
      seen_lose=1
      losses="${clause#lose=}"
      [[ "${losses}" =~ ^${ID_RE}:${KEY_RE}(,${ID_RE}:${KEY_RE})*$ ]] || die "invalid lose list (expected lose=<id>:<key>,…)"
      ;;
    *) die "unknown clause '${clause%%=*}' (expected remove= or lose=)" ;;
  esac
done

if [ -n "${removals}" ]; then
  n="$(tr ',' '\n' <<<"${removals}" | wc -l)"
  [ "${n}" -le "${MAX_REMOVALS}" ] || die "remove lists ${n} ids, at most ${MAX_REMOVALS}"
  dup="$(tr ',' '\n' <<<"${removals}" | sort | uniq -d | head -n 1)"
  [ -z "${dup}" ] || die "duplicate removal '${dup}'"
fi
if [ -n "${losses}" ]; then
  n="$(tr ',' '\n' <<<"${losses}" | wc -l)"
  [ "${n}" -le "${MAX_LOSSES}" ] || die "lose lists ${n} losses, at most ${MAX_LOSSES}"
  dup="$(tr ',' '\n' <<<"${losses}" | sort | uniq -d | head -n 1)"
  [ -z "${dup}" ] || die "duplicate loss '${dup}'"
  if [ -n "${removals}" ]; then
    both="$(comm -12 <(tr ',' '\n' <<<"${removals}" | sort -u) <(tr ',' '\n' <<<"${losses}" | cut -d: -f1 | sort -u) | head -n 1)"
    [ -z "${both}" ] || die "node '${both}' is both removed and losing a property"
  fi
fi

args=""
[ -z "${removals}" ] || args="--remove=${removals}"
[ -z "${losses}" ] || args="${args:+${args} }--lose=${losses}"
[ "${MODE}" = "apply" ] || args="${args} --preview"
printf '%s\n' "${args}"
