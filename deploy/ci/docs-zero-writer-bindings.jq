def env($workload; $container; $name):
  [$workload.spec.jobTemplate.spec.template.spec.containers[]
    | select(.name == $container) | .env[]? | select(.name == $name)]
  | if length == 1 then .[0] else null end;
def literal($workload; $container; $name; $value):
  env($workload; $container; $name) == {name:$name,value:$value};
def secret($workload; $container; $name; $secret; $key):
  env($workload; $container; $name) ==
    {name:$name,valueFrom:{secretKeyRef:{name:$secret,key:$key}}};

INDEX(.items[]; .metadata.name) as $jobs
| ($jobs["radar-refresh-scrape"] // null) as $scrape
| ($jobs["radar-refresh-projection"] // null) as $projection
| $scrape != null and $projection != null
  and literal($scrape; "scrape"; "SCRAPE_S3_ENDPOINT";
    "https://s3.bhs.io.cloud.ovh.net")
  and literal($scrape; "scrape"; "SCRAPE_S3_BUCKET";
    "radar-immobilier-graph-preprod")
  and secret($scrape; "scrape"; "SCRAPE_S3_ACCESS_KEY";
    "radar-graph-s3-credentials"; "GRAPH_S3_ACCESS_KEY")
  and secret($scrape; "scrape"; "SCRAPE_S3_SECRET_KEY";
    "radar-graph-s3-credentials"; "GRAPH_S3_SECRET_KEY")
  and literal($projection; "project-graph"; "GRAPH_S3_ENDPOINT";
    "https://s3.bhs.io.cloud.ovh.net")
  and literal($projection; "project-graph"; "GRAPH_S3_BUCKET";
    "radar-immobilier-graph-preprod")
  and secret($projection; "project-graph"; "GRAPH_S3_ACCESS_KEY";
    "radar-graph-s3-credentials"; "GRAPH_S3_ACCESS_KEY")
  and secret($projection; "project-graph"; "GRAPH_S3_SECRET_KEY";
    "radar-graph-s3-credentials"; "GRAPH_S3_SECRET_KEY")
