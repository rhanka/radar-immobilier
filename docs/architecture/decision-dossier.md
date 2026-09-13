# Architecture decision dossier — before and after

Revision **D8**, 2026-09-13. The owner-facing comparison contains exactly two
complete architecture views: **BEFORE** and **AFTER**. Effective transition facts
are supporting text and gates, not a third primary graph. Opening the Focus page
performs no action, creates no Track event and is not an invoice.

## 1. Architecture BEFORE

The complete [BEFORE source](../architecture.md) preserves the September 13
capture: production/preproduction access and SSO, Immo and Geo services, shared
Kubernetes platform, PostgreSQL and object roles, and the workstation LLM path.
The preproduction API still used MinIO `PP-RAW`/`PP-DOCS`; refresh graph objects
were on OVH and LLM-derived processing still depended on the workstation.

Every component and nested subflow is shown together. Each carries a service
icon, repository provenance and role. The verified user addresses remain
`preprod.immo.sent-tech.ca` and `immo.sent-tech.ca`.

## 2. Architecture AFTER

The complete [AFTER source](transitions-target.md) is the one-b3-8 target after
T1, T2 and T3 acceptance. It keeps the same user/SSO, Immo, Geo and platform
boundaries while moving RAW/DOCS object roles to OVH and running the Immo refresh
with in-process Graphify/llm-mesh in Kubernetes. SCW TEM remains shown until a
replacement is validated.

AFTER is not deployed as a complete architecture. Its preproduction T2 storage
slice is accepted, production T2 remains in progress and T3 stays gated. The
pre-T2 audit found one node exposes 1,840m CPU and 5,907.82 Mi allocatable versus
4,095m/8,442 Mi requests; placement must be remeasured after storage cleanup.

## 3. Effective delta — context, not a third architecture

Graphify **0.18.0** is integrated and **Luna high** selected. The first
Kubernetes run failed before invoking the LLM because its input was `.html`, not
a PDF. Preproduction RAW passed parity and its API was rebound to OVH.

Preproduction DOCS now has exact OVH parity: **59,017 objects / 12,534,514,457
bytes**, canonical manifest SHA-256 `52646a7b…0425`, `failed=0`. Its MinIO
StatefulSet, Pod, Service, 40 Gi data PVC and six NetworkPolicies are removed;
the checkpoint/migration PVC is retained. The namespace storage quota moved
from four PVCs / 47 Gi to three PVCs / 7 Gi, while API, MCP and UI remain 1/1.
Production T2 is still in progress. These facts explain the gap between BEFORE
and AFTER without introducing another primary graph.

## 4. Fixed owner decisions and gates

The ratified order remains T1 refresh → T2 objects → T3 one node, with
preproduction before production. The DOCS canonical reference remains exactly
the initial production SCW set of 59,017 keys+hashes; the 85,176-object
preproduction surplus is not migrated. Immo retains PV pipeline ownership and
SCW TEM is retained until its replacement is validated.

T1 requires a valid PDF, provider completion, typed Signal/exact PDF,
idempotent replay and unattended schedule. Preproduction T2 has passed its
object parity and removal gate; production must independently pass the same
canonical manifest, recovery, fence, rebind and removal checks. T3 requires
production T2 completion, rightsizing, remeasured placement, a verified
two-node state, then one-node preproduction acceptance before production
authorization.

## 5. Rollback boundary

Object rollback restores an application-consistent set of canonical graph hash,
SQL checkpoint/version, evidence objects and input set. It never assumes a
cross-S3/SQL transaction or permits dual writers. Preproduction retains the
migration/checkpoint PVC as recovery evidence. In-progress production T2
authorizes no credential revocation or node reduction.

## 6. Explicit open questions

The Focus form presents each question before its selectable options and exports
the exact question, all options, the selected value and its comment as JSON.
Responses remain local drafts and do not alter fixed decisions.

1. **Which preproduction address should be the owner-facing entry point?** Keep
   the verified Immo URL; create a separate alias/portal; or defer.
2. **Should the future automation boundary remain limited to Immo, or include
   assisted Geo extraction?** Immo-only; coordinated Immo+Geo scope; or defer.
   This does not reopen Immo ownership of the PV pipeline.
3. **Should the audited LLM allocation be ratified, reconciled first, or remain
   indicative?** This question is explicitly **non-critical**. No answer leaves
   it open and non-blocking.

## 7. Rendered evidence and limits

Exactly two Mermaid sources are rendered as sanitized SVG and complete native
SvelteFlow. Nested boxes use `parentId`; service icons and repo labels are
mandatory for every node and group. Browser checks cover every node, edge and
subflow, full-graph fit, zoom, offline use, comments and actual clipboard JSON.

Known limits remain explicit: T1 has not reached provider acceptance,
production T2 is still in progress and T3 remains gated. Preproduction T2 is
not represented as completion of the full AFTER target.

## 8. Billing annex

The joined period is **2026-08-10 through 2026-09-13 inclusive**, 35 days / 840
hours, America/Toronto. Infrastructure is the fixed one-b3-8 BHS5 projection:
`840 × 0.082 = 68.88 CAD`; observed two/three-node costs remain excluded.

The deduplicated local session audit allocates 139.337732 CAD to immo and
111.877705 CAD to geo, or **251.215438 CAD LLM** and **320.095438 CAD** including
infrastructure. These are local allocations, not provider invoice lines. Until
the non-critical question is answered, the LLM amount remains indicative and
unratified.
