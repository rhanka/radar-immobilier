# Immo + geo backup and disaster recovery plan

Updated 2026-09-18 for #698 / immo PR #712. Immo is the prime: it owns the
combined result, operation order, acceptance evidence and incident response.
Two coordinated PRs, one here and one in `rhanka/geo`, deliver that result.
The immo conductor records the geo PR URL/revision and paired proof with #712.
A geo handoff or successful PostgreSQL Job is not whole-service recovery.

## Scope and baseline

Measurements below come from the 2026-09-17 brief, not a new cluster inspection.

| Component | Baseline | Recovery authority |
|---|---:|---|
| Immo PG16/PostGIS 3.4, prod | 1,002 MiB; live PVC 5 GiB | Logical dump, including annotations, scores and relational links |
| Immo PG16/PostGIS 3.4, preprod | 950 MiB; live PVC 5 GiB | Same mechanism in distinct namespace/bucket |
| Immo documents/raw objects | Size/count unknown | Every captured original and object version referenced by PG |
| Immo graph bucket/keyring | Size/count unknown | Graph artifacts, publication manifests and keyring state required by the cycle |
| Geo `sentropic-geo`, bhs | ~48.9 GB; 45,378 objects | Inventory authoritative inputs and exact publication dependencies |
| Geo PG/PostGIS | 139 MiB; PVC 5 GiB | Rebuild only if the paired proof reproduces it from retained cycle inputs |

Geo authoritative inputs include `sources/qc-zonage-grilles/`, `raw/` and
`capture/_runs/`, even when empty today. `normalized/`, `exports/immo/`,
`pmtiles/` and Geo PostGIS qualify for regeneration only with pinned transforms,
parameters and all inputs retained. Copy the exact published artifacts referenced
by immo when reproduction is not demonstrated; no blanket exclusion of derived
data. Immo keyring PVC state must be exported or proven reconstructible.
Re-provision secrets from the owner vault, never Git or backup logs.

Targets: `radar-immobilier-backups[-preprod]` for PG, and owner-provisioned
immo-object/geo PRA buckets with separate identities. Targets in bhs protect
against instance/PVC loss and source-object deletion, not regional/provider-wide
loss or compromised backup administrators. Off-region immutable protection needs
its own owner decision and cost measurement. Versioning alone is not immutability.

## End-to-end consistency sequence

A recovery unit is one `cycleId`, environment and reference instant `T0`, with
component manifest SHA-256s linked in a final cycle manifest. Choose a bounded
write freeze for the initial joint proof. A common timestamp alone is insufficient.

1. Immo acquires the single cycle lease, allocates UTC + random ID, and records
   both repository revisions, image digests, bucket coordinates and transform
   versions. Suspend immo refresh, geo ingestion/export and all manual/scheduled
   writers. Fence API mutations/annotation writes and S3 upload/overwrite/delete
   paths. Stop new queue work; drain accepted requests, PG transactions and S3
   operations. Record the complete writer inventory and fence acknowledgments.
   Unidentified writers block the cycle.
2. After drain, record `T0`. Export a repeatable-read PG snapshot, calculate exact
   per-table counts and run `pg_dump --snapshot` from that SAME transaction.
   Keep the exporting transaction alive through dump completion. Supply the common
   `CYCLE_ID`; record database, environment, extensions, bytes/hash and snapshot time.
3. Still frozen, inventory/copy immo documents/raw, then graph/publications and
   keyring export, then geo authoritative inputs and required publications.
   Every component carries the SAME cycle ID/T0. Inventories record source key,
   version ID, size, SHA-256 and destination version/key. ETag alone is insufficient
   for multipart data. Copy specific versions, not a later unversioned `latest`.
   Empty inventories are explicit.
4. Verify copied bytes, then resolve every PG→document→graph→geo reference against
   those inventories. Verify the PG restore. Immo publishes
   `cycles/<env>/<cycleId>/complete.json` LAST: component manifest hashes, freeze
   interval/T0, receipts, transforms and allowed reconstruction steps. Any missing
   component or failed verification means NO complete marker.
5. Release the fence and restore the exact prior scheduler state after completion,
   or after recording failure while retaining the previous valid cycle. An
   independent lease watchdog alerts on a stuck freeze; it must never manufacture
   completeness or silently resume half-drained writers. Record freeze duration
   and catch-up backlog. Size the initial timeout from measured copy throughput
   for up to 48.9 GB, not an assumed few seconds.

Guarantee, conditional on fencing ALL writers: one stable application state after
all acknowledged pre-T0 writes drained. Requests refused/queued during the freeze
are excluded and retry after thaw; unacknowledged writes have no inclusion promise.
The implemented standalone PG path guarantees its own coherent snapshot without
a freeze. Its manifests explicitly say `scope: postgres-only`; they MUST NOT be
relabelled as joint complete cycles.

