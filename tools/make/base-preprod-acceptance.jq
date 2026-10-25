$input[0] as $c |
.binding==$c.binding and .image==$c.image
and (.q1|attestation and .passed==true)
and (if has("q2") then (.q2|attestation and .passed==true) else true end)
and (if has("q2") then .q2.afterRestart==true and .q2.observedAt>=.q1.observedAt else true end)
and .personal.writerEpoch=="scoped" and .personal.maintenanceBarrier==false
and .lotsOpen==false
and .mcpSuccessorDeployed==true
and ([..|strings|test("<|>|placeholder|changeme|todo";"i")]|any|not)
