#!/usr/bin/env bash
# No daemon delegation: all destructive calls are recorded, never executed.
set -euo pipefail
printf '%s\n' "$*" >> "$PROOF_DIR/commands"
project=$PROOF_PROJECT; owner=$PROOF_OWNER
case $1 in
  ps) [[ ! -f $PROOF_DIR/live ]] || echo container-id; exit 0;;
  volume|network)
    if [[ $2 == ls ]]; then
      [[ ! -f $PROOF_DIR/live ]] || echo "$project"_runtime
      exit 0
    fi;;
esac
if [[ ${2:-} == inspect ]]; then
  format=$4; id=$5
  case $format in
    *org.radar.base.owner*)
      case ${PROOF_CASE:-} in foreign) project=radar-test-foreign;; esac
      [[ $id != shared ]] || owner=foreign
      printf '%s|%s\n' "$project" "$owner";;
    '{{.Name}}') echo "${project}_runtime";;
    *Mounts*) [[ ${PROOF_CASE:-} != shared ]] || echo shared;;
    *) exit 2;;
  esac
  exit 0
fi
[[ $1 == compose ]] || exit 2
shift
config=
while [[ $# -gt 0 ]]; do
  case $1 in
    --env-file|-p) shift 2;;
    -f) config=$2; shift 2;;
    *) break;;
  esac
done
case $1 in
  up) touch "$PROOF_DIR/live";;
  logs|ps) echo 'retained synthetic evidence';;
  down)
    if [[ ${PROOF_CASE:-} == *cleanup* && -f $PROOF_DIR/live ]]; then exit 9; fi
    if [[ ${PROOF_CASE:-} != residual ]]; then rm -f "$PROOF_DIR/live"; fi;;
  run)
    evidence=$(sed -n 's/^      - \(.*\):\/evidence$/\1/p' "$config")
    scope=${!#}
    case ${PROOF_CASE:-} in
      failure|failure-cleanup) exit 17;;
      INT|TERM|INT-cleanup|TERM-cleanup) kill -"${PROOF_CASE%-cleanup}" "$BASE_API_RUN_PID"; sleep 0.1; exit 0;;
    esac
    : > "$evidence/tests.tsv"
    for path in $scope; do
      case ${PROOF_CASE:-} in skipped) printf '%s\t0\t0\t1\n' "$path";;
        *) printf '%s\t2\t0\t0\n' "$path";; esac
    done > "$evidence/tests.tsv";;
  *) exit 2;;
esac
