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
| T2 — remove MinIO and remaining SCW dependencies | `PP-RAW-OVH` parity + API rebind verified; DOCS bucket/Secret provisioned; inventories show PP 144,193/28.34 GB vs canonical PR 59,017/12,534,514,457 B; guarded copy tooling through `be362561` | Diff manifests; use exact PR 59,017 keys+hashes as canonical set; selectively copy to OVH prod/preprod; prove equality/recovery; then remove all MinIO; TEM excluded | **PARTIAL / IN PROGRESS**: RAW complete; DOCS copy/parity/rebind not complete; production migration outcome unknown |
| T3 — one OVH b3-8 | Three b3-8; service plan; 16 PVC/15 Cinder RWO inventory | Finish T2; rightsize; reconcile required affinity/PVC constraints; prove controlled two-node operation; only then test one-node preprod before production | **NO-GO today**: requests and required anti-affinity do not fit one node |

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

[FACT] Preproduction RAW has completed parity and the API is rebound to
`PP-RAW-OVH`; the old identity is fenced/recovery-only. DOCS inventories show
preprod MinIO at 144,193 objects / 28.34 GB and production SCW `docs-pocs` at
59,017 / 12,534,514,457 B. The OVH bucket and Secret are provisioned; guarded copy
tooling is committed on `chore/scw-final-sweep` through `be362561`.

[FACT · owner decision] The current production source is the exact initial
canonical reference. Both OVH prod and preprod must converge to the same 59,017
keys and hashes. The preprod surplus is non-canonical and must not be migrated.
Sequence: manifest diff → canonical set → selective copy → exact parity → recovery
proof → recoverable removal of all MinIO. Copy/parity/rebind are not complete;
the launched production migration has no reported outcome. TEM remains retained.

[FACT] The current platform audit measured three b3-8 nodes. One node exposes
1,840m CPU / 5,907.82 Mi allocatable; workload requests total 4,095m / 8,442 Mi,
while current pod memory is 5,273 Mi. Required CoreDNS, konnectivity and Traefik
anti-affinity cannot be satisfied on one node. Sixteen PVCs include 15 Cinder RWO.
T3 is **NO-GO today**: first complete T2, rightsize, reconcile constraints, then
prove a controlled two-node state before attempting one-node preprod acceptance.

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
