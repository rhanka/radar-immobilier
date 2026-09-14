(.metadata.labels["app.kubernetes.io/component"] // "") == "object-storage-inventory"
and (.status.active // 0) == 1
and (.status.succeeded // 0) == 0
and (.status.failed // 0) == 0
and ((.spec.template.spec.containers // []) |
  length == 1
  and .[0].name == "inventory"
  and ((.[0].args[0] // "") | contains("/evidence/docs-checkpoint-v2")))
and any((.spec.template.spec.volumes // [])[];
  .persistentVolumeClaim.claimName == "radar-object-storage-inventory-checkpoint")
