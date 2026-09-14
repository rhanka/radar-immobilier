# Final Immo SCW and MinIO sweep

Date: 2026-09-13
Audit baseline: `097036783006226afea53a6b49383bf70890774f` (`origin/main`)
Live transition receipt: [`evidence/scw-final-sweep-prod-live-receipt-2026-09-13.json`](evidence/scw-final-sweep-prod-live-receipt-2026-09-13.json)
Final parity receipt: [`evidence/scw-final-sweep-prod-final-parity-receipt-2026-09-14.json`](evidence/scw-final-sweep-prod-final-parity-receipt-2026-09-14.json)
Scope: historical baseline plus non-secret transition reconciliation. The
freshness pass was read-only; it did not mutate storage, cluster resources,
Secrets, or workloads.

## Current transition state

The storage cutover actions recorded by the branch plan have occurred. A fresh
read-only production observation at `2026-09-13T23:36:25Z` reached the OVH MKS
API server in namespace `radar-immobilier`. The API Deployment was rolled out
and all six `S3_*` entries use `radar-docs-s3-credentials` key references with
no literal value. GRAPH and SCRAPE ConfigMap coordinates point to OVH BHS bucket
`radar-immobilier-docs`; their dedicated Secret objects exist. Scaleway TEM is
the explicit retained exception.

The completed production copy Job
`radar-object-storage-copy-docs-prod-b92vl` reported 59,017 processed objects,
12,534,514,457 bytes, zero failures and canonical manifest SHA-256
`52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425`.
The observation also found no production `radar-minio` StatefulSet, Service,
data PVC, or ingress NetworkPolicy; the 1 Gi evidence checkpoint PVC remains
Bound. These are accepted facts about the performed transition, not a rollback
of the historical baseline below.

Final production parity was restored by the strengthened read-only Job
`radar-object-storage-copy-docs-prod-vz8kd`. Its four separate checkpoint
proofs record zero source missing/extra/size conflicts, zero destination
attribute conflicts, zero destination missing/extra/size conflicts, and a
complete summary. The final source and destination scans each verified 59,017
objects and 12,534,514,457 bytes against canonical manifest SHA-256
`52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425`;
the copy pass matched every object, copied none, pruned none and failed none.
Source and target exactness, attribute parity, overall exact parity and
completion are all true. The final parity receipt records the SHA-256 of each
proof file without object keys or Secret values.

The repository `object-storage-docs-prod-final-status` target first stopped at
the quota check because the production `ci-deployer` may not `get
resourcequotas`. Re-running that same read-only target with the existing
operator context on the identical OVH API server and explicit production
namespace passed fully: MinIO absence, checkpoint, quota, dedicated
DOCS/GRAPH/SCRAPE bindings, API rollout and TEM preservation. The live
transition receipt records both the restricted-principal denial and the
successful final status without object keys or Secret values.

The branch plan records the earlier preproduction transition separately. This
freshness pass did not re-observe preproduction and therefore makes no newer
runtime claim for that namespace.

## Historical audit baseline

Everything from this heading through the original blocker/handoff section is
the immutable pre-cutover assessment at commit `09703678`. Statements such as
“armed”, “unproved”, “no copy”, and listed legacy paths describe that baseline,
not the current repository or the live transition summarized above.

## Historical baseline conclusion

Immo is not ready to claim SCW eradication. The production grounding publisher is
armed and still writes to SCW. Preproduction has three physical storage planes:
API raw and derived documents on in-cluster MinIO, refresh graph output on OVH,
and a legacy grounding bridge from SCW to MinIO. Several manual or suspended
Jobs remain executable with SCW literals. TEM is the only SCW dependency that
the target state permits.

Local MinIO is not a removal target. Historical evidence and defensive tests
that reject unsafe object URLs also remain. This audit targets effective
preproduction and production clients and executable deployment paths.

## Historical baseline evidence and freshness

