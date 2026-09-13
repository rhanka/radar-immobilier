# Sequential target architecture — T1 → T2 → T3

Revision D5, 2026-09-13. These are **proposed, not deployed** states. The
unchanged IDs identify the same logical or physical resource between views. A
production role marked `binding TBD` is a target contract, not observed runtime.
The transition order is fixed; each stage still requires preproduction evidence
before a separately gated production promotion.

## T1 — autonomous refresh, existing storage retained

T1 removes routine workstation execution from the PV-to-Signal path. It keeps
the verified preproduction MinIO API bindings until T2 and does not infer the
unobservable production bindings. The detailed causal pipeline is in
[`proposal.md`](proposal.md).

```mermaid
flowchart TB
  subgraph T1_CARD["T1 · PROPOSED / NOT DEPLOYED · stage card"]
    T1_CHANGE["CHANGES<br/>In-pod Immo refresh: fresh candidate → deterministic 3.4 → guarded graph → atomic PG"]
    T1_KEEP["KEPT<br/>PP-DB, PP-GRAPH, API/UI/MCP, Geo evidence and MinIO API roles"]
    T1_REMOVE["REMOVED<br/>Routine workstation LLM and parallel legacy canonical publishers"]
    T1_GATES["GATES<br/>Installed contract + durable identity/lock + preprod E2E THEN production"]
    T1_EVIDENCE["EVIDENCE<br/>Graphify 0.18.0 published; Immo implementation/schedule acceptance open"]
  end
  user["User / browser"]
  ppurl["preprod.immo.sent-tech.ca<br/>verified access as-of 2026-09-13"]
  prurl["immo.sent-tech.ca<br/>verified access as-of 2026-09-13"]
  user --> ppurl
  user --> prurl
  subgraph OVH_CLUSTER["[OVH-CLUSTER] OVH BHS shared Kubernetes · observed 3 b3-8 nodes · NOT T3"]
    edge["Traefik / TLS / tenant isolation<br/>shared capacity and safety constraints"]
    subgraph immo_tenant["Immo tenant · application ownership"]
      subgraph immo_pp["PREPRODUCTION · first acceptance"]
        PP_UI["[PP-UI] Immo frontend"]
        PP_API["[PP-API] Immo API"]
        PP_MCP["[PP-MCP] OAuth remote MCP"]
        PP_DB[("[PP-DB] same PostgreSQL/PostGIS")]
        PP_REFRESH["[PP-REFRESH] proposed autonomous CronJob<br/>fresh typed Signal + exact PDF acceptance"]
        subgraph ppminio["[PP-MINIO] existing in-cluster MinIO · retained through T1"]
          PP_RAW[("[PP-RAW] existing API raw role")]
          PP_DOCS[("[PP-DOCS] existing API documents role")]
        end
      end
      subgraph immo_pr["PRODUCTION · promote only after preprod"]
        PR_UI["[PR-UI] Immo frontend"]
        PR_API["[PR-API] Immo API"]
        PR_MCP["[PR-MCP] OAuth remote MCP · target role"]
        PR_DB[("[PR-DB] target database role<br/>physical binding TBD / UNVERIFIED today")]
        PR_REFRESH["[PR-REFRESH] target autonomous CronJob<br/>physical binding TBD / UNVERIFIED today"]
        PR_OBJECT_GAP["Production object bindings<br/>UNVERIFIED today · no provider inferred"]
      end
    end
    subgraph geo_tenant["Geo tenant · geographic inputs and products"]
      PP_GEO["[PP-GEO] Geo API preprod"]
      GEO_API["[GEO-API] Geo API production"]
      GEO_DB[("[GEO-DB] geographic DB role<br/>API dependency UNVERIFIED")]
      GEO_PROCESS["In-process capture / normalize / joins<br/>no invented SQL spatial join"]
    end
    pidp["preprod.auth.sent-tech.ca<br/>SSO / OIDC"]
    idp["auth.sent-tech.ca<br/>SSO / OIDC"]
  end
  PP_GRAPH[("[PP-GRAPH] same existing OVH graph + corpus bucket")]
  PR_GRAPH[("[PR-GRAPH] target graph + corpus role<br/>physical binding TBD / UNVERIFIED today")]
  PP_GEO_S3[("[PP-GEO-S3] OVH normalized serving copy")]
  GEO_S3[("[GEO-S3] OVH corpus + normalized products")]
  WS_ADMIN["[WS-ADMIN] optional enrollment / administration only<br/>no routine LLM runtime after T1"]
  providers["LLM providers<br/>operated from the refresh workload"]
  TEM["[SCW-TEM] retained email exception<br/>until replacement validated"]
  ppurl --> edge
  prurl --> edge
  edge --> PP_UI
  edge --> PR_UI
  PP_UI --> PP_API
  PP_UI --> PP_MCP
  PP_API <--> pidp
  PR_UI --> PR_API
  PR_UI --> PR_MCP
  PR_API <--> idp
  PP_API --> PP_DB
  PP_API --> PP_RAW
  PP_API --> PP_DOCS
  PP_REFRESH --> PP_GRAPH
  PP_REFRESH --> PP_DB
  PP_REFRESH --> providers
  PP_API --> GEO_S3
  PP_API --> PP_GEO
  PR_REFRESH -.-> PR_GRAPH
  PR_REFRESH -.-> PR_DB
  PR_API --> GEO_API
  PP_GEO --> PP_GEO_S3
  GEO_API --> GEO_S3
  GEO_API -.-> GEO_DB
  GEO_PROCESS --> GEO_S3
  WS_ADMIN -.-> PP_REFRESH
```

## T2 — OVH object roles active, old writers fenced

