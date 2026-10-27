#!/usr/bin/env bash
# Sourced by the hermetic operator fixture; all cluster commands are fake.
cp input.json network-good-input.json
for state in nodeport loadbalancer external-ip external-name node-port-field hostnetwork hostport template-hostport template-hostnetwork init-hostport alternate-route extra-endpoint extra-legacy no-isolation allow-pods policy-change; do
  export FAKE_STATE=$state
  for action in close activate start-api restart-api reopen-api; do
    [[ $action != close || ( $state != extra-endpoint && $state != extra-legacy ) ]] || continue
    proofs=$testdir/proofs.json
    [[ $action != start-api ]] || proofs=$testdir/activation-receipt.json
    [[ $action != restart-api ]] || proofs=$testdir/first-qualification.json
    [[ $action != reopen-api ]] || proofs=$testdir/acceptance.json
    : > cluster-calls
    if invoke "$action" EXPECTED="$testdir/expected.json" PROOFS="$proofs"; then
      echo "Network bypass accepted: $action $state" >&2; exit 1
    fi
    case $state in
      nodeport|loadbalancer|external-ip|external-name|node-port-field) error='Unqualified Service exposure';;
      hostnetwork|hostport) error='Pod exposes hostNetwork or hostPort';;
      template-hostport|template-hostnetwork|init-hostport) error='Workload template exposes hostNetwork or hostPort';;
      alternate-route) error='Unsupported alternate network route/policy';;
      extra-endpoint) error='A consumer endpoint is ready';;
      extra-legacy) error='A consumer legacy endpoint is ready';;
      no-isolation) error='Consumer pod ingress is not isolated';;
      allow-pods) error='Unbounded PostgreSQL ingress sources are forbidden';;
      policy-change) error='Fresh bound CNI enforcement probes required';;
    esac
    rg -qF "$error" "result-$n.log" || { cat "result-$n.log" >&2; exit 1; }
    if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
  done
done
unset FAKE_STATE
for filter in 'del(.maintenance.networkIsolation)' '.maintenance.networkIsolation.networkPolicyEnforced=false' \
  '.maintenance.networkIsolation.nodeOriginDenied=false' '.maintenance.networkIsolation.binding.actorSub="foreign"' \
  '.maintenance.networkIsolation.observedAt="2000-01-01T00:00:00Z"'; do
  jq "$filter" network-good-input.json > input.json
  : > cluster-calls
  if invoke start-api PROOFS="$testdir/activation-receipt.json"; then echo 'Unverified pod isolation accepted' >&2; exit 1; fi
  rg -qF 'Fresh bound CNI enforcement probes required' "result-$n.log"
  if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
done
cp network-good-input.json input.json
# A qualified API endpoint can exist during Q1/Q2, never during closed maintenance.
export FAKE_STATE=qualified-endpoint
if invoke collect-maintenance EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"; then exit 1; fi
rg -qF 'A consumer endpoint is ready' "result-$n.log"
invoke tunnel-api
unset FAKE_STATE
cp network-policies.json network-original-policies.json
jq '.items += [{metadata:{name:"controller-only",uid:"controller-policy",resourceVersion:"1"},
  spec:{podSelector:{matchLabels:{"app.kubernetes.io/component":"api"}},policyTypes:["Ingress"],ingress:[{from:[{namespaceSelector:{matchLabels:{"kubernetes.io/metadata.name":"traefik"}},
  podSelector:{matchLabels:{"app.kubernetes.io/name":"traefik"}}}]}]}},
  {metadata:{name:"database-only",uid:"db-policy",resourceVersion:"1"},
  spec:{podSelector:{matchLabels:{"app.kubernetes.io/component":"postgres"}},policyTypes:["Ingress"],ingress:[{}]}}]' network-original-policies.json > network-policies.json
