$input[0] as $c |
(if $action == "inspect" then []
 elif $action == "init" then
   ["--workspace-slug",$c.workspaceSlug,"--workspace-label",$c.workspaceLabel,
    "--actor",$c.binding.actorSub,"--reason",$c.reason]
   + [$c.moderators[] | "--moderator",.] + [$c.managers[] | "--manager",.]
 elif $action == "attach" then
   ["--actor",$c.binding.actorSub,"--reason",$c.reason]
   + [$c.attachments[] | "--entry",(.sub+":"+.workspaceId)]
 else [$action,"--workspace",$c.binding.workspaceId,"--actor",$c.binding.actorSub,
   "--reason",$c.reason,"--maintenance-attempt",$c.binding.maintenanceAttemptId,
   "--release",$c.binding.releaseId]
   + [$expected[0][] | "--instance",.id]
   + ["--evidence-json",($proofs[0].evidence|tojson)] end) as $args |
{apiVersion:"batch/v1",kind:"Job",
 metadata:{name:$c.jobName,namespace:$c.namespace,
   annotations:{"radar.sent-tech.ca/release":$c.binding.releaseId}},
 spec:{backoffLimit:0,activeDeadlineSeconds:540,ttlSecondsAfterFinished:86400,
   template:{metadata:{labels:{"app.kubernetes.io/name":"radar-immobilier",
     "app.kubernetes.io/component":"api","radar.sent-tech.ca/operator":$c.jobName}},
   spec:{serviceAccountName:"radar-app",automountServiceAccountToken:false,restartPolicy:"Never",
     securityContext:{runAsNonRoot:true,runAsUser:1001,runAsGroup:1001,fsGroup:1001,
       seccompProfile:{type:"RuntimeDefault"}},
     containers:[{name:"operator",image:$c.image,imagePullPolicy:"IfNotPresent",workingDir:"/workspace",
       command:["node","api/dist/scripts/base-preprod-job.js",
         ({action:$action,binding:$c.binding,image:$c.image,database:$c.database,args:$args}|tojson)],
       readinessProbe:{exec:{command:["/bin/false"]},periodSeconds:1},
       securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:["ALL"]}},
       resources:{requests:{cpu:"100m",memory:"128Mi"},limits:{cpu:"1",memory:"512Mi"}},
       envFrom:[{configMapRef:{name:"radar-api"}}],
       env:([{name:"OPERATOR_IMAGE",value:$c.image}] +
         (["POSTGRES_USER","POSTGRES_PASSWORD","POSTGRES_DB"] | map({name:.,
         valueFrom:{secretKeyRef:{name:"radar-db-credentials",key:.}}}))),
       terminationMessagePolicy:"File",terminationMessagePath:"/dev/termination-log"
     }]}}}}
