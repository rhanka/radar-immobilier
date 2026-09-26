# Study — Coordinated instant snapshots for backup/restore (RPO/RTO), feasibility on our real stack

Status: **STUDY ONLY** (analysis + write-up). No manifest, pipeline or infrastructure
change is proposed here and none was made. This document assesses whether an
owner-proposed "state-of-the-art" backup/restore architecture — coordinated,
instantaneous PostgreSQL + S3 snapshots at a common timestamp, decoupled from the
copy/restore work — is feasible on the stack that actually exists in this repository.

Evidence discipline used throughout:

- **FACT** — verifiable in this worktree, with a repo path/line citation.
- **HYPOTHESIS** — plausible but not verifiable from the repo; needs a live-cluster or
  owner check.
- **JUDGMENT** — engineering assessment / interpretation.

No precise RPO/RTO figures are invented; only justified qualitative orders of magnitude
are given.

---

## 0. Scope, method and a naming caveat

### 0.1 What was measured

The feasibility verdict rests on the code and manifests that are present in this
worktree (base `0ed6952f`, PR #763 merged). The following were read directly:

- PostgreSQL workload + volume: `deploy/k8s/20-postgres-postgis.yaml`.
- Backup mechanics: `deploy/ci/db-backup-job.tmpl.yaml`, `deploy/ci/bascule-preprod/db-restore-job.tmpl.yaml` (referenced by the orchestrator).
- The prod→preprod "iso-prod" switchover pipeline: `deploy/ci/bascule-preprod/bascule.mjs` and `.github/workflows/bascule-preprod.yml`.
- Object-storage tooling and versioning handling: `deploy/ci/migrate-object-storage.sh`.
- Architecture of record: `docs/architecture.md` (§1–§4).
- Governance records: `deploy/ci/bascule-preprod/CRED_CYCLE.md`, `README.md`.

### 0.2 Naming caveat — "snapshot" already means two different things here

**FACT.** In this repository the word *snapshot* today denotes a **logical
data-consistency / coverage checkpoint of the database content**, not an
instantaneous storage snapshot. The `radar-consistency-snapshot` Job/CronJob is a
"one-shot manuel de première population WP3" that computes consistency/coverage over
PG state (`deploy/k8s/35-consistency-snapshot-job.yaml:1-24`;
`docs/architecture.md:604`). The owner model uses *snapshot* in the storage sense
(an instantaneous point-in-time image of PG data and of S3). This document uses
**storage snapshot** / **volume snapshot** for the owner's meaning to avoid
conflation with the existing consistency snapshot.

### 0.3 What is NOT in this worktree base

**FACT.** The recent cross-repo hardening described in the brief — an immo→geo GitHub
cross-repo dispatch via a PAT (Actions R/W on `rhanka/geo`, `ref=main` only) with
environment gates — is **not present** in this worktree base: there is no geo dispatch
in any `.github/workflows/*` file, and the PRA decision dossier and the two-tenant
coherence spec referenced by the brief are untracked relative to this base. Those
elements are therefore treated as **caller-provided context** in section D, explicitly
labelled, not as repo-verified facts.

---

## 1. The stack as it really is (facts)

**FACT — PostgreSQL is a single-replica StatefulSet on a block PVC.**
`radar-postgres` is a `StatefulSet` with `replicas: 1`, image `postgis/postgis:16-3.4`,
data on a `volumeClaimTemplates` PVC named `postgres-data`, `accessModes:
["ReadWriteOnce"]`, `storageClassName: block-standard`, `storage: 5Gi`, mounted at
`/var/lib/postgresql/data` with `PGDATA=/var/lib/postgresql/data/pgdata`
(`deploy/k8s/20-postgres-postgis.yaml:32-93`). There is no streaming replica and no
WAL archiving configured in the manifest.

**FACT — the StorageClass `block-standard` is provided by the cluster, not by this
repo.** A full-repo search finds **no `kind: StorageClass`** object and **no CSI
provisioner declaration**; `block-standard` appears only as a *consumer* reference in
three PVCs (`deploy/k8s/20-postgres-postgis.yaml:90`,
`deploy/k8s/object-storage-docs-prod/checkpoint-pvc.yaml:8`,
`deploy/k8s/object-storage-inventory-preprod/checkpoint-pvc.yaml:7`). Storage
provisioning is owned by `poc-k8s` (`docs/architecture.md:484`: "poc-k8s owns the
cluster … storage provisioning").

**FACT — there is no VolumeSnapshot machinery anywhere in the repo.** No
`VolumeSnapshot`, `VolumeSnapshotClass`, or `snapshot.storage.k8s.io` object exists in
any manifest.

**FACT — this is OVH Managed Kubernetes (BHS) + OVH S3, with in-cluster MinIO too.**
The cluster endpoint is `https://hlhedx.c1.bhs5.k8s.ovh.net` (`docs/architecture.md:484`);
the OVH S3 endpoint is `https://s3.bhs.io.cloud.ovh.net` (`docs/architecture.md:585`;
consumed via the `BHS` env in `deploy/ci/bascule-preprod/bascule.mjs:133-190`). Object
storage is split: **external OVH S3** buckets (`radar-immobilier-graph-preprod`,
`sentropic-geo`, `sentropic-geo-preprod`, `radar-preprod-snapshot`) and **in-cluster
MinIO** backed by a PVC (`radar-minio`, buckets `radar-immobilier-raw`,
`radar-immobilier-docs`, `radar-immobilier-docs-preprod`)
(`docs/architecture.md:571-585`).

**FACT — two tenants share one cluster, each with its own PostgreSQL and its own OVH S3
buckets.** Immo (`radar-immobilier` / `radar-immobilier-preprod`) has `radar-postgres`;
Geo (`geo` / `geo-preprod`) has a separate `geo/postgis`, "PG16 + PostGIS3.4 … separate
from Immo's DB" (`docs/architecture.md:581`, `514-516`). The two PostgreSQL engines are
the **same major version and PostGIS version**, which matters for a uniform
snapshot/PITR approach (JUDGMENT).

**FACT — today's "backup" is a logical `pg_dump`, not an instantaneous image.** The
backup Job runs `pg_dump -h radar-postgres … --no-owner --no-privileges | gzip` as a
**network client** into an `emptyDir`, then uploads to OVH S3 with an S3 CLI
(`deploy/ci/db-backup-job.tmpl.yaml:54-110`). The switchover path uses a custom-format
dump and `pg_restore --clean --if-exists --single-transaction`
(`deploy/ci/bascule-preprod/bascule.mjs:26-38`, `703-781`). A `pg_dump` is
transaction-consistent (one MVCC snapshot for the whole dump) **but takes wall-clock
time proportional to database size** — it is not "instant" in the owner's sense.

**FACT — the current switchover is a live dump + live copy, consistency by ordering +
append-only + reconciliation, quiesce on the target (preprod), not on prod.** The
orchestrator sequence is QUIESCE preprod consumers → S1 trigger prod `pg_dump` (T1) →
S2 restore preprod (guards G1 rollback / G2 quiesce) → S2c migrate → S3 docs copy
(additive, server-side `CopyObject`) → S3b recon (`dest ⊇ src` by Key+Size) → S5 flip
serving (G4) → un-quiesce → S6 differential refresh → S7 smoke
(`deploy/ci/bascule-preprod/bascule.mjs:24-53`, `cmdQuiesce`, `cmdRestore`,
`cmdCopyDocs`, `cmdRecon`, `cmdFlip`). Consistency between PG and S3 is **not** a single
instant: it comes from *dump-before-copy* ordering, *append-only/content-addressed*
document keys, and a *recon* that only guarantees `DB ⊆ S3` (destination is a superset),
never a common atomic instant (`bascule.mjs:220-257`, `876-946`).

**FACT — S3 versioning is understood and used by the object-storage tooling.** The
migration tool checks `get-bucket-versioning`, **requires the destination bucket to be
`Enabled`**, and tracks `VersionId` / `priorVersionId` per object
(`deploy/ci/migrate-object-storage.sh:798-819`, `675-680`, `336`, `374`). So OVH S3
supports versioning here and the codebase already manipulates object versions — the raw
capability that an "as-of T" read of S3 would need (see §2.2).

**FACT — the runner/orchestrator is deliberately kubectl-only and 0-Python.** The data
plane lives entirely in in-cluster Jobs; the GitHub runner does `kubectl` (+ `curl` for
smoke) only, never `pg_dump`/`pg_restore`, never S3, never `kubectl logs`
(`bascule.mjs:9-22`, `205-218`, `806-846`). Validated images are `postgis/postgis:16-3.4`
(pg_dump/pg_restore), `amazon/aws-cli` (pinned by digest), and `s5cmd`
(`bascule.mjs:146-194`; `db-backup-job.tmpl.yaml:87-108`). The owner rules "0 Python"
and "no new unvalidated container image" are already the operating constraint of the
existing design.

---

## 2. Technical reality of "instant snapshots"

### 2.1 PostgreSQL

**FACT/JUDGMENT.** PostgreSQL has **no native logical "instant snapshot"** primitive
that produces a portable point-in-time image cheaply. The real options, mapped to the
owner model:

| Option | What it is | Instant? | Fit to owner model |
| --- | --- | --- | --- |
| (i) `pg_dump` (today) | Logical export inside one MVCC snapshot | **No** — consistent but O(DB size) wall-clock | This is what we run now; it is exactly the "long freeze / slow" path the owner wants to leave behind |
| (ii) PITR = WAL archiving + base backup | Continuous WAL shipping + periodic base backup; restore replays to a chosen LSN/time | Base backup is not instant, **but** recovery *target* can be any past instant | Strong match for "common timestamp T" without freezing writers; needs infra we do not have yet |
| (iii) Storage-level volume snapshot (CSI `VolumeSnapshot` of the PVC) | Block-device snapshot of the PG data volume | **Near-instant** at the storage layer | **Best match to the owner's step 3** (snapshot is instantaneous once the order is given) — subject to CSI support (see §7) |

**JUDGMENT — the owner model maps to option (iii), coordinated volume snapshot.** The
owner's "give the order → the snapshot is instantaneous" is precisely a CSI
`VolumeSnapshot` of the `postgres-data` PVC. Two caveats decide whether the resulting
image is restorable:

- **Crash-consistent vs application-consistent.** A bare block snapshot of a running PG
  volume is *crash-consistent*: on restore PG performs crash recovery from its WAL.
  PostgreSQL is designed to survive this (it is equivalent to a power-cut), so a
  crash-consistent volume snapshot is generally restorable — **but** it is safer to make
  it *application-consistent* by wrapping the snapshot in `pg_backup_start(...)` /
  `pg_backup_stop()` (the modern, non-exclusive replacement for the deprecated
  `pg_start_backup`/`pg_stop_backup`), or at minimum issuing a `CHECKPOINT` immediately
  before, and — if the volume filesystem is separate from PG — `fsfreeze` on the mount
  during the snapshot call. This flushes/quiesces just long enough for the block snapshot
  to be a clean image. This is the "brief freeze of a few seconds" in the owner model
  (step 2), and it is *seconds*, not the O(DB-size) minutes of `pg_dump`.
- **CSI latency and driver behaviour.** "Instantaneous" is a storage-layer property of
  the driver (copy-on-write vs full copy) and is **not** knowable from the repo (§7).
  The `VolumeSnapshot` *API call* returns quickly; whether the snapshot is
  point-in-time-consistent and how long until `readyToUse` depends on the CSI driver
  behind `block-standard`.

**JUDGMENT.** PITR (option ii) and volume snapshots (option iii) are complementary, not
exclusive: PITR gives a continuously movable recovery target (excellent RPO) without any
freeze, while a coordinated volume snapshot gives a clean labelled instant that is cheap
to fan out across tenants. The owner model leans on (iii); (ii) is the natural
RPO-hardening companion (see §5).

### 2.2 S3 / OVH Object Storage

**FACT/JUDGMENT.** There is **no atomic bucket-snapshot primitive** on S3 / OVH Object
Storage. You cannot "freeze a bucket at T". The realistic levers for a consistent
"as-of T" view:

- **Versioning + a coordinated timestamp marker.** With bucket versioning enabled, every
  object keeps timestamped versions. An "as-of T" read is *all object versions with
  `LastModified ≤ T`* (via `list-object-versions`), reconstructing the logical state the
  bucket had at T. This is not a snapshot object; it is a *read convention* over the
  version history. **FACT that the raw capability exists here:** versioning is already
  checked/required and version ids are already tracked by
  `deploy/ci/migrate-object-storage.sh:798-819, 675-680`.
- **Object-lock / retention** can additionally *guarantee* that versions ≤ T are not
  deleted or overwritten before the copy runs (immutability window), which protects the
  as-of view against a racing writer or lifecycle rule.
- **Append-only / content-addressed keys (today's reality).** The document corpus is
  content-addressed (`raw/…/cas/<sha>.<ext>`) and copies are additive
  (`bascule.mjs:876-921`; `docs/architecture.md:565`). For an append-only store, "as-of
  T" degenerates to "all keys created ≤ T", which is exactly why today's recon can settle
  for `dest ⊇ src` without a true instant.

**JUDGMENT — how to get a coherent S3 view at T without an atomic snapshot.** Enable
versioning on the buckets in scope; at the coordinated instant T, record T (and
optionally set a short object-lock/retention fence); then the asynchronous copy job reads
"versions ≤ T" rather than "current". Combined with the PG snapshot at the same T, this
yields a **defined, reproducible common cut** even though neither store is literally
frozen. The limitation is that mutable (overwritten) objects need versioning to be
reconstructable at T; a purely append-only prefix does not (its history is monotonic).

---

## 3. Feasibility of the brief coordinated freeze (owner steps 2-3-4)

**FACT — the mechanics to suspend consumers already exist.** The orchestrator already
suspends CronJobs and scales Deployments to zero, drains in-flight Jobs, and *proves*
quiescence fail-closed before a destructive step (`bascule.mjs:466-649`, guard G2). This
is the machinery a brief freeze would reuse, except today it targets **preprod (the
restore target)**, whereas the owner model freezes **the source** for a few seconds to
take a clean snapshot.

**JUDGMENT — what is genuinely instantaneous vs not in steps 2-3-4:**

- **Instant (seconds):** the `VolumeSnapshot` API call; a `CHECKPOINT`; `fsfreeze`
  freeze/thaw of the mount; `pg_backup_start`/`pg_backup_stop` bracketing; suspending
  CronJobs (`spec.suspend=true`) and scaling Deployments to zero at the API level.
- **NOT instant / needs draining:** a Deployment scaled to zero does not drop its open PG
  connections and in-flight transactions the instant the API returns — pods terminate on
  their grace period; the orchestrator already waits for `status.replicas → 0` and drains
  owned Jobs (`bascule.mjs:603-647`). A long-running write transaction, or a Job not in
  the quiesce list, can still hold the database mid-write during the intended freeze
  window.

**JUDGMENT — the real risks of the brief freeze:**

- **Writers outside the quiesce set.** G2 already flags this class of bug: one-off Jobs
  (`radar-scrape`, `radar-graph-projection`, `radar-graphify*`, `radar-populate-geo`, …)
  hold a PG connection only while running and "escape the quiesce list"
  (`bascule.mjs:486-528`). A coordinated snapshot must fence *every* writer to both PG and
  S3, or accept that the snapshot is crash-consistent for whatever a straggler was doing.
  With PG this is safe (crash recovery); with S3 an in-flight multi-part upload straddling
  T is the sharp edge.
- **Long connections / long transactions.** These are the reason a pure "scale to zero
  and snapshot immediately" is not truly clean; either wait for drain (adds seconds) or
  accept crash-consistency. `pg_backup_start` sidesteps this: it does not need writers
  stopped at all — it marks a consistent recovery start and lets the snapshot be taken
  live. **This is the key insight: for PG you may not need a freeze at all** (option ii/iii
  hybrid); the "few-seconds freeze" is mostly about giving S3 writers a common fence.
- **S3 writes during the window.** OVH S3 has no server-side freeze; a writer mid-window
  produces an object with `LastModified` around T. Versioning + the "≤ T" read convention
  (§2.2) is what makes this deterministic; without versioning the S3 side of the cut is
  ambiguous for mutated objects.

**VERDICT (section B).** A brief coordinated freeze of a few seconds to ~1 minute is
**feasible** and largely reuses existing quiesce machinery, but it is *not* what makes
PG consistent (PG can be snapshotted live with `pg_backup_start` or accepted
crash-consistent); its real job is to give **all S3 writers a common timestamp fence**.
The freeze is short precisely because the expensive work (copy/restore) is deferred
(§6).

---

## 4. Multi-tenant coherence at a common instant (section C)

**JUDGMENT — the goal.** A shared orchestrator signals immo *and* geo to snapshot PG and
fence S3 at the **same timestamp T**, so that a later restore reconstructs a state where
Immo's DB, Immo's S3, Geo's DB and Geo's S3 all reflect the same instant. Because Immo's
served documents are read cross-tenant from `GEO-S3` (`docs/architecture.md:482`, `565`,
`615`), a per-tenant-independent snapshot time would let Immo's DB reference a Geo object
version that Geo's snapshot did not capture — a dangling cross-tenant reference. A common
T is what removes that class of inconsistency.

**FACT — the engines are homogeneous.** Both tenants run PG16 + PostGIS 3.4
(`deploy/k8s/20-postgres-postgis.yaml:50`; `docs/architecture.md:581`), and both S3 sides
are OVH Object Storage (BHS). A single snapshot recipe (volume snapshot + versioning
marker) applies uniformly to both tenants (JUDGMENT).

**JUDGMENT — what a common T really guarantees, and its limits:**

- **Guarantees a common RPO across the four stores** *if* every store's fence is taken
  against the same T and every writer is fenced or crash-safe at T. The result is a
  coherent cross-tenant cut: Immo-DB@T, Immo-S3@T, Geo-DB@T, Geo-S3@T.
- **Does not guarantee zero skew.** Clock skew between the two tenants' snapshot calls,
  CSI snapshot creation latency, and the S3 `LastModified` granularity mean T is a *target
  window*, not a mathematical instant. The existing code already reasons about clock skew
  (a `FRESHNESS_SKEW_SEC` margin, default 120s, in `bascule.mjs:395`, `419-424`). A
  realistic design records T once centrally and every actor fences against that single T
  with a small tolerance.
- **Does not remove the append-only advantage.** For content-addressed prefixes the cut
  is naturally monotonic; versioning is only strictly required where objects are mutated
  in place.

---

## 5. RPO / RTO per option (section E)

No exact figures are asserted (the repo does not measure snapshot/restore durations for
this workload). Qualitative orders of magnitude, justified:

| Option | RPO (potential data loss) | RTO (time to restore service) | Rationale |
| --- | --- | --- | --- |
| **Live dump + copy (today)** | Coarse: whatever changed since the last dump; and the PG/S3 cut is *ordered*, not instantaneous, so the recovered state is "DB ⊆ S3", not a single instant | Moderate-to-high: full `pg_restore --single-transaction` of a logical dump + additive S3 copy + differential refresh (the refresh alone is described as ~1h class of work, `bascule.mjs:37`, `988`) | Logical restore rebuilds indexes/constraints; wall-clock grows with DB size and corpus size |
| **Coordinated volume snapshot at T** | Fine at the snapshot cadence; a *common T* across the four stores removes cross-tenant skew | Low-to-moderate: restore = provision a PVC from the snapshot (block-level, fast) + PG crash/WAL recovery; S3 side is a version-scoped copy that can run asynchronously | Block restore avoids logical rebuild; the win is a clean common instant and a short/none freeze |
| **PITR (WAL archiving + base backup)** | Finest: recovery target can be *any* past instant down to the WAL segment/commit granularity — best RPO | Moderate: restore base backup + replay WAL to target T; replay time grows with distance from the last base backup | Continuous WAL shipping means near-continuous RPO without freezing writers |

**JUDGMENT — why the owner model improves RPO and removes the long freeze.** Today the
freeze/quiesce sits on preprod and the *consistency* is an ordering + recon property, so
the recovered cut is not a single instant and the copy/restore happen inside the
operational window. The owner model (i) makes the recoverable point a **defined common
instant T** across both tenants (better, explicit RPO), and (ii) moves the expensive
copy/restore *after* the snapshot, so the only online cost is a seconds-scale fence
instead of a dump+copy+refresh window (removes the long freeze). PITR layered on top would
push RPO from "snapshot cadence" toward "continuous".

---

## 6. Decoupling snapshot from copy (owner step 5, section F)

**JUDGMENT — feasible and it is the core value of the model.** Once a coordinated,
labelled instant exists (PG volume snapshot + S3 as-of-T marker), the four copies (dump
from snapshot) and the restore run **asynchronously from the snapshot artifacts**, not
from the live systems. Implications:

- **No long online freeze.** Live systems resume immediately after the seconds-scale
  fence; the copy reads the *snapshot*, so it can take as long as it needs without holding
  production.
- **`pg_dump` can move off the hot path.** A logical dump (still the portable, restorable
  artifact we trust — and the 0-Python, validated-image path) can be taken **from a clone
  of the snapshot** (provision a temporary PVC from the `VolumeSnapshot`, start a throwaway
  PG pointed at it, `pg_dump` from there). The production database never sees the dump load.
- **S3 copy reads versions ≤ T.** The additive `CopyObject` loop we already run
  (`bascule.mjs:876-921`) becomes a *version-scoped* copy, which is deterministic and
  replayable.
- **Cost/consistency trade-off.** Decoupling adds storage (snapshots + versions retained
  until the async copy completes) and adds moving parts (snapshot lifecycle, temporary
  clone PVCs, version-scoped copy). It also means the "restore" you validate is derived
  from the snapshot, so snapshot integrity becomes a first-class thing to verify (a smoke
  equivalent to S7).

**JUDGMENT.** This step is where the model pays for itself: it is the difference between a
switchover *window* and a switchover *instant + background work*. It is compatible with
the existing verdict-only, in-cluster-Jobs, kubectl-only design — the snapshot and the
async copy are just more in-cluster Jobs the runner dispatches and polls by `.status`.

---

## 7. Trigger / authorization architecture (section D)

Caller-provided context (labelled): the recent hardening added an immo→geo GitHub
cross-repo dispatch via a PAT (Actions R/W on `rhanka/geo`, `ref=main` only) with
environment gates; the owner asks whether a **direct in-cluster inter-tenant
authorization** should instead give the go immo→geo, with the GitHub Action kept as a
**standby**, not active at the same time.

**Comparison.**

| Dimension | (1) Direct in-cluster authz (k8s controller/operator, cross-namespace RBAC, or a transverse service) | (2) Cross-repo GitHub dispatch (PAT), kept as standby |
| --- | --- | --- |
| Where the go lives | Inside the cluster, immo namespace → geo namespace, via RBAC | Outside the cluster, GitHub Actions → `rhanka/geo` |
| Latency / atomicity of a common T | Low latency, single control plane → easier to hit a tight common T across both tenants | Higher latency (two workflow runs), harder to align a tight T |
| Blast radius | Cross-namespace RBAC must be minimal (name-scoped verbs on the exact objects: create/patch specific Jobs/VolumeSnapshots), or it becomes a tenant-isolation hole | PAT is a long-lived cross-repo credential; scope is repo/Actions-level, coarser than k8s RBAC |
| Governance fit | Matches "k8s perimeter = transverse cloud-native service"; the tenant (immo) stays operator | Matches the current PII-free, kubectl-only runner posture |
| Auditability | k8s audit log of the exact API calls | GitHub Actions run history |

**JUDGMENT — how to keep exactly one active at a time.** The two paths must be mutually
exclusive by construction, not by convention. An arming switch (the pattern already used
for CD activation, `bascule-bundle-cd.yml:76`, and for the prod trigger token whose Role
rules are emptied to `[]` after use, `bascule-bundle-cd.yml:237-247`) is the right shape:
when the in-cluster controller is armed, the cross-repo PAT path is disarmed (its Role
rules emptied / the workflow gated off by an env flag), and vice-versa. This mirrors the
existing dual-kubeconfig discipline where the prod-trigger token is name-scoped to a
single `patch cronjob` verb and guarded by a validating admission policy (suspend-only)
(`bascule.mjs:400-453`; `deploy/ci/bascule-preprod/vap-ci-trigger-suspend-only.yaml`).

**JUDGMENT — RBAC for a direct in-cluster controller.** It would need `create`/`get`
`.status` on `VolumeSnapshot` objects in both namespaces (or a transverse namespace it
owns), plus the existing verbs to suspend CronJobs / scale Deployments for the brief
fence. Cross-namespace access should be a dedicated ServiceAccount with a `Role` per
target namespace (not a cluster-wide `ClusterRole`), name-scoped to the exact object
names, so the tenant boundary is preserved. Reading only `.status` (never `kubectl
logs`/pod stdout) keeps the PII-free property (`bascule.mjs:806-846`).

**JUDGMENT — owner constraints are satisfiable.**

- **0 Python / no new unvalidated image.** A controller can be a Node/TS binary (the
  existing `bascule.mjs` is Node), or even reuse `kubectl` + already-validated images
  (`postgis`, `amazon/aws-cli`, `s5cmd`); a `VolumeSnapshot` is a plain k8s object created
  with `kubectl`/client-go/Node client — **no Python and no new container image required**
  (`bascule.mjs:146-194`).
- **Cred governance (k8s↔immo mint with a rotation CYCLE; tenant stays operator).** The
  existing `CRED_CYCLE.md` model (SealedSecrets committed encrypted, `.env` recovery copy,
  documented rotation, verifiable recovery with no per-act owner GO) extends directly to
  any new cross-namespace SA token or S3 reader used by the async copy
  (`deploy/ci/bascule-preprod/CRED_CYCLE.md`). The k8s perimeter stays "transverse
  cloud-native service"; immo remains the operator.

**VERDICT (section D).** The direct in-cluster path is the better fit for a *tight common
T* and for keeping the tenant boundary in k8s RBAC (fine-grained) rather than in a
coarse cross-repo PAT; the GitHub dispatch is a sound **break-glass standby**. The
must-have is a hard, single-source arming switch so the two are never both live.

---

## 8. Verdict and prerequisites (section G)

**Overall: feasible with caveats, and the hard dependency is one repo cannot answer.**

- **PG side — feasible.** Coordinated, near-instant PG capture via CSI `VolumeSnapshot`
  of the `postgres-data` PVC, made application-consistent with `pg_backup_start`/`stop`
  (or `CHECKPOINT` + `fsfreeze`), is the correct mapping of the owner model
  (§2.1). **Conditional on the CSI driver behind `block-standard` supporting
  `VolumeSnapshot`** — which is **UNKNOWN from the repo** and is the single blocking
  unknown.
- **S3 side — feasible, no atomic snapshot needed.** A coherent "as-of T" view is
  achievable via versioning + a coordinated T marker (+ optional object-lock fence); the
  tooling already handles versioning and version ids (§2.2,
  `migrate-object-storage.sh:798-819`).
- **Coordination — feasible.** Existing quiesce/drain machinery, skew handling, and
  in-cluster Job dispatch supply the moving parts (§3, §4).
- **Decoupling — feasible and is the payoff.** Async copy/restore from the snapshot
  removes the long freeze (§6).
- **Trigger/authz — feasible.** Direct in-cluster path is the better fit; keep GitHub
  dispatch as a mutually-exclusive standby (§7).

**The point of hardest uncertainty (single blocker):** whether `block-standard`'s CSI
driver on this OVH MKS cluster supports `VolumeSnapshot` (and how "instant" and how
consistent its snapshots are). The repo does **not** define the StorageClass or any
VolumeSnapshotClass (§1), so this cannot be settled here. **HYPOTHESIS** (needs
verification, do not act on it): OVH Managed Kubernetes block storage is commonly backed
by the Cinder/OpenStack CSI driver (`cinder.csi.openstack.org`), which supports CSI
snapshots when a `VolumeSnapshotClass` is installed and the external snapshotter is
enabled — but this must be confirmed against the live cluster and with `poc-k8s`, because
it is owned outside this repo.

### Concrete prerequisites (to verify or enable, in order)

1. **Verify CSI snapshot support** on the live cluster: driver behind `block-standard`,
   presence of the `snapshot.storage.k8s.io` CRDs, the external-snapshotter controller,
   and at least one `VolumeSnapshotClass` — with `poc-k8s` (cluster owner). *This gates
   everything on the PG side.* (Repo source-gap: §1.)
2. **Enable a `VolumeSnapshotClass`** for the PG PVCs in both tenant namespaces (if step 1
   is positive).
3. **Enable bucket versioning** on the OVH S3 buckets in scope for both tenants
   (Immo `radar-immobilier-graph-preprod` + Geo `sentropic-geo*`), and decide whether an
   object-lock/retention fence is used at T; the tooling already assumes versioning where
   it copies (`migrate-object-storage.sh:798-819`).
4. **Consider WAL archiving / PITR** as the RPO-hardening companion (option ii) — not in
   the manifest today (§1); it is the path to near-continuous RPO if the snapshot cadence
   is not tight enough.
5. **An orchestration controller** (Node/TS or kubectl-driven, 0 Python, no new image)
   that: records a single T, fences writers briefly, creates the four fences
   (2× `VolumeSnapshot`, 2× S3 as-of-T markers), releases, then dispatches async
   copy/restore Jobs and polls them by `.status` — reusing the existing verdict-only,
   PII-free pattern (§3, §6, §7).
6. **A hard arming switch** making the in-cluster go and the cross-repo PAT standby
   mutually exclusive (§7).
7. **Snapshot-integrity smoke** (an S7-equivalent) validating a restore *from the
   snapshot artifacts*, since the trusted restore now derives from snapshots (§6).

### Recommendation on a decision dossier

**JUDGMENT — yes, a French decision dossier (dossier de décision) is warranted**, because
the model touches tenant isolation (cross-namespace RBAC), a cross-owner dependency
(`poc-k8s` for CSI/StorageClass), credential governance (the k8s↔immo mint cycle), and it
changes the recovery guarantee (from ordered-cut to a common-instant RPO). The dossier
should carry, at minimum, these decisions:

- **D1 — CSI snapshot dependency:** confirm with `poc-k8s` whether `block-standard`
  supports `VolumeSnapshot`; if not, fall back to a PITR-based common-T (option ii) or keep
  the current live-dump model. *(This decision is a prerequisite, not a preference.)*
- **D2 — S3 coherence mechanism:** versioning + as-of-T read (± object-lock) as the
  standard for both tenants.
- **D3 — Trigger authority:** direct in-cluster inter-tenant authz as primary, cross-repo
  GitHub PAT as mutually-exclusive standby, with the arming switch as the enforcement.
- **D4 — RPO target and cadence:** snapshot cadence and whether PITR is layered on, i.e.
  the explicit RPO/RTO the owner is buying.
- **D5 — Scope/ownership:** confirm that the k8s lane operates this as a transverse
  cloud-native service while immo remains operator, per the standing owner rule, and that
  no Python / no new unvalidated image enters the job path.

---

## Appendix — key repo sources (facts)

| Fact | Source |
| --- | --- |
| PG single-replica StatefulSet, PVC RWO `block-standard`, image `postgis:16-3.4` | `deploy/k8s/20-postgres-postgis.yaml:32-93` |
| `block-standard` not defined in repo; storage owned by poc-k8s | repo grep (no `kind: StorageClass`); `docs/architecture.md:484` |
| No VolumeSnapshot/VolumeSnapshotClass anywhere | repo grep (no `snapshot.storage.k8s.io`) |
| OVH MKS cluster (BHS) + OVH S3 endpoint | `docs/architecture.md:484`, `585` |
| Two tenants, separate PG, shared cross-tenant S3 read | `docs/architecture.md:481-482`, `565`, `581`, `615` |
| Backup = logical `pg_dump`, network client, S3 upload | `deploy/ci/db-backup-job.tmpl.yaml:54-110` |
| Switchover = live dump+copy, quiesce on preprod, recon `dest ⊇ src` | `deploy/ci/bascule-preprod/bascule.mjs:24-53`, `220-257`, `466-649`, `876-946` |
| "snapshot" today = logical consistency snapshot | `deploy/k8s/35-consistency-snapshot-job.yaml:1-24`; `docs/architecture.md:604` |
| S3 versioning checked/required, version ids tracked | `deploy/ci/migrate-object-storage.sh:798-819`, `675-680` |
| Runner kubectl-only, verdict-only (.status), 0-Python, validated images | `deploy/ci/bascule-preprod/bascule.mjs:9-22`, `146-194`, `806-846` |
| Prod trigger name-scoped, VAP suspend-only, arming switch, rules→`[]` | `bascule.mjs:400-453`; `bascule-bundle-cd.yml:76`, `237-247` |
| Cred cycle governance (SealedSecrets, rotation, verifiable recovery) | `deploy/ci/bascule-preprod/CRED_CYCLE.md` |