policy_sha=$(jq -Sc '[.items[]|{metadata:(.metadata|{name,uid,resourceVersion}),spec}]|sort_by(.metadata.name)' network-policies.json | sha256sum | cut -d' ' -f1)
jq --arg sha "$policy_sha" '.maintenance.networkIsolation.policySha256=$sha' network-good-input.json > input.json
for rule in '{}' '{"from":[]}' '{"from":[{}]}' '{"from":[{"podSelector":{}}]}' \
  '{"from":[{"namespaceSelector":{}}]}' \
  '{"from":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"other"}},"podSelector":{"matchLabels":{"component":"api"}}}]}' \
  '{"from":[{"ipBlock":{"cidr":"0.0.0.0/0"}}]}'; do
  jq --argjson rule "$rule" '.items[-1].spec.ingress=[$rule]' network-policies.json > database-policy.json
  cp database-policy.json network-policies.json
  policy_sha=$(jq -Sc '[.items[]|{metadata:(.metadata|{name,uid,resourceVersion}),spec}]|sort_by(.metadata.name)' network-policies.json | sha256sum | cut -d' ' -f1)
  jq --arg sha "$policy_sha" '.maintenance.networkIsolation.policySha256=$sha' network-good-input.json > input.json
  for action in close start-api; do
    : > cluster-calls
    if invoke "$action" EXPECTED="$testdir/expected.json" PROOFS="$testdir/activation-receipt.json"; then
      echo 'Unbounded PostgreSQL ingress accepted' >&2; exit 1
    fi
    rg -qF 'Unbounded PostgreSQL ingress sources are forbidden' "result-$n.log"
    if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
  done
done
# A broad selector can also select PostgreSQL; it receives the same refusal.
jq '.items[-1].spec.podSelector={}' network-policies.json > database-policy.json
cp database-policy.json network-policies.json
if invoke start-api PROOFS="$testdir/activation-receipt.json"; then exit 1; fi
rg -qF 'Unbounded PostgreSQL ingress sources are forbidden' "result-$n.log"
jq '.items[-1].spec.podSelector={matchLabels:{"app.kubernetes.io/component":"postgres"}}
  | .items[-1].spec.ingress=[{from:[{podSelector:{matchLabels:{"app.kubernetes.io/component":"api"}}}]}]' network-policies.json > database-policy.json
cp database-policy.json network-policies.json
policy_sha=$(jq -Sc '[.items[]|{metadata:(.metadata|{name,uid,resourceVersion}),spec}]|sort_by(.metadata.name)' network-policies.json | sha256sum | cut -d' ' -f1)
jq --arg sha "$policy_sha" '.maintenance.networkIsolation.policySha256=$sha' network-good-input.json > input.json
invoke tunnel-api
cp network-original-policies.json network-policies.json
cp network-good-input.json input.json
cp ingress-fixture.json middleware-baseline.json
for annotation in 'traefik.ingress.kubernetes.io/router.middlewares=auth@file' \
  'traefik.ingress.kubernetes.io/router.middlewares=auth@kubernetescrd' \
  'traefik.example/extension=middleware:auth' 'traefik.example/extension=auth@file'; do
  jq --arg key "${annotation%%=*}" --arg value "${annotation#*=}" \
    '.items[0].metadata.annotations[$key]=$value' middleware-baseline.json > ingress-fixture.json
  for action in close start-api; do
    : > cluster-calls
    if invoke "$action" EXPECTED="$testdir/expected.json" PROOFS="$testdir/activation-receipt.json"; then
      echo 'Traefik middleware annotation accepted' >&2; exit 1
    fi
    rg -qF 'Traefik middleware annotations are forbidden' "result-$n.log"
    if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
  done
done
cp middleware-baseline.json ingress-fixture.json
echo 'PASS alternate Services/routes, host ports, namespace endpoints, CNI evidence and qualification boundary'
cp input.json waiver-original-input.json
jq '.maintenance.networkIsolation={waiver:{reference:"owner-preprod-preaccord-2026-10-27",
  reason:"Conductor-authorized preprod cutover without CNI qualification"}}' input.json > waiver-input.json
cp waiver-input.json input.json
export FAKE_STATE=no-isolation
invoke collect-maintenance EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
jq -e --slurpfile c input.json '.mode=="waived" and .namespace=="radar-immobilier-preprod"
  and .binding==$c[0].binding and .waiver==$c[0].maintenance.networkIsolation.waiver' "out-$n/network-isolation-receipt.json" >/dev/null
