def controller($object;$kind):
  [$object.metadata.ownerReferences[]? | select(.controller==true and .kind==$kind)] | first;
def terminal:
  any(.status.conditions[]?; (.type=="Complete" or .type=="Failed") and .status=="True");
def operationJob($record;$job):
  any($record.jobs[]; .name==$job.metadata.name and
    (.uid==$job.metadata.uid or (.uid==null and .hash==$job.metadata.annotations["cutover-spec-sha256"])));
def refreshJob($record;$job):
  controller($job;"CronJob") as $owner |
  any($record.cronjobs[]; .uid==$owner.uid and
    (.name=="radar-refresh-pv" or .name=="radar-refresh-pending-watchdog"
      or .name=="radar-consistency-snapshot" or .name=="radar-populate-geo-daily"));
def deploymentPod($record;$replicasets;$pod):
  controller($pod;"ReplicaSet") as $owner |
  any($replicasets.items[]; .metadata.uid==$owner.uid and
    (controller(.;"Deployment") as $deploy | any($record.deployments[]; .uid==$deploy.uid)));
def operationPod($record;$jobs;$pod):
  controller($pod;"Job") as $owner |
  any($jobs.items[]; .metadata.uid==$owner.uid and operationJob($record;.));
def refreshPod($record;$jobs;$pod):
  controller($pod;"Job") as $owner |
  any($jobs.items[]; .metadata.uid==$owner.uid and refreshJob($record;.));
$r[0] as $record |
[$jobs[0].items[] | select(terminal|not) |
  select(operationJob($record;.)|not) | select(refreshJob($record;.)|not) |
  {name:.metadata.name,uid:.metadata.uid,known:false}] +
[.items[] | select(.status.phase!="Succeeded" and .status.phase!="Failed") |
  select(controller(.;"StatefulSet").name!="radar-postgres") |
  select(operationPod($record;$jobs[0];.)|not) |
  {name:.metadata.name,uid:.metadata.uid,
    known:(deploymentPod($record;$rs[0];.) or refreshPod($record;$jobs[0];.))}]
