  and $db.identity[0].observe_transactions == true
  and $db.transactions[0].active_transactions == 0
  and $db.transactions[0].active_sessions == 0
  and ($db.differences|length)>0
  and all($db.differences[]; .activeMember and .attachedHere and (.attachedElsewhere|not))
  and any($db.approved[]; .sub==$c.binding.actorSub)
  and any($db.memberships[]; .status=="active" and .manage_members==true
    and .account_id==([$db.approved[]|select(.sub==$c.binding.actorSub)|.id][0]))
  and ($db.privileges|map(.relation)|sort)==(["account_users","workspaces","workspace_memberships",
    "workspace_membership_events","facet_streams","facet_event_bindings","facet_heads",
    "facet_stream_attachments","facet_command_contexts","facet_activation_state","facet_unresolved_events",
    "facet_events","facet_commands","personal_projection_revisions","workspace_projection_revisions"]|sort)
  and all($rights[0].activate|to_entries[]; .key as $privilege |
    all(.value[]; . as $relation |
      any($db.privileges[]; .relation==$relation and .[$privilege]==true)))
  and ($db.functions|map(.proname)|sort)==["check_facet_stream","facet_swap_head_enforcement"]
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
