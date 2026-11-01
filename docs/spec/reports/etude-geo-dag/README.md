# Study: radar PV scraping and signal detection moved to a geo DAG

Durable copy of the immo conductor study of 2026-10-31. Its geo counterpart is
[geo ADR-0035](https://github.com/rhanka/geo/pull/427), status `proposed`, which fixes the split, the
`exports/immo/pv-signals/v1/` contract and the lot gates (L0 to L8). Nothing here is ratified: ADR-0035
flips to `accepted` only on an owner-direct record.

| File | Content |
|---|---|
| [`consensus-v3.md`](consensus-v3.md) | Reference text: decisions C1-C3 and G1-G7, facts checked on origin/main, target architecture, lots L0-L8, risks, the single owner decision |
| [`proposition-opus.md`](proposition-opus.md) | Independent proposal 1 (French), input to the consensus |
| [`proposition-muse.md`](proposition-muse.md) | Independent proposal 2 (French), input to the consensus |
| [`requests-cluster-mesh.md`](requests-cluster-mesh.md) | Function requests F-CM1 to F-CM8 to `@sentropic/cluster-mesh` and `llm-gateway` |
| [`requests-engram.md`](requests-engram.md) | Function requests F-EN1 to F-EN9 to `@sentropic/engram` |

Not copied: consensus v1 and v2 (superseded by v3). The request files cite `consensus-v2.md` as their
context; v3 keeps the same requests and adds the geo review (G1-G7).

Radar documents amended to point at ADR-0035: `docs/architecture.md` (Immo chain E1-E5 paragraph) and
`docs/spec/SPEC_EVOL_REFRESH_018.md` (decision 1). Until ratification and the lot gates, `radar-refresh-pv`
stays the running PV chain.
