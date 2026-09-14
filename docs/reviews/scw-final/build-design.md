# T2 immediate parallel implementation

Date: 2026-09-13. Author: Codex, requested gpt-6-astra xhigh.
Baseline: 32cae733 on chore/scw-final-sweep; audit is input, not live acceptance.
Owner instruction: begin MinIO/SCW removal now, alongside T1. Retain TEM.

## Decisions

D1. Preserve the existing separation of raw, scrape/parsed and canonical graph
stores. OVH is the deployed destination; Geo remains a distinct read-only
consumer contract. Never copy Immo data into Geo's bucket or reuse its IAM.
Preprod graph already uses OVH; do not regress its endpoint, identity or keys.
Production physical bindings and new raw/docs destinations are not yet proved.

D2. Start with branch-local provider-neutral binding and executable-residue
removal. Existing SCW migration branch `origin/chore/eradicate-scw-refs` is a
patch source only: inspect/reuse relevant logic, never merge its stale base.
Do not change image versions or refresh commands: T1 owns those.

D3. All remaining deployed/manual/suspended writers must take explicit storage
coordinates and credentials for their own environment. Remove hardcoded SCW
and MinIO fallback paths; missing required bindings must fail closed, not route
to another store. Use Kubernetes ConfigMap keys for non-secret coordinates and
Secret references for credentials. Preserve the GRAPH_S3_* priority and current
conditional canonical writer. A changed endpoint alone is not migration.

D4. First slice: neutralize manual graph/scrape manifests, remove
unused S3 permissions from DB migration, remove obsolete mount executables,
correct active deployment examples, and add offline regression checks. Keep
local Compose/test MinIO and rejection fixtures. No application runtime changes
or provider-shaped source-data field rename in this slice.

D5. Prepare API raw/docs and refresh environment binding changes in a subsequent
explicitly released slice. Do not invent physical bucket names or credentials.
Required coordinates come from fresh inventory/provisioning; unresolved values
remain a rollout blocker with exact missing-key diagnostics. No automatic
deployment, promotion, CI-variable toggle or namespace mutation by the builder.

D6. MinIO StatefulSet/service/PVC and associated policy removal is a final
cutover step, not an early source edit. Likewise, legacy grounding retirement
depends on T1's accepted replacement. Their live presence is inventoried now;
their destruction is gated, without making all T2 development wait for T1.

D7. The conductor owns writer fencing, non-destructive copy, complete key/size/
content parity including metadata relied on by clients, final delta, paired
DB/object recovery proof, client reads/writes and stale-ETag rejection. Retain
the old store read-only until verified recovery and zero consumers. Then remove
only enumerated Immo resources, preprod before prod, and record recoverability.
TEM, Geo, MatchID, shared infrastructure and local developer volumes are exempt.

## Exact first-slice write paths

- `deploy/k8s/31-graph-projection-job.yaml`
- `deploy/k8s/32-graph-projection-only-job.yaml`
- `deploy/k8s/33-scrape-job.yaml`, `deploy/k8s/33b-scrape-cities-job.yaml`
- `deploy/k8s/36-db-migrate-job.yaml`
- `deploy/k8s/37-graphify34-apply-job.yaml`
- `deploy/k8s/38-graphify34-emit-candidates-job.yaml`
- `deploy/k8s/39-export-graph-nodes-job.yaml`
- `deploy/k8s/40-export-gt-designation-events-job.yaml`
- `deploy/ci/check-object-storage-bindings.sh`
- `deploy/ci/check-object-storage-bindings.test.sh`
- `scripts/mount-scw.sh`, `scripts/umount-scw.sh` (retire; check callers first)
- `.env.example`, `deploy/k8s/README.md`
- `docs/architecture/scw-final-sweep.md`, `docs/reviews/scw-final/**`
- `plan/SCWF-BRANCH_chore-scw-final-sweep.md`

No refresh-018 worktree writes, app code, root Makefile/Compose, rules, .track,
other plans/repos, credentials, live data, Git push/merge or deployment.
If a necessary binding requires another path, report an exact scope amendment
before editing it. Avoid changing shared files merely to enable nicer tests.

## Verification and acceptance

Use Make, ENV=test-scw-final last, Docker for Node/Python if needed. Ports reserved:
API 8882, UI 5382, Maildev 1182; prefer offline validation without any new services.
Every commit <=150 changed lines including its plan update. Only generated T1
dependency commit had an exception; it does not extend to T2.

Run `make k8s-validate ENV=test-scw-final`; render changed one-shot manifests too.
Test every selected document for endpoint/region/bucket/path-style and identity
references; forbid legacy literals, mixed value/valueFrom, optional fallback
credentials and Geo writes. Assert no TEM or local-development config changes.
The checker covers the released slice, not a false repo-wide eradication pass.
Retain an explicit remaining-client list until the later slices remove all hits.

Runtime evidence correction: `.kube/ovh.conf` identifies Geo CI and its Immo
denials prove only RBAC. Dedicated Immo preprod cert-ro can read deployments and
CronJobs; PVC/storageclasses and production remain unverified. Do not repeat
the old audit's claim of complete preprod access loss.

## Review gate

Independent Fable review of this immutable design precedes first-slice edits.
Reconcile blocking findings, then build; post-build review precedes integration.
Neither a review receipt nor offline green tests imply migration/decommission.

## Reconciled Fable review: first slice released

F1 accepted: pin every storage family actually consumed by each command through
non-optional ConfigMap/Secret key references; deleting literals is insufficient.
Assert the complete consumed fallback chain, including S3_* where used, so neither
envFrom nor application defaults can silently select MinIO/SCW. Required graph
coordinates use radar-api GRAPH_S3_* keys and radar-graph-s3-credentials; scrape
coordinates use radar-api SCRAPE_S3_* and radar-scrape-s3-credentials. Explicitly
list missing/unverified bindings; no merge or dispatch before their validation.
If a command also consumes the main raw store, resolve that complete family too,
or report the exact missing scope/binding before claiming the job is migrated.

F2 accepted: MOVE refresh-diag to the later bound slice; do not edit it now or
toggle its armed CI variable. This prevents the first slice breaking main CD.
DB migration S3 privilege removal remains safe and in scope.
F3 accepted: record remaining manual/duplicate run-job routes; no workflow edit.
F4 accepted: keep the armed production grounding publisher at the top of the
remaining-client list; T1 replacement gates its retirement, not this build slice.
Conductor releases the amended first-slice implementation immediately. Independent
post-build review and later runtime/data gates remain mandatory.
