cp api-after-fixture.json api-fixture.json
jq --arg now "$now" '.generation="1" | .podUid="synthetic-before-pod" | .templateHash="synthetic-before-template"
  | .containerId="containerd://synthetic-before" | .startedAt=($now|fromdateiso8601-60|todateiso8601)
  | .restartedAt=($now|fromdateiso8601-70|todateiso8601)' api-fixture.json > api-before-fixture.json
jq -n --slurpfile c input.json --slurpfile instance api-fixture.json --slurpfile before api-before-fixture.json --arg now "$now" \
  '{reference:"synthetic-qualification",sha256:("f"*64),observedAt:$now,passed:true,instance:$instance[0]} as $q |
  ($q+{instance:$before[0],observedAt:($now|fromdateiso8601-40|todateiso8601|sub("Z$";".123Z"))}) as $q1 |
  {binding:$c[0].binding,image:$c[0].image,q1:$q1,q2:($q+{afterRestart:true}),
    restart:{binding:$c[0].binding,image:$c[0].image,q1:$q1,previousInstance:$before[0],
      completedAt:($now|fromdateiso8601-10|todateiso8601),instance:$instance[0]},
    personal:{writerEpoch:"scoped",maintenanceBarrier:false},lotsOpen:false,mcpSuccessorDeployed:true}' > acceptance.json
cp ingress-fixture.json closed-ingresses.json
check_reopened_routes() {
  jq -e '.items[0].spec.rules[0].host=="preprod.immo.sent-tech.ca"
    and [.items[0].spec.rules[0].http.paths[].path]==["/health","/api/v1/auth","/api/v1/workspaces"]
    and all(.items[0].spec.rules[0].http.paths[]; .backend.service.name=="radar-api" and .backend.service.port.number==3000)
    and .items[0].spec.tls[0].secretName=="fixture-tls"
    and .items[0].metadata.annotations["traefik.ingress.kubernetes.io/router.priority"]=="42"
    and .items[1].spec.defaultBackend.service.name=="base-maintenance-fixture"' ingress-fixture.json >/dev/null
  cp closed-ingresses.json ingress-fixture.json
}
: > cluster-calls
invoke reopen-api PROOFS="$testdir/acceptance.json"
check_reopened_routes
rg -q -- '--request-timeout=20s patch ingress fixture-app' cluster-calls
if rg -- '--request-timeout=20s (scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
cp acceptance.json accepted.json
reject_restart_chain() {
  local scenario=$1 filter=$2
  jq "$filter" accepted.json > acceptance.json
  : > cluster-calls
  if invoke reopen-api PROOFS="$testdir/acceptance.json"; then
    echo "Unsafe restart chain: $scenario" >&2; exit 1
  fi
  rg -qF 'Bound API qualification required' "result-$n.log"
  [[ ! -s cluster-calls ]]
}
reject_restart_chain old-restart '.q1.observedAt=.q2.observedAt | .restart.q1=.q1'
reject_restart_chain same-instance '.q1=.q2 | del(.q1.afterRestart)
  | .restart.q1=.q1 | .restart.previousInstance=.q1.instance'
reject_restart_chain foreign-q1 '.restart.q1.sha256=("e"*64)'
reject_restart_chain foreign-before '.restart.previousInstance.podUid="foreign"'
reject_restart_chain reused-pod '.q1.instance.podUid=.q2.instance.podUid
  | .restart.q1=.q1 | .restart.previousInstance=.q1.instance'
reject_restart_chain reused-container '.q1.instance.containerId=.q2.instance.containerId
  | .restart.q1=.q1 | .restart.previousInstance=.q1.instance'
reject_restart_chain start-at-q1 '.q1.observedAt=.q2.instance.startedAt | .restart.q1=.q1'
jq 'del(.q2,.restart)' accepted.json > first-qualification.json
cp api-before-fixture.json api-fixture.json
invoke restart-api PROOFS="$testdir/first-qualification.json"
jq -e --slurpfile instance api-fixture.json --slurpfile q1 first-qualification.json \
  '.instance==$instance[0] and .q1==$q1[0].q1 and .previousInstance==$q1[0].q1.instance
    and .instance.podUid!=.previousInstance.podUid and (.completedAt|length>0)' "out-$n/restart.json" >/dev/null
jq --slurpfile restart "out-$n/restart.json" --arg observedAt "$(date -u +%FT%TZ)" \
  '.restart=$restart[0] | .q2.observedAt=$observedAt' accepted.json > acceptance.json
: > cluster-calls
invoke reopen-api PROOFS="$testdir/acceptance.json"
check_reopened_routes
rg -q -- '--request-timeout=20s patch ingress fixture-app' cluster-calls
for field in q2 q2.afterRestart binding.releaseId restart restart.instance restart.q1 restart.previousInstance; do
  jq --arg field "$field" 'delpaths([$field|split(".")])' accepted.json > acceptance.json
  : > cluster-calls
  if invoke reopen-api PROOFS="$testdir/acceptance.json"; then echo 'Unqualified reopening accepted' >&2; exit 1; fi
  [[ ! -s cluster-calls ]]
done
cp accepted.json acceptance.json
for state in unavailable replicas cron job new new-generation new-pod crash new-container new-template; do
  export FAKE_STATE=$state
  : > cluster-calls
  if invoke reopen-api PROOFS="$testdir/acceptance.json"; then echo "Unsafe reopening: $state" >&2; exit 1; fi
  if rg -- '--request-timeout=20s patch ingress ' cluster-calls; then exit 1; fi
done
export FAKE_STATE=denied
if invoke permissions; then echo 'Permission refusal was ignored' >&2; exit 1; fi
unset FAKE_STATE
source tools/make/base-preprod-network.test.sh
