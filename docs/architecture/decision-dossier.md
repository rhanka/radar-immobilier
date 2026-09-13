# Architecture dossier — before, effective transition, after

Revision **D6**, 2026-09-13. The dossier separates a preserved before capture,
the later effective state on the same day, and two after targets. Opening the
Focus page performs no action, creates no Track event and is not an invoice.

## 1. Three levels of truth

The reading path is **Before → Effective transition on September 13 → After T2
→ After T3**. [The three transition diagrams](transitions-target.md) and the
[register](transitions.md) are canonical for the effective and target states.
Every diagram exposes changes, retained elements, removals, gates and evidence.

The complete target keeps the Immo/Geo product chain, prod/preprod URL and SSO,
and moves object roles to OVH. It proposes both tenants on one existing b3-8 only
after safety acceptance. SCW TEM is retained until its replacement is validated.

## 2. Before capture

The [before source](../architecture.md) was observed earlier on September 13:
the API used MinIO `PP-RAW` and empty fallback `PP-DOCS`; separate
`PP-DOCS-LEGACY` held useful history. Refresh used OVH `PP-GRAPH` and `PP-DB`,
while the LLM-derived path still required a workstation. Production access was
observed, but its private bindings were not inventoried.

Observed surfaces include `preprod.immo.sent-tech.ca`, `immo.sent-tech.ca`,
`preprod.auth.sent-tech.ca` and `auth.sent-tech.ca`. Repository provenance is
shown on every node: radar-immobilier owns Immo application paths, geo owns Geo
data/services, and poc-k8s owns the shared Kubernetes platform.

## 3. Effective transition — T1

Graphify **0.18.0** is integrated and **Luna high** is selected. The first
Kubernetes validation run failed before invoking the LLM: its chosen input was
`.html`, while the extraction contract requires PDF. This is a real fail-closed
input-validation result, not provider completion or T1 acceptance.

The next run must use a valid PDF and prove provider completion, a typed Signal
with its exact PDF, idempotent replay and unattended scheduling. The workstation
remains available for administration/fallback until those gates pass. The
[causal T1 pipeline](proposal.md) shows acquisition, Graphify, guarded graph
publication, atomic PostgreSQL projection and served proof.

## 4. Effective transition — T2

Preproduction RAW passed parity and the API was rebound to `PP-RAW-OVH`; the old
raw identity is fenced/recovery-only. DOCS inventory observes preprod MinIO at
144,193 objects / 28.34 GB and canonical production SCW `docs-pocs` at
59,017 / 12,534,514,457 B.
The OVH bucket and Secret are provisioned and guarded copy tooling is committed
on `chore/scw-final-sweep` through `be362561`; it is **not on `origin/main`** at
this snapshot.

By explicit owner decision, the production source is the **exact initial
canonical reference**. OVH prod and preprod must each contain those same 59,017
keys and hashes. The surplus 85,176 preprod objects is non-canonical and is not
migrated. The gate is manifest diff → production canonical set → selective copy
→ exact keys/hash parity → recovery proof → recoverable removal of all MinIO.
Copy, parity/recovery and rebind are **not complete**; production migration has
no completed outcome. TEM remains until replacement validation.

## 5. After targets and one-node gate

After T2, RAW and DOCS use distinct accepted OVH roles, with exactly 59,017
canonical DOCS keys/hashes in prod and preprod. Only then may every MinIO
consumer, object, workload and PVC be removed through the recoverable gate. The
target never reuses a MinIO physical identity for an OVH bucket.

T3 has **not started** and is **NO-GO today**. One node exposes 1,840m CPU and
5,907.82 Mi allocatable, versus 4,095m/8,442 Mi requests and 5,273 Mi current pod
memory. Required anti-affinity and 16 PVC/15 Cinder RWO add placement constraints.
The mandatory sequence is T2 complete → rightsizing → constraints reconciled →
verified two-node operation → one-node preprod test → production authorization.

## 6. Gates and rollback

T1: valid PDF → provider → Signal/PDF → replay → schedule. T2: inventory →
conditional copy → parity → restore → writer fence → rebind, preprod before prod.
T3: T2 → capacity/placement → two nodes → one node.

Object rollback restores an app-consistent set of canonical graph hash, SQL
checkpoint/version, proof objects and input set. It never assumes a cross-S3/SQL
transaction or permits dual writers. A partial transition authorizes no deletion,
credential revocation or node reduction.

## 7. Rendered evidence and limits

| State | Effective fact | Still open |
| --- | --- | --- |
| Before | Captured MinIO/API/workstation topology | Historical baseline only |
| Transition | RAW OVH active; T1 pre-LLM failure; DOCS inventory | T1 acceptance; DOCS/prod completion |
| After T2 | Complete OVH object target | Not deployed |
| After T3 | Complete one-node target | Not started; NO-GO today |

Eight Mermaid sources are rendered to sanitized SVG and complete native
SvelteFlow. Nested boxes use `parentId`; service icons and repo labels are
mandatory for every node and group. No genuine balanced owner decision is open,
so no fake option is shown; the JSON action copies facts and remaining gates.

## 8. Billing annex

The last cost report merged on `origin/main` ends **2026-08-09**, making the
joined period **2026-08-10 through 2026-09-13 inclusive**: 35 days / 840 hours,
America/Toronto. This proves the repository-report boundary, not an unavailable
external invoice identity.

Infrastructure is only the requested projection of **one b3-8 BHS5**:
`840 × 0.082 = 68.88 CAD`. The two/three-node observed platform costs are
pass-through/internal and excluded from the billable projection.

The refreshed deduplicated session audit retains the previous report's unit
basis and allocation formula: two Claude seats and one ChatGPT Pro seat at
200 USD/month, seven-day capacity, USD→CAD 1.37 and LLM margin ×1.15. It gives
139.337732 CAD immo + 111.877705 CAD geo = **251.215438 CAD LLM**. The indicative
sum is **320.095438 CAD**. These are allocations from local session logs, not
provider invoice lines; [the monthly report](../reports/architecture-monthly/report-through-2026-09-13.md)
documents sources, method and uncertainty.
