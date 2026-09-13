# T1 detailed refresh pipeline — implemented, acceptance in progress

[FACT] This is the implemented T1 path under acceptance on September 13. Graphify
stays exactly 0.18.0; the PDF contract name `immo-pv-extraction-v3` is not a
0.18.3 dependency version. Luna high is selected through llm-mesh. The first
Kubernetes run failed before invoking the LLM because the chosen input object was
`.html`, while the extraction profile requires PDF. That result proves input
validation and fail-closed behavior only: provider completion, a typed Signal,
the exact PDF and unattended scheduling remain open.

```mermaid
flowchart LR
  municipal["Municipal PV / CAS documents"]
  subgraph immo_target["T1 · IMMO-owned refresh · IMPLEMENTED / ACCEPTANCE OPEN"]
    acquire["1 Acquire + parse<br/>CAS bytes, original page map, immutable input manifest"]
    subgraph llm_target["2 Profile extraction + grounding · Immo hosts Graphify 0.18.0"]
      materialize["Materialize checked S3 inputs<br/>stable document/page mappings"]
      graphify["Graphify 0.18.0 + llm-mesh<br/>Luna high selected · first run did not reach LLM"]
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
  subgraph ppminio["[PP-MINIO] document/history store · retained until T2 gates"]
    PP_RAW[("[PP-RAW] old raw identity · recovery only")]
    PP_DOCS[("[PP-DOCS] empty MinIO fallback")]
    PP_DOCS_LEGACY[("[PP-DOCS-LEGACY] useful replay/history<br/>retained for T2 parity + recovery")]
  end
  PP_RAW_OVH[("[PP-RAW-OVH] active API raw role<br/>parity + rebind verified")]
  GEO_S3[("[GEO-S3] Geo-owned corpus<br/>mapped raw/pv-index/cas/ evidence")]
  PP_GEO["[PP-GEO] Geo geographic API<br/>input contract; Geo owns geographic data"]
  credentials["OPEN acceptance · durable keyring + lock<br/>scheduled/manual exclusion, refresh/restart/recovery"]
  providers["Luna high<br/>selected provider path · not reached on first run"]
  municipal --> acquire
  acquire -->|"WRITE immutable corpus/state"| PP_GRAPH
  materialize -->|"READ selected corpus"| PP_GRAPH
  publish -->|"Guarded WRITE complete graph"| PP_GRAPH
  project -->|"READ published canonical bytes"| PP_GRAPH
  project -->|"Atomic WRITE"| PP_DB
  PP_API -->|"READ typed graph"| PP_DB
  PP_API -->|"READ exact mapped PDF"| GEO_S3
  PP_API -->|"READ/WRITE after RAW cutover"| PP_RAW_OVH
  PP_API -->|"Legacy READ · unchanged through T1"| PP_DOCS
  PP_API -->|"READ OGC / geographic input"| PP_GEO
  PP_UI -->|"Application"| PP_API
  PP_MCP -->|"Authorized tools"| PP_API
  graphify -.->|"Requires operated identity"| credentials
  graphify -->|"plan / prepare / complete"| providers
  served -.->|"Must prove scheduled Job, not job-green proxy"| credentials
```

[JUDGMENT] Correct the input selection to a real PDF, then require a traceable
provider completion, one real typed Signal with its exact PDF, idempotent replay
and unattended schedule after pod replacement and credential refresh. Only then
may a separately gated production promotion begin. Model selection or a started
Job does not substitute for those acceptance levels. The workstation remains
available for administration/fallback until T1 is accepted.
