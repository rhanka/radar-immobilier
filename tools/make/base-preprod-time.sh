#!/usr/bin/env bash
# Dates des identités capturées : conversion de l'instant, jamais du fuseau local implicite.
utc_timestamp() {
  local raw=$1 field=$2
  [[ $raw =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$ ]] || fail "Horodatage invalide pour $field : ISO 8601 explicite requis"
  date -u -d "$raw" +%FT%TZ 2>/dev/null || fail "Horodatage invalide pour $field"
}
require_utc_timestamps() {
  local path=$1 invalid
  invalid=$(jq -r 'paths(strings) as $p | getpath($p) as $v |
    select($v|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:")) |
    select($v|endswith("Z")|not) | $p|map(tostring)|join(".")' "$path")
  [[ -z $invalid ]] || fail "Preuve non UTC : ${invalid//$'\n'/, } ; horodatages UTC Z requis"
}
