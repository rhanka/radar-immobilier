.items[] | select((
  (.kind=="StatefulSet" and .metadata.name=="radar-postgres")
  or (.kind=="HorizontalPodAutoscaler" and .spec.scaleTargetRef.kind=="Deployment"
    and .spec.scaleTargetRef.apiVersion=="apps/v1" and .spec.scaleTargetRef.name=="radar-api"
    and .spec.minReplicas==1 and all(.spec.metrics[]?;.type=="Resource"))
)|not) | .kind+"/"+.metadata.name
