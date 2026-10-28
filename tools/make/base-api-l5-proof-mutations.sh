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
    .scriptSha256==$hash and .protectedBytesRestored and
    (.materializedSha256|test("^[a-f0-9]{64}$")))' "$directory/inherited-mutants.json" >/dev/null
  if [[ $batch == pwa ]]; then
    original_hash=$(sha256sum tools/make/base-api-pwc-review-inherited.mjs | cut -d' ' -f1)
    legacy_hash=$(sha256sum tools/make/base-api-l5-legacy.mjs | cut -d' ' -f1)
    # Batch-level success above is independent of later batches interrupted by Docker.
    # Still require the wrapper exit to agree with every recorded batch result.
    jq -e --arg original "$original_hash" --arg legacy "$legacy_hash" \
      --slurpfile batches "$directory/inherited-mutants.json" '.signal==null and
      .originalSha256==$original and .legacySha256==$legacy and
      .status==(if any($batches[0][];.status!=0 or .signal!=null or .error!=null
        or (.protectedBytesRestored|not)) then 1 else 0 end)' "$directory/l5-inherited-harness.json" >/dev/null
  fi
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
    cases_hash=$(sha256sum tools/make/base-api-l5-cases.mjs | cut -d' ' -f1)
    engine_hash=$(sha256sum tools/make/base-api-pwc-review-mutations.mjs | cut -d' ' -f1)
    jq -e --arg cases "$cases_hash" --arg engine "$engine_hash" '.status==0 and .signal==null and
      .casesSha256==$cases and .engineSha256==$engine' "$directory/l5-mutation-harness.json" >/dev/null
  else
    engine=base-api-pwe-mutations.mjs
    [[ $group != review ]] || engine=base-api-pwc-review-mutations.mjs
    engine_hash=$(sha256sum "tools/make/$engine" | cut -d' ' -f1)
    cases_hash=$(sha256sum "tools/make/base-api-l5-$group-cases.mjs" | cut -d' ' -f1)
    jq -e --arg cases "$cases_hash" --arg engine "$engine_hash" \
      --slurpfile results "$directory/$kind-mutants/results.json" '.status==0 and .signal==null and
        .casesSha256==$cases and .engineSha256==$engine and
        (.caseNames|sort)==($results[0]|map(.name)|sort)' "$directory/l5-$group-harness.json" >/dev/null
  fi
done