- Source, workflow, environment-variable names, secret names, GitHub run
  metadata, and PR state were inspected from the audit baseline. No secret
  value or complete workload environment was read.
- PR #671 moved application images to GHCR; #672 made Obscura public and
  digest-pinned; #677 moved both preproduction refresh CronJobs to OVH.
  All are merged. PR #670 remains an open, old-base draft: it is evidence and a
  patch source, not a branch to merge wholesale.
- Repository variables currently arm `PREPROD_CD_ENABLED`,
  `GROUNDING_PUBLISH_PROD_ENABLED`, `REFRESH_DIAG_ENABLED`, and both release
  backup gates. `REFRESH_CRONJOB_PROD_ENABLED` and both automatic rollback
  flags are absent.
- Backup variables resolve to OVH BHS: preproduction bucket
  `sentropic-pgbackup-preprod`, production override `sentropic-pgbackup`.
- Secret names still include `SCW_DOCS_POCS_ACCESS_KEY`,
  `SCW_DOCS_POCS_SECRET_KEY`, and legacy `SCW_SECRET_KEY`. Presence is not proof
  of use; the first pair has an executable consumer described below.
- The production grounding workflow has a successful manual run from 2026-09-04
  and remains armed. The preproduction grounding and generic run-job workflows
  also have prior runs. Rollback has no recorded run.
- Fixed-OVH read-only checks on 2026-09-13 were denied by RBAC for workload,
  Job, CronJob, and ConfigMap reads in both Immo namespaces. Therefore the
  current production bindings and suspended/manual objects are **unproved**.
  The old SCW cluster was not used as a substitute.
- Same-day architecture evidence captured before the permission loss proves
  preproduction API MinIO bindings, OVH refresh bindings, and successful refresh
  runs. It does not prove production state. Re-run the final checks with a
  read-only Immo principal before either cutover is accepted.

## Historical classification vocabulary

| Class | Meaning |
| --- | --- |
| Active | Deployed, scheduled, armed CI, or manually executable for a deployed environment. “Dormant” and “suspended” remain active-capable. |
| Local-only | Compose/test/developer MinIO with no deployed-environment claim. |
| Historical | Immutable audit, completed run, dated plan, or superseded evidence. |
| Defensive | Tests or controls that intentionally mention rejected MinIO/S3 URLs. |
| TEM | Explicitly retained Scaleway Transactional Email dependency. |
| Shared | Geo or MatchID resource requiring the owning repository or reconciled scope. |

## Historical baseline physical clients and data

| Client | Preproduction evidence | Production evidence | Class/action |
| --- | --- | --- | --- |
| API `S3_*` | `http://radar-minio:9000`, `radar-immobilier-raw`, path-style | RBAC denied; Git base prescribes MinIO | Active; migrate `PP_RAW`, prove prod binding |
| scrape `SCRAPE_S3_*` | inherits endpoint/credentials; code-default bucket `radar-immobilier-docs` | unknown | Active; migrate derived `PP_DOCS` and prod equivalent |
| graph `GRAPH_S3_*` | refresh overlay uses OVH BHS bucket `radar-immobilier-graph-preprod` | unknown; dormant prod overlay inherits SCW | Active; keep PP OVH, define/prove prod OVH |
| grounding source/destination | SCW `radar-immobilier-docs-pocs` to MinIO `radar-immobilier-docs-preprod` | armed publisher writes SCW docs-pocs | Active; retire after T1 canonical writer replaces it |
| Geo PDF reader | OVH `sentropic-geo`, prefix `raw/pv-index/cas/`, read-only | unknown | Shared; preserve, no fallback to Immo stores |
| PostgreSQL backup | OVH BHS repository variables | OVH BHS production override | Active, provider-neutral; retain |
| TEM | Scaleway SMTP/API configuration | same contract | TEM; retain until replacement is validated |

