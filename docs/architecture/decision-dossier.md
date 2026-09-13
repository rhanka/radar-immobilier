# Decision dossier — Immo refresh and storage retirement

Revision **D2**, 2026-09-13. **INCOMPLETE / presentation only**: production inventory,
credential operations and the Opus review (weekly limit) are unresolved. No implementation,
migration, package integration or deployment is authorized by opening this page.
Author: Codex / gpt-6-astra / xhigh. This is not an owner signature or Track decision.

## 1. Decision asked

[JUDGMENT] Review the framing of a **future delivery-sequence decision**; no option
selection is requested now. The eventual alternatives are:
**A** staged in-pod Graphify refresh, then verified storage cutover;
**B** full E1–E5 DAG before cutover; **C** storage first, workstation refresh temporarily.
Scope: Immo preprod first, then a separately gated production promotion; Graphify
consumer contract, Geo evidence-reader boundary and poc-k8s operations are affected.

[FACT] Already fixed by the owner: all PV-to-Signal stages remain Immo-owned;
resume i-cond work, preserve Graphify's extraction effort, eradicate MinIO and SCW
storage/image dependencies, **retain SCW TEM until a replacement is validated**;
present this dossier before starting. Do not re-ask those decisions.

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
targets 0.18.0 / mesh 0.19 with an ESM-only mesh subpath; publication and Immo
acceptance are not established. The latest i-cond study proposes **in-process
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

## 4. Options

All cost, benefit and reversibility assessments below are **[JUDGMENT]**, not quotes.

| ID | Choice | Strongest case FOR | Strongest case AGAINST | Cost | Reversibility | Wins if |
| --- | --- | --- | --- | --- | --- | --- |
| A | Checkpointed in-pod Graphify refresh, then storage cutover | Reuses current CAS/library work; proves fresh user-visible output early | A sequential runner may need rework for the eventual DAG and must not become another canonical writer | Medium integration + migration; unpriced | Good before writes; rollback needs data checkpoints after publication | Existing gate/writer contracts can be reused without bypassing E4/E5 safety |
| B | Complete layered S3-DAG E1–E5 before cutover | Establishes sole merge/projection ownership immediately; gives durable recomputation boundaries | Broadest change before first acceptance; adds contracts and orchestration to the storage release | Highest initial engineering scope; unpriced | Reverting contracts and mixed-version outputs is harder | Parallelism, resumability or multi-writer risks make a sequential slice unsafe |
| C | Migrate storage first; retain workstation LLM temporarily | Isolates provider retirement from extraction change; exercises all existing reader/writer paths | Does not deliver autonomous fresh Signals and migrates publishers that may soon change | Smaller initial code change; additional migration coordination; unpriced | Easier code rollback, not automatic data rollback | An urgent storage risk outweighs the cost of temporary workstation dependence |

## 5. Recommendation and counter-case

[JUDGMENT] **Provisional preference A; defer execution.** Qualify the smallest
vertical slice on a published Graphify version, preserve guarded canonical writes,
then migrate validated store roles. This is not approval to implement a new DAG or
silently abandon its invariants. Use B if A cannot prove exclusive writers/recovery.
The comparative effort is unverified: measure A/B/C against the same served-Signal,
PDF, exclusive-writer, credential-continuity and recovery boundary before selection.

[JUDGMENT] **Strongest argument against A:** it could create a disposable second
orchestrator, duplicate credential handling, and postpone the only robust writer
boundary. B can be cheaper overall if the DAG integration is already close to ready.
**Overturn condition:** authoritative handoff shows A violates single-writer rules,
or B's tested remaining scope is comparable; urgent storage risk can favor C.

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
| Graphify upgrade preserves extraction and public contracts | Owner + i-cond | Installed published package, ESM consumer smoke, independent route/cancellation/schema tests | Final release and Immo B2 acceptance |
| Durable unattended credentials | Latest i-cond study + independent review | G1b unique refresh writer, persistence, restart/recovery tests | Operated identity contract |
| No data loss or competing writers during retirement | Repo rules + owner | G3/G4 parity manifests, IAM/writer matrix, restore rehearsal | Inventory/volume/recovery criteria |
| Preprod first, separate production release, TEM retained | Owner | G0–G6; explicit TEM exclusion | Production evidence; no release authorized |
| Honest decision surface, alternatives and actual reviews | Owner + Focus contract | This dossier, source links, local notes, individual review records | Codex completed; Opus unavailable (weekly limit) |

## 8. What is needed next

[JUDGMENT] This **incomplete presentation does not request approval**. The smallest
missing owner input is the acceptable recovery/maintenance envelope (downtime,
RPO/RTO and retention), not a renewed TEM or ownership decision. Obtain the authorized
OVH production inventory and final upstream contract before a complete execution
dossier. Local Focus notes are drafts only; they neither sign nor deploy anything.
[JUDGMENT] Before selecting a sequence, also establish refresh-versus-retirement
priority, acceptable duration of workstation dependence, effort ceiling, required
freshness/coverage/evidence availability and the accepting owner for each contract.
These are missing criteria, not five defaults or a forced questionnaire.
