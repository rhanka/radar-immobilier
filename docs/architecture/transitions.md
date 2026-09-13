# Architecture transition register

Owner direction, September 13, 2026: execute the existing work **refresh first,
MinIO second, one-node Kubernetes third**, as soon as the corresponding acceptance
checks pass. The earlier presentation-only hold is superseded. The dossier follows
execution; it is not a request to vote again on those three objectives.

## Reference and update contract

- Canonical current-state source: `docs/architecture.md`; the proposed refresh
  boundary is in `docs/architecture/proposal.md` until verified in deployment.
- Committed renderer: `docs/architecture/focus/`, including the Mermaid parser,
  SVG renderer, native nested SvelteFlow, service/repository map and tests.
  Reference commits: `b1aef3b2`, `df0ac28e`, `63f32086`, `8d3da5b6`, `ef0b24c2`.
- Every architecture transition must update the source diagrams, resource/owner
  map, this register and evidence in the **same implementation PR**. Rebuild and
  run the documented mapping/browser checks. A drawing change is not deployment.
- Record before/after runtime, exact image/package/commit, evidence timestamp,
  execution owner, acceptance, rollback and unresolved gaps. Preserve history in
  Git; retain stable IDs for unchanged physical resources.
- The monthly report embeds a dated rendering and source hashes. Later changes
  must not silently alter an already issued report. HTML includes interactive
  SvelteFlow plus rendered Mermaid; PDF includes static diagrams and the HTML link.

## Engaged plan, retained work and remaining transitions

| Transition | Existing work retained | Remaining acceptance | Current status |
| --- | --- | --- | --- |
| T1 — autonomous PV → Signal cron | Immo CAS #678; four-stage pipeline; canonical writer; projection; 3.4 EMIT/APPLY; i-cond's in-pod Graphify study; existing scrape/projection CronJobs | Install exact Graphify 0.18.0; finish consumer/runner wiring; one-document proof then selected corpus; guarded publish → PG → typed Signal and PDF; retry/idempotence; durable unattended identity; run the CronJob's Job template, then observe scheduled execution | Release ready; Immo integration and live end-to-end proof still pending |
| T2 — remove MinIO and remaining SCW dependencies | #677 OVH refresh bindings, #671/#672 GHCR migrations; #670 retirement branch; existing role map PP-RAW/PP-DOCS/PP-GRAPH/GEO-S3 | Inventory all readers/writers and objects; provision exact OVH bindings; copy + integrity + final-write reconciliation; repoint and test; stop MinIO after no clients remain; close executable SCW references in images, Jobs, CI and backups; purge source PVC only after recovery acceptance | MinIO still effective in the dated preprod snapshot; production inventory and cross-repo residue closure required |
| T3 — one OVH b3-8 | poc-k8s `cluster-rightsizing-plan.md`, `rightsizing-status-2026-09-13.md`, `b3-8-service-plan.md` | Include Immo prod and the new refresh Job in full capacity budget; verify PDB/affinity/PVC placement, batch and wake peaks; preserve data and active services; controlled consolidation then pool min=max=desired=1 | Owner-fixed target; not yet a demonstrated safe placement |

[FACT] Graphify producer confirms **0.18.0 published**, tag `v0.18.0`, merge
`1a723695d8a23ffe5e13f1988c52ded056f85c96`; exact-version installation and ESM/CJS
contract tests passed on the producer side. H2A envelope
`env:graphify-018-final:1789306808055`, 13:40 UTC. This closes the publication
dependency, not the Immo consumer acceptance. Earlier open-PR references are dated
history, not current release status.

[JUDGMENT] The shortest continuation is the engaged in-pod library integration,
not a new mesh network service, another CLI orchestration layer or completion of
the entire E1–E5 DAG before the first live refresh. Preserve its exclusive-writer
and retry invariants. A one-document smoke alone does not satisfy T1.

[FACT] Owner reminder: Geo is continuing SCW eradication after missed references
were found. Geo's verified GHCR deployment/secret cleanup is **not** certification
of every source adapter, S3 binding, Job/CronJob, CI path or backup. SCW closure
remains cross-repository work throughout these transitions. Retain **SCW TEM**
until its replacement is validated. Do not delete shared MatchID SCW resources
or historical audit evidence as part of Immo/Geo cleanup.

[FACT] The platform measured 3 b3-8 nodes, 9,454 Mi instantaneous node memory and
5,907.82 Mi allocatable per node at 13:20–13:24 UTC. The sample excludes detailed
Immo prod certification and is not a peak. MinIO preprod retirement frees about
347 Mi in its later sample, not the full 904 Mi namespace. T3 must use the existing
service-by-service plan; do not assume deleting MinIO alone makes a drain safe.

## Monthly reporting and billing direction

[FACT] Report window: **2026-08-12 00:00 through 2026-09-10 23:59:59,
America/Toronto**. September 13 transitions belong in an explicitly post-period
update, not in the month's delivered totals.

[FACT] Owner fixes the billable infrastructure basis to **one node projected**.
The three-node configuration was an error. Actual provider expense remains an
internal incurred-cost line; extra node capacity is not passed through to the
client. Do not divide the historical total by three without checking node-hours,
rates and separately billed non-node items. Keep the prior preprod allocation
decision and SCW TEM exception; neither is being re-asked.

[JUDGMENT] Re-audit tokens before issuing the bill: exact local-time window,
per-message/call deduplication across resumed/copied sessions, input/cache/output
breakdown, model/provider scope and like-for-like prior window. Separate observed
usage, real subscription/API expense, allocation method, margin and billable sum.
The current historical-peak normalization is an allocation assumption, not a
supplier bill. Present each alternative only after its explicit question and
numerical consequence; no default selection or invented lower consumption.
