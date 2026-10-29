      coverage) change='.items += [.items[0]|.metadata.name="unexpected"]';;
      bypass) change='.items[0].spec.rules[0].http.paths[0].backend.service.name="radar-api"';;
      default-bypass) change='.items[1].spec.defaultBackend.service.name="radar-api"';;
      route-uid) change='.items[1].metadata.uid="replacement"';;
      *) change='.';;
    esac
    jq "$change" ingress-fixture.json;;
  'patch ingress '*)
    name=$3; command=$*
    while [[ $# -gt 0 ]]; do
      if [[ $1 == --patch-file ]]; then patch=$2; shift 2; else shift; fi
    done
    if [[ ( ${FAKE_STATE:-} == restore-race && $patch == *restore-patch.json ) || ( ${FAKE_STATE:-} == reclose-race && $patch == *reclose-patch.json ) ]]; then
      jq '(.items[0].metadata.resourceVersion)="999"' ingress-fixture.json > ingress-next.json
      mv ingress-next.json ingress-fixture.json
    fi
    if [[ $command == *'--type=json'* ]]; then
      jq --arg name "$name" --slurpfile patch "$patch" '
        (.items[]|select(.metadata.name==$name)) |=
          (reduce $patch[0][] as $op (.; ($op.path|split("/")[1:]) as $path |
            if $op.op=="test" then if getpath($path)!=$op.value then error("concurrent change") else . end
            else setpath($path;$op.value) end) |
            .metadata.resourceVersion=((.metadata.resourceVersion|tonumber)+1|tostring))' ingress-fixture.json > ingress-next.json
      mv ingress-next.json ingress-fixture.json
    else
      jq --arg name "$name" --slurpfile patch "$patch" '
        (.items[]|select(.metadata.name==$name)|.spec.rules)=$patch[0].spec.rules | (.items[]|select(.metadata.name==$name)|.metadata.resourceVersion)|=(tonumber+1|tostring)' ingress-fixture.json > ingress-next.json
      mv ingress-next.json ingress-fixture.json
    fi
    if [[ $command == *' -o json' ]]; then jq --arg name "$name" '.items[]|select(.metadata.name==$name)' ingress-fixture.json; fi;;
  'create -f '*deny-service.json)
    [[ ! -e refusal-service-exists ]] || { echo 'AlreadyExists' >&2;exit 1; }
    : >refusal-service-exists;;
  'get service base-maintenance-fixture --ignore-not-found -o json')
    [[ ! -e refusal-service-exists ]] || cat deny-service-fixture.json;;
  'get service base-maintenance-fixture -o json')
    if [[ ${FAKE_STATE:-} == deny-selector ]]; then jq '.spec.selector={app:"api"}' deny-service-fixture.json
    else cat deny-service-fixture.json; fi;;
  'get endpointslices -l kubernetes.io/service-name=base-maintenance-fixture -o json')
    if [[ ${FAKE_STATE:-} == deny-endpoint ]]; then echo '{"items":[{"endpoints":[{"conditions":{"ready":true}}]}]}'
    else echo '{"items":[]}'; fi;;
  'get endpoints base-maintenance-fixture '*)
    [[ ${FAKE_STATE:-} != deny-legacy ]] || echo '{"subsets":[{"addresses":[{"ip":"192.0.2.1"}]}]}';;
  'get service radar-api '*publishNotReadyAddresses*)
    [[ ${FAKE_STATE:-} != publish-unready ]] || printf true;;
  'get service radar-api '*selector*)
    printf '{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"api"}';;
  'get deployment fixture-mcp '*) jq -r .image "$INPUT";;
  'get deployment radar-api '*metadata.uid*)
    generation=$(jq -r .generation api-fixture.json); [[ ${FAKE_STATE:-} != new-generation ]] || generation=3
    printf 'synthetic-api-deployment\t%s\t%s\t1\n' "$generation" "$generation";;
  'get deployment radar-api '*restartedAt*) jq -r .restartedAt api-fixture.json;;
  'get deployment radar-api '*availableReplicas*)
    if [[ ${FAKE_STATE:-} == unavailable ]]; then echo 0; else echo 1; fi;;
  'get deployment radar-api '*) jq -r .image "$INPUT";;
  'get deployments.apps '*) printf 'radar-api\tapi-uid\t1\tfixture-api\nradar-ui\tui-uid\t1\tfixture-ui\nradar-immo-mcp\tmcp-uid\t1\tfixture-mcp\n';;
  'get cronjobs.batch '*) printf 'fixture-refresh\tcron-uid\tfalse\t0 * * * *\tfixture-api\n';;
  'rollout restart deployment/radar-api') cp api-after-fixture.json api-fixture.json;;
  'get cronjobs '*) [[ ${FAKE_STATE:-} != cron ]] || echo false;;
  'get jobs '*) [[ ${FAKE_STATE:-} != job ]] || echo 1;;
  'get endpointslices '*) [[ ${FAKE_STATE:-} != ready ]] || printf '[{"conditions":{"ready":true}}]\n';;
  'scale deployment/radar-api --replicas='*)
    [[ ${FAKE_STATE:-} != reclose-scale-fail ]] || exit 1
    [[ ${BASE_PREPROD_REHEARSAL:-} != 1 ]] || printf '%s\n' "${3##*=}" > api-replicas-fixture;;
  'get deployments '*)
    if [[ ${FAKE_STATE:-} == replicas ]];then printf 'radar-ui\t1\n';
    elif [[ ${BASE_PREPROD_REHEARSAL:-} == 1 ]];then printf 'radar-api\t%s\n' "$(cat api-replicas-fixture)";fi;;
