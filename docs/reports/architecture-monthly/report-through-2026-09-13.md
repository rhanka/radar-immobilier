# Architecture and reporting companion — through September 13, 2026

Status: D5 evidence companion, **not** an invoice, final delivery total, owner
signature, deployment record or replacement for preserved source reports.

## 1. Requested period and capture cutoffs

- Timezone: America/Toronto.
- Requested start: the real preceding invoice/report boundary, **unverified**.
- Requested end: September 13 inclusive (`2026-09-14T00:00:00-04:00` exclusive).
- Prior timestamped runtime check: `2026-09-13T15:38:00Z`.
- Prior timestamped T1 implementation progress: `2026-09-13T15:39:00Z`.
- Follow-up T1/T2/T3 state: dated September 13; exact UTC cutoff **not supplied**.
- Unified delivery/token/billing cutoff: **not frozen or verified**; September 13
  is incomplete in the available evidence.
- Owner correction captured `2026-09-13T15:10:18.423Z`; this is provenance of
  the instruction, not the data capture cutoff.

The September 13 transitions are inside the requested period. They are classified
below as observed evidence versus planned target work; neither classification
changes the still-unverified start or invents a full-day total.

## 2. Architecture first

The dated [portable Focus rendering](architecture-transition-2026-09-13.html)
opens on the **complete final target** and exposes the selectable path
**Existant → T1 refresh → T2 objets OVH → T3 cible 1 nœud**. Every transition is
rendered from committed Mermaid into both a complete nested native SvelteFlow and
a sanitized Mermaid SVG. All four existing detailed views remain accessible.

Canonical sources: [current state](../../architecture.md), [three target
states](../../architecture/transitions-target.md), [T1 causal detail](../../architecture/proposal.md),
[transition register](../../architecture/transitions.md) and [D5 dossier](../../architecture/decision-dossier.md).

## 3. September 13 transitions — observed versus planned

| State | Observed in available September 13 evidence | Planned / not deployed |
| --- | --- | --- |
| Existant | API uses MinIO `PP-RAW`; `PP-DOCS` fallback is empty; distinct `PP-DOCS-LEGACY` has useful replay/history. Refresh uses OVH `PP-GRAPH`; prod private bindings remain unavailable. | No production symmetry inferred. |
| T1 | Fable BLOCK at `ac3a7150`; fixes `537b9e0c` + `3d9ed43c`; scoped 34/34, integration 4/4 and typecheck pass. | **BLOCKED** while Fable re-review runs. Before real extraction, benchmark historical/manual and v1/v2/v3 on five PDFs with non-simulated runs. Model unselected, Cloud Code not enrolled, no scores, provider Signal or K8s acceptance. |
| T2 | Legacy inventory unchanged; remediation reaches `ee84ae29` / `f2ac3825` / `c30467ca` / `cef6d7ed`; checkpoint work at `aaf0cbf7` / `91242223`. | **MIGRATE+RETAIN**; checkpoint mechanism under construction. No object copy; parity, recovery and cutover remain open; TEM retained. |
| T3 | Three b3-8; one allocatable 1,840m/5,907.82 Mi; requests 4,095m/8,442 Mi; pods 5,273 Mi; 16 PVC/15 Cinder RWO; required anti-affinity incompatible. | **NO-GO today**. Complete T2, rightsize, reconcile constraints, verify two nodes, then test one. |

## 4. Complete final target

The proposed end state contains prod/preprod Immo URLs and SSO, Immo UI/API/MCP,
PG, autonomous refresh, OVH graph/corpus and distinct OVH API raw/document roles.
It contains Geo APIs, the geographic DB role with uncertain API dependency, OVH
raw/normalized products, PV/zoning/regulation/lot/environment sources and
in-process joins. The workstation is optional enrollment/admin only. MinIO and
all active Scaleway dependencies are absent except retained SCW TEM. Production
private bindings are target roles marked TBD/UNVERIFIED, not observed facts.

## 5. Transition gates and limits

Preproduction precedes production for every transition. T1 requires Fable re-review,
the neutral five-PDF non-simulated benchmark, a real fresh typed Signal with exact
PDF and K8s retry/schedule acceptance. T2 requires completed checkpoint/writer safety, full parity,
paired recovery and retention. T3 requires T2, rightsizing, reconciled placement,
a verified two-node step, then one-node preprod safety before production.

No T1/T2/T3 deployment, object copy, deletion, credential action, cluster change
or billing calculation occurred in this documentation build.

## 6. Billing annex — last and unresolved

The strongest preceding local cost report is
`docs/reports/couts-2026-07-13_2026-08-09.md`: it nominally ends August 9 and was
generated August 9 with partial-day data. It is not proof of the last actual
invoice or of the requested period start. `methode-unites-facturation.md` refers
to older Wave 250804-028 (June 8–July 5); it is not proof of the latest tariff.

- Infrastructure: one b3-8 BHS5 projection at `0.082 CAD/h`; period hours and
  projected amount are unknown until the real start is verified.
- `720 h / 59.04 CAD` is an old 30-day illustration only, never the current amount.
- LLM: later count tokens with the **same unit tariffs as the previous month's
  actual invoice**, once that invoice and its tariffs are identified.
- No DIRECT/USAGE/CAPACITY choice, token parsing, allocation method or final amount
  is requested or inferred by D5.

## 7. Replay

```sh
make -f docs/architecture/focus/Makefile test build browser clipboard ENV=test-architecture
```

Preview: `http://127.0.0.1:5188/`. The build uses the existing Sentropic Focus
kit read-only and starts no application stack.
