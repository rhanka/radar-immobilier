# Surcharges de fixture uniquement : aucune commande réelle ne sort de ce workspace.
actions_input=$testdir/actions-input.json
cp input.json "$actions_input"
if [[ ${VEHICLE_ACTION_CASE:-all} != window ]];then
  export FAKE_STATE=run
  if invoke activate EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json";then
    echo 'ÉCHEC : run non terminé accepté' >&2;exit 1
  fi
  for required in '123' 'CI fixture' 'fixture/pr';do
    if ! rg -qF "$required" "result-$n.log";then
      cat "result-$n.log" >&2
      echo 'ÉCHEC : run bloquant sans id, workflow et branche' >&2;exit 1
    fi
  done
  unset FAKE_STATE
fi
if [[ ${VEHICLE_ACTION_CASE:-all} != identity ]];then
  jq --arg now "$now" '.maintenance.changeFreeze.endsAt=($now|fromdateiso8601+60|todateiso8601)' "$actions_input" > input.json
  : > cluster-calls
  if invoke close EXPECTED="$testdir/expected.json";then
    echo 'ÉCHEC : fermeture acceptée avec un gel plus court que la bascule' >&2;exit 1
  fi
  rg -q 'Gel.*durée' "result-$n.log"
  if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls;then
    echo 'ÉCHEC : mutation avant validation du gel' >&2;exit 1
  fi
fi
source tools/make/base-preprod-actions-time.test.sh
source tools/make/base-preprod-freeze.test.sh
cp "$actions_input" input.json
printf 'PASS Actions : run identifié et fenêtre entière protégée\n'
