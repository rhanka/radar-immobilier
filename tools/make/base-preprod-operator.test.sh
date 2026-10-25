#!/usr/bin/env bash
# Hermetic host tests: fake cluster binaries, unreadable environment sentinel, no Docker.
set -euo pipefail
root=$(pwd -P)
mkdir -p "$root/tmp"
testdir=$(mktemp -d "$root/tmp/base-preprod-tests.XXXXXX")
trap 'status=$?; if [[ $status == 0 ]]; then rm -rf "$testdir"; else cat "$testdir"/result-*.log >&2; echo "Retained: $testdir" >&2; fi' EXIT
mkdir -p "$testdir/tools/make" "$testdir/deploy/base-preprod" "$testdir/bin" "$testdir/.env"
cp tools/make/base-preprod*.sh tools/make/base-preprod*.jq "$testdir/tools/make/"
cp deploy/base-preprod/operator.mk "$testdir/deploy/base-preprod/"
printf '%s\n' '$(error root_makefile_was_read)' > "$testdir/Makefile"
printf '#!/bin/sh\nprintf unexpected >> "%s/cluster-calls"\nexit 1\n' "$testdir" > "$testdir/bin/kubectl"
cp "$testdir/bin/kubectl" "$testdir/bin/gh"
chmod +x "$testdir/bin/"*
export PATH="$testdir/bin:$PATH"
cd "$testdir"
now=$(date -u +%FT%TZ)
jq -n --arg now "$now" '{context:"synthetic-context",namespace:"radar-immobilier-preprod",
 image:("ghcr.io/fixture/api@sha256:"+("a"*64)),jobName:"base-operator-synthetic",operation:"inspect",
 repository:"fixture/repository",reason:"synthetic qualification",database:{database:"radar",role:"radar",schema:"public"},
 binding:{workspaceId:"11111111-1111-4111-8111-111111111111",actorSub:"opaque:fixture",
 maintenanceAttemptId:"22222222-2222-4222-8222-222222222222",releaseId:(("b"*40)+":synthetic")},
 backup:{reference:"synthetic-backup",sha256:("c"*64),restoredAt:$now,restoreReceiptSha256:("d"*64)}}' > input.json
n=0
invoke() {
  n=$((n+1))
  make --no-print-directory -f deploy/base-preprod/operator.mk "$@" INPUT="$testdir/input.json" OUTPUT="$testdir/out-$n" ENV=preprod > "$testdir/result-$n.log" 2>&1
}
reject() {
  if invoke "$@"; then echo "Unexpected success: $*" >&2; exit 1; fi
  [[ ! -e cluster-calls ]] || { cat cluster-calls >&2; exit 1; }
}
invoke validate
invoke render-job
jq -e '.spec.backoffLimit==0 and .spec.activeDeadlineSeconds==540
 and .spec.template.spec.serviceAccountName=="radar-app"
 and .spec.template.spec.automountServiceAccountToken==false
 and .spec.template.spec.securityContext.runAsUser==1001
 and .spec.template.spec.restartPolicy=="Never"
 and .spec.template.spec.containers[0].workingDir=="/workspace"
 and .spec.template.spec.containers[0].readinessProbe.exec.command==["/bin/false"]
 and (.spec.template.spec.containers[0].image|contains("@sha256:"))' "out-$n/job.json" >/dev/null
cp input.json valid.json
for field in context image reason binding.actorSub binding.releaseId backup.reference; do
  jq --arg field "$field" 'setpath($field|split(".");"<OWNER_INPUT>")' valid.json > input.json
  reject activate
