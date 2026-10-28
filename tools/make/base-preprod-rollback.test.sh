#!/usr/bin/env bash
# Reprise de rollback entièrement simulée, au premier appel du point d'entrée natif.
rm -f refusal-service-exists
invoke close EXPECTED="$testdir/expected.json"
rollback_routes=$testdir/out-$n/ingress-snapshot.json
: > cluster-calls
invoke verify-closed EXPECTED="$testdir/expected.json"
jq -e '.closed==true' "out-$n/closed.json" >/dev/null
rg -q 'repos/fixture/repository/actions/workflows/build-push-images.yml' cluster-calls
if rg -q 'unbound variable|CD is not frozen' "result-$n.log";then cat "result-$n.log" >&2;exit 1;fi
rollback_input=$testdir/rollback-original-input.json
cp input.json "$rollback_input"
if [[ ${VEHICLE_RECOVERY_CASE:-all} != opaque ]];then
  jq '.maintenance.reopenBy=(now|floor-1|todateiso8601)' "$rollback_input" > input.json
fi
invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$rollback_routes"
cp "$rollback_input" input.json
jq -e --slurpfile original ingress-original.json 'del(.items[].metadata.resourceVersion)==($original[0]|del(.items[].metadata.resourceVersion))' ingress-fixture.json >/dev/null
printf 'PASS rollback : garde native initialisée et routes restaurées au premier essai\n'
