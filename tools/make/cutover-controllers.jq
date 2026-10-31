# PostgreSQL StatefulSets are recognised by label, not by name: during a major
# upgrade radar-postgres (PG16) and radar-pg18 coexist (deploy/k8s/pg18).
def postgres: .kind=="StatefulSet"
  and .spec.selector.matchLabels["app.kubernetes.io/component"]=="postgres"
  and .spec.template.metadata.labels["app.kubernetes.io/component"]=="postgres";
.items[] | select((
  postgres
  or (.kind=="HorizontalPodAutoscaler" and .spec.scaleTargetRef.kind=="Deployment"
    and .spec.scaleTargetRef.apiVersion=="apps/v1" and .spec.scaleTargetRef.name=="radar-api"
    and .spec.minReplicas==1 and all(.spec.metrics[]?;.type=="Resource"))
)|not) | .kind+"/"+.metadata.name
