(.spec.template.spec.containers[] | select(.name == "api") |
  [.env[] |
    select(
      .name == "S3_ENDPOINT" or
      .name == "S3_REGION" or
      .name == "S3_BUCKET" or
      .name == "S3_FORCE_PATH_STYLE" or
      .name == "S3_ACCESS_KEY" or
      .name == "S3_SECRET_KEY"
    )
  ]) as $bindings |
($bindings | length) == 6 and
all($bindings[]; (has("value") | not) and (.valueFrom | type == "object")) and
([$bindings[] | {name, secret: .valueFrom.secretKeyRef.name, key: .valueFrom.secretKeyRef.key}]
  | sort_by(.name)) ==
[
  {name:"S3_ACCESS_KEY",secret:"radar-docs-s3-credentials",key:"DOCS_S3_ACCESS_KEY"},
  {name:"S3_BUCKET",secret:"radar-docs-s3-credentials",key:"DOCS_S3_BUCKET"},
  {name:"S3_ENDPOINT",secret:"radar-docs-s3-credentials",key:"DOCS_S3_ENDPOINT"},
  {name:"S3_FORCE_PATH_STYLE",secret:"radar-docs-s3-credentials",key:"DOCS_S3_FORCE_PATH_STYLE"},
  {name:"S3_REGION",secret:"radar-docs-s3-credentials",key:"DOCS_S3_REGION"},
  {name:"S3_SECRET_KEY",secret:"radar-docs-s3-credentials",key:"DOCS_S3_SECRET_KEY"}
]