T2 migrates the API raw/document roles to new OVH logical bindings. `PP-RAW`
and `PP-DOCS` remain the physical MinIO identities; they are never reused for
the new buckets. The old store is recovery-only after reader/writer parity and
stays present until the deletion gate. Production bindings remain target roles
until the separately authorized inventory and promotion prove them.

```mermaid
flowchart TB
  subgraph T2_CARD["T2 · PROPOSED / NOT DEPLOYED · stage card"]
    T2_CHANGE["CHANGES<br/>New PP/PR OVH API raw + documents roles; readers/writers repointed and verified"]
    T2_KEEP["KEPT<br/>PP-DB, PP-GRAPH, refresh, Geo corpus, recovery copy and TEM exception"]
    T2_REMOVE["REMOVED AFTER GATE<br/>MinIO consumers + workload/PVC; SCW images/digests/jobs/manual/CI/backup/bootstrap/secret refs"]
    T2_GATES["GATES<br/>Parity + recovery + writer fence + zero consumers in preprod THEN production"]
    T2_EVIDENCE["EVIDENCE<br/>#677 OVH refresh landed; API MinIO and production inventory remain open today"]
  end
  user["User / browser"]
  ppurl["preprod.immo.sent-tech.ca<br/>verified access as-of 2026-09-13"]
  prurl["immo.sent-tech.ca<br/>verified access as-of 2026-09-13"]
  user --> ppurl
  user --> prurl
  subgraph OVH_CLUSTER["[OVH-CLUSTER] OVH BHS shared Kubernetes · still 3 nodes until T3 acceptance"]
    edge["Traefik / TLS / tenant isolation<br/>shared capacity and safety constraints"]
    subgraph immo_tenant["Immo tenant · application ownership"]
      subgraph immo_pp["PREPRODUCTION · storage cutover first"]
        PP_UI["[PP-UI] Immo frontend"]
        PP_API["[PP-API] Immo API"]
        PP_MCP["[PP-MCP] OAuth remote MCP"]
        PP_DB[("[PP-DB] same PostgreSQL/PostGIS")]
        PP_REFRESH["[PP-REFRESH] autonomous refresh retained"]
        subgraph ppminio["[PP-MINIO] old MinIO · fenced recovery only · deletion gate open"]
          PP_RAW[("[PP-RAW] old physical MinIO raw identity")]
          PP_DOCS[("[PP-DOCS] old physical MinIO documents identity")]
        end
      end
      subgraph immo_pr["PRODUCTION · inventory and promotion after preprod"]
        PR_UI["[PR-UI] Immo frontend"]
        PR_API["[PR-API] Immo API"]
        PR_MCP["[PR-MCP] OAuth remote MCP · target role"]
        PR_DB[("[PR-DB] target database role<br/>physical binding TBD / UNVERIFIED today")]
        PR_REFRESH["[PR-REFRESH] target autonomous CronJob<br/>physical binding TBD / UNVERIFIED today"]
      end
    end
    subgraph geo_tenant["Geo tenant · geographic inputs and products"]
      PP_GEO["[PP-GEO] Geo API preprod"]
      GEO_API["[GEO-API] Geo API production"]
      GEO_DB[("[GEO-DB] geographic DB role<br/>API dependency UNVERIFIED")]
      GEO_PROCESS["In-process capture / normalize / joins<br/>no invented SQL spatial join"]
    end
    pidp["preprod.auth.sent-tech.ca<br/>SSO / OIDC"]
    idp["auth.sent-tech.ca<br/>SSO / OIDC"]
  end
  PP_GRAPH[("[PP-GRAPH] same existing OVH graph + corpus bucket")]
  PR_GRAPH[("[PR-GRAPH] target graph + corpus role<br/>physical binding TBD / UNVERIFIED today")]
  PP_RAW_OVH[("[PP-RAW-OVH] new API raw target role<br/>logical binding TBD")]
  PP_DOCS_OVH[("[PP-DOCS-OVH] new API documents target role<br/>logical binding TBD")]
  PR_RAW_OVH[("[PR-RAW-OVH] production API raw target role<br/>physical binding TBD / UNVERIFIED today")]
  PR_DOCS_OVH[("[PR-DOCS-OVH] production API documents target role<br/>physical binding TBD / UNVERIFIED today")]
  PP_GEO_S3[("[PP-GEO-S3] OVH normalized serving copy")]
  GEO_S3[("[GEO-S3] OVH corpus + normalized products")]
  SCW_RESIDUE["SCW final executable sweep<br/>TEM explicitly excluded"]
  TEM["[SCW-TEM] retained email exception<br/>until replacement validated"]
  ppurl --> edge
  prurl --> edge
  edge --> PP_UI
  edge --> PR_UI
  PP_UI --> PP_API
  PP_UI --> PP_MCP
  PP_API <--> pidp
  PR_UI --> PR_API
  PR_UI --> PR_MCP
  PR_API <--> idp
  PP_API --> PP_DB
  PP_API --> PP_RAW_OVH
  PP_API --> PP_DOCS_OVH
  PP_REFRESH --> PP_GRAPH
  PP_REFRESH --> PP_DB
  PP_API --> GEO_S3
  PP_API --> PP_GEO
  PR_API -.-> PR_RAW_OVH
  PR_API -.-> PR_DOCS_OVH
  PR_REFRESH -.-> PR_GRAPH
  PR_REFRESH -.-> PR_DB
  PR_API --> GEO_API
  PP_GEO --> PP_GEO_S3
  GEO_API --> GEO_S3
  GEO_API -.-> GEO_DB
  GEO_PROCESS --> GEO_S3
  SCW_RESIDUE -.-> TEM
```

