if $step=="ddl" or $step=="data" or $step=="destination" then
  .spec.template.spec.containers[0].env += [{name:"CUTOVER_EXPECTED_DATABASE",value:"radar"}]
else . end
| (.spec.template.spec.containers[],.spec.template.spec.initContainers[]?) |= (
  .terminationMessagePolicy="File"|.terminationMessagePath="/dev/termination-log"|
  if (.command[0]=="node") then
    .env=((.env//[])+[{name:"CUTOVER_COMMAND",value:((.command+(.args//[]))|tojson)},
      {name:"CUTOVER_TIMEOUT",value:($timeout|tostring)}])|
    .command=["node","-e"]|.args=[$wrapper]
  else
    .args=[$shellWrapper,
