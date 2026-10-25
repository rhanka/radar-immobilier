#!/usr/bin/env bash
# Sourced by the hermetic operator test in its private fixture workspace.
jq '.maintenance={middleware:"base-maintenance-fixture",sources:["198.51.100.23/32"],ingresses:["fixture-app","fixture-mcp"]}
 | .mcpDeployment="fixture-mcp" | .apiIngress="fixture-app"' input.json > enriched.json
cp enriched.json input.json
cp good-proofs.json proofs.json
jq -n --slurpfile c input.json --arg now "$now" '{deploymentUid:"synthetic-api-deployment",generation:"2",
  restartedAt:$now,podUid:"synthetic-api-pod",templateHash:"synthetic-template",containerId:"containerd://synthetic",
  restartCount:"0",startedAt:$now,image:$c[0].image,imageID:("containerd://"+($c[0].image|split("@")[1]))}' > api-fixture.json
cat > bin/kubectl <<'FAKE'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> cluster-calls
shift 5
case "$*" in
  'auth can-i '*) [[ ${FAKE_STATE:-} != denied ]] || { echo no; exit 1; }; echo yes;;
  'api-resources '*) echo middlewares.traefik.io;;
  'get job '*conditions*)
    if [[ ${FAKE_STATE:-} == failed-job || ${FAKE_STATE:-} == failed-with-zero ]]; then echo Failed; else echo Complete; fi;;
  'get job '*) printf 'synthetic-job-uid\t%s\n' "$(jq -r .image "$INPUT")";;
  'get pods -l app.kubernetes.io/name='*)
    case ${FAKE_STATE:-} in
      new-pod) change='.podUid="replacement"';;
      crash) change='.restartCount="1"';;
      new-container) change='.containerId="containerd://replacement"';;
      new-template) change='.templateHash="replacement"';;
      *) change='.';;
    esac
    jq -r "$change | [.podUid,.image,.templateHash,.containerId,.restartCount,.startedAt,.imageID,\"true\"]|@tsv" api-fixture.json;;
  'get pods -l '*imageID*)
    digest=$(jq -r '.image|split("@")[1]' "$INPUT")
    [[ ${FAKE_STATE:-} != foreign-image ]] || digest=sha256:$(printf 'c%.0s' {1..64})
    code=0; [[ ${FAKE_STATE:-} != failed-job ]] || code=2
    printf 'synthetic-pod-uid\t%s\tcontainerd://%s\t%s\n' "$(jq -r .image "$INPUT")" "$digest" "$code";;
  'get pods -l '*) cat synthetic-termination.json;;
  'logs job/'*) cat synthetic-receipt.json;;
  'get pods '*)
    case ${FAKE_STATE:-} in
      old) printf 'synthetic-old-api\tRunning\tapi\t\n';;
      new) printf 'unexpected-new-uid\tRunning\tapi\t\n';;
    esac;;
  'get ingresses '*) printf 'fixture-app\nfixture-mcp\n';;
  'get ingress '*) printf 'radar-immobilier-preprod-base-maintenance-fixture@kubernetescrd';;
  'get middleware '*) printf '["198.51.100.23/32"]';;
  'get service radar-api '*publishNotReadyAddresses*)
    [[ ${FAKE_STATE:-} != publish-unready ]] || printf true;;
  'get service radar-api '*selector*)
    printf '{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"api"}';;
  'get deployment fixture-mcp '*) jq -r .image "$INPUT";;
  'get deployment radar-api '*metadata.uid*)
    generation=2; [[ ${FAKE_STATE:-} != new-generation ]] || generation=3
    printf 'synthetic-api-deployment\t%s\t%s\t1\n' "$generation" "$generation";;
  'get deployment radar-api '*restartedAt*) jq -r .restartedAt api-fixture.json;;
  'get deployment radar-api '*availableReplicas*)
    if [[ ${FAKE_STATE:-} == unavailable ]]; then echo 0; else echo 1; fi;;
  'get deployment radar-api '*) jq -r .image "$INPUT";;
  'get cronjobs '*) [[ ${FAKE_STATE:-} != cron ]] || echo false;;
  'get jobs '*) [[ ${FAKE_STATE:-} != job ]] || echo 1;;
  'get endpointslices '*) [[ ${FAKE_STATE:-} != ready ]] || printf '[{"conditions":{"ready":true}}]\n';;
  'get deployments '*) [[ ${FAKE_STATE:-} != replicas ]] || printf 'radar-ui\t1\n';;
esac
exit 0
FAKE
cat > bin/gh <<'FAKE'
#!/usr/bin/env bash
set -eu
printf 'gh %s\n' "$*" >> cluster-calls
case "$*" in
  *'--jq .state'*)
    if [[ ${FAKE_STATE:-} == cd ]]; then echo active; else echo disabled_manually; fi;;
  *'/actions/runs?per_page=100'*) [[ ${FAKE_STATE:-} != run ]] || echo '{"id":123,"status":"in_progress"}';;
  *) echo '{}';;
esac
exit 0
FAKE
chmod +x bin/kubectl bin/gh
invoke collect-maintenance EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
jq -e '.expectedInstances|length==2' "out-$n/maintenance.json" >/dev/null
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
for state in old new cron job ready replicas publish-unready cd run; do
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
jq -n --slurpfile c input.json --slurpfile instance api-fixture.json --arg now "$now" \
  '{reference:"synthetic-qualification",sha256:("f"*64),observedAt:$now,passed:true,instance:$instance[0]} as $q |
  {binding:$c[0].binding,image:$c[0].image,q1:$q,q2:($q+{afterRestart:true}),
    restart:{binding:$c[0].binding,image:$c[0].image,completedAt:$now,instance:$instance[0]},
    personal:{writerEpoch:"scoped",maintenanceBarrier:false},lotsOpen:false,mcpSuccessorDeployed:true}' > acceptance.json
: > cluster-calls
invoke reopen-api PROOFS="$testdir/acceptance.json"
rg -q -- '--request-timeout=20s patch ingress fixture-app' cluster-calls
if rg -- '--request-timeout=20s (scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
cp acceptance.json accepted.json
jq 'del(.q2,.restart)' accepted.json > first-qualification.json
invoke restart-api PROOFS="$testdir/first-qualification.json"
jq -e --slurpfile instance api-fixture.json '.instance==$instance[0] and (.completedAt|length>0)' "out-$n/restart.json" >/dev/null
for field in q2 q2.afterRestart binding.releaseId restart restart.instance; do
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
