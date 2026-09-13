# Sequential target architecture — T1 → T2 → T3

Revision D6, 2026-09-13. The three diagrams are deliberately different kinds of
state: the first is the **effective transition snapshot** on September 13; the
second and third are **after targets, not deployed**. The unchanged IDs identify
the same logical or physical resource between views. A production role marked
`binding TBD` is a target contract, not observed runtime. Preproduction evidence
still precedes any separately gated production promotion.

## Effective transition — T1 validation + partial T2 storage migration

Graphify 0.18.0 is integrated and Luna high is selected. The first Kubernetes
run reached the workload but stopped **before any LLM call**: the selected input
was HTML, while the extraction contract requires a PDF. This is useful runtime
evidence, not T1 acceptance. In parallel, `PP-RAW-OVH` has passed parity and is
the active API raw binding. `PP-DOCS-OVH` and its Secret are provisioned and the
inventory is running; copy tooling is committed, but document copy, parity,
recovery and rebind remain open. The inventory snapshot finds 144,193 / 28.34 GB
in preprod versus 59,017 / 12,534,514,457 B in production `docs-pocs`. By owner decision,
production is the exact initial canonical reference: the target is those same
59,017 keys and hashes in OVH prod and OVH preprod. The preprod surplus is
non-canonical and must not be copied. Production audit/migration has
started without a completed outcome. The detailed causal pipeline is in
[`proposal.md`](proposal.md).

```mermaid
flowchart TB
  subgraph T1_CARD["TRANSITION EFFECTIVE · 2026-09-13 · partial, not accepted"]
    T1_CHANGE["DONE / VERIFIED<br/>Graphify 0.18.0 integrated; Luna high selected<br/>PP-RAW parity + OVH rebind"]
    T1_KEEP["KEPT<br/>PP-DB, PP-GRAPH, API/UI/MCP, Geo evidence<br/>MinIO documents/history + SCW TEM"]
    T1_REMOVE["NOT REMOVED<br/>Workstation/admin path and MinIO retained until their gates pass"]
    T1_GATES["OPEN GATES<br/>Retry T1 with a real PDF → typed Signal + exact PDF → schedule<br/>DOCS diff → PROD canonical 59,017 → selective copy → exact keys+hashes → recoverable MinIO removal"]
    T1_EVIDENCE["OBSERVED<br/>First K8s run failed before LLM: .html input, PDF required<br/>DOCS PP 144,193/28.34 GB vs canonical PR 59,017/12,534,514,457 B"]
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
        PP_REFRESH["[PP-REFRESH] K8s validation workload<br/>first run stopped pre-LLM on .html input"]
        subgraph ppminio["[PP-MINIO] retained for documents/history until T2 gates"]
          PP_RAW[("[PP-RAW] old raw identity<br/>fenced/recovery after OVH rebind")]
          PP_DOCS[("[PP-DOCS] empty API documents fallback")]
          PP_DOCS_LEGACY[("[PP-DOCS-LEGACY] useful replay/history<br/>partial inventory · retained for T2")]
        end
      end
      subgraph immo_pr["PRODUCTION · promote only after preprod"]
        PR_UI["[PR-UI] Immo frontend"]
        PR_API["[PR-API] Immo API"]
        PR_MCP["[PR-MCP] OAuth remote MCP · target role"]
        PR_DB[("[PR-DB] target database role<br/>physical binding TBD / UNVERIFIED today")]
        PR_REFRESH["[PR-REFRESH] target autonomous CronJob<br/>physical binding TBD / UNVERIFIED today"]
        PR_OBJECT_GAP["Production object audit/migration<br/>launched in parallel · outcome UNKNOWN"]
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
  PP_RAW_OVH[("[PP-RAW-OVH] active API raw role<br/>parity passed + rebind verified")]
  PP_DOCS_OVH[("[PP-DOCS-OVH] bucket + Secret provisioned<br/>selective copy/rebind NOT DONE")]
  PR_DOCS_SCW[("[PR-DOCS-SCW] exact canonical docs-pocs<br/>59,017 objects / 12,534,514,457 B")]
  PR_DOCS_OVH[("[PR-DOCS-OVH] production target<br/>audit/migration launched · outcome UNKNOWN")]
  subgraph docs_migration["DOCS convergence gate · no bulk copy / no premature delete"]
    DOCS_DIFF["1 Diff manifests<br/>PP 144,193 vs PR 59,017"]
    DOCS_CANONICAL["2 Canonical set = PROD SCW<br/>exactly 59,017 keys + hashes"]
    DOCS_COPY["3 Selective copy<br/>guarded tooling committed"]
    DOCS_PARITY["4 Exact OVH prod = preprod<br/>59,017 keys + hashes + recovery proof"]
    DOCS_PRUNE["5 Remove all MinIO<br/>only after parity · recoverable"]
    DOCS_DIFF --> DOCS_CANONICAL
    DOCS_CANONICAL --> DOCS_COPY
    DOCS_COPY --> DOCS_PARITY
    DOCS_PARITY --> DOCS_PRUNE
  end
  PP_GEO_S3[("[PP-GEO-S3] OVH normalized serving copy")]
  GEO_S3[("[GEO-S3] OVH corpus + normalized products")]
  WS_ADMIN["[WS-ADMIN] optional enrollment / administration only<br/>no routine LLM runtime after T1"]
  providers["Luna high via llm-mesh<br/>not reached by first K8s run"]
  TEM["[SCW-TEM] retained email exception<br/>until replacement is validated"]
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
  PP_API --> PP_DOCS
  PP_DOCS_OVH -.->|"Inventory/copy target · not rebound"| PP_DOCS
  PP_DOCS_LEGACY --> DOCS_DIFF
  PR_DOCS_SCW --> DOCS_DIFF
  DOCS_COPY -.-> PP_DOCS_OVH
  DOCS_COPY -.-> PR_DOCS_OVH
  PP_REFRESH --> PP_GRAPH
  PP_REFRESH --> PP_DB
  PP_REFRESH -.->|"Next valid-PDF run"| providers
  PP_API --> GEO_S3
  PP_API --> PP_GEO
  PP_API -.->|"DECLARED invitation email"| TEM
  PR_REFRESH -.-> PR_GRAPH
  PR_REFRESH -.-> PR_DB
  PR_API --> GEO_API
  PR_API -.->|"Target email role · binding unverified"| TEM
  PP_GEO --> PP_GEO_S3
  GEO_API --> GEO_S3
  GEO_API -.-> GEO_DB
  GEO_PROCESS --> GEO_S3
  WS_ADMIN -.->|"Retained during validation"| PP_REFRESH
```