The main store owns raw documents, parsed/ciblage artifacts, job state, and
ontology data. The scrape store adds raw/parsed/run artifacts. The graph store
owns `graph/<city>/latest.json`, history, candidates, and exports. Canonical
graph writes are guarded by pre-image archival and expected-ETag conditions;
copy and cutover must preserve this single-writer contract.

## Historical baseline executable workflows and manifests

| Path/group | Finding | Class |
| --- | --- | --- |
| `.github/workflows/grounding-publish-prod.yml` | Armed manual write to `https://s3.fr-par.scw.cloud/radar-immobilier-docs-pocs`; consumes `SCW_DOCS_POCS_*` | Active, critical |
| `.github/workflows/grounding-preprod.yml`, `deploy/k8s/41-grounding-citation-job.yaml`, `deploy/k8s/grounding-preprod/**` | Manual SCW-to-MinIO copy followed by MinIO projection | Active manual |
| `.github/workflows/build-push-images.yml` | GHCR builds; deploy-preprod, OVH backups and MinIO refresh diagnostic are armed | Active; registry cutover landed, storage is mixed |
| `.github/workflows/run-job.yaml` | Exposes mapper, snapshot, projection, scrape, graphify, candidate and export Jobs; duplicate scrape routing exists | Active manual |
| `.github/workflows/rollback.yml`, `deploy/ci/rollback-release.sh` | Image-only rollback; no object or database recovery orchestration | Active manual; recovery gap |
| `deploy/ci/db-backup-job.tmpl.yaml`, `run-db-backup.sh` | Generic S3 client; effective GitHub bindings are OVH | Active, retain |
| `deploy/k8s/25-minio.yaml`, `30-api.yaml`, `70-networkpolicy.yaml` | StatefulSet/PVC, deployed API binding and API-to-MinIO policy are in base kustomization | Active |
| `deploy/k8s/refresh-diag/diag-refresh-job.yaml` | Armed preprod CI Job writes MinIO documents bucket | Active |
| `deploy/k8s/refresh-cronjobs/**` | Both preprod CronJobs unsuspended and patched to OVH graph bucket | Active, already OVH |
| `deploy/k8s/refresh-cronjobs-prod/**` | Unsuspends base CronJobs without replacing SCW values; enable variable absent | Active-capable dormant, critical before arming |
| `deploy/k8s/71-networkpolicy-graph-projection-minio-preprod.yaml`, `72-networkpolicy-grounding-minio-preprod.yaml` | Manual-apply MinIO policies; runtime presence unproved | Active-capable manual |
| `.env.example`, `docker-compose*.yml`, Makefile MinIO defaults | Developer/test MinIO; `.env.example` no longer prescribes a deployed provider | Local-only |
| `scripts/mount-scw.sh`, `scripts/umount-scw.sh` | Executables removed in the first source slice; historical references retained | Retired from active source |

## Historical baseline Jobs and CronJobs

| Manifests | Storage behavior | Disposition |
| --- | --- | --- |
| `31-graph-projection-job.yaml`, `32-graph-projection-only-job.yaml` | Required `GRAPH_S3_*` ConfigMap/Secret refs; no literal or optional fallback | Source-prepared; dispatch blocked until namespace bindings are verified |
| `33-scrape-job.yaml`, `33b-scrape-cities-job.yaml` | Required `SCRAPE_S3_*` ConfigMap/Secret refs; no literal or optional fallback | Source-prepared; dispatch blocked until namespace bindings are verified |
| `32b-reproject-etape-job.yaml` | Direct SCW, old image, manual legacy | Retire |
| `34-refresh-cronjob.yaml` | Two suspended base CronJobs with direct SCW; overlays may unsuspend | Make base provider-neutral; require per-env OVH binding |
| `35-consistency-snapshot-job.yaml`, `35-consistency-snapshot-cronjob.yaml`, `35-run-geo-mapper-job.yaml` | PostgreSQL only; CronJob is suspended | Retain; not an object-store dependency |
| `35a-populate-geo-job.yaml`, `35b-populate-geo-cronjob.yaml` | PostgreSQL/Geo HTTP; scheduled definition not bundled | Retain; prove absence/presence in runtime inventory |
| `36-db-migrate-job.yaml` | PostgreSQL-only command; unused S3 Secret reference removed | Source-prepared; safe for existing CD path |
| `37-graphify34-apply-job.yaml`, `38-graphify34-emit-candidates-job.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-gt-designation-events-job.yaml` | Required `GRAPH_S3_*` ConfigMap/Secret refs; no literal or optional fallback | Source-prepared; dispatch blocked until namespace bindings are verified |
| `41-grounding-citation-job.yaml` | SCW source to MinIO destination | Retire after T1 replacement and parity proof |
| preprod projection and refresh diagnostic Jobs | Direct MinIO destinations | Rebind before MinIO decommission |

