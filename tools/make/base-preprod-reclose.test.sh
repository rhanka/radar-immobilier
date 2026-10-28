#!/usr/bin/env bash
# La fermeture initiale ne doit jamais remplacer le snapshot après réouverture.
cp ingress-fixture.json before-reclose.json
: > cluster-calls
if invoke close EXPECTED="$testdir/expected.json";then
  echo 'ÉCHEC : close réexécuté après réouverture' >&2;exit 1
fi
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls;then
  echo 'ÉCHEC : close après réouverture a tenté une mutation' >&2;exit 1
fi
cmp before-reclose.json ingress-fixture.json
printf 'PASS close après réouverture refusé sans mutation\n'
# Simuler le dépassement de l'échéance sans changer l'accord de gel actif.
jq '.maintenance.reopenBy=(now|floor-1|todateiso8601)' input.json > late-input.json
cp late-input.json input.json
: >cluster-calls
invoke reclose-api EXPECTED="$testdir/expected.json" ROUTES="$closure_snapshot"
reclosed_snapshot=$testdir/out-$n/ingress-snapshot.json
jq -e --slurpfile original "$closure_snapshot" '.ingresses==$original[0].ingresses' "$reclosed_snapshot" >/dev/null
[[ $(cat api-replicas-fixture) == 0 ]]
invoke verify-closed EXPECTED="$testdir/expected.json"
invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$reclosed_snapshot"
jq -e --slurpfile original ingress-original.json 'del(.items[].metadata.resourceVersion)==($original[0]|del(.items[].metadata.resourceVersion))' ingress-fixture.json >/dev/null
printf 'PASS récupération native tardive : reclose-api → verify-closed → restore-ingresses\n'
