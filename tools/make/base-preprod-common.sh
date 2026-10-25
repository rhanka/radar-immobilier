#!/usr/bin/env bash
# Shared operator guards. Owner JSON is data, never sourced or interpolated into code.
fail() { echo "$1" >&2; exit 2; }
regular_json() {
  local path=$1 part=$1
  [[ $path == /* && $path == *.json && -f $path && -s $path && $(stat -c %s "$path") -le 1048576 ]] || fail 'Explicit bounded JSON file required'
  while [[ $part != / ]]; do
    [[ ! -L $part ]] || fail 'Symlink input refused'
    case ${part##*/} in .env*|.git|secrets|credentials) fail 'Forbidden input path';; esac
    part=$(dirname -- "$part")
  done
  jq -se 'length == 1' "$path" >/dev/null || fail 'Exactly one JSON document required'
}
operator_inputs() {
  [[ ${ENV:-} == preprod ]] || fail 'ENV=preprod required'
  regular_json "${INPUT:-}"
  jq -e -f tools/make/base-preprod-input.jq "$INPUT" >/dev/null || fail 'Invalid or placeholder operator input'
  [[ ${OUTPUT:-} == /* && ! -e $OUTPUT && ! -L $OUTPUT ]] || fail 'New absolute OUTPUT directory required'
  local parent=$OUTPUT
  while [[ $parent != / ]]; do
    [[ ! -L $parent ]] || fail 'Symlink output refused'
    parent=$(dirname -- "$parent")
  done
  mkdir -m 700 -p "$OUTPUT"
  k=(kubectl --context "$(jq -r .context "$INPUT")" --namespace radar-immobilier-preprod --request-timeout=20s)
  repo=$(jq -r .repository "$INPUT")
  job=$(jq -r .jobName "$INPUT")
  jq '{binding,image,backup,context,namespace,jobName}' "$INPUT" > "$OUTPUT/binding.json"
}
require_expected() {
  regular_json "${EXPECTED:-}"
  jq -e 'type=="array" and length>0 and all(.[];
    (.id|type=="string" and length>0) and (.role|type=="string" and length>0))
    and ([.[].id]|length== (unique|length))
    and ([..|strings|test("<|>|placeholder|changeme|todo";"i")]|any|not)' "$EXPECTED" >/dev/null || fail 'Independent nonempty instance roster required'
}
require_proofs() {
  regular_json "${PROOFS:-}"
  # Reuse the same schema definitions without running its final common-input filter.
  { sed '$d' tools/make/base-preprod-input.jq; cat tools/make/base-preprod-proof.jq; } > "$OUTPUT/proof-filter.jq"
  jq -e --slurpfile input "$INPUT" --slurpfile expected "$EXPECTED" \
    -f "$OUTPUT/proof-filter.jq" "$PROOFS" >/dev/null || fail 'Unqualified or foreign maintenance proofs'
}
render_job() {
  local action=$1
  if [[ $action == activate || $action == resume ]]; then require_expected; require_proofs; fi
  jq -n --arg action "$action" --slurpfile input "$INPUT" \
    --slurpfile expected "${EXPECTED:-/dev/null}" --slurpfile proofs "${PROOFS:-/dev/null}" \
    -f tools/make/base-preprod-job.jq > "$OUTPUT/job.json"
}
