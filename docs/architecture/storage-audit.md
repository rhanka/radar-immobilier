# Effective storage audit — 2026-09-13

Scope: read-only inspection of current remote main, migration PR state and
whitelisted Kubernetes configuration. No Secret values, object contents, data
migration, deployment or permission changes.

## Baseline and migration status

Immo `origin/main` was freshly fetched and remains
`097036783006226afea53a6b49383bf70890774f`. A branch name or PR title is not
evidence of a merged or deployed change.

| Change | State at inspection | Actual scope |
| --- | --- | --- |
| [#671](https://github.com/rhanka/radar-immobilier/pull/671) | In main, merge `7d85ec07` | Application image registry → GHCR; not S3 migration |
| [#672](https://github.com/rhanka/radar-immobilier/pull/672) | In main, `c64db578` | Obscura image → public upstream; not S3 migration |
| [#674](https://github.com/rhanka/radar-immobilier/pull/674) | In main, `ad26c3a2` | Pins the still-required MinIO image to Quay |
| [#675](https://github.com/rhanka/radar-immobilier/pull/675) | In main, `ae62a649` | Production refresh overlay, release-gated; explicitly retains SCW storage TODO #670 |
| [#677](https://github.com/rhanka/radar-immobilier/pull/677) | In main, `09703678`; bindings observed in preprod | Both preprod refresh CronJobs → OVH `radar-immobilier-graph-preprod`; does not repoint the API |
| [#670](https://github.com/rhanka/radar-immobilier/pull/670) | **OPEN, DRAFT, not merged**; remote head `ae129e1077c871faa115b425c920202a53bc186e` | Remaining reference cleanup; executable S3 coordinates still TODO; MinIO and SCW TEM deliberately retained |

The #670 inventory and PR body explicitly require: OVH bucket provisioned →
objects migrated → clients repointed → MinIO manifests removed **last**, in a
separate gated change. They describe MinIO as still load-bearing in both
environments on September 11; this is historical operational evidence, **not**
a fresh production runtime observation. SCW transactional email was retained by
owner decision, pending an approved replacement.
The owner explicitly reconfirmed that exception on September 13 during this audit.

The #677 overlay comment claiming the refresh bucket is also the application's
bucket contradicts the live API ConfigMap below. The executable patch only
targets the two CronJobs. Its historical mirror count is not re-attested here.

## Effective preproduction configuration

OVH endpoint verified: `https://hlhedx.c1.bhs5.k8s.ovh.net`.
Namespace: `radar-immobilier-preprod`. Checks repeated at 12:33–12:37 UTC.

| Consumer/resource | Observed binding | Qualification |
| --- | --- | --- |
| `radar-minio` | StatefulSet, ready replicas **1**; Quay image digest | Still deployed, not removed |
| `radar-api` default store | `http://radar-minio:9000`, bucket `radar-immobilier-raw`, region `fr-par`, path-style `true` | Live ConfigMap imported by Deployment; no endpoint/bucket env override |
| `radar-api` scrape reader | Same MinIO endpoint; code-default bucket `radar-immobilier-docs` | Derived from absence of `SCRAPE_S3_*` overrides; bucket existence/access not tested |
| `radar-api` mapped PV reader | `GEO_DOCUMENTS_REPOINT=1`; OVH `sentropic-geo` | Live Deployment; primary CAS prefix `raw/pv-index/cas/`, no Immo fallback for mapped candidates |
| `radar-refresh-scrape` | OVH `radar-immobilier-graph-preprod`, `bhs`, path-style `false` | Enabled; last scheduled Sep 13 03:17, last successful Sep 13 06:13:54 UTC |
| `radar-refresh-projection` | Same OVH bucket; `GRAPH_S3_*` take precedence over inherited fallbacks | Enabled; last scheduled Sep 13 04:30, **last successful Sep 11 04:30:13 UTC** |
| `radar-immo-mcp` | Separate `immo-mcp-config`; no S3 endpoint/bucket overrides observed | Do not infer a direct bucket dependency from the API image alone |
| Grounding Job 41 | Absent from current Job inventory | SCW → MinIO remains in main's on-demand template; **not an observed active pipeline** |
| `radar-preprod-snapshot-restore` | Completed Job; OVH snapshot bucket; retained SCW snapshot-tools image reference | Historical completed Job, not an active PV component or proof of ongoing SCW image pulls |

API/UI/MCP live image tag: `8e18f01`. Configuration observation does not establish
request success, object coverage, or a running process's refreshed environment.
CronJob `lastSuccessfulTime` is controller status, not proof of fresh signals.
The projection timestamp does not establish the cause of its more recent lack
of recorded success; no remediation is part of this architecture task.
Current main also confirms that the direct scrape feed writes lowercase node
types while the Signal routes select exact `Signal`/`DesignationEvent` types.
Scrape success alone is therefore not a fresh served-signal acceptance criterion.

## Production: explicit evidence gap

The current main API base still names MinIO. Production refresh still names
Scaleway for graph projection; scrape endpoint/bucket use Secret references.
The old GitHub Actions grounding publisher still exists on main. **None of these
facts proves those paths are currently executed in production.**

The available OVH Geo credential is `system:serviceaccount:geo:ci-deployer`;
production Immo workload listing is RBAC-denied. No permission changes attempted.
A read-only request was delivered through h2a to the existing k8s agent:
`claude:poc-k8s:bc26801997f1`, envelope `env:1789302953010:a370`.
No reply had arrived when this audit was written.

The default local kubecontext points to **the old SCW cluster**, not OVH. Its
retained/suspended Immo resources are deliberately excluded from today's
production architecture. Do not confuse a reachable old API server with the
cluster serving `immo.sent-tech.ca`.

Required completion evidence: timestamped OVH `radar-immobilier` workload
inventory and allowlisted non-secret S3 bindings, ConfigMap references,
CronJob schedules/suspension and image identities. An existing authorized
read-only kubeconfig or the k8s operator's sanitized output is sufficient.
