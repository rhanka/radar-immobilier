INDEX(.items[]; (.kind + "/" + .metadata.name)) as $resources
| ($resources["StatefulSet/radar-minio"] // null) as $statefulSet
| ($resources["Service/radar-minio"] // null) as $service
| ($resources["PersistentVolumeClaim/minio-data-radar-minio-0"] // null) as $pvc
| ["allow-api-to-minio", "allow-graph-projection-to-minio", "allow-grounding-to-minio",
   "allow-object-storage-inventory-to-minio", "allow-scrape-to-minio",
   "allow-snapshot-dump-to-minio"] as $policyNames
| (.items | length) == 9
  and $statefulSet.spec.replicas == 1 and $statefulSet.status.readyReplicas == 1
  and $statefulSet.spec.selector.matchLabels ==
    {"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"}
  and $service.spec.selector ==
    {"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"}
  and $pvc.status.phase == "Bound" and $pvc.status.capacity.storage == "40Gi"
  and $pvc.spec.storageClassName == "block-standard"
  and ([.items[] | select(.kind == "NetworkPolicy") | .metadata.name] | sort) == ($policyNames | sort)
  and all(.items[] | select(.kind == "NetworkPolicy");
    .spec.podSelector.matchLabels ==
      {"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"}
    and .spec.policyTypes == ["Ingress"])
