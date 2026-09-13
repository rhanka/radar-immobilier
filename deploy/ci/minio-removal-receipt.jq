{
  schemaVersion: 1,
  environment: "preprod",
  plane: "MinIO",
  observedAt: $observedAt,
  removed: false,
  canonicalRecovery: {
    endpoint: "https://s3.fr-par.scw.cloud",
    region: "fr-par",
    bucket: "radar-immobilier-docs-pocs",
    objects: 59017,
    bytes: 12534514457
  },
  discardedNonCanonicalCorpus: {objects: 144193, bytes: 28340040620},
  resources: [.items[] | {
    kind, name: .metadata.name, uid: .metadata.uid,
    storage: (if .kind == "PersistentVolumeClaim" then .status.capacity.storage else null end)
  }] | sort_by(.kind, .name)
}