## Historical baseline retained references

- Keep local integration fixtures and compose MinIO services.
- Keep provenance/UI tests that reject MinIO, private, or presigned storage URLs.
- Keep `.track/**`, completed plans/reports, and dated incident/audit evidence.
- Rename provider-shaped active data such as `scw_key` only with all consumers
  and tests; it is not itself proof of a live endpoint.
- Geo PRs 371–377 are merged and GHCR-ready, but the OVH S3 consumer contract
  is unchanged. Geo's GCP bootstrap still prescribed an SCW credential and old
  SCW PVC/ingress/suspended Jobs were not purged at handoff. Those are shared
  blockers to a global claim, not Immo mutation authority.
- Shared MatchID registry scopes remain under reconciliation with `poc-k8s`.

## Historical baseline first source slice checkpoint and remaining clients

This branch has prepared provider-neutral bindings for the released manual Jobs,
removed unused migration credentials, and retired the two uncalled mount scripts.
It has not provisioned a bucket, copied data, deployed a manifest, or migrated a
runtime. The required `radar-api` graph/scrape keys are absent in the freshly read
preproduction ConfigMap; the scrape Secret is absent and production is unverified.

Remaining executable clients, in risk order:

1. The armed production grounding publisher still writes the legacy SCW docs-pocs
   bucket. T1 replacement, parity, fencing, and recovery proof gate retirement.
2. The deployed API raw store and derived scrape store still use in-cluster MinIO
   in preproduction; production bindings remain unverified.
3. The armed refresh diagnostic still writes the MinIO documents bucket. Its
   manifest and CI variable were deliberately left unchanged in this slice.
4. Production refresh manifests still inherit SCW storage if armed; their enable
   variable is absent, but the executable definitions remain.
5. The preproduction grounding bridge and its MinIO policies remain until T1
   acceptance; `32b-reproject-etape-job.yaml` remains a manual legacy SCW client.
6. `.github/workflows/run-job.yaml` still exposes manual routes, including the
   duplicate scrape route. The source-prepared Jobs now fail closed until their
   required bindings exist; the workflow itself was outside this slice.
7. The MinIO StatefulSet, Service, PVC and network policies remain intentionally.
   Their deletion requires copy/parity, paired DB/object recovery, and zero consumers.

## Historical baseline remediation file map

This is the implementation boundary for the later design/build chain. Astra
must settle delete-versus-rebind choices, Gemini 3.8 High reviews that design,
Sol xhigh builds it, and Gemini performs the post-build review. It is not a
two-host consensus claim.

