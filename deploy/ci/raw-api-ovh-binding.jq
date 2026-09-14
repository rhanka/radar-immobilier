(.spec.template.spec.containers[] | select(.name == "api") |
  [.env[] |
    select(
      .name == "S3_ENDPOINT" or
      .name == "S3_REGION" or
      .name == "S3_BUCKET" or
      .name == "S3_FORCE_PATH_STYLE" or
      .name == "S3_ACCESS_KEY" or
      .name == "S3_SECRET_KEY"
    ) |
    {
      name,
      secret: .valueFrom.secretKeyRef.name,
      key: .valueFrom.secretKeyRef.key
    }
  ] | sort_by(.name)) ==
[
  {name:"S3_ACCESS_KEY",secret:"radar-raw-s3-credentials",key:"RAW_S3_ACCESS_KEY"},
  {name:"S3_BUCKET",secret:"radar-raw-s3-credentials",key:"RAW_S3_BUCKET"},
  {name:"S3_ENDPOINT",secret:"radar-raw-s3-credentials",key:"RAW_S3_ENDPOINT"},
  {name:"S3_FORCE_PATH_STYLE",secret:"radar-raw-s3-credentials",key:"RAW_S3_FORCE_PATH_STYLE"},
  {name:"S3_REGION",secret:"radar-raw-s3-credentials",key:"RAW_S3_REGION"},
  {name:"S3_SECRET_KEY",secret:"radar-raw-s3-credentials",key:"RAW_S3_SECRET_KEY"}
]