The freeze/inventory/reference coordinator is a joint implementation gate, not
hidden functionality of #712's DB CronJob. Immo owns this integration and the
paired proof; geo supplies its executable export/regeneration in its PR.
Until all receipts exist, only PostgreSQL recovery can be demonstrated.

## Recovery order and acceptance

1. Select a COMPLETE joint cycle with matching hashes/receipts. If none exists,
   owner acceptance is required for degraded PostgreSQL-only recovery; never
   silently mix dates across components.
2. Provision isolated namespaces, empty storage, PG16/PostGIS 3.4 and extension
   binaries, buckets, service accounts, network and vault-managed secrets.
   Reconstruct application roles/ownership/grants from versioned infrastructure
   policy; role passwords are not stored in the dump.
3. Restore geo authoritative object versions and required publications. Rebuild
   normalized/exports/pmtiles/PostGIS using the recorded transforms. Validate
   hashes and feature/geometry invariants before serving geo.
4. Restore immo documents, graph versions, publication pointers and keyring state
   from that same cycle; verify object hashes and referential closure.
5. Restore immo PG into a new instance; compare exact snapshot counts/extensions,
   validate indexes/constraints, then restore application privileges. The automated
   verifier uses a local bootstrap role and strips ACLs: it does not prove final
   API role access. Exercise that role, an existing annotation, document, graph
   link and geo feature.
6. Start immo read-only against the restored stores/geo; check API/UI, document
   rendering, maps and annotations, then a controlled new write/read. Measure from
   incident declaration through service validation. Record data age, total duration,
   bytes, peak memory/disk, retries. Owner GO precedes cutover; reopen writers and
   schedules last. Preserve old assets for rollback.

RPO target: 24h for a COMPLETE VERIFIED joint cycle. PG runs at 02:15 and 14:15 UTC
to leave retry margin. Joint cadence targets 12h only after freeze duration/capacity
are measured. No PITR. Immo RTO target: 4h; geo and combined RTO remain unmeasured.
A tiny local fixture or DB-only restore cannot establish whole-service RTO.

## PostgreSQL implementation and resource budget

`db-backup/backup.py` replaces the three shell scripts. Pin its PG16/PostGIS/Python
image by digest. The exporter stays open for counts AND dump. Upload order is
dump, manifest checksum, manifest (commit marker); checksums contain no file paths.
Restore validates schema, database, environment, cycle, timestamp, manifest hash,
dump hash/size and count structure BEFORE starting PostgreSQL. Equal counts are
necessary, not proof of semantic equality of application data.

Restore runs a socket-only server on a 6 GiB disk-backed `emptyDir`, plus 2 GiB
for the archive. It has no live PG credentials, no S3 identity and no live PVC.
Use `shared_buffers=32MB`, `work_mem=2MB`, `maintenance_work_mem=32MB` and no
parallel restore. The 512 MiB restore limit covers Python + client + server;
this is a proposal requiring preprod peak measurement. Dump limit: 256 MiB;
S3 stages: 128 MiB. Sequential init-container accounting gives a 512 MiB Pod
limit; freshness adds 128 MiB, total 640 MiB against ~768 MiB reported prod margin.
Check concurrent/manual jobs: the 768 MiB refresh cannot overlap. The one-hour
backup deadline at 02:15/14:15 precedes the 05:17 refresh window. Admission still
depends on actual quota use; reschedule instead of assuming more quota.

The proof deletes successful Jobs and checks pod cleanup. Failed Jobs have a
one-hour deadline and one-day TTL; their volumes survive only for diagnosis.
The local server stops in `finally`; forced termination cannot leave data on the
source. Node ephemeral space/eviction and the 8 GiB peak limit are measured gates.

## Retention, lifecycle and cost assumptions

Keep the latest VERIFIED point in each of 7 represented UTC days, 4 represented
ISO weeks and 1 represented month, deduplicating overlap. One dump copy per run:
no extra Sunday/monthly upload or masked error. Missed days do not age out valid
points. Prune only after a successful verification report; read/list/delete
failures fail the Job. Incomplete/unverified attempts older than 48h are removed
only when a verified point exists. Never sacrifice the last good point.

The owner provisions each environment with `make -f deploy/ci/backup-pra.mk
backup-provision` BEFORE activation (guards and exact commands in the runbook).
Three S3 identities per environment: writer uploads sets/receipts without deletion,
reader handles restore/freshness/configuration reads without writes, retainer alone
deletes. Non-secret runtime configuration is `radar-pra-settings`.
Unmanaged enabled lifecycle rules require owner review. Current complete sets
have NO age expiration. Reserved daily/weekly/monthly prefixes expire after
7/28/31 days; these do not change the current count-based sets layout.
Execution owner: the infrastructure owner; accountable owner: immo conductor `i-cond`.
Abort incomplete multipart uploads after one day, expire noncurrent versions after
35 days and expired delete markers. Per-exercise receipts expire after 90 days;
current verified receipts follow count retention. Not WORM. When no successful
point exists, alert on accumulating failed attempts instead of purging evidence.
Authoritative object/geo history has no expiry until joint reference analysis
proves no retained cycle needs it.

