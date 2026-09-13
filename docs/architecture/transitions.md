# Architecture transition register

Owner direction, September 13, 2026: execute the existing work **refresh first,
MinIO second, one-node Kubernetes third**, as soon as the corresponding acceptance
checks pass. The earlier presentation-only hold is superseded. The dossier follows
execution; it is not a request to vote again on those three objectives.

## Reference and update contract

- Before-state source: `docs/architecture.md`; the effective transition snapshot
  plus the two after targets are in `docs/architecture/transitions-target.md` and the
  detailed T1 causal boundary is in `docs/architecture/proposal.md`.
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
| T1 — autonomous PV → Signal cron | Graphify 0.18.0 integrated; Luna high selected; K8s validation launched | Re-run with an actual PDF; prove provider completion, typed Signal + exact PDF, idempotent replay and unattended schedule | **IN VALIDATION**: first K8s run failed before the LLM because the supplied object was `.html`, not PDF; no T1 acceptance yet |
| T2 — remove MinIO and remaining SCW dependencies | Preprod RAW rebind plus canonical DOCS parity accepted: 59,017 objects / 12,534,514,457 B, manifest `52646a7b…0425`, failed 0; MinIO workload/service/data PVC and six NetworkPolicies removed; checkpoint PVC retained | Complete the independently gated production copy, parity/recovery, rebind and MinIO removal; TEM excluded | **PREPROD ACCEPTED / PRODUCTION IN PROGRESS** |
| T3 — one OVH b3-8 | Preprod cleanup reduced storage quota use from 4 PVC/47 Gi to 3 PVC/7 Gi; API/MCP/UI remain 1/1 | Finish production T2; remeasure requests and placement; prove controlled two-node operation; only then test one-node preprod before production | **GATED**: no node reduction before T2 production acceptance and a fresh capacity proof |

[FACT] Graphify producer confirms **0.18.0 published**, tag `v0.18.0`, merge
`1a723695d8a23ffe5e13f1988c52ded056f85c96`; exact-version installation and ESM/CJS
contract tests passed on the producer side. H2A envelope
`env:graphify-018-final:1789306808055`, 13:40 UTC. This closes the publication
dependency, not the Immo consumer acceptance. Earlier open-PR references are dated
history, not current release status.

[FACT] Graphify remains exactly 0.18.0 and `immo-pv-extraction-v3` remains an
internal contract name. Luna high is the selected model. A first Kubernetes run
was executed, but the selected object was `.html` while the contract requires a
PDF; execution therefore failed **before the LLM was called**. This proves the
workload reached input validation, not provider completion or T1 acceptance.

[FACT · owner correction] Keep llm-mesh 0.19.0. A rare nested `UND_ERR_SOCKET`
fails the Job closed; durable state is resumed at the next cycle. No corruption or
in-process retry is claimed. The 0.19.1 need is judged probably false and not prioritized:
cross-repository implementation is unauthorized, PR #585 is closed and its branches
are removed. Diagnosis is deferred to `s-conductor`, with no implementation request.

[FACT · gate] The next run must use a valid PDF and prove provider completion,
typed Signal + exact PDF, idempotent replay and unattended scheduling. The Luna
high selection does not waive any of those acceptance gates.

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

[FACT] Preproduction RAW remains rebound to `PP-RAW-OVH`. The canonical DOCS
copy into OVH now passes exact parity at **59,017 objects / 12,534,514,457
bytes**, canonical manifest SHA-256 `52646a7b…0425`, with `failed=0`. This is the
owner-selected production-reference set; the former 144,193-object preprod
population and its surplus were not promoted as canonical.

[FACT · owner decision] The current production source is the exact initial
canonical reference. Both OVH prod and preprod must converge to the same 59,017
keys and hashes. The preprod surplus is non-canonical and must not be migrated.
Sequence: manifest diff → canonical set → selective copy → exact parity →
recovery proof → recoverable removal of MinIO. Preproduction completed this
gate: StatefulSet, Pod, Service, 40 Gi data PVC and six MinIO NetworkPolicies
were removed. The checkpoint/migration PVC remains; quota usage moved from four
PVCs / 47 Gi to three PVCs / 7 Gi; API, MCP and UI remain 1/1. Production is
still executing its separately gated T2 transition. TEM remains retained.

[FACT] The pre-T2 platform audit measured three b3-8 nodes. One node exposes
1,840m CPU / 5,907.82 Mi allocatable versus 4,095m / 8,442 Mi requested before
the preprod MinIO removal; required CoreDNS, konnectivity and Traefik
anti-affinity were also incompatible with one node. T3 remains **GATED**: finish
production T2, remeasure the post-cleanup workload/PVC baseline, reconcile
constraints, then prove a controlled two-node state before one-node preprod.

## Requested report period and billing-last direction

[FACT] The last cost report merged on `origin/main` ends August 9. The joined
window is therefore **August 10 through September 13 inclusive**, America/Toronto:
`2026-08-10T00:00:00-04:00` to `2026-09-14T00:00:00-04:00`, 35 days / 840 hours.
This is a repository-report boundary; no claim is made about an external invoice
that is absent from the repository.

[FACT · owner] Billing comes last. The infrastructure basis is exactly one b3-8
BHS5 projection at `0.082 CAD/h`: `840 × 0.082 = 68.88 CAD`. The observed two-
and three-node cluster costs are platform pass-through/internal costs and are not
billable in this projection.

[FACT · owner] LLM allocation retains the preceding report method and unit basis:
two Claude seats and one ChatGPT Pro seat at 200 USD/month each, measured seven-
day provider capacity, USD→CAD 1.37 and LLM margin ×1.15. The dated token audit
records actual window totals and deduplication; it is an allocation calculation,
not a provider invoice line.
