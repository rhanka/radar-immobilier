#!/usr/bin/env bash
# Accord explicite du conducteur couvrant la bascule et sa marge de récupération.
require_change_freeze() {
  local recovery=false
  case ${action:-} in reclose-api|verify-closed|restore-ingresses) recovery=true;; esac
  jq -e --argjson recovery "$recovery" '
    def stamp($field):
      getpath($field|split(".")) as $v |
      if ($v|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$")) then
        try ($v|capture("^(?<whole>[^.Z]+)(?<fraction>[.][0-9]+)?Z$") |
          (.whole+"Z"|fromdateiso8601) + ("0"+(.fraction//"")|tonumber))
        catch error("Horodatage invalide : \($field) ; UTC Z requis")
      else error("Horodatage invalide : \($field) ; UTC Z requis, fractions autorisées") end;
    stamp("maintenance.changeFreeze.startsAt") as $start |
    stamp("maintenance.changeFreeze.endsAt") as $end |
    stamp("maintenance.reopenBy") as $reopen |
    .maintenance.changeFreeze as $f |
    $f.noPushOrMerge==true and ($f.reference|type=="string" and length>0 and length<=512 and test("\\S"))
    and $start<=now and now<$end and $start<$reopen and $reopen<=$end
    and ($recovery or now<$reopen)' "$INPUT" >/dev/null || fail 'Gel push/fusion absent ou de durée insuffisante : accord référencé, gel actif et reopenBy couvert requis'
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
