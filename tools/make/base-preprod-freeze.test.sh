#!/usr/bin/env bash
# Chaque contrat insuffisant doit être rejeté avant toute commande externe.
for change in 'del(.maintenance.changeFreeze)' '.maintenance.changeFreeze.noPushOrMerge=false' '.maintenance.changeFreeze.reference=""' '.maintenance.changeFreeze.startsAt=($now|fromdateiso8601+60|todateiso8601)' '.maintenance.reopenBy=($now|fromdateiso8601-1|todateiso8601)' '.maintenance.changeFreeze.endsAt=($now|fromdateiso8601+30|todateiso8601)';do
  jq --arg now "$now" "$change" "$actions_input" > input.json
  : > cluster-calls
  if invoke preflight;then echo "ÉCHEC : contrat de gel accepté : $change" >&2;exit 1;fi
  rg -q 'Gel.*durée' "result-$n.log"
  [[ ! -s cluster-calls ]] || { echo 'ÉCHEC : accès externe avant validation de durée' >&2;exit 1; }
done
cp "$actions_input" input.json
: > cluster-calls
invoke preflight
jq -e --slurpfile c input.json '.passed and .binding==$c[0].binding and .changeFreeze==$c[0].maintenance.changeFreeze and .reopenBy==$c[0].maintenance.reopenBy' "out-$n/preflight.json" >/dev/null
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) |^gh .*--method (PUT|POST|PATCH|DELETE)' cluster-calls;then
  echo 'ÉCHEC : préflight mutateur' >&2;exit 1
fi
printf 'PASS préflight : accord complet, référencé et valable jusqu’à réouverture\n'
