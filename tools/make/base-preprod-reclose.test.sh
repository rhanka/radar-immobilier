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
jq --arg deadline "$(jq -r .lateReopenBy "$rehearsal/summary.json")" '.maintenance.reopenBy=$deadline' input.json > late-input.json
cp late-input.json input.json
source tools/make/base-preprod-reclose-refusals.test.sh
: >cluster-calls
invoke reclose-api EXPECTED="$testdir/expected.json" ROUTES="$closure_snapshot"
mark reclose-api
reclosed_snapshot=$testdir/out-$n/ingress-snapshot.json
jq -e --slurpfile before before-reclose.json --slurpfile saved "$closure_snapshot" '
  [.[].op]==["test","test","test","replace"]
  and [.[].path]==["/metadata/uid","/metadata/resourceVersion","/spec","/spec"]
  and .[0].value==$before[0].items[0].metadata.uid
  and .[1].value==$before[0].items[0].metadata.resourceVersion
  and .[2].value==$before[0].items[0].spec
  and .[3].value==($saved[0].closedIngresses[]|select(.metadata.name=="fixture-app")|.spec)' "$testdir/out-$n/reclose-patch.json" >/dev/null
[[ $(sha256sum "$closure_snapshot"|cut -d' ' -f1) == "$closure_sha" ]]
jq -e --slurpfile original "$closure_snapshot" '.ingresses==$original[0].ingresses' "$reclosed_snapshot" >/dev/null
[[ $(cat api-replicas-fixture) == 0 ]]
invoke verify-closed EXPECTED="$testdir/expected.json"
mark verify-closed
invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$reclosed_snapshot"
mark restore-ingresses
jq -e --slurpfile original ingress-original.json 'del(.items[].metadata.resourceVersion)==($original[0]|del(.items[].metadata.resourceVersion))' ingress-fixture.json >/dev/null
printf 'PASS récupération native tardive : reclose-api → verify-closed → restore-ingresses\n'
