# Service pictograms and repository responsibility

Presentation decision, September 13: use local blue SVG service pictograms with
explicit service names and repository labels, following the owner's reference.
This reversible presentation change does not change the architecture or decide
any open implementation option. Pictograms are original generic vectors, not
vendor logos: an S3 icon does **not** imply AWS, nor a DB icon Google Cloud SQL.

`repo:` identifies the repository responsible for the represented code, workload
manifest, client binding or transformation. The smaller role line disambiguates
these responsibilities. It does **not** certify deployment or bucket creation.
External actors/sources/providers have no generating repo. Unassigned credential
operations stay `repo: à décider`; no secret service or owner is invented. Target
production bindings are repo-owned roles marked TBD, not asserted runtime objects.

| Component family | Repository and evidence |
| --- | --- |
| Immo UI, API, PG, MinIO, CronJobs, four PV stages | `radar-immobilier` main `09703678`: `deploy/k8s/kustomization.yaml`, `20-postgres-postgis.yaml`, `25-minio.yaml`, `refresh-cronjobs/`, `api/src/config.ts`, `tools/graphify-v23/`, `tools/grounding/` |
| OVH Immo refresh bucket | Immo client configuration in `refresh-cronjobs/kustomization.yaml`; creation/provisioning not attributed by this audit |
| Geo API, PostGIS, S3 bindings, capture, joins, sync | `geo` main `f68d8ddf`: `deploy/k8s/`, `acquisition/config/s3-target.json`, `packages/geo/src/zonage/lotZoneJoin.ts`; bucket creation outside audit |
| Shared cluster, ingress/TLS, namespace envelopes | `poc-k8s` local `03acdfd`: `platform/overlays/ovh/`, `tenants/`; this is not the older remote main |
| SSO application and its PostgreSQL | `sentropic`: `deploy/k8s/base/{35-auth-idp,20-postgres}.yaml`, included by base kustomization; local HEAD `97fe9f53e8079694e35771227c11544ce8658316`, read September 13 for ownership only. `poc-k8s/tenants/sentropic-preprod/README.md` explicitly assigns workloads to Sentropic |
| Published Graphify library | `graphify` 0.18.0; consumer/integration remains `radar-immobilier`. A library dependency is not a transfer of the PV chain to Graphify |
| Effective transition / after targets | `transitions-target.md`; Immo/Geo application roles retain their repos, shared cluster roles use `poc-k8s`; preprod RAW/DOCS OVH are active, production DOCS convergence remains gated, and target production bindings stay qualified |
| DOCS convergence | `radar-immobilier` owns manifest diff, exact production canonical set, guarded selective copy, keys/hash parity and recoverable MinIO removal; SCW/OVH are storage locations, not code provenance |
| Release/copy and mixed Geo views | Both `radar-immobilier` and `geo` where the box combines their operations; individual child boxes retain their specific repo |

The explicit map in `focus/service-provenance.js` covers every leaf and group;
unknown IDs fail the build. Shared resource IDs reuse the same attribution across
all views, including the three transition states and T1 detail. The detailed inspector exposes the evidence
path. This complements the dated runtime register in [architecture](../architecture.md),
not a new live audit. MinIO remains in the immutable BEFORE capture; the effective
transition removes it only from accepted preproduction and leaves production in
progress. The owner's SCW TEM retention exception is unchanged. No target view uses the
`unknown` icon or a permissive provenance fallback; an unmapped ID fails closed.
