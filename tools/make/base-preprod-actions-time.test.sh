#!/usr/bin/env bash
cp "$actions_input" input.json
export FAKE_STATE=expire-after-actions
: > cluster-calls
if invoke activate EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json";then
  echo 'ÉCHEC : activation acceptée après expiration pendant la lecture Actions' >&2;exit 1
fi
unset FAKE_STATE
cp "$actions_input" input.json
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls;then
  echo 'ÉCHEC : activation engagée après expiration pendant la lecture Actions' >&2;exit 1
fi
rg -q 'Gel.*durée' "result-$n.log"