jq -e '.networkIsolation.mode=="waived" and .networkIsolation.waiver.reason!=""' "out-$n/maintenance.json" >/dev/null
rg -qF 'network-isolation-receipt.json' "out-$n/checksums.txt"
invoke start-api PROOFS="$testdir/activation-receipt.json"
# No declaration: the existing profile/CNI gate still refuses this cluster.
jq 'del(.maintenance.networkIsolation.waiver)' waiver-input.json > input.json
if invoke start-api PROOFS="$testdir/activation-receipt.json"; then exit 1; fi
rg -qF 'Consumer pod ingress is not isolated' "result-$n.log"
unset FAKE_STATE
cp waiver-input.json input.json
{ sed '$d' tools/make/base-preprod-input.jq; echo isolation_waiver; } > waiver-filter.jq
for namespace in radar-immobilier radar-immobilier-prod another-namespace radar-immobilier-preprod-shadow; do
  jq --arg ns "$namespace" '.namespace=$ns' waiver-input.json > input.json
  : > cluster-calls
  if invoke validate; then echo 'Waiver accepted outside preprod' >&2; exit 1; fi
  [[ ! -s cluster-calls ]]
  if jq -e -f waiver-filter.jq input.json >/dev/null; then exit 1; fi
done
for change in '.maintenance.networkIsolation.waiver=null' \
  '.maintenance.networkIsolation.waiver.reference="unapproved"' \
  '.maintenance.networkIsolation.waiver.reason="   "' \
  'del(.maintenance.networkIsolation.waiver.reason)'; do
  jq "$change" waiver-input.json > input.json
  : > cluster-calls
  if invoke validate; then echo 'Malformed waiver accepted' >&2; exit 1; fi
  [[ ! -s cluster-calls ]]
done
cp waiver-input.json input.json
for state in old new cron job replicas extra-endpoint extra-legacy allow-pods nodeport hostport; do
  export FAKE_STATE=$state
  : > cluster-calls
  if invoke collect-maintenance EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"; then
    echo "Waiver bypassed retained guard: $state" >&2; exit 1
  fi
  case $state in
    old) error='An old instance still exists';; new) error='A consumer or operator process is still running';;
    cron) error='CronJob is not suspended';; job) error='An active Job remains';;
    replicas) error='Consumer deployment can restart';; extra-endpoint) error='A consumer endpoint is ready';;
    extra-legacy) error='A consumer legacy endpoint is ready';; allow-pods) error='Unbounded PostgreSQL ingress sources are forbidden';;
    nodeport) error='Unqualified Service exposure';; hostport) error='Pod exposes hostNetwork or hostPort';;
  esac
  rg -qF "$error" "result-$n.log"
  if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls; then exit 1; fi
done
unset FAKE_STATE
jq '.items[0].metadata.annotations["traefik.ingress.kubernetes.io/router.middlewares"]="auth@file"' middleware-baseline.json > ingress-fixture.json
if invoke start-api PROOFS="$testdir/activation-receipt.json"; then exit 1; fi
rg -qF 'Traefik middleware annotations are forbidden' "result-$n.log"
cp middleware-baseline.json ingress-fixture.json
jq '.items[0].spec.rules[0].http.paths[0].backend.service.name="radar-api"' middleware-baseline.json > ingress-fixture.json
if invoke start-api PROOFS="$testdir/activation-receipt.json"; then exit 1; fi
rg -qF 'Ingress lacks refusal backend' "result-$n.log"
cp middleware-baseline.json ingress-fixture.json
jq '.binding.releaseId="1234567:short"' waiver-input.json > input.json
: > cluster-calls
if invoke validate; then echo 'Waiver bypassed full release SHA' >&2; exit 1; fi
[[ ! -s cluster-calls ]]
cp waiver-original-input.json input.json
echo 'PASS preprod-only waiver receipts, rejection outside preprod, unchanged absence and retained guards'
