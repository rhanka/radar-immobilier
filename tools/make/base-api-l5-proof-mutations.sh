#!/usr/bin/env bash
jq -e 'keys==["l5","pwa","pwb","pwc","pwd","pwe","review"]' "$mutants" >/dev/null
component_source() {
  check_source "$1"
  for label in typecheck eslint required; do command_passed "$1" "$label"; done
  tests_passed "$1" required
  jq -e '.numPendingTests==0' "$1/required.json" >/dev/null
}
for tuple in pwa:31 pwb:5 pwd:7 pwc:25; do
  batch=${tuple%:*}; count=${tuple#*:}
  directory=$(jq -er --arg batch "$batch" '.[$batch]' "$mutants")
  component_source "$directory"
  before_intrusion "$directory" "$directory/$batch-mutants/campaign.log"
  hash=$(sha256sum "tools/make/base-api-$batch-mutations.mjs" | cut -d' ' -f1)
  jq -e --arg batch "$batch" --arg hash "$hash" 'any(.[];.batch==$batch and .status==0 and
    .scriptSha256==$hash and .protectedBytesRestored)' "$directory/inherited-mutants.json" >/dev/null
  receipt="$directory/$batch-mutants/mutations.json"
  jq -e --argjson count "$count" 'length==$count and ([.[].name]|unique|length)==$count' "$receipt" >/dev/null
  case $batch in
    pwa|pwc) jq -e 'all(.[];.killed and .restored and (.sha256|test("^[a-f0-9]{64}$")))' "$receipt" >/dev/null;;
    pwb) jq -e 'all(.[];.baseline.expected==.baseline.observed and .restored.expected==.restored.observed and
      .mutated.expected!=.mutated.observed)' "$receipt" >/dev/null;;
    pwd) jq -e 'all(.[];.baseline=="passed" and .mutated=="assertion_failed" and .restored=="passed")' "$receipt" >/dev/null;;
  esac
done
for tuple in pwe:52 review:16 l5:3; do
  group=${tuple%:*}; count=${tuple#*:}
  directory=$(jq -er --arg group "$group" '.[$group]' "$mutants")
  component_source "$directory"
  kind=$group; [[ $group != review ]] || kind=pwcr
  label=$group-mutants
  before_intrusion "$directory" "$directory/$label.log"
  command_passed "$directory" "$label"
  jq -e --argjson count "$count" 'length==$count and ([.[].name]|unique|length)==$count and
    all(.[];.killed and (.baseline|length)>0 and (.restored|length)>0 and
      all(.baseline[];.status=="passed") and all(.restored[];.status=="passed") and
      all(.mutated[];.status=="passed" or .status=="failed") and
      any(.mutated[];.status=="failed" and any(.failureMessages[];test("AssertionError|__VITEST_REJECTS__"))))' \
    "$directory/$kind-mutants/results.json" >/dev/null
  if [[ $group == l5 ]]; then
    jq -e '.status==0 and .signal==null' "$directory/l5-mutation-harness.json" >/dev/null
  fi
done
