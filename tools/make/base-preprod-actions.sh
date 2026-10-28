#!/usr/bin/env bash
# Accord explicite du conducteur couvrant la bascule et sa marge de récupération.
require_change_freeze() {
  jq -e '.maintenance as $m | $m.changeFreeze as $f |
    $f.noPushOrMerge==true and ($f.reference|type=="string" and length>0 and length<=512 and test("\\S"))
    and (try (($f.startsAt|fromdateiso8601)<=now and now<($m.reopenBy|fromdateiso8601)
      and ($m.reopenBy|fromdateiso8601)<=($f.endsAt|fromdateiso8601)) catch false)' "$INPUT" >/dev/null || fail 'Gel push/fusion absent ou de durée insuffisante : accord référencé, startsAt <= maintenant < reopenBy <= endsAt requis'
}
assert_no_actions() {
  local file=$1 message=$2 details
  [[ -s $file ]] || return 0
  details=$(jq -rs 'map("id=\(.id) workflow=\((.name//.path//"inconnu")|@json) branche=\((.head_branch//"inconnue")|@json)")|join("; ")' "$file")
  fail "$message : $details"
}
preflight() {
  require_change_freeze
  inventory
  require_change_freeze
  assert_no_actions "$OUTPUT/runs-initial.jsonl" 'A nonterminal Actions run exists'
  jq -n --slurpfile c "$INPUT" --arg at "$(date -u +%FT%TZ)" '{binding:$c[0].binding,image:$c[0].image,observedAt:$at,changeFreeze:$c[0].maintenance.changeFreeze,reopenBy:$c[0].maintenance.reopenBy,passed:true}' > "$OUTPUT/preflight.json"
}
