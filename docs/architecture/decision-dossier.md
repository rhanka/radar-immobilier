# Architecture dossier — complete target and sequential transitions

Revision **D5**, 2026-09-13. **Target architecture proposed; no deployment
claimed.** The complete final target and T1→T2→T3 states are the primary reading
surface. Production inventory and every transition's acceptance remain open.
Opening this page performs no action and creates no Track event.
Author: Codex documentation build. This is not an owner signature or invoice.

## 1. Complete target and fixed path

[FACT · owner] Present and execute the existing direction in order:
**Existant → T1 autonomous PV/Signal refresh → T2 OVH object cutover plus final
SCW sweep → T3 one existing b3-8**. Preproduction precedes a separately gated
production promotion. [Selectable target states](transitions-target.md) and
[transition register](transitions.md) are the sources of truth for this dossier.

[JUDGMENT] The complete target has one OVH b3-8 housing the Immo and Geo tenants,
subject to shared capacity and safety acceptance. It retains prod/preprod URLs
and SSO; Immo UI/API/MCP/PG/refresh and object roles; Geo API, uncertain database
dependency, corpus/products, official sources and in-process joins. No MinIO or
other Scaleway service is active in the final target; **TEM is the sole retained
exception** until replacement is validated. MatchID is excluded.

[FACT · owner correction] Billing is the final annex, not a critical-path choice.
No DIRECT/USAGE/CAPACITY selection is requested. Later token accounting uses the
same unit tariffs as the preceding month's **actual** invoice once that invoice
is verified.

## 2. Existing state and evidence boundary

[FACT] The September 13 current-state snapshot verifies preproduction storage at
12:33–12:37 UTC: API `PP-RAW` / `PP-DOCS` remain physical MinIO roles;
scrape/projection use the same existing OVH `PP-GRAPH`; PG remains `PP-DB`.
Mapped PDF evidence reads `GEO-S3/raw/pv-index/cas/`. Production application
access is observed, but private Immo DB/object/refresh bindings are **UNVERIFIED**.

[FACT] A dedicated Immo read at 15:38 UTC confirmed one ready preprod API, UI
and MCP replica plus the existing scrape/projection CronJobs. It did not observe
the proposed Graphify 0.18 refresh, PVC/storage class or production internals.

[FACT] `immo.sent-tech.ca`, `preprod.immo.sent-tech.ca`, `auth.sent-tech.ca` and
`preprod.auth.sent-tech.ca` are the observed access/SSO surfaces. The existing
platform observation has three b3-8 nodes. Its instantaneous ~9,454 Mi exceeds
one node's 5,907.82 Mi allocatable; MinIO accounts for only ~347 Mi.

[FACT] Graphify 0.18.0 is published. By 15:39 UTC Immo had committed the refresh
dependency pins at `d0595d9f`, passed typecheck and started scoped tests. That is
observed implementation progress, not consumer completion, a scheduled refresh
or typed Signal/PDF acceptance. Every target
production role may be named as a contract, but its physical binding remains
TBD rather than inferred from source defaults or the old SCW cluster.

## 3. T1 — autonomous Immo refresh

[FACT · design] The causal chain is acquisition/parse → profile extraction and
grounding → preserved fresh candidate → deterministic 3.4 enrichment on that
fresh candidate **before** canonical publication → guarded full-graph write →
atomic PG projection → typed Signal plus exact PDF. [Detailed T1 flow](proposal.md).

[FACT] Immo owns every step; Geo owns geographic inputs. T1 keeps the existing
API MinIO roles until T2. Consumer implementation is underway; operated keyring,
durable lock and end-to-end qualification remain pending.

[JUDGMENT] Acceptance requires the actual installed contract, durable credentials,
one lock shared by scheduled/manual execution, failure/resume and a CronJob-created
Job surviving pod replacement and credential refresh. A bump, manual Job green or
nonempty graph cannot substitute for a fresh typed Signal and its exact PDF.

## 4. T2 — object cutover and final SCW sweep

[JUDGMENT] Create new target bindings `PP-RAW-OVH` / `PP-DOCS-OVH`; never reuse
the physical MinIO IDs `PP-RAW` / `PP-DOCS`. Migrate every reader/writer with
key/size/hash and application decode parity, fence old writers, repoint real
clients, rehearse recovery and retain the old store read-only until deletion gate.

[FACT] Preproduction goes first, then separately inventoried production. Production
private bindings are still TBD/UNVERIFIED. Retire MinIO only at zero consumers.
The final Immo sweep covers images, old digests, Jobs, manual/CI/backup/bootstrap and executable/secret references. TEM remains the sole exception.

