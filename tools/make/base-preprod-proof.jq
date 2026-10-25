$input[0] as $c | ($expected[0]|map(.id)|sort) as $ids |
. as $p |
(.binding == $c.binding)
and ([.observations.networkAllowed,.observations.networkDenied,.observations.sessionRequired,
      .observations.externalStopped,.observations.streamsTerminated,.observations.mcpSuccessor]
     | all(.[]; attestation and .passed == true and .binding == $c.binding))
and (.observations.mcpSuccessor.image|text and test("@sha256:[a-f0-9]{64}$"))
and (.databaseInspection.binding == $c.binding and .databaseInspection.action == "inspect")
and (.databaseInspection.result as $db |
  ($db.missingMigrations|length)==0
  and ($db.identity[0]|{database,role,schema})==$c.database
  and $db.identity[0].observe_transactions == true
  and $db.transactions[0].active_transactions == 0
  and $db.transactions[0].active_sessions == 0
  and ($db.differences|length)>0
  and all($db.differences[]; .activeMember and .attachedHere and (.attachedElsewhere|not))
  and any($db.approved[]; .sub==$c.binding.actorSub)
  and any($db.memberships[]; .status=="active" and .manage_members==true
    and .account_id==([$db.approved[]|select(.sub==$c.binding.actorSub)|.id][0]))
  and all($db.privileges[]; .read==true)
  and all($db.privileges[]|select(.relation|IN("workspaces","workspace_memberships",
    "workspace_membership_events","facet_streams","facet_event_bindings","facet_heads",
    "facet_stream_attachments","facet_activation_state","facet_unresolved_events")); .insert==true)
  and all($db.privileges[]|select(.relation|IN("account_users","workspace_memberships",
    "facet_events","facet_commands","facet_streams","facet_heads","facet_stream_attachments",
    "facet_command_contexts","facet_activation_state")); .lock_authority==true)
  and all($db.functions[]; .execute==true)
  and (if ($db.indexAuthority|length)>0 then all($db.indexAuthority[];.can_drop_as_current_role==true)
    else any($db.personal[];.workspace_id==$c.binding.workspaceId and .old_index_dropped==true) end)
  and ($db.personal|all(.[]; .workspace_id==$c.binding.workspaceId or .writer_epoch=="scoped"))
  and all($db.lots[]; (.destination_open|not)))
and (.databaseInspection.observedAt|fresh)
and (.evidence as $e |
  $e.workspaceId==$c.binding.workspaceId and $e.actorSub==$c.binding.actorSub
  and $e.maintenanceAttemptId==$c.binding.maintenanceAttemptId
  and $e.releaseId==$c.binding.releaseId and $e.reason==$c.reason
  and ($e.instanceIds|sort)==$ids
  and ([$e.drain,$e.shutdown]|all(.[];
    (.completedAt|fresh) and (.coveredInstanceIds|sort)==$ids)))
and ([..|strings|test("<|>|placeholder|changeme|todo";"i")]|any|not)