| Concern | Exact source surface | Required outcome |
| --- | --- | --- |
| Deployed API stores | `deploy/k8s/30-api.yaml`; `deploy/overlays/preprod/kustomization.yaml` | Production bindings explicit in base/prod path; preprod overrides `PP_RAW` and `PP_DOCS`; neither points to MinIO or SCW |
| Refresh stores | `deploy/k8s/34-refresh-cronjob.yaml`; `deploy/k8s/refresh-cronjobs/kustomization.yaml`; `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml` | Provider-neutral base; explicit OVH bucket/region/path-style values in both overlays before either is unsuspended |
| Diagnostic writer | `deploy/k8s/refresh-diag/diag-refresh-job.yaml`; `.github/workflows/build-push-images.yml` | Diagnostic uses the same environment-specific OVH contract, without an independent MinIO default |
| Legacy grounding | `.github/workflows/grounding-{preprod,publish-prod}.yml`; `deploy/k8s/41-grounding-citation-job.yaml`; `deploy/k8s/grounding-preprod/**`; `deploy/k8s/72-networkpolicy-grounding-minio-preprod.yaml` | Retire once T1 publishes canonical graph/evidence and source/destination parity is recorded |
| Manual Jobs | `.github/workflows/run-job.yaml`; `deploy/k8s/31-graph-projection-job.yaml`; `32-graph-projection-only-job.yaml`; `32b-reproject-etape-job.yaml`; `33-scrape-job.yaml`; `33b-scrape-cities-job.yaml`; `37-graphify34-apply-job.yaml`; `38-graphify34-emit-candidates-job.yaml`; `39-export-graph-nodes-job.yaml`; `40-export-gt-designation-events-job.yaml` | Remove obsolete Jobs/routes; remaining clients inherit only an explicit environment OVH binding; eliminate duplicate scrape route |
| MinIO workload | `deploy/k8s/{25-minio,70-networkpolicy,71-networkpolicy-graph-projection-minio-preprod}.yaml`; `deploy/k8s/kustomization.yaml` | Remove cluster MinIO service, StatefulSet, PVC declaration, and policies only after consumer and recovery gates pass |
| Secrets/least privilege | `deploy/k8s/{30-api,36-db-migrate,secrets.example}.yaml`; active workflow secret references | Provider-neutral names, no unused S3 access on DB migration, no deployed SCW object credential consumer; TEM secret remains |
| Registry residue | `deploy/k8s/10-rbac.yaml`; `deploy/k8s/11-ci-deployer-preprod-rbac.yaml`; `deploy/k8s/secrets.example.yaml`; `deploy/k8s/README.md` | Remove `radar-registry-pull` only after both live namespaces prove GHCR/public images and no pull dependency |
| Manual mount | `scripts/mount-scw.sh`; `scripts/umount-scw.sh` | Delete executable legacy object mounts |
| Recovery | `.github/workflows/rollback.yml`; `deploy/ci/rollback-release.sh`; DB backup/restore runbook or implementation selected by design | Preserve image rollback and add an evidenced object/DB recovery path; local `make db-restore` alone is insufficient |
| Active defaults/schema | `.env.example`; `api/src/config.ts`; `packages/radar-sources/src/sources/pv-cities-hard.json` plus its consumers/tests | Separate local MinIO defaults from deployed guidance; neutralize provider-shaped active names without weakening URL-deny tests |

Do not mass-delete Docker Compose, Makefile MinIO test targets, local fixtures,
historical documents, `.track`, or defensive URL tests. Do not change Geo or
MatchID resources from this branch.

## Cutover, parity, fencing, and recovery checklist

Apply separately to preproduction, then production, and record bucket/prefix
identifiers without credentials.

1. Freeze the reviewed client matrix: workload, service account, secret name,
   endpoint, region, path-style mode, bucket, read/write role, and prefixes.
   Resolve every unknown with the fixed OVH read-only context.
2. Provision exact OVH destinations with least-privilege identities, encryption,
   versioning/retention, lifecycle, CORS, and audit logging as required by the
   actual client. Do not reuse Geo or shared MatchID credentials.
3. Take a PostgreSQL backup and record object high-water marks. Bulk-copy each
   source without deletion; preserve key, bytes, content type/encoding, metadata,
   and versions where relied upon.
4. Compare complete key sets and byte sizes, then content hashes. Do not treat a
   multipart ETag as a content checksum. Sample application-level decodes for
   raw PDFs, parsed artifacts, graph history, candidates, and exports.
