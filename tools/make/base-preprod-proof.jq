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
  and $db.identity[0].observe_transactions == true
  and $db.transactions[0].active_transactions == 0
  and $db.transactions[0].active_sessions == 0
  and ($db.differences|length)>0
  and all($db.differences[]; .activeMember and .attachedHere and (.attachedElsewhere|not))
  and any($db.approved[]; .sub==$c.binding.actorSub)
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
