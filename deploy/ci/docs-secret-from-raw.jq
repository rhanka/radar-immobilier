select(.metadata.name == "radar-raw-s3-credentials")
| select(all(.data.RAW_S3_ACCESS_KEY, .data.RAW_S3_SECRET_KEY;
    type == "string" and length > 0))
| {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "radar-docs-s3-credentials",
      namespace: "radar-immobilier-preprod"
    },
    type: "Opaque",
    data: {
      DOCS_S3_ACCESS_KEY: .data.RAW_S3_ACCESS_KEY,
      DOCS_S3_SECRET_KEY: .data.RAW_S3_SECRET_KEY,
      DOCS_S3_ENDPOINT: ("https://s3.bhs.io.cloud.ovh.net" | @base64),
      DOCS_S3_REGION: ("bhs" | @base64),
      DOCS_S3_BUCKET: ("radar-immobilier-docs-preprod" | @base64),
      DOCS_S3_FORCE_PATH_STYLE: ("false" | @base64)
    }
  }
