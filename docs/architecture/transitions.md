# Architecture transition register

Owner direction, September 13, 2026: execute the existing work **refresh first,
MinIO second, one-node Kubernetes third**, as soon as the corresponding acceptance
checks pass. The earlier presentation-only hold is superseded. The dossier follows
execution; it is not a request to vote again on those three objectives.

## Reference and update contract

- Canonical current-state source: `docs/architecture.md`; the three proposed
  platform states are in `docs/architecture/transitions-target.md` and the
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
| T1 — autonomous PV → Signal cron | Immo CAS #678; four-stage pipeline; canonical writer; projection; 3.4 EMIT/APPLY; existing CronJobs | Publish/adopt llm-mesh 0.19.1; prove a real-provider Signal via `immo-pv-extraction-v3`; durable identity; CronJob-created Job and schedule | **GO_WITH_GATES** preprod success; **NO-GO** unattended/retry/prod before 0.19.1; no provider/K8s acceptance |
| T2 — remove MinIO and remaining SCW dependencies | #677 OVH refresh bindings; live API `PP-RAW`; empty `PP-DOCS`; useful `PP-DOCS-LEGACY`; #671/#672 GHCR work | Complete the `25ec9e04` fail-before-write suite and conditional-write capability; copy + integrity + recovery; fence/repoint/test; retain legacy until complete parity/recovery; close SCW except TEM | **MIGRATE+RETAIN** decided; remediation underway, not accepted; no copy, cutover or deletion |
| T3 — one OVH b3-8 | Three b3-8; service plan; 16 PVC/15 Cinder RWO inventory | Finish T2; rightsize; reconcile required affinity/PVC constraints; prove controlled two-node operation; only then test one-node preprod before production | **NO-GO today**: requests and required anti-affinity do not fit one node |

[FACT] Graphify producer confirms **0.18.0 published**, tag `v0.18.0`, merge
`1a723695d8a23ffe5e13f1988c52ded056f85c96`; exact-version installation and ESM/CJS
contract tests passed on the producer side. H2A envelope
`env:graphify-018-final:1789306808055`, 13:40 UTC. This closes the publication
dependency, not the Immo consumer acceptance. Earlier open-PR references are dated
history, not current release status.

[FACT] The earlier H2A progress envelope `env:d5-live-progress-20260913T1539`
reported dependency commit `d0595d9f`; the follow-up reaches Immo HEAD `ac3a7150`.
Graphify remains exactly 0.18.0 and fail-closes correctly; `immo-pv-extraction-v3`
is an internal contract name, not version 0.18.3. Targeted suites pass 8/8 + 7/7,
and the full typecheck plus scope/branch gates pass. Nested `UND_ERR_SOCKET` is
confirmed in the llm-mesh 0.19.0 normalizer, not Graphify; a delegated 0.19.1 patch
is not yet published. The preprod success path is **GO_WITH_GATES**; unattended,
retry and production remain **NO-GO** before 0.19.1. No provider/K8s acceptance exists.

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

[FACT] The live API uses MinIO `PP-RAW`; its derived `PP-DOCS` bucket is empty.
The distinct `PP-DOCS-LEGACY` bucket has baseline 1/2,821,583 B, graph 4/639,226 B,
ontology 530/34,257,805 B, parsed ≥4,884/≥272,554,144 B, raw unknown and runs ≥445.
Fable's postbuild review keeps fail-before-write and conditional-write capability
remediation blocking. Commit `25ec9e04` starts fail-before-write; its suite and the
conditional-write capability remain in progress. **MIGRATE+RETAIN** applies until
complete parity and recovery; no copy, cutover or deletion has started, and TEM remains retained.

[FACT] The current platform audit measured three b3-8 nodes. One node exposes
1,840m CPU / 5,907.82 Mi allocatable; workload requests total 4,095m / 8,442 Mi,
while current pod memory is 5,273 Mi. Required CoreDNS, konnectivity and Traefik
anti-affinity cannot be satisfied on one node. Sixteen PVCs include 15 Cinder RWO.
T3 is **NO-GO today**: first complete T2, rightsize, reconcile constraints, then
prove a controlled two-node state before attempting one-node preprod acceptance.

## Requested report period and billing-last direction

[FACT · owner] The requested period starts at the **real preceding invoice/report
boundary**, still unverified, and ends September 13 inclusive, America/Toronto
(`2026-09-14T00:00:00-04:00` exclusive). Record the actual evidence capture cutoff
separately because the current September 13 day is incomplete. T1/T2/T3 work on
September 13 is inside the requested period and must be classified observed versus
planned, not moved to a post-period section.

[FACT · owner] Billing comes last. The infrastructure basis is one b3-8 BHS5
projection at the observed `0.082 CAD/h`; period hours and projected amount are
unknown until the start is verified. `720 h / 59.04 CAD` is an old 30-day
illustration only, never the current-period amount.

[FACT · owner] Count LLM tokens later with the **same unit tariffs as the previous
month's actual invoice**. First identify that invoice and its tariffs. Do not open
a DIRECT/USAGE/CAPACITY allocation choice, infer D4's null option or parse tokens
in this docs build. Earlier reports and Wave examples remain evidence, not proof
of the latest invoice boundary or price.
