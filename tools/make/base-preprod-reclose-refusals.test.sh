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