esac
exit 0
FAKE
cat > bin/gh <<'FAKE'
#!/usr/bin/env bash
set -eu
printf 'gh %s\n' "$*" >> cluster-calls
if [[ ${FAKE_STATE:-} == expire-after-actions && "$*" == *'/actions/runs?per_page=100'* ]];then
  jq '.maintenance.reopenBy=(now|floor-1|todateiso8601)' "$INPUT" > expired-window.json
  mv expired-window.json "$INPUT"
  exit 0
fi
case "$*" in
  *'--jq .state'*)
    if [[ ${FAKE_STATE:-} == cd ]]; then echo active; else echo disabled_manually; fi;;
  *'/actions/runs?per_page=100'*) [[ ${FAKE_STATE:-} != run ]] || echo '{"id":123,"status":"in_progress","name":"CI fixture","path":".github/workflows/ci.yml","head_branch":"fixture/pr"}';;
  *) echo '{}';;
esac
exit 0
FAKE
chmod +x bin/kubectl bin/gh
: > cluster-calls
if [[ ${BASE_PREPROD_REHEARSAL:-} == 1 ]];then source tools/make/base-preprod-rehearsal.test.sh; return;fi
source tools/make/base-preprod-public.test.sh
source tools/make/base-preprod-actions.test.sh
invoke permissions
cp ingress-original.json ingress-fixture.json
source tools/make/base-preprod-rollback.test.sh
rm -f refusal-service-exists
invoke close EXPECTED="$testdir/expected.json"
closure_output=$testdir/out-$n
jq -e --slurpfile original ingress-original.json '.ingresses|map({metadata:{name:.metadata.name,uid:.metadata.uid},spec})==($original[0].items|map({metadata:{name:.metadata.name,uid:.metadata.uid},spec}))' "$closure_output/ingress-snapshot.json" >/dev/null
jq -e '.items[0].metadata.annotations["traefik.ingress.kubernetes.io/router.priority"]=="42"
  and .items[0].spec.tls[0].secretName=="fixture-tls"
  and .items[1].spec.defaultBackend.service.name=="base-maintenance-fixture"' ingress-fixture.json >/dev/null
