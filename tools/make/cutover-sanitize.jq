if $step=="ddl" or $step=="data" or $step=="destination" then
  .spec.template.spec.containers[0].env |=
    ((.//[]|map(select(.name!="POSTGRES_DB"))) +
      [{name:"POSTGRES_DB",value:($r[0].targetDb//$r[0].liveDb//"radar")},
       {name:"CUTOVER_EXPECTED_DATABASE",value:($r[0].targetDb//$r[0].liveDb//"radar")}])
else . end
| ($r[0].restoreDb//$r[0].targetDb) as $db
| if $step=="restore" and $db!=null then
    .spec.template.spec.containers[0].env |=
      (map(select(.name!="PGDATABASE" and .name!="TARGET_DB" and .name!="LIVE_DB")) +
        [{name:"PGDATABASE",value:$db},{name:"TARGET_DB",value:$db},
         {name:"POSTGRES_DB",value:$db},{name:"LIVE_DB",value:($r[0].liveDb//"")}])
  else . end
| (.spec.template.spec.containers[],.spec.template.spec.initContainers[]?) |= (
  .terminationMessagePolicy="File"|.terminationMessagePath="/dev/termination-log"|
  if (.command[0]=="node") then
    .env=((.env//[])+[{name:"CUTOVER_COMMAND",value:((.command+(.args//[]))|tojson)},
      {name:"CUTOVER_TIMEOUT",value:($timeout|tostring)}])|
    .command=["node","-e"]|.args=[$wrapper]
  else
    .args=[$shellWrapper,
      "--"]+(.command//["/s5cmd"])+(.args//[])|.command=["/bin/sh","-c"]
  end
)
| if (["ddl","data","destination","database","clone","discard","tplreset","tplseal"]|index($step)) then
    .spec.template.spec.containers[0].image=$r[0].release.apiImage
  else . end
| if $step=="data" then
    .spec.template.spec.containers[0].env += [{name:"CUTOVER_EVIDENCE",value:({
      run:$r[0].run,release:$r[0].release.gitSha,
      instances:(if $r[0].kind=="prepare" then $r[0].preparedConsumers else $r[0].consumers end),
      completedAt:($r[0].closedAt//$r[0].preparedDrainedAt)}|tojson)}]
  else . end
