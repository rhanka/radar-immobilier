def env($workload; $container; $name):
  [$workload.spec.jobTemplate.spec.template.spec.containers[]
    | select(.name == $container) | .env[]? | select(.name == $name)]
  | if length == 1 then .[0] else null end;
def literal($workload; $container; $name; $value):
  env($workload; $container; $name) == {name:$name,value:$value};
def secret($workload; $container; $name; $secret; $key):
  env($workload; $container; $name) ==
    {name:$name,valueFrom:{secretKeyRef:{name:$secret,key:$key}}};

# Inspect the full CronJob list: the causal refresh replaces the retired pair.
INDEX(.items[]; .metadata.name) as $jobs
| ($jobs["radar-refresh-pv"] // null) as $refresh
| $refresh != null
  and literal($refresh; "refresh-pv"; "SCRAPE_S3_ENDPOINT";
    "https://s3.bhs.io.cloud.ovh.net")
  and literal($refresh; "refresh-pv"; "SCRAPE_S3_BUCKET";
    "radar-immobilier-graph-preprod")
  and secret($refresh; "refresh-pv"; "SCRAPE_S3_ACCESS_KEY";
    "radar-graph-s3-credentials"; "GRAPH_S3_ACCESS_KEY")
  and secret($refresh; "refresh-pv"; "SCRAPE_S3_SECRET_KEY";
    "radar-graph-s3-credentials"; "GRAPH_S3_SECRET_KEY")
