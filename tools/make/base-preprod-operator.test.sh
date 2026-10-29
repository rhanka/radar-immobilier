reject resume
reject close
jq '.backup.reference="https://backup.invalid/object?token=synthetic"' valid.json > input.json
reject validate
cp valid.json input.json
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
  {binding:$c.binding,image:$c.image,
   observations:{networkAllowed:$check,networkDenied:$check,sessionRequired:$check,
    externalStopped:$check,streamsTerminated:$check,mcpSuccessor:($check+{image:$c.image})},
   databaseInspection:{binding:$c.binding,image:$c.image,releaseSha:($c.binding.releaseId|split(":")[0]),
    action:"inspect",observedAt:($now|sub("Z$";".123Z")),result:{
    identity:[($c.database+{observe_transactions:true})],missingMigrations:[],
    approved:[{id:"synthetic-account",sub:$c.binding.actorSub,status:"approved"}],
    memberships:[{account_id:"synthetic-account",status:"active",manage_members:true}],
    differences:[{activeMember:true,attachedHere:true,attachedElsewhere:false}],personal:[],lots:[],
    privileges:(["account_users","workspaces","workspace_memberships","workspace_membership_events",
     "facet_streams","facet_event_bindings","facet_heads","facet_stream_attachments","facet_command_contexts",
     "facet_activation_state","facet_unresolved_events","facet_events","facet_commands",
     "personal_projection_revisions","workspace_projection_revisions"]
      |map({relation:.,read:true,insert:true,update:true,lock_authority:true})),
    functions:[{proname:"check_facet_stream",execute:true},{proname:"facet_swap_head_enforcement",execute:true}],
    indexAuthority:[{can_drop_as_current_role:true}],transactions:[{active_transactions:0,active_sessions:0}]}},
   evidence:($c.binding+{reason:$c.reason,instanceIds:($ids[0]|map(.id)),
    drain:{completedAt:$now,coveredInstanceIds:($ids[0]|map(.id))},
    shutdown:{completedAt:$now,coveredInstanceIds:($ids[0]|map(.id))}})}' > proofs.json
invoke render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
jq -e '.spec.template.spec.containers[0].command[2]|fromjson|.args|index("--evidence-json")!=null' "out-$n/job.json" >/dev/null
cp proofs.json good-proofs.json
for right in facet_event_bindings:lock_authority workspace_memberships:update facet_activation_state:update; do
  relation=${right%:*}; privilege=${right#*:}
  jq --arg relation "$relation" --arg privilege "$privilege" \
    '(.databaseInspection.result.privileges[]|select(.relation==$relation)|.[$privilege])=false' good-proofs.json > proofs.json
  reject render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
done
while IFS=$'\t' read -r privilege relation; do
  jq --arg relation "$relation" --arg privilege "$privilege" \
    '(.databaseInspection.result.privileges[]|select(.relation==$relation)|.[$privilege])=false' good-proofs.json > proofs.json
  reject render-job EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"
done < <(jq -r '.activate|to_entries[]|.key as $key|.value[]|[$key,.]|@tsv' api/src/scripts/base-preprod-rights.json)
cp good-proofs.json proofs.json
for field in image databaseInspection.image databaseInspection.releaseSha binding.actorSub binding.workspaceId binding.maintenanceAttemptId binding.releaseId evidence.actorSub evidence.maintenanceAttemptId evidence.releaseId; do
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