5. Fence every writer for the environment: API ingestion, scrape/refresh
   CronJobs, diagnostic and grounding workflows, manual run-job routes, and
   canonical graph publisher. Verify no unfenced service account can write the
   old store.
6. Copy the final delta, repeat zero-difference parity, and capture the current
   canonical graph key, archived pre-image, expected ETag, and relevant DB
   references in one cutover record.
7. Repoint secrets/configuration, deploy, and test through real clients: raw
   upload/read, scrape write/read, conditional canonical graph publish including
   stale-ETag rejection, PostgreSQL projection, and exact PDF evidence retrieval.
   Geo remains read-only at `sentropic-geo/raw/pv-index/cas/`.
8. Observe one scheduled refresh completion plus targeted manual recovery probes.
   Confirm Jobs terminate, CronJobs have the intended suspend state, and no pod,
   CI job, or service account attempts the old endpoints.
9. Prove recovery in an isolated target: restore the paired DB/object checkpoint,
   rebuild graph/evidence reads, record RPO/RTO, and exercise the reviewed
   rollback path. Retain the old store read-only until this succeeds.
10. Only then revoke old object credentials, remove executable SCW/MinIO paths,
    snapshot and delete the MinIO PVC/resources, and repeat the full audit. Never
    delete local developer data as part of the deployed cutover.

## Repeatable final audit

Run commands through the repository or architecture helper with
`ENV=test-scw-final` last. The audit passes only when all criteria below pass;
text-search success alone is insufficient.

1. Source sweep: use `rg` over `.github`, `deploy`, `scripts`, application
   configuration, active runbooks, and environment examples for `scw`,
   Scaleway endpoints, MinIO endpoints, old buckets, registry hosts,
   `radar-registry-pull`, and SCW secret names. Classify every hit with this
   vocabulary. Only TEM, local-only, historical, defensive, or shared hits may
   remain.
2. Render/validate all base, preprod, prod, refresh, grounding, and diagnostic
   paths with `make k8s-validate ENV=test-scw-final`. Also inspect manual YAML
   not included by kustomization; suspended resources are not exempt.
3. With `/tmp/radar-architecture-tools.mk cluster`, list only names, image refs,
   service accounts, CronJob suspend/schedule state, Job status, ConfigMap S3
   coordinates, PVCs, NetworkPolicies, and Secret **names** in namespaces
   `radar-immobilier-preprod` and `radar-immobilier`. Never dump Secrets or full
   environments. A Forbidden result leaves that environment unproved.
4. GitHub acceptance: active workflow variables match intended gates; no armed
   or manual workflow references old object endpoints/secrets; backups resolve
   to OVH; restore and rollback evidence points to the paired checkpoint.
5. Runtime acceptance: every running/pending/suspended/manual client maps to the
   approved OVH store or retained TEM/shared contract; both namespaces use
   GHCR/public images without `radar-registry-pull`; object parity, writer fence,
   scheduled refresh, rollback, and isolated recovery evidence are attached.
6. Decommission acceptance: no Immo consumer or credential accesses MinIO/SCW;
   old buckets/PVCs remain until recovery proof, then their explicit deletion is
   separately approved and recorded. A missing object due to RBAC is not proof
   that it is absent.

## Historical baseline blockers and handoff

- Fresh preproduction and production runtime proof requires an OVH read-only
  principal with access to the two Immo namespaces.
- Production physical buckets/prefixes and recovery objectives must be fixed by
  the owner-reviewed design; source defaults cannot stand in for live evidence.
- T1 canonical acquisition/publication acceptance precedes retirement of the
  grounding bridge and all final writer fencing.
- Shared Geo legacy cleanup and MatchID registry scopes stay with their owners.
- This audit deliberately stops before source changes, deployment, copy,
  credential rotation, resource deletion, or an overall T2 completion claim.