Before measurement, assume dumps at 50% of PG size: 501/475 MiB (prod/preprod),
0.953 GiB per paired run. At 60 runs/month, upload is approximately **57.2 GiB**,
excluding retries and verification downloads. Twelve disjoint points/env use
about **11.44 GiB current storage**, plus new/incomplete attempts, metadata and
35-day noncurrent versions (which may dominate the bill). The former daily +
weekly + monthly design wrote 35–36 copies/month/env, about 33.4–34.3 GiB, not the
original 29.3 claim. Geo's initial whole-bucket upper bound is 48.9 GB (~45.5 GiB).
Immo object sizes, change rates and OVH prices remain unknown; no monthly price
is asserted without measurements.

## Paired activation and premerge evidence

Both `backup-preprod` and `backup-prod` overlays render active CronJobs. The
base app bundle cannot overwrite them. The image workflow's `deploy-backup-pra`
waits for the build, pins the digest and applies BOTH overlays in one release
operation on main. Before merge, arm `BACKUP_PRA_ENABLED=true`, configure the
protected production environment/owner approval and narrowly scoped
`PRA_KUBE_CONFIG` authorized in both namespaces. These are merge prerequisites,
not existing state asserted by this document. Production application requires
owner GO. Kubernetes has no atomic cross-namespace apply: server-dry-run both,
record both results, page on partial activation and complete/roll back the pair
under the same owner decision.

Before merge, k8s uses THIS branch's image/renders. Exact commands, lifecycle,
identity matrix and receipts: `deploy/ci/README.md`, section #698. The proof
creates a unique backup Job, then separately downloads its exact S3 object into
a second unique restore Job, records UID/hash/counts and checks cleanup.
It neither waits for main nor touches production.

Merge dossier: both PR revisions; image digest; tests/renders; IAM denials, bucket
privacy/SSE and lifecycle readbacks; quota/admission/CNI DNS+S3 proof; preprod
object key and both Job receipts; measured peaks/timings; joint frozen cycle and
application restore; alert delivery and catch-up proof. Immo conductor accepts,
infra/k8s executes, geo delivers its component. Missing joint evidence stays a
joint gate, never a PostgreSQL test presented as the complete result.

## Freshness and incident ownership

Hourly `radar-backup-freshness` reads VERIFIED receipts, checks manifest binding
and dump existence/size, then computes snapshot age. No point, dangling/corrupt
receipt or age over 86,400s fails. Upload-only manifests never count.
`backup-common/alerts.yaml` is the operator-installed Prometheus rule for a
failed/stalled/missing checker; monitoring selectors and the immo on-call route
must be proved before activation. Polling/page delay may approach two hours
beyond RPO; the 12h cadence offers normal margin, not a strict SLA.

Immo on-call diagnoses Job/quota/S3 failure, protects the latest good point, runs
a catch-up backup + isolated restore and records the actual gap. Never delete old
points to silence an alert. The joint coordinator must separately monitor age
of its final complete marker; healthy PG freshness cannot silence missing
immo-object/geo recovery.

## Contradictory review reconciliation

References A1–A21 refer to the Astra review; G1–G13 to Gemini's summary table.

| Findings | Disposition and evidence |
|---|---|
| A1/A3/A4/A15; G2/G3/G4/G10 | Replaced path-dependent checks and live estimates with a validated manifest and exact counts in the dump snapshot; real PG race/offline-source/corruption tests pass |
| A2/A5/A6; G1/G5 | Explicit resources, ephemeral socket-only PG and TTL/deletion cleanup; live admission/peak-space proof remains k8s-owned |
| A7/A8/A14/A20; G6/G12 | Count-based verified retention, executable lifecycle/readback, single dump copy and corrected volume estimates; no upload error suppression |
| A9/A16; G7/G10 | Paired active overlays/CD path and branch-only unique Jobs; activation/proof require the recorded owner/infra prerequisites |
| A10/A12/A13/A19; G8/G9/G11 | Explicit network rules, scoped identities per stage/env, no duplicate Secret; actual IAM/SSE/CNI denials remain a premerge infrastructure proof |
| A11/A17/A21 | Implemented extension checks, freshness and alert definition; full roles/business recovery, joint coordinator, alert routing and service RTO remain named joint gates, not claimed delivered by a PG test |
| A18 | New containerized real PG tests plus S3 boundary failures and rendered-resource guards; original pre-release tests remain green |
| G13 | Revert suggestion declined: preserve the inherited numeric-retention/portable-awk fix and its regression test; do not reintroduce a validated release-runner defect during this correction |
| Gemini assertions outside table | Do not claim stats are always zero, inevitable PVC exhaustion, or absence of all existing CD; those statements exceed static evidence. The demonstrated defects are fixed without relying on those claims |

No new independent consensus review is claimed for this working diff. The two
input reviews cover its parent revision; conductor review and paired premerge
evidence are still required before merging.