rg -qF 'scale deployment/radar-api --replicas=0' cluster-calls
rg -qF 'scale deployment/radar-ui --replicas=0' cluster-calls
rg -qF 'scale deployment/radar-immo-mcp --replicas=0' cluster-calls
rg -qF 'patch cronjob fixture-refresh' cluster-calls
if rg 'api-resources --api-group|get middleware|auth can-i .*middlewares' cluster-calls; then exit 1; fi
: > cluster-calls
invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$closure_output/ingress-snapshot.json"
jq -e --slurpfile original ingress-original.json 'del(.items[].metadata.resourceVersion)==($original[0]|del(.items[].metadata.resourceVersion))' ingress-fixture.json >/dev/null
rm -f refusal-service-exists
invoke close EXPECTED="$testdir/expected.json"
closure_output=$testdir/out-$n
cp ingress-fixture.json restoration-baseline.json
for change in '.items[0].spec.tls[0].secretName="concurrent-tls"' '.items[0].spec.rules[0].host="concurrent.invalid"' '.items[1].metadata.resourceVersion="999"'; do
  jq "$change" restoration-baseline.json > ingress-fixture.json
  cp ingress-fixture.json concurrent.json
  : > cluster-calls
  if invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$closure_output/ingress-snapshot.json"; then
    echo 'Concurrent Ingress modification overwritten' >&2; exit 1
  fi
  rg -qF 'Ingress diverged since closure' "result-$n.log"
  cmp concurrent.json ingress-fixture.json
  if rg -- '--request-timeout=20s patch ingress ' cluster-calls; then exit 1; fi
done
cp restoration-baseline.json ingress-fixture.json
export FAKE_STATE=restore-race
if invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$closure_output/ingress-snapshot.json"; then
  echo 'Ingress resourceVersion race ignored' >&2; exit 1
fi
rg -qF 'Ingress changed during restoration' "result-$n.log"
jq -e --slurpfile before restoration-baseline.json '[.items[].spec]==[$before[0].items[].spec]' ingress-fixture.json >/dev/null
cp restoration-baseline.json ingress-fixture.json
unset FAKE_STATE
for state in route-uid old replicas cron job ready; do
  export FAKE_STATE=$state
  : > cluster-calls
  if invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$closure_output/ingress-snapshot.json"; then
    echo "Unsafe route restoration: $state" >&2; exit 1
  fi
  if rg -- '--request-timeout=20s patch ingress ' cluster-calls; then exit 1; fi
done
unset FAKE_STATE
jq '.binding.releaseId="foreign"' "$closure_output/ingress-snapshot.json" > foreign-routes.json
: > cluster-calls
if invoke restore-ingresses EXPECTED="$testdir/expected.json" ROUTES="$testdir/foreign-routes.json"; then exit 1; fi
[[ ! -s cluster-calls ]]
: > cluster-calls
invoke collect-maintenance EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
jq -e '.expectedInstances|length==2' "out-$n/maintenance.json" >/dev/null
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
for state in old new cron job ready replicas publish-unready cd run coverage bypass default-bypass deny-selector deny-endpoint deny-legacy; do
  export FAKE_STATE=$state
  : > cluster-calls
  if invoke activate EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"; then
    echo "Unsafe live-state acceptance: $state" >&2; exit 1
  fi
  case $state in
    old) expected_error='An old instance still exists';;
    new) expected_error='A consumer or operator process is still running';;
    cron) expected_error='CronJob is not suspended';;
    job) expected_error='An active Job remains';;
    ready) expected_error='A consumer endpoint is ready';;
    replicas) expected_error='Consumer deployment can restart';;
    publish-unready) expected_error='Service publishes unready addresses';;
    cd) expected_error='CD is not frozen';;
    run) expected_error='A nonterminal Actions run exists';;
    coverage) expected_error='Ingress coverage changed';;
    bypass|default-bypass) expected_error='Ingress lacks refusal backend';;
    deny-selector) expected_error='Invalid refusal Service';;
    deny-endpoint) expected_error='Refusal Service has endpoints';;
    deny-legacy) expected_error='Refusal Service has legacy endpoints';;
  esac
  rg -qF "$expected_error" "result-$n.log" || { cat "result-$n.log" >&2; exit 1; }
  if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
done
unset FAKE_STATE
jq '.operation="inspect"' input.json > inspect-input.json
cp input.json activation-input.json
cp inspect-input.json input.json
jq -n --slurpfile c input.json --arg now "$now" '{action:"inspect",binding:$c[0].binding,
  image:$c[0].image,releaseSha:($c[0].binding.releaseId|split(":")[0]),
  observedAt:$now,result:{identity:[$c[0].database]}}' -c > synthetic-receipt.json
