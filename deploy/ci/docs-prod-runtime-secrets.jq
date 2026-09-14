def runtime_secret($name; $prefix):
  {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: $name,
      namespace: "radar-immobilier",
      labels: {
        "app.kubernetes.io/name": "radar-immobilier",
        "app.kubernetes.io/part-of": "sentropic"
      }
    },
    type: "Opaque",
    data: {
      (($prefix + "_S3_ACCESS_KEY")): .data.DOCS_S3_ACCESS_KEY,
      (($prefix + "_S3_SECRET_KEY")): .data.DOCS_S3_SECRET_KEY
    }
  };

if (.data | keys | sort) != (["DOCS_S3_ACCESS_KEY", "DOCS_S3_BUCKET",
    "DOCS_S3_ENDPOINT", "DOCS_S3_FORCE_PATH_STYLE", "DOCS_S3_REGION",
    "DOCS_S3_SECRET_KEY"] | sort) then
  error("PROD DOCS source Secret key family differs")
else
  {apiVersion: "v1", kind: "List", items: [
    runtime_secret("radar-graph-s3-credentials"; "GRAPH"),
    runtime_secret("radar-scrape-s3-credentials"; "SCRAPE")
  ]}
end
