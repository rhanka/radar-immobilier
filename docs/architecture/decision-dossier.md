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

[FACT] The September 13 current-state snapshot verifies preproduction at
12:33–12:37 UTC: API `PP-RAW` / `PP-DOCS` remain physical MinIO roles;
scrape/projection use the same existing OVH `PP-GRAPH`; PG remains `PP-DB`.
Mapped PDF evidence reads `GEO-S3/raw/pv-index/cas/`. Production application
access is observed, but private Immo DB/object/refresh bindings are **UNVERIFIED**.

[FACT] `immo.sent-tech.ca`, `preprod.immo.sent-tech.ca`, `auth.sent-tech.ca` and
`preprod.auth.sent-tech.ca` are the observed access/SSO surfaces. The existing
platform observation has three b3-8 nodes. Its instantaneous ~9,454 Mi exceeds
one node's 5,907.82 Mi allocatable; MinIO accounts for only ~347 Mi.

[FACT] Graphify 0.18.0 is published. That closes a producer dependency, not the
Immo consumer, scheduled refresh or typed Signal/PDF acceptance. Every target
production role may be named as a contract, but its physical binding remains
TBD rather than inferred from source defaults or the old SCW cluster.

## 3. T1 — autonomous Immo refresh

[FACT · design] The causal chain is acquisition/parse → profile extraction and
grounding → preserved fresh candidate → deterministic 3.4 enrichment on that
fresh candidate **before** canonical publication → guarded full-graph write →
atomic PG projection → typed Signal plus exact PDF. [Detailed T1 flow](proposal.md).

[FACT] Immo owns every step; Geo owns geographic inputs. T1 keeps the existing
API MinIO roles until T2. Graphify 0.18.0 is published, while mesh 0.19 host
planning, keyring operation and consumer integration remain pending.

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

## 5. Execution basis and counter-case

[FACT · owner] Proceed with T1, then T2, then T3. [JUDGMENT] Reuse the canonical
writer, projection/3.4 and i-cond's library boundary; do not create another publisher
or network mesh service. Acceptance, not the dossier UI, gates cutover. The release
dependency is closed; an installed package alone does not qualify the refresh.

[JUDGMENT] **Strongest argument against A:** it could create a disposable second
orchestrator, duplicate credential handling, and postpone the only robust writer
boundary. B can be cheaper overall if the DAG integration is already close to ready.
**Implementation stop condition:** the continuation would violate single-writer
or recovery guarantees. Resolve that concrete defect; do not silently change the
owner-fixed order or reopen the entire architecture choice.

[JUDGMENT] **Pre-mortem:** six months later Jobs are green but new PVs still do not
reach served Signals, PDFs point at a different corpus, and an ephemeral keyring
lost refreshed tokens. Root cause: accepting infrastructure success instead of a
document-to-UI proof, and deleting old stores before all writers/readers were mapped.

[JUDGMENT] **Presenter interest:** A is easiest for me to bound and validate in a
small branch; that convenience is not evidence of lowest total cost. **Owner
interest:** reliable fresh findings with evidence, reduced storage dependencies,
controlled recovery and no unnecessary Graphify rework. Reviewer findings must be
shown individually in [review records](decision-reviews.md); absence is not consensus.

## 6. Reversibility and cost

[JUDGMENT] Gate sequence: **G0** inventory/contract/owner criteria for **every
affected consumer, including production if a resource is shared** → **G1** isolated
one-document extraction/candidate test (no PG) → **G1b** durable credential owner,
exclusive refresh writer, persistence and refresh/restart/recovery tests → **G2**
preprod publish/project/3.4/API/PDF end-to-end and retry tests → **G3** preprod
object parity, client repoint and write fencing → **G4** preprod restore rehearsal
+ retention window → **G5** removal of **verified preprod-exclusive** MinIO/resources
only after no consumers remain → **G6** separately authorized production
inventory/backup/promotion, repeating G1b–G5 there before any production deletion.
Shared-resource deletion requires all consumers' inventory and acceptance first.
No dual writers during the handoff. Backups are rollback artifacts, not live fallbacks.

[JUDGMENT] G0/G3/G5 also cover **SCW storage and image dependencies**: inventory
executable endpoints, image coordinates and every reader/writer; validate OVH
object parity and replacement image provenance/pulls (including rollback images);
then remove obsolete active templates/configuration. Historical audit evidence is
not rewritten. **TEM stays excluded**; MinIO removal alone does not close SCW retirement.

[JUDGMENT] Before cutover, revert code/config. After writes, stop writers, restore
the captured graph/DB checkpoint and reconcile objects before routing clients back.
The proposed recovery point fences relevant writers and records the canonical graph
hash, SQL checkpoint/version, exact evidence-object set and run input hash together.
Intervening writes must be either prevented or journaled/replayed within the agreed
RPO; do not assume a cross-S3/SQL transaction or silently discard newer API writes.
G4 must verify that this recovered version serves its Signals and their exact PDFs.
Do not reactivate two stores. Permanent deletion is not instantly reversible.
Time/cost are **not estimated** until volume, credential route, maintenance window
and restore throughput are measured. Required owner criteria: acceptable downtime,
recovery point/time and retention; none is silently assumed.

## 7. Attendus

| Criterion | Source | Covered by | Gap |
| --- | --- | --- | --- |
| Effective main + Kubernetes, not legacy guesses | Owner | Runtime/continuation audits | OVH production inventory |
| Same DB/S3 identities across diagrams; all PV stages Immo | Owner | Mermaid → Focus mapping and subflows | Mapping tests pass; browser verification recorded separately |
| New PV → visible typed Signal + resolvable evidence | Owner refresh request + route contract | G1/G2 document-hash-to-UI trace, second-run idempotence, failure/retry tests | Not executed; outside this dossier branch |
| Graphify upgrade preserves extraction and public contracts | Owner + i-cond | Published 0.18.0 producer proof; ESM consumer smoke required | Immo B2 acceptance |
| Durable unattended credentials | Latest i-cond study + independent review | G1b unique refresh writer, persistence, restart/recovery tests | Operated identity contract |
| No data loss or competing writers during retirement | Repo rules + owner | G3/G4 parity manifests, IAM/writer matrix, restore rehearsal | Inventory/volume/recovery criteria |
| Preprod first, gated production release, TEM retained | Owner | G0–G6; explicit TEM exclusion | Production acceptance evidence |
| Honest decision surface, alternatives and actual reviews | Owner + Focus contract | This dossier, source links, local notes, individual review records | Codex completed; Opus unavailable (weekly limit) |

## 8. What is needed next

[FACT] No renewed sequence, one-node, Immo ownership or TEM decision is requested.
[JUDGMENT] Gather runtime, credential and recovery evidence during implementation;
ask only for an unresolved cutover criterion before an irreversible action.
The **billing re-audit remains incomplete**. Local Focus choices are drafts only,
not a final invoice or an implicitly selected commercial method. Separate the
monthly delivery totals from September 13 post-period transitions. Geo SCW closure
remains open until active code, Jobs, CI, storage and backups are checked, not just
the registry rollout. Preserve historical evidence and shared MatchID resources.
