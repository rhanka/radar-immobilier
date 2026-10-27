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
