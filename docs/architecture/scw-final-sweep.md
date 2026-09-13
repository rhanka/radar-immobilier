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
