# Option A — proposed execution boundary

[JUDGMENT] This is an option, not an active deployment. The current application
still reads MinIO. Replacement OVH API buckets and durable credential operations
are intentionally unresolved until the inventory and owner recovery criteria exist.
Source: [decision dossier](decision-dossier.md), [continuation audit](continuation-audit.md).

```mermaid
flowchart LR
  municipal["Municipal PV / CAS documents"]
  subgraph immo_target["PROPOSED · IMMO-owned refresh Job · checkpointed"]
    acquire["1 Collect + 2 parse/exploit<br/>Immutable document-set manifest"]
    subgraph llm_target["3 Interpret / ground · Immo consumer of Graphify library"]
      materialize["Immo · S3 materialization<br/>Document and input-set hashes"]
      graphify["Graphify 0.18.0 candidate<br/>In-process mesh 0.19 · ESM subpath"]
      evidence["Immo · extraction / grounding gates<br/>Source, page, citation, schema"]
      materialize --> graphify
      graphify --> evidence
    end
    publish["Immo · guarded canonical writer<br/>Exclusive publisher / checkpoint"]
    project["4 Atomic projection<br/>Exclusive PG writer at validated cutover"]
    post["Immo · 3.4 EMIT then APPLY<br/>APPLY recomputes from PG"]
    acquire --> materialize
    evidence --> publish
    publish --> project
    project --> post
  end
  PP_GRAPH[("[PP-GRAPH] Existing OVH refresh bucket<br/>Corpus and canonical prefixes remain distinct roles")]
  PP_DB[("[PP-DB] Same preprod PostgreSQL<br/>No new Graphify database")]
  PP_API["[PP-API] Same preprod API<br/>Typed Signals / evidence reader"]
  PP_UI["[PP-UI] Same preprod UI<br/>Visible findings + PDF proof"]
  GEO_S3[("[GEO-S3] Shared Geo corpus<br/>Mapped raw/pv-index/cas/ evidence")]
  credentials["OPEN · credential operations<br/>Writable keyring, unique refresh owner, recovery"]
  providers["LLM providers<br/>Explicit routing subject / bounded retries"]
  municipal --> acquire
  acquire -->|"WRITE corpus"| PP_GRAPH
  materialize -->|"READ selected corpus"| PP_GRAPH
  publish -->|"WRITE graph only after gates"| PP_GRAPH
  project -->|"READ graph"| PP_GRAPH
  project -->|"Atomic WRITE"| PP_DB
  post -->|"READ and guarded reproject"| PP_DB
  post -->|"Guarded canonical WRITE"| PP_GRAPH
  graphify -.->|"Requires operated identity"| credentials
  graphify -->|"plan / prepare / complete"| providers
  PP_API -->|"READ Signal / DesignationEvent"| PP_DB
  PP_API -->|"Mapped PDF READ; coverage gate"| GEO_S3
  PP_UI -->|"Read application"| PP_API
```

[JUDGMENT] No service mesh network component is required by this option. The
keyring box denotes an unresolved contract, not a newly selected secret service.
The existing MinIO API roles must be inventoried and migrated separately; this
refresh diagram does not assert their removal or choose their replacement buckets.
