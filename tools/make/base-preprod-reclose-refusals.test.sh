#!/usr/bin/env bash
# Matrice de refus sur des copies de fixtures ; aucun accès externe réel.
recovery_no_write() {
  if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls;then
    echo 'ÉCHEC : mutation malgré une précondition refusée' >&2;exit 1
  fi
}
recovery_reject() {
  : >cluster-calls
  if invoke reclose-api EXPECTED="$testdir/expected.json" ROUTES="$1";then
    echo 'ÉCHEC : reclose-api a accepté une divergence' >&2;exit 1
  fi
  recovery_no_write
}
cp input.json recovery-input.json
cp before-reclose.json recovery-live.json
for recovery_change in '.binding.releaseId="foreign"' '.closedIngresses=[]' '.closedIngresses[1].spec.defaultBackend.service.name="radar-api"';do
  jq "$recovery_change" "$closure_snapshot" > recovery-bad-routes.json
  recovery_reject "$testdir/recovery-bad-routes.json"
  cmp recovery-live.json ingress-fixture.json
done
for recovery_change in '.items[0].metadata.uid="replacement"' '.items[0].spec.tls[0].secretName="concurrent"' '.items[1].spec.defaultBackend.service.name="radar-api"';do
  jq "$recovery_change" recovery-live.json > ingress-fixture.json
  cp ingress-fixture.json recovery-divergent.json
  recovery_reject "$closure_snapshot"
  cmp recovery-divergent.json ingress-fixture.json
done
cp recovery-live.json ingress-fixture.json
for recovery_action in activate reopen-api;do
  : >cluster-calls
  recovery_proof=$testdir/proofs.json
  [[ $recovery_action != reopen-api ]] || recovery_proof=$testdir/acceptance.json
  if invoke "$recovery_action" EXPECTED="$testdir/expected.json" PROOFS="$recovery_proof";then
    echo "ÉCHEC : avancement tardif accepté : $recovery_action" >&2;exit 1
  fi
  rg -q 'Gel.*durée' "result-$n.log"; recovery_no_write
done
jq '.maintenance.changeFreeze.endsAt=(now|floor-1|todateiso8601)' recovery-input.json > input.json
recovery_reject "$closure_snapshot"
cp recovery-input.json input.json
export FAKE_STATE=reclose-race
: >cluster-calls
if invoke reclose-api EXPECTED="$testdir/expected.json" ROUTES="$closure_snapshot";then
  echo 'ÉCHEC : concurrence resourceVersion ignorée' >&2;exit 1
fi
rg -q 'Ingress modifié pendant reclose-api' "result-$n.log"
jq -e --slurpfile before recovery-live.json '[.items[].spec]==[$before[0].items[].spec]' ingress-fixture.json >/dev/null
if rg 'scale deployment/radar-api' cluster-calls;then exit 1;fi
cp recovery-live.json ingress-fixture.json
export FAKE_STATE=reclose-scale-fail
if invoke reclose-api EXPECTED="$testdir/expected.json" ROUTES="$closure_snapshot";then exit 1;fi
[[ $(cat api-replicas-fixture) == 1 ]]
unset FAKE_STATE
# La route est déjà fermée ; le même snapshot permet de reprendre l'arrêt.
invoke reclose-api EXPECTED="$testdir/expected.json" ROUTES="$closure_snapshot"
[[ $(cat api-replicas-fixture) == 0 ]]
# Réinitialiser les copies pour le parcours nominal qui suit la matrice.
cp recovery-live.json ingress-fixture.json
printf '1\n' >api-replicas-fixture
printf 'PASS refus reclose-api, concurrence et reprise après arrêt interrompu\n'
