INDEX(.items[]; (.kind + "/" + .metadata.name)) as $resources
| ($resources["StatefulSet/radar-minio"] // null) as $statefulSet
| ($resources["Service/radar-minio"] // null) as $service
| ($resources["PersistentVolumeClaim/minio-data-radar-minio-0"] // null) as $pvc
| ["allow-api-to-minio", "allow-graph-projection-to-minio", "allow-grounding-to-minio",
   "allow-object-storage-inventory-to-minio", "allow-scrape-to-minio",
   "allow-snapshot-dump-to-minio"] as $policyNames
| (["StatefulSet/radar-minio", "Service/radar-minio",
    "PersistentVolumeClaim/minio-data-radar-minio-0"] +
   ($policyNames | map("NetworkPolicy/" + .))) as $expectedKeys
| [.items[] | (.kind + "/" + .metadata.name)] as $observedKeys
| ($observedKeys | length) == ($observedKeys | unique | length)
  and all($observedKeys[]; . as $key | ($expectedKeys | index($key)) != null)
  and ($statefulSet == null or (
    $statefulSet.spec.replicas == 1 and $statefulSet.status.readyReplicas == 1
    and $statefulSet.spec.selector.matchLabels ==
      {"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"}))
  and ($service == null or $service.spec.selector ==
    {"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"})
  and ($pvc == null or (
    $pvc.status.phase == "Bound" and $pvc.status.capacity.storage == "40Gi"
    and $pvc.spec.storageClassName == "block-standard"))
  and all(.items[] | select(.kind == "NetworkPolicy");
    .metadata.name as $name
    | ($policyNames | index($name)) != null
      and .spec.podSelector.matchLabels ==
        {"app.kubernetes.io/component":"minio","app.kubernetes.io/name":"radar-immobilier"}
      and .spec.policyTypes == ["Ingress"])