## 5. T3 — one existing b3-8

[FACT] The current observation is three b3-8 nodes and ~9,454 Mi instantaneous
memory against 5,907.82 Mi allocatable on one node. MinIO accounts for only ~347
Mi and its removal is insufficient to make a one-node drain safe.

[JUDGMENT] T3 consolidates both Immo and Geo tenants on one **existing** b3-8 only
after a complete shared peak including Immo production and the new refresh. It
must settle realistic requests, hibernation/wake choices, anti-affinity, PDBs,
PVC placement/attachment, batch overlap, health probes and recovery on one failure
domain. No second per-tenant node is part of the target or billing projection.

[JUDGMENT] The counter-case is explicit: the workload may not fit safely. Until
measurement and controlled drain evidence exist, the target remains proposed and
no capacity reduction is claimed.

## 6. Gates, promotion and recovery

[JUDGMENT] **T1 gates:** installed-package compatibility → consumer/integration
tests → real preprod Signal/PDF and idempotent resume → unattended scheduled run
after pod and credential refresh. **T2 gates:** complete client/IAM/object inventory
→ new destination controls → full and final-delta parity → fence → repoint → real
client tests → scheduled observation → isolated recovery → zero consumers → later
deletion. **T3 gates:** full peak/requests/placement proof → controlled preprod
drain/health → separately authorized production consolidation.

[JUDGMENT] Every stage is preprod first and production second. Shared resources
require all consumers' acceptance. Suspended/manual paths are still executable and
must be inventoried. Backups are rollback artifacts, not live fallbacks; no dual
writer is permitted during handoff.

[JUDGMENT] After writes, stop and fence writers, restore an app-consistent set of
canonical graph hash, SQL checkpoint/version, evidence objects and run input hash,
then prove the recovered Signals and exact PDFs. Prevent or journal/replay intervening
writes within the accepted RPO. Do not assume a cross-S3/SQL transaction or discard
newer writes. RPO/RTO, retention, volume and restore throughput remain unresolved.

## 7. Evidence, provenance and limitations

| Surface | D5 representation | Evidence still required |
| --- | --- | --- |
| Current state | Four existing detailed diagrams; verified preprod as-of timestamp | Authorized production private inventory |
| T1 / T2 / T3 | Three complete platform states plus detailed T1, each native SvelteFlow and Mermaid | Deployment and per-stage runtime acceptance |
| Identity | Stable old MinIO, new OVH, PG, graph and Geo IDs; explicit repo/service on every leaf/group | Final OVH target bindings and IAM |
| Safety | Preprod→prod gates, single writer, paired recovery, one-node counter-evidence | RPO/RTO, parity, peak and drain results |

[FACT · owner-response provenance] The D4 response was captured at
`2026-09-13T15:10:18.423Z` with dossier hash
`b001cefd850820d684fe701f5788463c28ac9f48a04c6be339c812d0c94f6451`
and artifact-input hash
`92b87297fbc8ed0f2670fa4fd07e1dde6d061d04533d3695275c1f386b3b032e`.
Its allocation `option` is `null`: no method was selected. D5 preserves the
owner's correction as instructions; it does not turn that null into ratification.

[FACT] This docs build launches no implementation or reviewer agent and writes no
Track event. Earlier D4/Gemini/Codex reviews remain historical evidence, not D5
approval. Production bindings, T1/T2/T3 deployments and monetary closure are not
claimed by rendered completeness.

## 8. Billing annex — evidence incomplete

[FACT · owner] The requested report starts at the real preceding invoice/report
boundary, which is **not yet verified**. It ends September 13 inclusive in
America/Toronto (`2026-09-14T00:00:00-04:00` exclusive). Record the actual data
capture cutoff separately because September 13 is incomplete. September 13
transitions are **inside** the requested period and must be labelled observed or
planned, never moved to a post-period appendix.

[FACT · owner] Infrastructure uses one b3-8 BHS5 projection at `0.082 CAD/h`.
Period hours and projected amount are unknown until the start is verified.
`720 h × 0.082 = 59.04 CAD` is an old 30-day illustration only, never the current
period amount.

[FACT · owner] LLM accounting comes last. Later, count tokens using the **same
unit tariffs as the previous month's actual invoice**; do not open a new allocation
method choice. The strongest local earlier cost report ends nominally August 9 and
was generated that day with partial data; it does not prove the invoice boundary.
The Wave 250804-028 method note covers June 8–July 5 and does not prove the latest
invoice or tariff. D5 does not parse tokens or infer a price.
