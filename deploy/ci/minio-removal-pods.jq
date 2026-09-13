(.items | map(select(.status.phase == "Running" or .status.phase == "Pending"))) as $active
| ($active | map(select(.metadata.name == "radar-minio-0")) | length) == 1
  and ($active | map(select(.metadata.name == "radar-minio-0"))[0] |
    any(.metadata.ownerReferences[]?; .kind == "StatefulSet" and .name == "radar-minio"))
  and ([$active[] | select(.metadata.name != "radar-minio-0") |
    select(any(.spec.volumes[]?;
      (.persistentVolumeClaim.claimName? // "") == "minio-data-radar-minio-0"))] | length) == 0
