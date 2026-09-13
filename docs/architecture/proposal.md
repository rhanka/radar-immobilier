# T1 detailed refresh pipeline — proposed, not deployed

[FACT] This is the current T1 design from the September 13 refresh handoff, not
the former Option A and not an observed deployment. It keeps the existing
preproduction MinIO API roles until T2. Graphify stays exactly 0.18.0; the PDF
contract name `immo-pv-extraction-v3` is not a 0.18.3 dependency version. At
Immo HEAD `ac3a7150`, targeted suites pass 8/8 + 7/7 and the full typecheck plus
scope/branch checks pass. Graphify fail-closes correctly; nested `UND_ERR_SOCKET`
belongs to the llm-mesh 0.19.0 normalizer. Its delegated 0.19.1 patch is unpublished.
The preprod success path is GO_WITH_GATES; unattended/retry/production is NO-GO
before 0.19.1. Real-provider Signal and Kubernetes acceptance remain open.

```mermaid
flowchart LR
  municipal["Municipal PV / CAS documents"]
  subgraph immo_target["T1 · IMMO-owned refresh · PROPOSED / NOT DEPLOYED"]
    acquire["1 Acquire + parse<br/>CAS bytes, original page map, immutable input manifest"]
    subgraph llm_target["2 Profile extraction + grounding · Immo hosts Graphify 0.18.0"]
      materialize["Materialize checked S3 inputs<br/>stable document/page mappings"]
      graphify["Graphify 0.18.0 + llm-mesh 0.19.0<br/>0.19.1 normalizer patch unpublished"]
      evidence["Validate profile + grounding<br/>schema, source, page, excerpt before success"]
      materialize --> graphify
      graphify --> evidence
    end
    candidate["3 Preserved fresh candidate<br/>complete baseline + stable IDs + manifest/hash receipts"]
    post["4 Deterministic 3.4 on FRESH candidate<br/>before canonical publication"]
    publish["5 Guarded full-graph publish<br/>one canonical writer · archive + expected ETag"]
    project["6 Atomic PG projection<br/>same validated canonical bytes · resumable callback"]
    served["7 Typed Signal + exact PDF proof<br/>immo-pv-extraction-v3 · API/UI acceptance · idempotent rerun"]
    acquire --> materialize
    evidence --> candidate
    candidate --> post
    post --> publish
    publish --> project
    project --> served
  end
  PP_GRAPH[("[PP-GRAPH] same existing OVH bucket<br/>corpus + candidates + canonical graph roles")]
  PP_DB[("[PP-DB] same preprod PostgreSQL<br/>atomic projection target")]
  PP_API["[PP-API] same preprod API<br/>Signal / DesignationEvent + evidence reader"]
  PP_UI["[PP-UI] same preprod UI<br/>visible Signal + PDF viewer"]
  PP_MCP["[PP-MCP] same OAuth remote MCP"]
  subgraph ppminio["[PP-MINIO] existing API store · retained until T2"]
    PP_RAW[("[PP-RAW] existing MinIO raw role")]
    PP_DOCS[("[PP-DOCS] empty MinIO fallback")]
    PP_DOCS_LEGACY[("[PP-DOCS-LEGACY] useful replay/history<br/>retained for T2 parity + recovery")]
  end
  GEO_S3[("[GEO-S3] Geo-owned corpus<br/>mapped raw/pv-index/cas/ evidence")]
  PP_GEO["[PP-GEO] Geo geographic API<br/>input contract; Geo owns geographic data"]
  credentials["OPEN acceptance · durable keyring + lock<br/>scheduled/manual exclusion, refresh/restart/recovery"]
  providers["LLM providers<br/>explicit owner scope / model policy"]
  municipal --> acquire
  acquire -->|"WRITE immutable corpus/state"| PP_GRAPH
  materialize -->|"READ selected corpus"| PP_GRAPH
  publish -->|"Guarded WRITE complete graph"| PP_GRAPH
  project -->|"READ published canonical bytes"| PP_GRAPH
  project -->|"Atomic WRITE"| PP_DB
  PP_API -->|"READ typed graph"| PP_DB
  PP_API -->|"READ exact mapped PDF"| GEO_S3
  PP_API -->|"READ/WRITE · unchanged through T1"| PP_RAW
  PP_API -->|"Legacy READ · unchanged through T1"| PP_DOCS
  PP_API -->|"READ OGC / geographic input"| PP_GEO
  PP_UI -->|"Application"| PP_API
  PP_MCP -->|"Authorized tools"| PP_API
  graphify -.->|"Requires operated identity"| credentials
  graphify -->|"plan / prepare / complete"| providers
  served -.->|"Must prove scheduled Job, not job-green proxy"| credentials
```

[JUDGMENT] The preproduction ladder is installed-package → consumer/integration
tests → one real typed Signal with exact PDF → unattended schedule after pod
replacement and credential refresh. Only then may a separately gated production
promotion begin. No version bump, manual Job success or nonempty graph substitutes
for those acceptance levels. The workstation becomes optional enrollment/admin,
not a routine T1 runtime.
