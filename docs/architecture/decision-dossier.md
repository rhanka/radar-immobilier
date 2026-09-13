# Decision dossier — Immo refresh and storage retirement

Revision **D4**, 2026-09-13. **Execution direction confirmed; acceptance incomplete**.
The owner authorized continuation in the order below. Production inventory,
credential operations and review gaps remain acceptance requirements, not a renewed
presentation-only hold. Opening this page itself performs no action.
Author: Codex / gpt-6-astra / xhigh. This is not an owner signature or Track decision.

## 1. Decision asked

[FACT · owner] The sequence is decided: **T1 autonomous PV/Signal refresh in
Kubernetes → T2 MinIO and remaining SCW retirement → T3 one b3-8 node**. Execute
the existing plan and update this reference at every transition; include dated
renderings in the monthly report. [Transition register](transitions.md).

[JUDGMENT] The remaining commercial question is: **which auditable method should
allocate LLM expense to Immo/Geo for August 12–September 10?** Focus choices are
drafts pending the token re-audit, not another vote on architecture order.
One-node infrastructure billing is fixed; extra node capacity is not passed through.

[FACT] Already fixed by the owner: all PV-to-Signal stages remain Immo-owned;
resume i-cond work, preserve Graphify's extraction effort, eradicate MinIO and SCW
storage/image dependencies, **retain SCW TEM until a replacement is validated**;
use this dossier to accompany execution. Do not re-ask those decisions.

## 2. Context: facts, assumptions and unknowns

[FACT] [Architecture](../architecture.md) and [runtime audit](storage-audit.md):
preprod API → `PP-RAW` / derived `PP-DOCS` on **PP-MINIO**; scrape and projection
→ one **PP-GRAPH** OVH bucket. PG is **PP-DB** in every view. Prefixes are not stores.
Mapped PDFs use **GEO-S3** `raw/pv-index/cas/`, not the preprod normalized Geo copy.
MinIO is still ready/configured; its content and every writer were not inventoried.

[FACT] Verified access: `immo.sent-tech.ca` / `preprod.immo.sent-tech.ca`;
SSO `auth.sent-tech.ca` / `preprod.auth.sent-tech.ca`. `preprod.sent-tech.ca` was
NXDOMAIN. OVH production Immo inventory is RBAC-denied; old SCW resources are excluded.

[FACT] [Continuation audit](continuation-audit.md): #678 is an open CAS draft,
reporting a successful candidate-only dry run, not live publication. Graphify #330
is merged and **0.18.0 is published**, with mesh 0.19 and an ESM-only mesh subpath.
Producer installation passed; Immo acceptance is pending ([evidence](transitions.md)).
The latest i-cond study proposes **in-process
mesh in the pod**, not a mandatory network service. Immo chat need not share it.

[FACT] Direct scraping writes lowercase graph types; routes serve exact `Signal`
and `DesignationEvent`. Fresh scrape ≠ fresh served Signal. 3.4 EMIT/APPLY is a
separate post-projection stage; APPLY recalculates from PG, not EMIT files.

[JUDGMENT] Working assumption: preserve existing logical store roles during the
first migration. Exact OVH targets, IAM, object volume, write owners, credential
refresh ownership, recovery window and price are **unknown**, not filled by analogy.

## 3. Stakes

[JUDGMENT] The failure modes are silent staleness, unavailable PDF evidence,
partial object migration, concurrent canonical writers and lost OAuth refresh.
Changing providers without testing these boundaries can preserve green Jobs but
break the user-visible result. The production blast radius warrants a separate gate.

[FACT] Immo owns acquisition→interpretation→publication→SQL→serving; Geo owns
geographic sources, joins and OGC/document products; Graphify owns its reusable
library; poc-k8s owns shared ingress, tenancy, storage and credential operations.
These are cross-owner contracts, not just image/tag substitutions.

## 4. Historical alternatives and the engaged plan

The following architecture alternatives are **historical, not open choices**.
The owner selected refresh first; storage-first and a complete new DAG before the
first refresh do not match that direction. Preserve E4/E5 exclusive-writer and
retry invariants in the in-pod continuation. See [T1–T3](transitions.md) for the
existing work retained and remaining acceptance. Assessments are [JUDGMENT].

| ID | Choice | Strongest case FOR | Strongest case AGAINST | Cost | Reversibility | Wins if |
| --- | --- | --- | --- | --- | --- | --- |
| A | Checkpointed in-pod Graphify refresh, then storage cutover | Reuses current CAS/library work; proves fresh user-visible output early | A sequential runner may need rework for the eventual DAG and must not become another canonical writer | Medium integration + migration; unpriced | Good before writes; rollback needs data checkpoints after publication | Existing gate/writer contracts can be reused without bypassing E4/E5 safety |
| B | Complete layered S3-DAG E1–E5 before cutover | Establishes sole merge/projection ownership immediately; gives durable recomputation boundaries | Broadest change before first acceptance; adds contracts and orchestration to the storage release | Highest initial engineering scope; unpriced | Reverting contracts and mixed-version outputs is harder | Parallelism, resumability or multi-writer risks make a sequential slice unsafe |
| C | Migrate storage first; retain workstation LLM temporarily | Isolates provider retirement from extraction change; exercises all existing reader/writer paths | Does not deliver autonomous fresh Signals and migrates publishers that may soon change | Smaller initial code change; additional migration coordination; unpriced | Easier code rollback, not automatic data rollback | An urgent storage risk outweighs the cost of temporary workstation dependence |

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
