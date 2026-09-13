INDEX(.items[]; (.kind + "/" + .metadata.name)) as $resources
| [{kind:"StatefulSet",name:"radar-minio"},
   {kind:"Service",name:"radar-minio"},
   {kind:"PersistentVolumeClaim",name:"minio-data-radar-minio-0"},
   {kind:"NetworkPolicy",name:"allow-api-to-minio"},
   {kind:"NetworkPolicy",name:"allow-graph-projection-to-minio"},
   {kind:"NetworkPolicy",name:"allow-grounding-to-minio"},
   {kind:"NetworkPolicy",name:"allow-object-storage-inventory-to-minio"},
   {kind:"NetworkPolicy",name:"allow-scrape-to-minio"},
   {kind:"NetworkPolicy",name:"allow-snapshot-dump-to-minio"}] as $expected
| {
  schemaVersion: 2,
  environment: "preprod",
  plane: "MinIO",
  observedAt: $observedAt,
  removed: false,
  canonicalRecovery: {
    endpoint: "https://s3.fr-par.scw.cloud",
    region: "fr-par",
    bucket: "radar-immobilier-docs-pocs",
    objects: 59017,
    bytes: 12534514457,
    manifestSha256: "52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425"
  },
  discardedNonCanonicalCorpus: {objects: 144193, bytes: 28340040620},
  resources: [$expected[] | . as $expectedResource
    | ($resources[$expectedResource.kind + "/" + $expectedResource.name] // null) as $observed
    | $expectedResource + {
      present: ($observed != null),
      uid: ($observed.metadata.uid // null),
      storage: (if $observed.kind == "PersistentVolumeClaim"
        then $observed.status.capacity.storage else null end)
    }]
}