## After T2 target — all OVH object roles active, old writers fenced

T2 applies **MIGRATE+RETAIN** to the API raw/document roles and useful legacy
history. The old physical MinIO identities are never reused for new buckets.
`PP-DOCS-LEGACY` stays recovery-only until complete parity and recovery. Production bindings remain target roles
until the separately authorized inventory and promotion prove them.

```mermaid
flowchart TB
  subgraph T2_CARD["T2 · PROPOSED / NOT DEPLOYED · stage card"]
    T2_CHANGE["CHANGES<br/>New PP/PR OVH API raw + documents roles; readers/writers repointed and verified"]
    T2_KEEP["KEPT<br/>PP-DB, PP-GRAPH, refresh, Geo corpus, PP-DOCS-LEGACY recovery and TEM"]
    T2_REMOVE["REMOVED AFTER GATE<br/>MinIO consumers + workload/PVC; SCW images/digests/jobs/manual/CI/backup/bootstrap/secret refs"]
    T2_GATES["GATES<br/>Fail before write + conditional-write capability<br/>parity + recovery + writer fence + zero consumers; preprod THEN production"]
    T2_EVIDENCE["STARTING POINT · 2026-09-13<br/>RAW parity/rebind done; DOCS PP 144,193 vs PR 59,017<br/>surplus PP non-canonical; selective copy/parity/rebind still open"]
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
          PP_DOCS[("[PP-DOCS] empty fallback bucket")]
          PP_DOCS_LEGACY[("[PP-DOCS-LEGACY] retained replay/history<br/>until complete parity + recovery")]
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
  PP_RAW_OVH[("[PP-RAW-OVH] active API raw role<br/>parity + rebind inherited from transition")]
  PP_DOCS_OVH[("[PP-DOCS-OVH] active API documents role<br/>only after copy/parity/recovery/rebind gate")]
  PR_DOCS_SCW[("[PR-DOCS-SCW] exact canonical docs-pocs<br/>59,017 objects / 12,534,514,457 B")]
  PR_RAW_OVH[("[PR-RAW-OVH] production API raw target role<br/>physical binding TBD / UNVERIFIED today")]
  PR_DOCS_OVH[("[PR-DOCS-OVH] target canonical DOCS<br/>same 59,017 keys + hashes as preprod")]
  PP_GEO_S3[("[PP-GEO-S3] OVH normalized serving copy")]
  GEO_S3[("[GEO-S3] OVH corpus + normalized products")]
  SCW_RESIDUE["SCW final executable sweep<br/>TEM explicitly excluded"]
  subgraph docs_migration["Accepted DOCS convergence sequence"]
    DOCS_DIFF["Diff manifests"]
    DOCS_CANONICAL["Canonical set = PROD SCW<br/>59,017 exact keys + hashes"]
    DOCS_COPY["Selective copy"]
    DOCS_PARITY["OVH prod = preprod<br/>59,017 exact keys + hashes"]
    DOCS_PRUNE["Remove all MinIO<br/>recoverable after parity"]
    DOCS_DIFF --> DOCS_CANONICAL
    DOCS_CANONICAL --> DOCS_COPY
    DOCS_COPY --> DOCS_PARITY
    DOCS_PARITY --> DOCS_PRUNE
  end
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
  PP_DOCS_LEGACY --> DOCS_DIFF
  PR_DOCS_SCW --> DOCS_DIFF
  DOCS_COPY --> PP_DOCS_OVH
  DOCS_COPY --> PR_DOCS_OVH
  PP_REFRESH --> PP_GRAPH
  PP_REFRESH --> PP_DB
  PP_API --> GEO_S3
  PP_API --> PP_GEO
  PR_API -.-> PR_RAW_OVH
  PR_API -.-> PR_DOCS_OVH
  PR_REFRESH -.-> PR_GRAPH
  PR_REFRESH -.-> PR_DB
  PR_API --> GEO_API
  PP_API -.->|"DECLARED invitation email"| TEM
  PR_API -.->|"Target email role · binding unverified"| TEM
  PP_GEO --> PP_GEO_S3
  GEO_API --> GEO_S3
  GEO_API -.-> GEO_DB
  GEO_PROCESS --> GEO_S3
  SCW_RESIDUE -.-> TEM
```

