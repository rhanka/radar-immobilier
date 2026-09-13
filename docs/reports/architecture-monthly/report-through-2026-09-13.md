# Architecture and reporting companion — through September 13, 2026

Status: D5 evidence companion, **not** an invoice, final delivery total, owner
signature, deployment record or replacement for preserved source reports.

## 1. Requested period and capture cutoffs

- Timezone: America/Toronto.
- Requested start: the real preceding invoice/report boundary, **unverified**.
- Requested end: September 13 inclusive (`2026-09-14T00:00:00-04:00` exclusive).
- Architecture capture cutoff: last cited live check `2026-09-13T12:37:00Z`.
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
| Existant | Preprod API uses MinIO `PP-RAW`/`PP-DOCS`; refresh uses same OVH `PP-GRAPH`; same `PP-DB`; Geo PDF corpus is separate. Prod access observed; private bindings unavailable. | None inferred from production source defaults. |
| T1 | Graphify 0.18.0 published; refresh design and CAS work available. | In-pod host mesh 0.19 integration, durable keyring/lock, full fresh candidate→3.4→guarded graph→atomic PG path, typed Signal/PDF and scheduled acceptance. |
| T2 | Preprod refresh graph binding is already OVH; API MinIO and executable SCW residue remain evidenced. | New `PP-RAW-OVH`/`PP-DOCS-OVH` roles, reader/writer parity, fencing, recovery, zero-consumer retirement, separately inventoried prod, final SCW sweep; TEM retained. |
| T3 | Three b3-8 nodes; ~9,454 Mi instantaneous memory; 5,907.82 Mi allocatable per node; MinIO ~347 Mi. | One existing b3-8 for Immo+Geo only after full peak/requests/affinity/PDB/PVC/drain acceptance. |

## 4. Complete final target

The proposed end state contains prod/preprod Immo URLs and SSO, Immo UI/API/MCP,
PG, autonomous refresh, OVH graph/corpus and distinct OVH API raw/document roles.
It contains Geo APIs, the geographic DB role with uncertain API dependency, OVH
raw/normalized products, PV/zoning/regulation/lot/environment sources and
in-process joins. The workstation is optional enrollment/admin only. MinIO and
all active Scaleway dependencies are absent except retained SCW TEM. Production
private bindings are target roles marked TBD/UNVERIFIED, not observed facts.

## 5. Transition gates and limits

Preproduction precedes production for every transition. T1 requires a real fresh
typed Signal with exact PDF, idempotent resume and unattended schedule after pod
and credential refresh. T2 requires full parity, writer fence, real-client tests,
paired object/DB recovery, retention and zero consumers before deletion. T3
requires the complete shared peak and one-node safety/placement proof.

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
