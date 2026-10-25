#!/usr/bin/env bash
# Sourced by the hermetic operator test in its private fixture workspace.
jq '.maintenance={middleware:"base-maintenance-fixture",sources:["198.51.100.23/32"],ingresses:["fixture-app","fixture-mcp"]}
 | .mcpDeployment="fixture-mcp" | .apiIngress="fixture-app"' input.json > enriched.json
cp enriched.json input.json
cp good-proofs.json proofs.json
cat > bin/kubectl <<'FAKE'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> cluster-calls
shift 5
case "$*" in
  'auth can-i '*) [[ ${FAKE_STATE:-} != denied ]] || { echo no; exit 1; }; echo yes;;
  'api-resources '*) echo middlewares.traefik.io;;
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
jq -n --slurpfile c input.json --arg now "$now" '{reference:"synthetic-qualification",sha256:("f"*64),observedAt:$now,passed:true} as $q |
  {binding:$c[0].binding,image:$c[0].image,q1:$q,q2:($q+{afterRestart:true}),
    personal:{writerEpoch:"scoped",maintenanceBarrier:false},lotsOpen:false,mcpSuccessorDeployed:true}' > acceptance.json
: > cluster-calls
invoke reopen-api PROOFS="$testdir/acceptance.json"
rg -q -- '--request-timeout=20s patch ingress fixture-app' cluster-calls
if rg -- '--request-timeout=20s (scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
cp acceptance.json accepted.json
for field in q2 q2.afterRestart binding.releaseId; do
  jq --arg field "$field" 'delpaths([$field|split(".")])' accepted.json > acceptance.json
  : > cluster-calls
  if invoke reopen-api PROOFS="$testdir/acceptance.json"; then echo 'Unqualified reopening accepted' >&2; exit 1; fi
  [[ ! -s cluster-calls ]]
done
cp accepted.json acceptance.json
for state in unavailable replicas cron job new; do
  export FAKE_STATE=$state
  : > cluster-calls
  if invoke reopen-api PROOFS="$testdir/acceptance.json"; then echo "Unsafe reopening: $state" >&2; exit 1; fi
  if rg -- '--request-timeout=20s patch ingress ' cluster-calls; then exit 1; fi
done
export FAKE_STATE=denied
if invoke permissions; then echo 'Permission refusal was ignored' >&2; exit 1; fi
unset FAKE_STATE
