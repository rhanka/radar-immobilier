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
