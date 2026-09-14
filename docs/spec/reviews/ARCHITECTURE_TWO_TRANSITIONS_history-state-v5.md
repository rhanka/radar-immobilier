---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v5
target-diff-sha256: cb8b5671e5efbffac0ce094e6ac9001bc25fc3bef4acd9f1c8801e8065408528
lens: historical and runtime-state correctness across both dated pairs
---

# Independent review v5 — history and state

## Evidence reviewed

The SHA-256 of `git diff -- docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md plan/ARCH2-BRANCH_docs-architecture-two-transitions.md` is exactly `cb8b5671e5efbffac0ce094e6ac9001bc25fc3bef4acd9f1c8801e8065408528`.

I reviewed only those two changed plan files and this assigned review file. I did not read the sibling v5 review or any consensus artifact.

## Findings

### H1 — High — the August A topology still represents unobserved manifest relations as active/observed graph facts

The stated correction for cycle v3 was to “make August manifest relations uniformly declared” (`plan/ARCH2-BRANCH_docs-architecture-two-transitions.md:25`). The EVOL instead gives A-before a mixed and misleading state encoding:

- D1 says the August anchors reconstruct declarations rather than runtime inventory and that commit time is not an operational observation (`SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md:13-18`).
- D2 likewise limits the August evidence to declared manifests and expressly excludes proof of secret resolution, traffic, completed refresh, or successful mirroring (`:22`).
- Yet the A-before container is labelled `OVH BHS5 · production · 2 b3-8 observed` and its ingress-to-UI/SSO, UI-to-API/Geo, API-to-DB, and SSO relations are solid (`:100-115`). The graph contract says a solid edge expresses a “documented dependency” (`:91-93`), but provides no visible `declared` qualifier for those August executable relations. Only selected storage, registry, and TEM edges are dashed and explicitly labelled declared (`:104`, `:117-123`, `:126`).

This cannot meet the prior finding's *uniformly declared* requirement: a reader can reasonably infer an active August serving/data-path graph from the solid edges and the word “observed”, despite the evidence register limiting S2/S3 to configuration plus a platform observation (`:382-384`). The issue is material to the historical before/after comparison because the A-after graph is explicitly a September runtime-cutover receipt (`:156`), so the pair currently compares a partly implied runtime topology with an observed runtime topology.

Required correction: assign an explicit, visible evidence class to every A-before node and relation from the August manifests, and render each manifest-only relation as `declared` (including the application, ingress, SSO, UI/API, API/database, and Geo-serving relations) rather than letting solid styling carry an ambiguous operational meaning. Preserve the narrowly observed platform fact separately, with the source and scope that support it. The canonical Mermaid, native scene projection, PDF caption, and acceptance assertions must encode the same distinction.

### H2 — Medium — canonical topology parity does not include the state semantics that distinguish the dated graphs

The proposed canonical projection serializes only `id,label,evidenceClass,parentId,repo` for nodes and `id,source,target,label,dashed,both` for edges (`SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md:46`). It omits an edge evidence class/state. That omission permits an implementation to satisfy the reference/Focus/PDF topology hash while changing an August edge from `declared` to `observed` (or otherwise changing its evidence semantics) as long as its endpoints, label, and dashed boolean remain unchanged. It also makes the required H1 correction non-verifiable across the three surfaces.

A dashed flag is not a state model: D4 permits labels **or** dashed styles for dormant/declared edges (`:42`), and the contracts use dashed lines for several distinct meanings—declared bindings, suspended scheduling, dormant execution, and manual launch (`:104`, `:175-178`, `:197-213`). A label is presentation text rather than a normalized evidence-state value.

Required correction: make edge evidence class (and, where applicable, runtime state such as suspended/dormant) a required canonical field with a closed vocabulary; reconstruct it from both Mermaid and native DOM; include it in the per-scene hash and PDF manifest; and test divergent state despite identical endpoints/labels. This is necessary for the two dated pair graphs to remain historically truthful, not merely topologically identical.

## Requirement check

The amendment does address several prior blockers: it defines four dated scenes and pair separation; keeps Pair B provider-neutral; makes B-after visibly production-dormant with a separate preproduction annotation; retains TEM visibly and outside the Pair-B extraction chain; uses the exact `Navigateur utilisateur` label; preserves Sonnet comparability and credential hygiene; prevents Gemini no-output from becoming a result; supplies finite attempt states, output-bearing-attempt/result bijection, invalid fixtures, the exact 10 August–13 September window, and the attachment/page-render requirements. It also specifies native/Mermaid metrics and PDF minima.

Those improvements do not cure H1 or H2. In particular, the asserted v3 remedy is contradicted by the current A-before visual/state contract, and the parity hash cannot detect that contradiction when rendered elsewhere.

## Verdict

**CHANGES REQUIRED. Implementation may not start.**

Resolve H1 and H2, then subject the amended exact diff to a fresh independent review cycle.
