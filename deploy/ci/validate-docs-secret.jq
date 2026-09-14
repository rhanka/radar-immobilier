. as $secret
| ["DOCS_S3_ACCESS_KEY", "DOCS_S3_SECRET_KEY", "DOCS_S3_ENDPOINT",
    "DOCS_S3_REGION", "DOCS_S3_BUCKET", "DOCS_S3_FORCE_PATH_STYLE"] as $required
| (($secret.data // {}) | keys | sort) == ($required | sort)
  and all($required[]; . as $key
    | ($secret.data[$key] | type == "string" and length > 0))
