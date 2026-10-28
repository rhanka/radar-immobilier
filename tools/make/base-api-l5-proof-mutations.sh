#!/usr/bin/env bash
[[ $(cat "$mutants/status") == 0 && -s $mutants/lock-release.txt ]]
for label in inherited-mutants pwe-mutants review-mutants l5-mutants; do command_passed "$mutants" "$label"; done
for tuple in pwa:31 pwb:5 pwd:7 pwc:25; do
  batch=${tuple%:*}; count=${tuple#*:}
  hash=$(sha256sum "tools/make/base-api-$batch-mutations.mjs" | cut -d' ' -f1)
  jq -e --arg batch "$batch" --arg hash "$hash" 'any(.[];.batch==$batch and .status==0 and
    .scriptSha256==$hash and .protectedBytesRestored)' "$mutants/inherited-mutants.json" >/dev/null
  jq -e --argjson count "$count" 'length==$count and ([.[].name]|unique|length)==$count' "$mutants/$batch-mutants/mutations.json" >/dev/null
done
for batch in pwa pwc; do
  jq -e 'all(.[];.killed and .restored and (.sha256|test("^[a-f0-9]{64}$")))' "$mutants/$batch-mutants/mutations.json" >/dev/null
done
jq -e 'all(.[];.baseline.expected==.baseline.observed and .restored.expected==.restored.observed and
  .mutated.expected!=.mutated.observed)' "$mutants/pwb-mutants/mutations.json" >/dev/null
jq -e 'all(.[];.baseline=="passed" and .mutated=="assertion_failed" and .restored=="passed")' "$mutants/pwd-mutants/mutations.json" >/dev/null
for tuple in pwe:52 pwcr:16 l5:3; do
  kind=${tuple%:*}; count=${tuple#*:}
  jq -e --argjson count "$count" 'length==$count and ([.[].name]|unique|length)==$count and
    all(.[];.killed and (.baseline|length)>0 and (.restored|length)>0 and
      all(.baseline[];.status=="passed") and all(.restored[];.status=="passed") and
      all(.mutated[];.status=="passed" or .status=="failed") and
      any(.mutated[];.status=="failed" and any(.failureMessages[];test("AssertionError|__VITEST_REJECTS__"))))' \
    "$mutants/$kind-mutants/results.json" >/dev/null
done
jq -e '.status==0 and .signal==null' "$mutants/l5-mutation-harness.json" >/dev/null
