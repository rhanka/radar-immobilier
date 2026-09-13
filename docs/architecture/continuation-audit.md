# Refresh continuation evidence — 2026-09-13

This is a read-only handoff, not an implementation plan or release approval.

| Reference | Observed state | What it does not prove |
| --- | --- | --- |
| Immo main `097036783006226afea53a6b49383bf70890774f` | Current fetched main; storage audit at 12:33–12:37 UTC | Main is not the deployed image: preprod API/UI/MCP use `8e18f01` |
| [Immo #678](https://github.com/rhanka/radar-immobilier/pull/678), `ab98ce5b9abecdb2adaae8297431d78fd3cc1448` | OPEN DRAFT; CAS corpus ingestion, bounded extraction, candidate gates | No canonical publication, projection, PG write or deployment |
| [Graphify #330](https://github.com/rhanka/graphify/pull/330), `4866860f41934d743028e822b230e769ac06e766` | OPEN; checked after 12:50 UTC, new revision CI in progress | Neither merged nor proven published/accepted by Immo |
| [Graphify main](https://github.com/rhanka/graphify/tree/55a76769) | Version 0.17.2, mesh dependency ^0.1.0 | Not the proposed 0.18.0 consumer contract |
| [Immo #670](https://github.com/rhanka/radar-immobilier/pull/670), `ae129e1077c871faa115b425c920202a53bc186e` | OPEN DRAFT; remaining retirement work | Not proof that MinIO or all SCW use disappeared |

[FACT] #678's PR body reports a second **read-only dry run**: 40 cities,
139 verified documents, 330 LLM calls, 0 uploads; candidate Signal 93→413 and
DesignationEvent 191→511. These are the author's reported results, not a
reproduced run or current served-signal counts. The earlier local branch SHA
and unchecked plan qualification are not a substitute for this newer PR.

## Successive i-cond proposals

[FACT] Read-only local sources in the existing conductor lane:
`/home/antoinefa/src/radar-immobilier/.lanes/conductor/.remote/`.
They are working handoffs, not ratified specs or deployment evidence.

1. September 5 [full-auto design](https://github.com/rhanka/radar-immobilier/blob/6296396fed804cf9a3d4a6e031c452af57313357/docs/design/PIPELINE_FULLAUTO_CLUSTER_MESH.md):
   S3-DAG E1 acquisition, E2 detection, E3 grounding, E4 merge, E5 projection.
2. `REFRESH_E2E_CONCEPTION.md`: sequential checkpointed extraction, grounding,
   publish, project and 3.4 EMIT/APPLY; hybrid workstation initially, network
   mesh later. This proposal is not the latest integration boundary.
3. `ETUDE_GRAPHIFY_MESH.md`: Graphify as a **library with in-process mesh**
   inside the Immo pod; no separate network mesh service required. Immo owns
   S3 corpus materialization, input-set hashes, candidates, gates, checkpoints,
   guarded canonical publication and workload identity. Graphify owns provider
   composition, route plan/prepare/complete lifecycle and extraction adapters.

[FACT] The latest study proposes preserving Immo chat's mesh 0.1.2 initially:
no mesh instance/type crosses the Graphify consumer boundary. It proposes a
small first test (one city/document/chunk, no PG), followed by full projection
and 3.4 validation. The first test alone cannot prove a user-visible refresh.

[FACT] The proposed keyring uses writable encrypted files (including refresh
and permissions changes). A read-only Kubernetes Secret alone does not satisfy
that contract. Ephemeral private storage can support a bounded test; durable
credential refresh and its unique writer remain design/operations questions.
No credentials were read, copied or provisioned during this inspection.

## Graphify peer handoff and revision boundary

[FACT] At 12:47 UTC `codex:graphify:01a09ac48ec1` reported CI and package-install
tests green at #330's **older** `ed0bb7da` and three review fixes underway:
late cancellation, validation rejected before generation for a plain LlmMesh,
and fenced-JSON handling. Envelope `env:lot-c-icond-successor:1789303674215`.
The newer public SHA above had checks in progress; old green checks do not
attest the new revision.

[FACT] That peer reports an i-cond-accepted **ESM-only**
`@sentropic/graphify/llm-mesh` subpath (`types` + `import`, no `require`), four
runtime exports plus option types, with the root CJS entry preserved. Public
exports include `createGraphifyMesh`, `classifyRouteFailure`,
`meshTextJsonClient`, and `textClientToCallLlm`. The installed published package
and Immo integration still need acceptance on the final release SHA.

[FACT] The peer was informed of the owner's new gate: **no Immo B2 consumer
implementation, migration or deployment before the decision dossier**.
Envelope `env:architecture-owner-gate:1789303843856`.

## Unresolved facts, not permission to implement

- OVH production Immo runtime inventory remains RBAC-blocked; see the
  [storage audit](storage-audit.md). The old SCW cluster is excluded.
- API bucket contents and all writers are not inventoried: target bucket names,
  migration volume, retention and rollback duration must not be invented.
- Exact upstream release availability and cross-package tests remain gates.
- Served Signal freshness and PDF resolvability require separate end-to-end
  acceptance; scrape success, lowercase PG nodes and dry-run candidates do not
  establish either.
- Owner decision: retain SCW TEM until an explicitly validated replacement.