done
cp valid.json input.json
reject activate
reject resume
reject close
n=$((n+1))
if make --no-print-directory -f deploy/base-preprod/operator.mk activate OUTPUT="$testdir/out-$n" ENV=preprod > /dev/null 2>&1; then exit 1; fi
canary=$testdir/injected
literal='$(shell touch '"$canary"') `touch '"$canary"'` $HOME ; "quote"'
jq --arg literal "$literal" '.binding.actorSub=$literal | .reason=$literal' valid.json > input.json
invoke render-job
[[ ! -e $canary ]]
jq -e --arg literal "$literal" '.spec.template.spec.containers[0].command[2]|fromjson|.binding.actorSub==$literal' "out-$n/job.json" >/dev/null
n=$((n+1))
if make --no-print-directory -f deploy/base-preprod/operator.mk validate 'INPUT=$(shell touch '"$canary"')' OUTPUT="$testdir/out-$n" ENV=preprod > /dev/null 2>&1; then exit 1; fi
[[ ! -e $canary && ! -e cluster-calls ]]
jq '.operation="activate"' valid.json > input.json
jq -n '[{id:"synthetic-old-api",role:"api"},{id:"synthetic-old-mcp",role:"mcp"}]' > expected.json
jq -n --slurpfile c input.json --slurpfile ids expected.json --arg now "$now" '
  $c[0] as $c | {reference:"synthetic-check",sha256:("e"*64),observedAt:$now,passed:true,binding:$c.binding} as $check |
  {binding:$c.binding,
   observations:{networkAllowed:$check,networkDenied:$check,sessionRequired:$check,
    externalStopped:$check,streamsTerminated:$check,mcpSuccessor:($check+{image:$c.image})},
   databaseInspection:{binding:$c.binding,action:"inspect",observedAt:($now|sub("Z$";".123Z")),result:{
    identity:[($c.database+{observe_transactions:true})],missingMigrations:[],
    approved:[{id:"synthetic-account",sub:$c.binding.actorSub,status:"approved"}],
    memberships:[{account_id:"synthetic-account",status:"active",manage_members:true}],
    differences:[{activeMember:true,attachedHere:true,attachedElsewhere:false}],personal:[],lots:[],
    privileges:(["account_users","workspaces","workspace_memberships","workspace_membership_events",
     "facet_streams","facet_event_bindings","facet_heads","facet_stream_attachments","facet_command_contexts",
     "facet_activation_state","facet_unresolved_events","facet_events","facet_commands",
     "personal_projection_revisions","workspace_projection_revisions"]
      |map({relation:.,read:true,insert:true,lock_authority:true})),
    functions:[{proname:"check_facet_stream",execute:true},{proname:"facet_swap_head_enforcement",execute:true}],
    indexAuthority:[{can_drop_as_current_role:true}],transactions:[{active_transactions:0,active_sessions:0}]}},
   evidence:($c.binding+{reason:$c.reason,instanceIds:($ids[0]|map(.id)),
    drain:{completedAt:$now,coveredInstanceIds:($ids[0]|map(.id))},
    shutdown:{completedAt:$now,coveredInstanceIds:($ids[0]|map(.id))}})}' > proofs.json
invoke render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
jq -e '.spec.template.spec.containers[0].command[2]|fromjson|.args|index("--evidence-json")!=null' "out-$n/job.json" >/dev/null
cp proofs.json good-proofs.json
for field in binding.actorSub binding.workspaceId binding.maintenanceAttemptId binding.releaseId evidence.actorSub evidence.maintenanceAttemptId evidence.releaseId; do
  jq --arg field "$field" 'setpath($field|split(".");"foreign")' good-proofs.json > proofs.json
  reject render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
done
for field in evidence.drain evidence.shutdown observations.networkDenied observations.mcpSuccessor; do
  jq --arg field "$field" 'delpaths([$field|split(".")])' good-proofs.json > proofs.json
  reject render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
done
cp good-proofs.json proofs.json
jq '.evidence.drain.completedAt="2099-01-01T00:00:00Z"' good-proofs.json > proofs.json
reject render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
source tools/make/base-preprod-live.test.sh
printf 'PASS operator refusals, literal Make/shell transport, no root/environment discovery, static Job contract (%s cases)\n' "$n"
