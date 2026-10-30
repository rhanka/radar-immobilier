# Live refresh writers that a prepare drain must wait for.
# Input: `kubectl get pods -o json`, read BEFORE $jobs, so a Job created between both reads
# is seen without its Pod and still counts. Args: --slurpfile r (record), cfg (config), jobs.
# Only Pending/Running Pods count: terminated Pods (Error/Completed) never block, even when
# their Job has no terminal condition yet. A writer Job that has not created any Pod yet and
# is not settled counts as a starting writer.
def controller($o;$kind):
  [$o.metadata.ownerReferences[]? | select(.controller==true and .kind==$kind)] | first;
def settled:
  any(.status.conditions[]?; (.type=="Complete" or .type=="Failed" or .type=="FailureTarget"
    or .type=="SuccessCriteriaMet") and .status=="True");
. as $pods |
[$r[0].cronjobs[] | select(.name as $name | $cfg[0].cronjobs | index($name)) | .uid] as $writers |
[$jobs[0].items[] | select(controller(.;"CronJob").uid as $uid | $uid != null and ($writers | index($uid)))] as $owned |
[$pods.items[] | select(.status.phase=="Pending" or .status.phase=="Running") |
  controller(.;"Job").uid as $job | select($job != null and any($owned[]; .metadata.uid==$job)) |
  {kind:"Pod",name:.metadata.name,uid:.metadata.uid,phase:.status.phase}] +
[$owned[] | select(settled|not) | .metadata.uid as $uid |
  select(any($pods.items[]; controller(.;"Job").uid==$uid) | not) |
  {kind:"Job",name:.metadata.name,uid:$uid,phase:"PodNotCreated"}]
