$input[0] as $c |
.binding==$c.binding and .image==$c.image
and (.q1|attestation and .passed==true)
and .q1.instance.image==$c.image
and (try ((.q1.observedAt|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)
  >= (.q1.instance.startedAt|fromdateiso8601)) catch false)
and (if has("q2") then (.q2|attestation and .passed==true) else true end)
and (if has("q2") then .q2.afterRestart==true and .q2.observedAt>=.q1.observedAt else true end)
and (if has("q2") then
  .restart.binding==$c.binding and .restart.image==$c.image
  and .restart.q1==.q1 and .restart.previousInstance==.q1.instance
  and .q2.instance.deploymentUid==.q1.instance.deploymentUid
  and (.q2.instance.podUid|text) and .q2.instance.podUid!=.q1.instance.podUid
  and (.q2.instance.containerId|text) and .q2.instance.containerId!=.q1.instance.containerId
  and (try ((.q1.observedAt|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601) as $q1 |
    (.restart.instance.restartedAt|fromdateiso8601)>$q1
    and (.restart.instance.startedAt|fromdateiso8601)>$q1
    and (.restart.completedAt|fromdateiso8601)>=
      ([.restart.instance.startedAt,.restart.instance.restartedAt]|map(fromdateiso8601)|max)) catch false)
  and .q2.instance==.restart.instance and .q2.instance.image==$c.image
  and (.restart.completedAt|fresh) and (.restart.instance.restartedAt|fresh)
  and (try ((.q2.observedAt|sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)
    >= ([.restart.completedAt,.q2.instance.startedAt,.restart.instance.restartedAt]
      |map(sub("\\.[0-9]+Z$";"Z")|fromdateiso8601)|max)) catch false)
  else true end)
and .personal.writerEpoch=="scoped" and .personal.maintenanceBarrier==false
and .lotsOpen==false
and .mcpSuccessorDeployed==true
and ([..|strings|test("<|>|placeholder|changeme|todo";"i")]|any|not)