receipt_sha=$(sha256sum synthetic-receipt.json | cut -d' ' -f1)
jq -n --slurpfile c input.json --arg sha "$receipt_sha" '{status:"complete",binding:$c[0].binding,
  image:$c[0].image,releaseSha:($c[0].binding.releaseId|split(":")[0]),sha256:$sha}' > synthetic-termination.json
invoke inspect
cmp synthetic-receipt.json "out-$n/receipt.json"
export FAKE_STATE=foreign-image
if invoke inspect; then echo 'Foreign running digest accepted' >&2; exit 1; fi
rg -qF 'Running pod image digest mismatch' "result-$n.log"
unset FAKE_STATE
export FAKE_STATE=failed-job
if invoke inspect; then echo 'Failed Job accepted' >&2; exit 1; fi
[[ -s out-$n/receipt.json ]] || { echo 'Failed Job receipt was not retained' >&2; exit 1; }
cmp synthetic-receipt.json "out-$n/receipt.json"
[[ -s out-$n/checksums.txt ]]
rg -qF 'Operator Job failed; verified receipt retained' "result-$n.log"
: > cluster-calls
if invoke collect-job; then echo 'Failed collected Job accepted' >&2; exit 1; fi
cmp synthetic-receipt.json "out-$n/receipt.json"
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
unset FAKE_STATE
export FAKE_STATE=failed-with-zero
if invoke collect-job; then echo 'Failed Job with zero process exit accepted' >&2; exit 1; fi
cmp synthetic-receipt.json "out-$n/receipt.json"
rg -qF 'Operator Job failed; verified receipt retained' "result-$n.log"
unset FAKE_STATE
cp input.json inspect-input.json
jq '.operation="init" | .binding.workspaceId=null | .binding.workspaceSlug="fixture"
  | .workspaceSlug="fixture"' input.json > init-input.json
cp init-input.json input.json
jq -c --slurpfile c input.json '.action="init" | .binding=$c[0].binding
  | .result={workspaceId:"11111111-1111-4111-8111-111111111111",workspaceSlug:"other"}' synthetic-receipt.json > foreign-init.json
cp synthetic-receipt.json inspect-receipt.json
cp synthetic-termination.json inspect-termination.json
cp foreign-init.json synthetic-receipt.json
receipt_sha=$(sha256sum synthetic-receipt.json | cut -d' ' -f1)
jq --slurpfile c input.json --arg sha "$receipt_sha" '.binding=$c[0].binding | .sha256=$sha' inspect-termination.json > synthetic-termination.json
if invoke collect-job; then echo 'Foreign initialization receipt accepted' >&2; exit 1; fi
rg -qF 'Initialization receipt destination mismatch' "result-$n.log"
cp inspect-input.json input.json
cp inspect-receipt.json synthetic-receipt.json
cp inspect-termination.json synthetic-termination.json
printf '\n' >> synthetic-receipt.json
if invoke inspect; then echo 'Corrupted Job receipt accepted' >&2; exit 1; fi
rg -qF 'Receipt hash mismatch' "result-$n.log"
cp activation-input.json input.json
jq -n --slurpfile c input.json '{binding:$c[0].binding,action:"activate",
  result:{workspaceId:$c[0].binding.workspaceId,sealedUnresolved:0,status:"open-success",epoch:"scoped",maintenanceBarrier:false}}' > activation-receipt.json
: > cluster-calls
invoke start-api PROOFS="$testdir/activation-receipt.json"
if rg -- '--request-timeout=20s patch ingress ' cluster-calls; then echo 'Public route opened before Q1/Q2' >&2; exit 1; fi
rg -qF 'scale deployment/radar-api --replicas=1' cluster-calls
: > cluster-calls
invoke tunnel-api
rg -qF 'port-forward --address=127.0.0.1 service/radar-api 18872:3000' cluster-calls
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
jq --arg now "$now" '.startedAt=($now|fromdateiso8601-20|todateiso8601)
  | .restartedAt=($now|fromdateiso8601-30|todateiso8601)' api-fixture.json > api-after-fixture.json
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