## T3 — complete target on one existing b3-8

This is the complete after-state requested for orientation. It is **PROPOSED /
NOT DEPLOYED**. One existing OVH b3-8 houses the Immo and Geo tenants only after
the shared full peak, requests, anti-affinity, PDB and PVC placement prove it
safe. T3 has not started; the current audit is NO-GO and a verified two-node step
must precede any one-node test.
MatchID is outside this dossier. No MinIO or other active Scaleway component is
part of this target; SCW TEM is the sole explicit exception.

```mermaid
flowchart TB
  subgraph T3_CARD["T3 · PROPOSED / NOT DEPLOYED · stage card"]
    T3_CHANGE["CHANGES<br/>After T2: rightsize + reconcile constraints<br/>verify two nodes before testing one existing b3-8"]
    T3_KEEP["KEPT<br/>Prod/preprod URLs + SSO, Immo/Geo roles, OVH stores, backups/recovery and TEM"]
    T3_REMOVE["REMOVED<br/>Extra active cluster nodes only after drain acceptance; no MinIO / other SCW target"]
    T3_GATES["GATES<br/>T2 complete → rightsizing → affinity/PVC constraints<br/>verified 2-node step → 1-node preprod THEN production"]
    T3_EVIDENCE["EVIDENCE · NO-GO TODAY<br/>3 b3-8; allocatable 1840m / 5907.82 Mi; requests 4095m / 8442 Mi; pods 5273 Mi<br/>16 PVC / 15 Cinder RWO; required CoreDNS/konnectivity/Traefik anti-affinity incompatible"]
  end
  user["User / browser / approved MCP client"]
  ppurl["preprod.immo.sent-tech.ca<br/>verified access as-of 2026-09-13"]
  prurl["immo.sent-tech.ca<br/>verified access as-of 2026-09-13"]
  user --> ppurl
  user --> prurl
  subgraph OVH_CLUSTER["[OVH-CLUSTER] TARGET · one EXISTING b3-8 · both Immo and Geo tenants · shared safety/capacity caveat"]
    edge["Traefik / TLS / namespace isolation<br/>shared platform on one failure domain"]
    subgraph immo_tenant["Immo tenant · full product chain"]
      subgraph immo_pp["PREPRODUCTION · acceptance before production"]
        PP_UI["[PP-UI] Immo frontend"]
        PP_API["[PP-API] Immo API"]
        PP_MCP["[PP-MCP] OAuth remote MCP"]
        PP_DB[("[PP-DB] same PostgreSQL/PostGIS")]
        PP_REFRESH["[PP-REFRESH] autonomous Immo CronJob<br/>acquire → profile → 3.4 → graph → PG"]
      end
      subgraph immo_pr["PRODUCTION · target roles; private bindings UNVERIFIED today"]
        PR_UI["[PR-UI] Immo frontend"]
        PR_API["[PR-API] Immo API"]
        PR_MCP["[PR-MCP] OAuth remote MCP · target role"]
        PR_DB[("[PR-DB] target database role<br/>physical binding TBD / UNVERIFIED today")]
        PR_REFRESH["[PR-REFRESH] target autonomous CronJob<br/>physical binding TBD / UNVERIFIED today"]
      end
    end
    subgraph geo_tenant["Geo tenant · geographic services and bounded processing"]
      PP_GEO["[PP-GEO] Geo API preprod"]
      GEO_API["[GEO-API] Geo API production"]
      GEO_DB[("[GEO-DB] geographic database role<br/>API dependency uncertain / UNVERIFIED")]
      GEO_CAPTURE["Geo capture<br/>bytes + URL + time + SHA-256"]
      GEO_NORMALIZE["Geo normalize / provenance"]
      GEO_JOIN["In-process spatial join<br/>parcel ∩ zoning · not SQL"]
      GEO_FOLD["In-process semantic joins<br/>zones + regulations + lots"]
      GEO_CONSTRAINTS["In-process environment constraints<br/>explicit missing-data status"]
    end
    subgraph identity_platform["Shared SSO platform · separate environment issuers"]
      pidp["preprod.auth.sent-tech.ca<br/>SSO / OIDC"]
      idp["auth.sent-tech.ca<br/>SSO / OIDC"]
    end
  end
  subgraph OVH_OBJECTS["OVH object storage · external to the node"]
    PP_GRAPH[("[PP-GRAPH] same OVH graph + corpus bucket")]
    PR_GRAPH[("[PR-GRAPH] target graph + corpus role<br/>physical binding TBD / UNVERIFIED today")]
    PP_RAW_OVH[("[PP-RAW-OVH] active API raw role<br/>parity + rebind accepted in T2")]
    PP_DOCS_OVH[("[PP-DOCS-OVH] active canonical documents<br/>59,017 production-reference keys + hashes")]
    PR_RAW_OVH[("[PR-RAW-OVH] production API raw target role<br/>physical binding TBD / UNVERIFIED today")]
    PR_DOCS_OVH[("[PR-DOCS-OVH] active canonical documents<br/>same 59,017 keys + hashes")]
    PP_GEO_S3[("[PP-GEO-S3] OVH normalized serving copy")]
    GEO_S3[("[GEO-S3] OVH raw corpus + normalized products")]
  end
  subgraph geo_sources["Authoritative geographic and municipal inputs"]
    PV_SRC["PV / notices"]
    ZONES_SRC["Zoning polygons"]
    REGULATIONS_SRC["Regulations / grids"]
    LOTS_SRC["Cadastral lots / assessment"]
    ENV_SRC["Flood / hydrography / CPTAQ"]
  end
  providers["LLM providers<br/>called by operated Immo refresh"]
  WS_ADMIN["[WS-ADMIN] optional enrollment / administration only<br/>no routine LLM runtime"]
  TEM["[SCW-TEM] sole retained Scaleway service<br/>until replacement validated"]
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
  PP_REFRESH --> providers
  PP_API --> GEO_S3
  PP_API --> PP_GEO
  PR_API -.-> PR_RAW_OVH
  PR_API -.-> PR_DOCS_OVH
  PR_REFRESH -.-> PR_GRAPH
  PR_REFRESH -.-> PR_DB
  PR_REFRESH -.-> providers
  PR_API --> GEO_API
  PP_API -.->|"DECLARED invitation email"| TEM
  PR_API -.->|"Target email role · binding unverified"| TEM
  PP_GEO --> PP_GEO_S3
  GEO_API --> GEO_S3
  GEO_API -.-> GEO_DB
  PV_SRC --> GEO_CAPTURE
  ZONES_SRC --> GEO_CAPTURE
  REGULATIONS_SRC --> GEO_CAPTURE
  LOTS_SRC --> GEO_CAPTURE
  ENV_SRC --> GEO_CAPTURE
  GEO_CAPTURE --> GEO_NORMALIZE
  GEO_NORMALIZE --> GEO_JOIN
  GEO_NORMALIZE --> GEO_FOLD
  GEO_JOIN --> GEO_FOLD
  GEO_NORMALIZE --> GEO_CONSTRAINTS
  GEO_NORMALIZE --> GEO_S3
  GEO_FOLD --> GEO_S3
  GEO_CONSTRAINTS --> GEO_S3
  WS_ADMIN -.-> PP_REFRESH
```
