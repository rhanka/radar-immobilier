# Final Immo SCW and MinIO sweep

Date: 2026-09-13
Audit baseline: `097036783006226afea53a6b49383bf70890774f` (`origin/main`)
Scope: evidence and remediation map only; no storage, cluster, secret, or workload mutation.

## Conclusion

Immo is not ready to claim SCW eradication. The production grounding publisher is
armed and still writes to SCW. Preproduction has three physical storage planes:
API raw and derived documents on in-cluster MinIO, refresh graph output on OVH,
and a legacy grounding bridge from SCW to MinIO. Several manual or suspended
Jobs remain executable with SCW literals. TEM is the only SCW dependency that
the target state permits.

Local MinIO is not a removal target. Historical evidence and defensive tests
that reject unsafe object URLs also remain. This audit targets effective
preproduction and production clients and executable deployment paths.

## Evidence and freshness

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

## Classification vocabulary

| Class | Meaning |
| --- | --- |
| Active | Deployed, scheduled, armed CI, or manually executable for a deployed environment. “Dormant” and “suspended” remain active-capable. |
| Local-only | Compose/test/developer MinIO with no deployed-environment claim. |
| Historical | Immutable audit, completed run, dated plan, or superseded evidence. |
| Defensive | Tests or controls that intentionally mention rejected MinIO/S3 URLs. |
| TEM | Explicitly retained Scaleway Transactional Email dependency. |
| Shared | Geo or MatchID resource requiring the owning repository or reconciled scope. |

## Physical clients and data

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

## Executable workflows and manifests

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
| `.env.example`, `docker-compose*.yml`, Makefile MinIO defaults | Developer/test MinIO; deployed prescriptions within `.env.example` need separation | Local-only except deployment guidance |
| `scripts/mount-scw.sh`, `scripts/umount-scw.sh` | Executable legacy manual SCW mounts | Active-capable manual |

## Jobs and CronJobs

| Manifests | Storage behavior | Disposition |
| --- | --- | --- |
| `31-graph-projection-job.yaml` | Inherits configured object store/optional scrape credentials | Rebind explicitly per environment |
| `32-projection-only-job.yaml`, `33-scrape-job.yaml`, `33b-scrape-cities-job.yaml` | Direct SCW docs-pocs | Remove literal and obsolete duplicate route |
| `32b-reproject-etape-job.yaml` | Direct SCW, old image, manual legacy | Retire |
| `34-refresh-cronjobs.yaml` | Two suspended base CronJobs with direct SCW; overlays may unsuspend | Make base provider-neutral; require per-env OVH binding |
| `35-consistency-snapshot{,-cronjob}.yaml`, `35-run-geo-mapper-job.yaml` | PostgreSQL only; CronJob is suspended | Retain; not an object-store dependency |
| `35a-populate-geo-job.yaml`, `35b-populate-geo-cronjob.yaml` | PostgreSQL/Geo HTTP; scheduled definition not bundled | Retain; prove absence/presence in runtime inventory |
| `36-db-migrate-job.yaml` | PostgreSQL work but inherits unused S3 secret/config | Remove unnecessary S3 privilege during remediation |
| `37-graphify-apply-job.yaml`, `38-emit-candidates-job.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-ground-truth-job.yaml` | Direct SCW docs-pocs | Rebind or retire with stale run-job options |
| `41-grounding-citation-job.yaml` | SCW source to MinIO destination | Retire after T1 replacement and parity proof |
| preprod projection and refresh diagnostic Jobs | Direct MinIO destinations | Rebind before MinIO decommission |

## Retained references

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

## Minimal remediation file map

This is the implementation boundary for the later design/build chain. Astra
must settle delete-versus-rebind choices, Gemini 3.8 High reviews that design,
Sol xhigh builds it, and Gemini performs the post-build review. It is not a
two-host consensus claim.

| Concern | Exact source surface | Required outcome |
| --- | --- | --- |
| Deployed API stores | `deploy/k8s/30-api.yaml`; `deploy/overlays/preprod/kustomization.yaml` | Production bindings explicit in base/prod path; preprod overrides `PP_RAW` and `PP_DOCS`; neither points to MinIO or SCW |
| Refresh stores | `deploy/k8s/34-refresh-cronjobs.yaml`; `deploy/k8s/refresh-cronjobs/{kustomization.yaml,patch-refresh-s3.yaml}`; `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml` | Provider-neutral base; explicit OVH bucket/region/path-style values in both overlays before either is unsuspended |
| Diagnostic writer | `deploy/k8s/refresh-diag/diag-refresh-job.yaml`; `.github/workflows/build-push-images.yml` | Diagnostic uses the same environment-specific OVH contract, without an independent MinIO default |
| Legacy grounding | `.github/workflows/grounding-{preprod,publish-prod}.yml`; `deploy/k8s/41-grounding-citation-job.yaml`; `deploy/k8s/grounding-preprod/**`; `deploy/k8s/72-networkpolicy-grounding-minio-preprod.yaml` | Retire once T1 publishes canonical graph/evidence and source/destination parity is recorded |
| Manual Jobs | `.github/workflows/run-job.yaml`; `deploy/k8s/{31,32,32b,33,33b,34,37,38,39,40}-*.yaml` | Remove obsolete Jobs/routes; remaining clients inherit only an explicit environment OVH binding; eliminate duplicate scrape route |
| MinIO workload | `deploy/k8s/{25-minio,70-networkpolicy,71-networkpolicy-graph-projection-minio-preprod}.yaml`; `deploy/k8s/kustomization.yaml` | Remove cluster MinIO service, StatefulSet, PVC declaration, and policies only after consumer and recovery gates pass |
| Secrets/least privilege | `deploy/k8s/{30-api,36-db-migrate,secrets.example}.yaml`; active workflow secret references | Provider-neutral names, no unused S3 access on DB migration, no deployed SCW object credential consumer; TEM secret remains |
| Registry residue | `deploy/k8s/10-rbac.yaml`; `deploy/k8s/11-ci-deployer-preprod-rbac.yaml`; `deploy/k8s/secrets.example.yaml`; deployment README | Remove `radar-registry-pull` only after both live namespaces prove GHCR/public images and no pull dependency |
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

## Current blockers and handoff

- Fresh preproduction and production runtime proof requires an OVH read-only
  principal with access to the two Immo namespaces.
- Production physical buckets/prefixes and recovery objectives must be fixed by
  the owner-reviewed design; source defaults cannot stand in for live evidence.
- T1 canonical acquisition/publication acceptance precedes retirement of the
  grounding bridge and all final writer fencing.
- Shared Geo legacy cleanup and MatchID registry scopes stay with their owners.
- This audit deliberately stops before source changes, deployment, copy,
  credential rotation, resource deletion, or an overall T2 completion claim.
